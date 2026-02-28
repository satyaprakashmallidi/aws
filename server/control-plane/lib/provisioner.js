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

// ── VPS auto-provisioning ─────────────────────────────────────────────────────

async function queueNewVpsProvisioning(pendingUserId) {
    const imageId = await contabo.getUbuntu2204ImageId();

    const { data: existingNodes } = await supabase.from('vps_nodes').select('host_shard');
    const hostShard = `h${(existingNodes?.length || 0) + 1}`;
    const ttydSecret = crypto.randomBytes(32).toString('hex');
    const wildcardDomain = `${hostShard}.${SUBDOMAIN}.${BASE_DOMAIN}`;
    const hostKitRepo = process.env.OPENCLAW_HOST_KIT_REPO || 'https://github.com/your-org/openclaw-host-kit.git';

    const cloudInit = `#!/usr/bin/env bash
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y git curl ca-certificates

git clone ${hostKitRepo} /opt/openclaw-host-kit
cd /opt/openclaw-host-kit

cat > .env << 'ENVEOF'
OPENCLAW_BASE_DOMAIN=${BASE_DOMAIN}
OPENCLAW_SUBDOMAIN=${SUBDOMAIN}
OPENCLAW_HOST_SHARD=${hostShard}
OPENCLAW_ACME_EMAIL=${process.env.OPENCLAW_ACME_EMAIL}
OPENCLAW_CF_DNS_API_TOKEN=${process.env.OPENCLAW_CF_DNS_API_TOKEN}
OPENCLAW_TTYD_SECRET=${ttydSecret}
OPENCLAW_RUNTIME_IMAGE=${RUNTIME_IMAGE}
OPENCLAW_CONTROL_PLANE_URL=${CONTROL_PLANE_URL}
OPENCLAW_INTERNAL_SECRET=${INTERNAL_SECRET}
ENVEOF

bash scripts/provision-host.sh
`;

    const userData = Buffer.from(cloudInit).toString('base64');

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
