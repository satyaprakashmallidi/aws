import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import * as contabo from './contabo.js';

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

// ── Inlined from openclaw-host-kit (TS source, no build output) ──────────────

function generateTerminalToken(instanceId, { secret, ttlSeconds = 86400 }) {
    const expiresAt = Math.floor(Date.now() / 1000) + ttlSeconds;
    const payload = `${instanceId}:${expiresAt}`;
    const sig = crypto.createHmac('sha256', secret).update(payload).digest('hex');
    return `${expiresAt}.${sig}`;
}

function buildInstanceUrls({ instanceId, hostShard, baseDomain, subdomain = 'openclaw', terminalToken }) {
    const host = `openclaw-${instanceId}.${hostShard}.${subdomain}.${baseDomain}`;
    return {
        openclawUrl: `https://${host}/`,
        ttydUrl: `https://${host}/terminal?token=${terminalToken}`,
    };
}

function buildProvisionScript({ traefikCompose, openclawRuntimeImage }) {
    const { acmeEmail, wildcardDomain, cfDnsApiToken } = traefikCompose;
    return `#!/usr/bin/env bash
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y ca-certificates curl gnupg lsb-release
if ! command -v docker > /dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sh
fi
systemctl enable --now docker
if ! docker compose version > /dev/null 2>&1; then
  apt-get install -y docker-compose-plugin
fi
mkdir -p /opt/traefik
touch /opt/traefik/acme.json
chmod 600 /opt/traefik/acme.json

cat > /opt/traefik-compose.yml << 'COMPOSE'
version: "3.9"
services:
  traefik:
    image: traefik:v3.1
    container_name: traefik
    restart: unless-stopped
    command:
      - "--providers.docker=true"
      - "--providers.docker.exposedbydefault=false"
      - "--entrypoints.websecure.address=:443"
      - "--certificatesresolvers.le.acme.email=${acmeEmail}"
      - "--certificatesresolvers.le.acme.storage=/acme.json"
      - "--certificatesresolvers.le.acme.dnschallenge=true"
      - "--certificatesresolvers.le.acme.dnschallenge.provider=cloudflare"
      - "--certificatesresolvers.le.acme.dnschallenge.resolvers=1.1.1.1:53,8.8.8.8:53"
      - "--certificatesresolvers.le.acme.dnschallenge.delaybeforecheck=10"
      - "--entrypoints.websecure.http.tls.certresolver=le"
      - "--entrypoints.websecure.http.tls.domains[0].main=${wildcardDomain}"
      - "--entrypoints.websecure.http.tls.domains[0].sans=*.${wildcardDomain}"
    environment:
      - CF_DNS_API_TOKEN=${cfDnsApiToken}
    ports:
      - "443:443"
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
      - /opt/traefik/acme.json:/acme.json
networks:
  default:
    name: traefik_default
COMPOSE

docker compose -p traefik -f /opt/traefik-compose.yml up -d
docker pull ${openclawRuntimeImage} || true
`;
}

// ── Slot management ───────────────────────────────────────────────────────────

export async function findAvailableNode() {
    const { data, error } = await supabase.rpc('claim_vps_slot');
    if (error) throw new Error(`claim_vps_slot: ${error.message}`);
    return data || null;
}

export async function releaseSlot(nodeId) {
    await supabase.rpc('release_vps_slot', { node_id: nodeId });
}

// ── Instance trigger ──────────────────────────────────────────────────────────

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

// ── User provisioning ─────────────────────────────────────────────────────────

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

// ── VPS auto-provisioning ─────────────────────────────────────────────────────

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

    const userData = Buffer.from(`${provisionScript}

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
