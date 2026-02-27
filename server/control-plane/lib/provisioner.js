import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import * as contabo from './contabo.js';
import { generateTerminalToken } from '../../../openclaw-host-kit/src/core/terminalToken.js';
import { buildInstanceUrls } from '../../../openclaw-host-kit/src/core/urls.js';
import { buildProvisionScript } from '../../../openclaw-host-kit/src/core/provision.js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
});

const BASE_DOMAIN = process.env.OPENCLAW_BASE_DOMAIN;
const SUBDOMAIN = process.env.OPENCLAW_SUBDOMAIN || 'openclaw';
const INTERNAL_SECRET = process.env.OPENCLAW_INTERNAL_SECRET;
const CONTROL_PLANE_URL = process.env.OPENCLAW_CONTROL_PLANE_URL;
const RUNTIME_IMAGE = process.env.OPENCLAW_RUNTIME_IMAGE || 'openclaw-ttyd:latest';
const LOCAL_API_PORT = process.env.LOCAL_API_PORT || '4444';
const VPS_CAPACITY_MAX = parseInt(process.env.VPS_CAPACITY_MAX || '6');

export async function findAvailableNode() {
    const { data, error } = await supabase.rpc('claim_vps_slot');
    if (error) throw new Error(`claim_vps_slot: ${error.message}`);
    return data || null;
}

export async function releaseSlot(nodeId) {
    await supabase.rpc('release_vps_slot', { node_id: nodeId });
}

export async function triggerUserInstance(node, userId) {
    const res = await fetch(`http://${node.ip_address}:${LOCAL_API_PORT}/api/internal/create-instance`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Internal-Secret': INTERNAL_SECRET },
        body: JSON.stringify({ instanceId: userId }),
        signal: AbortSignal.timeout(60_000),
    });

    if (!res.ok) throw new Error(`VPS create-instance failed (${res.status}): ${await res.text()}`);

    const result = await res.json();

    const terminalToken = generateTerminalToken(userId, {
        secret: node.ttyd_secret,
        ttlSeconds: 365 * 24 * 60 * 60,
    });

    const urls = buildInstanceUrls({
        instanceId: userId,
        hostShard: node.host_shard,
        baseDomain: node.base_domain,
        subdomain: SUBDOMAIN,
        terminalToken,
    });

    return {
        containerName: result.containerName,
        gatewayToken: result.gatewayToken,
        openclawUrl: urls.openclawUrl,
        ttydUrl: urls.ttydUrl,
    };
}

export async function provisionUser(userId, username) {
    const node = await findAvailableNode();

    if (!node) {
        await queueNewVpsProvisioning(userId);
        await supabase.from('user_profiles').update({ operation_status: 'provisioning' }).eq('userid', userId);
        return { queued: true };
    }

    try {
        const { containerName, gatewayToken, openclawUrl, ttydUrl } = await triggerUserInstance(node, userId);

        await supabase.from('user_profiles').update({
            vps_node_id: node.id,
            docker_container_name: containerName,
            docker_volume_name: `/var/lib/openclaw/instances/${userId}`,
            gateway_name: node.host_shard,
            gateway_token: gatewayToken,
            local_websocket: `wss://${new URL(openclawUrl).hostname}`,
            instance_url: openclawUrl,
            terminal_url: ttydUrl,
            operation_status: 'ready',
            provisioned_at: new Date().toISOString(),
        }).eq('userid', userId);

        return { queued: false, openclawUrl };
    } catch (err) {
        await releaseSlot(node.id);
        throw err;
    }
}

async function queueNewVpsProvisioning(pendingUserId) {
    const imageId = await contabo.getUbuntu2204ImageId();

    const { data: existingNodes } = await supabase.from('vps_nodes').select('host_shard');
    const hostShard = `h${(existingNodes?.length || 0) + 1}`;
    const ttydSecret = crypto.randomBytes(32).toString('hex');
    const wildcardDomain = `${hostShard}.${SUBDOMAIN}.${BASE_DOMAIN}`;

    const provisionScript = buildProvisionScript({
        traefikCompose: {
            acmeEmail: process.env.OPENCLAW_ACME_EMAIL,
            wildcardDomain,
            cfDnsApiToken: process.env.OPENCLAW_CF_DNS_API_TOKEN,
        },
        openclawRuntimeImage: RUNTIME_IMAGE,
    });

    const userData = Buffer.from(`#!/bin/bash
${provisionScript}

cat > /opt/openclaw-host-kit/.env << 'EOF'
OPENCLAW_BASE_DOMAIN=${BASE_DOMAIN}
OPENCLAW_SUBDOMAIN=${SUBDOMAIN}
OPENCLAW_HOST_SHARD=${hostShard}
OPENCLAW_ACME_EMAIL=${process.env.OPENCLAW_ACME_EMAIL}
OPENCLAW_CF_DNS_API_TOKEN=${process.env.OPENCLAW_CF_DNS_API_TOKEN}
OPENCLAW_TTYD_SECRET=${ttydSecret}
OPENCLAW_RUNTIME_IMAGE=${RUNTIME_IMAGE}
OPENCLAW_CONTROL_PLANE_URL=${CONTROL_PLANE_URL}
OPENCLAW_INTERNAL_SECRET=${INTERNAL_SECRET}
EOF

VPS_IP=$(curl -sf https://api.ipify.org)
curl -sf -X POST "${CONTROL_PLANE_URL}/api/webhooks/node-register" \\
  -H "Content-Type: application/json" \\
  -H "X-Internal-Secret: ${INTERNAL_SECRET}" \\
  -d '{"ip":"'"$VPS_IP"'","shard":"${hostShard}","baseDomain":"${BASE_DOMAIN}","ttydSecret":"${ttydSecret}","pendingUserId":"${pendingUserId}"}' || true
`).toString('base64');

    const instance = await contabo.createInstance({
        imageId,
        productId: process.env.CONTABO_PRODUCT_ID || 'V94',
        region: process.env.CONTABO_REGION || 'EU',
        displayName: `openclaw-${hostShard}`,
        userData,
    });

    await supabase.from('vps_nodes').insert({
        contabo_id: instance.instanceId,
        ip_address: '0.0.0.0',
        host_shard: hostShard,
        base_domain: BASE_DOMAIN,
        ttyd_secret: ttydSecret,
        capacity_max: VPS_CAPACITY_MAX,
        capacity_used: 0,
        status: 'provisioning',
    });
}
