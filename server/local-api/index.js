import express from 'express';
import fs from 'fs';
import path from 'path';
import os from 'os';
import cors from 'cors';
import { execFile, spawn } from 'child_process';

const app = express();

const HOME = os.homedir();
const OPENCLAW_DIR = process.env.OPENCLAW_DIR || path.join(HOME, '.openclaw');
const OPENCLAW_CONFIG_PATH = process.env.OPENCLAW_CONFIG_PATH || path.join(OPENCLAW_DIR, 'openclaw.json');
const WORKSPACE_DIR = process.env.OPENCLAW_WORKSPACE || path.join(OPENCLAW_DIR, 'workspace');
const SOUL_PATHS = [
    path.join(OPENCLAW_DIR, 'memory', 'SOUL.md'),
    path.join(OPENCLAW_DIR, 'SOUL.md'),
    path.join(WORKSPACE_DIR, 'SOUL.md'),
    path.join(WORKSPACE_DIR, 'memory', 'SOUL.md')
];

const GATEWAY_URL = process.env.OPENCLAW_GATEWAY_URL || 'http://127.0.0.1:18789';
const GATEWAY_TOKEN = process.env.OPENCLAW_GATEWAY_TOKEN;
const LOCAL_API_SECRET = process.env.LOCAL_API_SECRET || '';

const ALLOWED_PROVIDERS = new Set([
    'google-antigravity',
    'openai',
    'azure',
    'anthropic',
    'gemini'
]);

const PROVIDER_CATALOG = [
    { key: 'openai', label: 'OpenAI', authMethods: ['api_key', 'oauth'] },
    { key: 'anthropic', label: 'Anthropic', authMethods: ['api_key'] },
    { key: 'google', label: 'Google', authMethods: ['api_key'] },
    { key: 'openrouter', label: 'OpenRouter', authMethods: ['api_key'] },
    { key: 'xai', label: 'xAI (Grok)', authMethods: ['api_key'] },
    { key: 'together', label: 'Together AI', authMethods: ['api_key'] },
    { key: 'groq', label: 'Groq', authMethods: ['api_key'] },
    { key: 'fireworks', label: 'Fireworks', authMethods: ['api_key'] },
    { key: 'perplexity', label: 'Perplexity', authMethods: ['api_key'] },
    { key: 'mistral', label: 'Mistral', authMethods: ['api_key'] },
    { key: 'cohere', label: 'Cohere', authMethods: ['api_key'] },
    { key: 'huggingface', label: 'Hugging Face', authMethods: ['api_key'] },
    { key: 'cloudflare', label: 'Cloudflare AI Gateway', authMethods: ['api_key'] },
    { key: 'vercel-ai-gateway', label: 'Vercel AI Gateway', authMethods: ['api_key'] },
    { key: 'openai-codex', label: 'OpenAI Codex (ChatGPT OAuth)', authMethods: ['oauth'] },
    { key: 'custom', label: 'Custom Provider', authMethods: ['api_key'] }
];

app.use(cors());
app.use(express.json({ limit: '2mb' }));

function readJson(filePath) {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, data) {
    // Strip legacy keys no longer accepted by OpenClaw.
    if (data && typeof data === 'object') {
        if (data.identity !== undefined) {
            delete data.identity;
        }
        if (data.agents?.defaults?.description !== undefined) {
            delete data.agents.defaults.description;
        }
    }
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function readConfigSafe() {
    try {
        return readJson(OPENCLAW_CONFIG_PATH);
    } catch {
        return {};
    }
}

function normalizeModelKey(providerKey, modelId) {
    if (!providerKey || !modelId) return '';
    const trimmed = String(modelId).trim();
    if (!trimmed) return '';
    if (trimmed.includes('/')) return trimmed;
    return `${providerKey}/${trimmed}`;
}

function listModelsFromConfig(config) {
    const models = [];
    const seen = new Set();
    const primary = config?.agents?.defaults?.model?.primary;
    if (primary) {
        models.push({ key: primary, name: primary.split('/').pop() });
        seen.add(primary);
    }
    const fallbacks = config?.agents?.defaults?.model?.fallbacks || [];
    for (const fb of fallbacks) {
        if (!seen.has(fb)) {
            models.push({ key: fb, name: fb.split('/').pop() });
            seen.add(fb);
        }
    }
    const providers = config?.models?.providers || {};
    for (const [providerKey, provider] of Object.entries(providers)) {
        for (const model of (provider.models || [])) {
            const key = `${providerKey}/${model.id}`;
            if (seen.has(key)) continue;
            models.push({ key, name: model.name || model.id });
            seen.add(key);
        }
    }
    return models;
}

function safeWorkspacePath(name) {
    if (!name || typeof name !== 'string') return null;
    const normalized = name.replace(/\\/g, '/').trim();
    if (normalized.startsWith('/') || normalized.includes('..')) return null;
    return path.join(WORKSPACE_DIR, normalized);
}

function getAgentEntry(config, agentId) {
    const list = Array.isArray(config?.agents?.list) ? config.agents.list : [];
    return list.find(agent => agent?.id === agentId) || null;
}

function upsertAgentEntry(config, agentId) {
    if (!config.agents) config.agents = {};
    if (!Array.isArray(config.agents.list)) config.agents.list = [];
    let entry = config.agents.list.find(agent => agent?.id === agentId);
    if (!entry) {
        entry = { id: agentId };
        config.agents.list.push(entry);
    }
    return entry;
}

async function invokeTool(tool, args = {}) {
    if (!GATEWAY_TOKEN) {
        throw new Error('OPENCLAW_GATEWAY_TOKEN not set');
    }
    const response = await fetch(`${GATEWAY_URL.replace(/\/$/, '')}/tools/invoke`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${GATEWAY_TOKEN}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ tool, args })
    });
    if (!response.ok) {
        const text = await response.text();
        throw new Error(`Tools API error (${response.status}): ${text}`);
    }
    return response.json();
}

app.get('/api/health', async (req, res) => {
    try {
        const baseUrl = GATEWAY_URL.replace(/\/$/, '');
        // Fast path: root HTML should respond quickly if gateway is up.
        try {
            const rootRes = await fetch(`${baseUrl}/`, {
                method: 'GET',
                signal: AbortSignal.timeout(2000)
            });
            if (rootRes.ok) {
                return res.json({ status: 'online', ts: new Date().toISOString() });
            }
        } catch {
            // Fall through to deeper check
        }

        if (!GATEWAY_TOKEN) {
            return res.status(200).json({ status: 'offline', message: 'Missing gateway token' });
        }

        const response = await fetch(`${baseUrl}/v1/chat/completions`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${GATEWAY_TOKEN}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: 'health-check',
                messages: [{ role: 'user', content: 'ping' }],
                max_tokens: 1
            }),
            signal: AbortSignal.timeout(10000)
        });

        if (!response.ok) {
            const text = await response.text();
            return res.status(200).json({
                status: 'offline',
                message: `Gateway error ${response.status}`,
                details: text.slice(0, 200)
            });
        }

        return res.json({ status: 'online', ts: new Date().toISOString() });
    } catch (error) {
        return res.status(200).json({ status: 'offline', message: error.message });
    }
});

app.get('/api/models', (req, res) => {
    try {
        const config = readJson(OPENCLAW_CONFIG_PATH);
        const models = listModelsFromConfig(config);
        const currentModel = config?.agents?.defaults?.model?.primary || '';
        res.json({ models, currentModel });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/providers', (req, res) => {
    try {
        const config = readConfigSafe();
        const providers = Object.keys(config?.models?.providers || {});
        res.json({ providers });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/providers/catalog', (req, res) => {
    return res.json({ providers: PROVIDER_CATALOG });
});

app.get('/api/provider', (req, res) => {
    const { name } = req.query || {};
    if (!name) return res.status(400).json({ error: 'Provider name required' });
    try {
        const config = readConfigSafe();
        const provider = config?.models?.providers?.[name];
        if (!provider) return res.status(404).json({ error: 'Provider not found' });
        res.json({ name, provider });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.put('/api/provider', (req, res) => {
    const { name } = req.query || {};
    const { provider } = req.body || {};
    if (!name) return res.status(400).json({ error: 'Provider name required' });
    if (provider === undefined) return res.status(400).json({ error: 'Provider payload required' });
    try {
        const config = readConfigSafe();
        if (!config.models) config.models = {};
        if (!config.models.providers) config.models.providers = {};
        config.models.providers[name] = provider;
        writeJson(OPENCLAW_CONFIG_PATH, config);
        res.json({ ok: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/providers/connect', (req, res) => {
    if (!LOCAL_API_SECRET) {
        return res.status(500).json({ error: 'LOCAL_API_SECRET not set' });
    }
    const provided = req.headers['x-api-secret'];
    if (!provided || provided !== LOCAL_API_SECRET) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    const { provider, token, expiresIn, profileId } = req.body || {};
    if (!provider || !ALLOWED_PROVIDERS.has(provider)) {
        return res.status(400).json({ error: 'Invalid provider' });
    }
    if (!token || typeof token !== 'string') {
        return res.status(400).json({ error: 'Token is required' });
    }

    const args = ['models', 'auth', 'paste-token', '--provider', provider];
    if (expiresIn) args.push('--expires-in', String(expiresIn));
    if (profileId) args.push('--profile-id', String(profileId));

    const child = spawn('openclaw', args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => { stdout += data.toString(); });
    child.stderr.on('data', (data) => { stderr += data.toString(); });

    child.on('error', (err) => {
        return res.status(500).json({ error: err.message, stderr });
    });

    child.on('close', (code) => {
        if (code !== 0) {
            return res.status(500).json({ error: `Command failed with code ${code}`, stderr });
        }
        return res.json({ ok: true, stdout });
    });

    child.stdin.write(token);
    child.stdin.end();
});

app.post('/api/model', (req, res) => {
    const { model } = req.body || {};
    if (!model) return res.status(400).json({ error: 'Model is required' });
    try {
        const config = readConfigSafe();
        if (!config.agents) config.agents = {};
        if (!config.agents.defaults) config.agents.defaults = {};
        if (!config.agents.defaults.model) config.agents.defaults.model = {};
        config.agents.defaults.model.primary = model;
        writeJson(OPENCLAW_CONFIG_PATH, config);
        res.json({ ok: true, model });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/openclaw-config', (req, res) => {
    try {
        const content = fs.readFileSync(OPENCLAW_CONFIG_PATH, 'utf8');
        res.json({ path: OPENCLAW_CONFIG_PATH, content });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.put('/api/openclaw-config', (req, res) => {
    const { content } = req.body || {};
    if (typeof content !== 'string') return res.status(400).json({ error: 'Content is required' });
    try {
        fs.writeFileSync(OPENCLAW_CONFIG_PATH, content);
        res.json({ ok: true, path: OPENCLAW_CONFIG_PATH });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/models/config', (req, res) => {
    try {
        const config = readConfigSafe();
        const defaults = config?.agents?.defaults || {};
        const modelCfg = defaults.model || {};
        const allowed = Array.isArray(defaults.models) ? defaults.models : [];
        return res.json({
            primary: modelCfg.primary || '',
            fallbacks: Array.isArray(modelCfg.fallbacks) ? modelCfg.fallbacks : [],
            allowedModels: allowed,
            providers: config?.models?.providers || {}
        });
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
});

app.post('/api/models/config', (req, res) => {
    const { primary, fallbacks, allowedModels } = req.body || {};
    try {
        const config = readConfigSafe();
        if (!config.agents) config.agents = {};
        if (!config.agents.defaults) config.agents.defaults = {};
        if (!config.agents.defaults.model) config.agents.defaults.model = {};

        if (primary) {
            config.agents.defaults.model.primary = primary;
        }
        if (Array.isArray(fallbacks)) {
            config.agents.defaults.model.fallbacks = fallbacks;
        }
        if (Array.isArray(allowedModels)) {
            config.agents.defaults.models = allowedModels;
        }

        writeJson(OPENCLAW_CONFIG_PATH, config);
        return res.json({ ok: true });
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
});

app.get('/api/models/catalog', (req, res) => {
    const { provider } = req.query || {};
    if (!provider) return res.status(400).json({ error: 'Provider key required' });
    try {
        const config = readConfigSafe();
        const providerCfg = config?.models?.providers?.[provider];
        const models = Array.isArray(providerCfg?.models) ? providerCfg.models : [];
        return res.json({ provider, models });
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
});

app.post('/api/providers/custom', (req, res) => {
    const { key, label, baseUrl, api, authHeader, headers, models } = req.body || {};
    if (!key || !baseUrl || !api) {
        return res.status(400).json({ error: 'key, baseUrl, and api are required' });
    }
    try {
        const config = readConfigSafe();
        if (!config.models) config.models = {};
        if (!config.models.providers) config.models.providers = {};
        config.models.providers[key] = {
            label: label || key,
            baseUrl,
            api,
            ...(authHeader ? { authHeader } : {}),
            ...(headers ? { headers } : {}),
            models: Array.isArray(models) ? models : []
        };
        writeJson(OPENCLAW_CONFIG_PATH, config);
        return res.json({ ok: true });
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
});

app.get('/api/soul', (req, res) => {
    try {
        for (const filePath of SOUL_PATHS) {
            if (fs.existsSync(filePath)) {
                const content = fs.readFileSync(filePath, 'utf8');
                return res.json({ path: filePath, content });
            }
        }
        res.status(404).json({ error: 'SOUL.md not found' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.put('/api/soul', (req, res) => {
    const { content } = req.body || {};
    if (typeof content !== 'string') return res.status(400).json({ error: 'Content is required' });
    try {
        const filePath = SOUL_PATHS.find(p => fs.existsSync(p)) || SOUL_PATHS[0];
        fs.writeFileSync(filePath, content);
        res.json({ ok: true, path: filePath });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/workspace-file', (req, res) => {
    const filePath = safeWorkspacePath(req.query.name);
    if (!filePath) return res.status(400).json({ error: 'Invalid file name' });
    try {
        const content = fs.readFileSync(filePath, 'utf8');
        res.json({ path: filePath, content });
    } catch (error) {
        res.status(404).json({ error: error.message });
    }
});

app.put('/api/workspace-file', (req, res) => {
    const filePath = safeWorkspacePath(req.query.name);
    const { content } = req.body || {};
    if (!filePath) return res.status(400).json({ error: 'Invalid file name' });
    if (typeof content !== 'string') return res.status(400).json({ error: 'Content is required' });
    try {
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, content);
        res.json({ ok: true, path: filePath });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/workspace-list', (req, res) => {
    try {
        const entries = [];
        const root = WORKSPACE_DIR;
        const stack = ['.'];
        while (stack.length) {
            const rel = stack.pop();
            const abs = path.join(root, rel);
            const stat = fs.statSync(abs);
            if (stat.isDirectory()) {
                const items = fs.readdirSync(abs);
                for (const item of items) {
                    if (item === '.git' || item === 'node_modules') continue;
                    const nextRel = path.join(rel, item);
                    stack.push(nextRel);
                }
            } else if (stat.isFile()) {
                entries.push(rel.replace(/^[.][\\/]/, '').replace(/\\/g, '/'));
            }
        }
        entries.sort();
        res.json({ files: entries });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/agents', async (req, res) => {
    try {
        const { action, id } = req.query;
        if (action === 'status') {
            const response = await invokeTool('sessions_list', { activeMinutes: 60 });
            const details = response?.result?.details || {};
            const sessions = details.sessions || response.sessions || [];
            const activeAgents = new Set();
            sessions.forEach(session => {
                const key = session?.key || session?.sessionKey || '';
                const parts = key.split(':');
                if (parts[0] === 'agent' && parts[1]) activeAgents.add(parts[1]);
            });
            return res.json({
                totalAgents: sessions.length,
                activeAgents: Array.from(activeAgents),
                activeCount: activeAgents.size,
                sessions
            });
        }
        if (action === 'models') {
            const config = readJson(OPENCLAW_CONFIG_PATH);
            return res.json(listModelsFromConfig(config));
        }
        if (id) {
            const config = readJson(OPENCLAW_CONFIG_PATH);
            const agentEntry = getAgentEntry(config, id);
            const identity = agentEntry?.identity || config.identity || { name: 'OpenClaw', emoji: '🦞' };
            return res.json({
                id,
                description: agentEntry?.description || '',
                model: config.agents?.defaults?.model?.primary || '',
                identity,
                workspace: config.agents?.defaults?.workspace || WORKSPACE_DIR,
                availableModels: listModelsFromConfig(config).map(m => m.key),
                providers: Object.keys(config.models?.providers || {})
            });
        }

        const response = await invokeTool('agents_list', {});
        const details = response?.result?.details || {};
        const agents = details.agents || response.agents || [];
        const config = readJson(OPENCLAW_CONFIG_PATH);
        const model = config.agents?.defaults?.model?.primary || '';

        const enriched = agents.map(agent => ({
            ...agent,
            identity: getAgentEntry(config, agent?.id)?.identity || config.identity || { name: 'OpenClaw', emoji: '🦞' },
            description: getAgentEntry(config, agent?.id)?.description || '',
            model
        }));

        res.json({ agents: enriched, requester: details.requester || 'main', allowAny: details.allowAny || false });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.patch('/api/agents', (req, res) => {
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: 'Agent ID required' });
    try {
        const updates = req.body || {};
        const config = readJson(OPENCLAW_CONFIG_PATH);
        if (!config.agents) config.agents = {};
        if (!config.agents.defaults) config.agents.defaults = {};

        if (updates.description !== undefined) {
            const entry = upsertAgentEntry(config, id);
            entry.description = updates.description;
        }
        if (updates.model) {
            if (!config.agents.defaults.model) config.agents.defaults.model = {};
            config.agents.defaults.model.primary = updates.model;
        }
        if (updates.identity?.name !== undefined) {
            const entry = upsertAgentEntry(config, id);
            entry.identity = entry.identity || {};
            entry.identity.name = updates.identity.name;
        }
        if (updates.identity?.emoji !== undefined) {
            const entry = upsertAgentEntry(config, id);
            entry.identity = entry.identity || {};
            entry.identity.emoji = updates.identity.emoji;
        }

        writeJson(OPENCLAW_CONFIG_PATH, config);
        return res.json({ ok: true });
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
});

app.post('/api/chat', async (req, res) => {
    try {
        const { message, agentId = 'main', sessionId, stream } = req.body || {};
        if (!message) return res.status(400).json({ error: 'Message required' });
        const payload = {
            model: `openclaw:${agentId}`,
            user: sessionId || `user:local`,
            messages: [{ role: 'user', content: message }],
            stream: Boolean(stream)
        };
        const response = await fetch(`${GATEWAY_URL.replace(/\/$/, '')}/v1/chat/completions`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${GATEWAY_TOKEN}`,
                'Content-Type': 'application/json',
                ...(agentId !== 'main' ? { 'x-openclaw-agent-id': agentId } : {}),
                ...(sessionId ? { 'x-openclaw-session-key': sessionId } : {})
            },
            body: JSON.stringify(payload)
        });
        if (!response.ok) {
            const text = await response.text();
            return res.status(response.status).send(text);
        }
        if (stream) {
            res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
            res.setHeader('Cache-Control', 'no-store');
            response.body.pipeTo(WritableStreamToNode(res));
            return;
        }
        const data = await response.json();
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/chat', async (req, res) => {
    const { action, sessionKey, limit, includeTools } = req.query;
    if (action !== 'history' && action !== 'sessions') return res.status(400).json({ error: 'Invalid action' });
    try {
        if (action === 'sessions') {
            const response = await invokeTool('sessions_list', {
                // Broaden filters so older/other kinds show up in the UI selector.
                limit: limit ? parseInt(limit, 10) : 200,
                activeMinutes: 43200,
                messageLimit: 3
            });
            const details = response?.result?.details || {};
            return res.json({
                sessions: details.sessions || response.sessions || [],
                total: details.count || response.total || 0
            });
        }

        const response = await invokeTool('sessions_history', {
            sessionKey,
            limit: limit ? parseInt(limit, 10) : 50,
            includeTools: includeTools === 'true'
        });
        const details = response?.result?.details || {};
        res.json({
            sessionKey,
            messages: details.messages || response.messages || [],
            total: details.total || response.total || 0
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/tasks', async (req, res) => {
    try {
        const response = await invokeTool('cron', { action: 'list', includeDisabled: true });
        const details = response?.result?.details || {};
        const jobs = details.jobs || response.jobs || [];
        res.json({ jobs });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/tasks', async (req, res) => {
    try {
        const response = await invokeTool('cron', { action: 'add', job: req.body });
        res.json(response);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/tasks/:id/run', async (req, res) => {
    try {
        const response = await invokeTool('cron', { action: 'run', jobId: req.params.id });
        res.json(response);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/tasks/:id/pickup', async (req, res) => {
    try {
        const response = await invokeTool('cron', {
            action: 'update',
            jobId: req.params.id,
            updates: {
                metadata: {
                    status: 'picked_up',
                    pickedUpAt: new Date().toISOString()
                }
            }
        });
        res.json(response);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/tasks/:id/complete', async (req, res) => {
    try {
        const response = await invokeTool('cron', {
            action: 'update',
            jobId: req.params.id,
            updates: {
                metadata: {
                    status: 'completed',
                    completedAt: new Date().toISOString(),
                    result: req.body?.result || null
                }
            }
        });
        res.json(response);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

const PORT = process.env.LOCAL_API_PORT ? Number(process.env.LOCAL_API_PORT) : 3333;
app.listen(PORT, '127.0.0.1', () => {
    console.log(`OpenClaw local API running on http://127.0.0.1:${PORT}`);
});

function WritableStreamToNode(res) {
    return new WritableStream({
        write(chunk) {
            res.write(Buffer.from(chunk));
        },
        close() {
            res.end();
        }
    });
}
