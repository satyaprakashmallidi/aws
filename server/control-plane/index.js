import express from 'express';
import { createClient } from '@supabase/supabase-js';
import webhookRoutes from './routes/webhooks.js';
import { provisionUser } from './lib/provisioner.js';

const app = express();
const PORT = process.env.CONTROL_PLANE_PORT || 4445;

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
});

app.use('/api/webhooks/stripe', express.raw({ type: 'application/json' }));
app.use(express.json());

app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', process.env.ALLOWED_ORIGIN || 'http://localhost:5173');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Internal-Secret');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
});

function requireInternal(req, res, next) {
    if (req.headers['x-internal-secret'] !== process.env.OPENCLAW_INTERNAL_SECRET) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
}

app.get('/healthz', (_, res) => res.json({ ok: true }));

app.use('/api/webhooks', webhookRoutes);

app.post('/api/provision/user', requireInternal, async (req, res) => {
    const { userId, username } = req.body;
    if (!userId) return res.status(400).json({ error: 'userId required' });
    try {
        return res.json(await provisionUser(userId, username || userId));
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

app.get('/api/fleet', requireInternal, async (_, res) => {
    const { data, error } = await supabase
        .from('vps_nodes')
        .select('id, host_shard, ip_address, base_domain, capacity_max, capacity_used, status, created_at')
        .order('created_at', { ascending: true });
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ nodes: data });
});

app.listen(PORT, () => console.log(`[control-plane] port ${PORT}`));

export default app;
