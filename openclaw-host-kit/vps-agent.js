import express from 'express';
import { execFile } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const app = express();
app.use(express.json());

const PORT = process.env.VPS_AGENT_PORT || 4444;
const INTERNAL_SECRET = process.env.OPENCLAW_INTERNAL_SECRET || '';
const HOST_KIT_DIR = process.env.OPENCLAW_HOST_KIT_DIR
    || path.dirname(fileURLToPath(import.meta.url));

function requireInternal(req, res, next) {
    if (!INTERNAL_SECRET || req.headers['x-internal-secret'] !== INTERNAL_SECRET) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
}

function validId(id) {
    return typeof id === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(id);
}

app.get('/healthz', (_, res) => res.json({ ok: true }));

app.post('/api/internal/create-instance', requireInternal, async (req, res) => {
    const { instanceId } = req.body;
    if (!validId(instanceId)) return res.status(400).json({ error: 'Invalid instanceId' });

    const scriptPath = path.join(HOST_KIT_DIR, 'scripts', 'create-instance.sh');
    if (!fs.existsSync(scriptPath)) {
        return res.status(500).json({ error: `create-instance.sh not found at ${scriptPath}` });
    }

    try {
        const output = await new Promise((resolve, reject) => {
            execFile('bash', [scriptPath, instanceId], {
                cwd: HOST_KIT_DIR,
                timeout: 90_000,
                env: { ...process.env },
            }, (err, stdout, stderr) => {
                if (err) return reject(new Error(`create-instance.sh: ${stderr || err.message}`));
                resolve(stdout);
            });
        });

        const configPath = path.join(`/var/lib/openclaw/instances/${instanceId}`, 'openclaw.json');
        let gatewayToken = null;
        try {
            if (fs.existsSync(configPath)) {
                gatewayToken = JSON.parse(fs.readFileSync(configPath, 'utf8'))?.gateway?.auth?.token || null;
            }
        } catch { /* not yet written */ }

        return res.json({ ok: true, instanceId, containerName: `openclaw-${instanceId}`, gatewayToken, output: output.trim() });
    } catch (err) {
        console.error('[vps-agent] create-instance:', err);
        return res.status(500).json({ error: err.message });
    }
});

app.delete('/api/internal/remove-instance/:instanceId', requireInternal, async (req, res) => {
    const { instanceId } = req.params;
    if (!validId(instanceId)) return res.status(400).json({ error: 'Invalid instanceId' });

    try {
        await new Promise((resolve, reject) => {
            execFile('docker', ['rm', '-f', `openclaw-${instanceId}`], { timeout: 30_000 },
                (err, stdout, stderr) => {
                    if (err) return reject(new Error(`docker rm: ${stderr || err.message}`));
                    resolve(stdout);
                });
        });

        execFile('rm', ['-rf', `/var/lib/openclaw/instances/${instanceId}`]);

        return res.json({ ok: true, instanceId });
    } catch (err) {
        console.error('[vps-agent] remove-instance:', err);
        return res.status(500).json({ error: err.message });
    }
});

app.listen(PORT, '0.0.0.0', () => console.log(`[vps-agent] port ${PORT}`));
