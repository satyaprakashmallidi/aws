import express from 'express';
import fs from 'fs';
import path from 'path';
import os from 'os';
import cors from 'cors';
import { execFile, spawn } from 'child_process';
import crypto from 'crypto';

const app = express();

const HOME = os.homedir();
function resolveOpenClawDir() {
    if (process.env.OPENCLAW_DIR) return process.env.OPENCLAW_DIR;
    const candidates = [
        path.join(HOME, '.openclaw'),
        '/home/ubuntu/.openclaw'
    ];
    for (const candidate of candidates) {
        try {
            if (fs.existsSync(candidate)) return candidate;
        } catch {
            // ignore
        }
    }
    return path.join(HOME, '.openclaw');
}

const OPENCLAW_DIR = resolveOpenClawDir();
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

function resolveOpenClawCliPath() {
    if (process.env.OPENCLAW_CLI_PATH) return process.env.OPENCLAW_CLI_PATH;
    const candidates = [
        path.join(HOME, '.npm-global', 'bin', 'openclaw'),
        path.join(HOME, '.local', 'bin', 'openclaw'),
        '/usr/local/bin/openclaw',
        '/usr/bin/openclaw'
    ];
    for (const candidate of candidates) {
        try {
            if (fs.existsSync(candidate)) return candidate;
        } catch {
            // ignore
        }
    }
    return 'openclaw';
}

const OPENCLAW_CLI = resolveOpenClawCliPath();

function parseJsonLoose(value) {
    if (!value || typeof value !== 'string') return null;
    const text = value.trim();
    if (!text) return null;
    try {
        return JSON.parse(text);
    } catch {
        // ignore
    }

    const startIndexes = [];
    for (let i = 0; i < text.length; i += 1) {
        const ch = text[i];
        if (ch === '{' || ch === '[') startIndexes.push(i);
    }
    for (let i = startIndexes.length - 1; i >= 0; i -= 1) {
        const start = startIndexes[i];
        const candidate = text.slice(start).trim();
        try {
            return JSON.parse(candidate);
        } catch {
            // ignore
        }
    }
    return null;
}

function parseToolOutputJson(stdout, stderr) {
    const parsedStdout = parseJsonLoose(stdout);
    if (parsedStdout !== null) return parsedStdout;
    const parsedStderr = parseJsonLoose(stderr);
    if (parsedStderr !== null) return parsedStderr;
    return null;
}

function getSessionsIndexPath(agentId = 'main') {
    return path.join(OPENCLAW_DIR, 'agents', agentId, 'sessions', 'sessions.json');
}

function readSessionsIndex(agentId = 'main') {
    const indexPath = getSessionsIndexPath(agentId);
    if (!fs.existsSync(indexPath)) return null;
    const raw = fs.readFileSync(indexPath, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
}

function sessionsIndexToList(indexObj) {
    if (!indexObj || typeof indexObj !== 'object') return [];
    return Object.entries(indexObj).map(([key, meta]) => {
        if (!meta || typeof meta !== 'object') return { key };
        return sanitizeSessionSummary({ key, ...meta });
    });
}

function sanitizeSessionSummary(session) {
    const key = session?.key || session?.sessionKey || session?.id || '';
    const kind = session?.kind || session?.chatType || session?.type;
    const updatedAt = session?.updatedAt || session?.timestamp;
    const sessionId = session?.sessionId || session?.id;

    const out = {
        key,
        ...(kind ? { kind } : {}),
        ...(updatedAt ? { updatedAt } : {}),
        ...(sessionId ? { sessionId } : {})
    };

    const allow = [
        'ageMs',
        'systemSent',
        'abortedLastRun',
        'inputTokens',
        'outputTokens',
        'totalTokens',
        'totalTokensFresh',
        'model',
        'modelProvider',
        'contextTokens',
        'deliveryContext',
        'lastChannel',
        'origin'
    ];
    for (const k of allow) {
        if (session?.[k] !== undefined) out[k] = session[k];
    }
    return out;
}

async function listSessionsCli({ limit = 500 } = {}) {
    const attempts = [
        ['sessions', '--json'],
        ['sessions', 'list', '--json'],
        ['sessions']
    ];
    let last = null;
    for (const args of attempts) {
        const { code, stdout, stderr } = await runOpenClaw(args, { timeoutMs: 20000 });
        last = { code, stdout, stderr, args };
        if (code !== 0) continue;
        const parsed = parseToolOutputJson(stdout, stderr);
        if (!parsed) continue;
        if (Array.isArray(parsed.sessions)) return { sessions: parsed.sessions, total: parsed.count || parsed.total || parsed.sessions.length };
        if (Array.isArray(parsed)) return { sessions: parsed, total: parsed.length };
        if (parsed && typeof parsed === 'object') {
            const sessions = parsed.sessions || parsed.items || [];
            if (Array.isArray(sessions)) return { sessions, total: parsed.count || parsed.total || sessions.length };
        }
    }
    throw new Error(`Failed to list sessions via CLI${last ? ` (last: ${OPENCLAW_CLI} ${last.args.join(' ')})` : ''}`);
}

function readSessionHistoryFromDisk(sessionKey, { limit = 50, includeTools = false, agentId = 'main' } = {}) {
    const index = readSessionsIndex(agentId);
    if (!index) return null;
    const meta = index?.[sessionKey];
    if (!meta) return null;

    const sessionsDir = path.join(OPENCLAW_DIR, 'agents', agentId, 'sessions');
    const fileCandidate = meta.sessionFile || (meta.sessionId ? path.join(sessionsDir, `${meta.sessionId}.jsonl`) : null);
    if (!fileCandidate) return null;

    const resolved = path.isAbsolute(fileCandidate) ? fileCandidate : path.join(sessionsDir, fileCandidate);
    if (!fs.existsSync(resolved)) return null;

    const raw = fs.readFileSync(resolved, 'utf8');
    const lines = raw.split(/\r?\n/).filter(Boolean);
    const events = [];
    for (const line of lines) {
        const parsed = parseJsonLoose(line);
        if (!parsed || typeof parsed !== 'object') continue;
        if (parsed.type !== 'message' || !parsed.message) continue;
        const role = parsed.message?.role;
        if (!includeTools && (role === 'tool' || role === 'toolResult' || role === 'tool_result')) continue;
        events.push(parsed);
    }

    const total = events.length;
    const sliced = limit > 0 ? events.slice(Math.max(0, events.length - limit)) : events;
    return { messages: sliced, total };
}

function takeRecentSessionsWithMain(sessions, { agentId = 'main', limit = 30 } = {}) {
    const list = Array.isArray(sessions) ? sessions.filter(Boolean) : [];
    const mainKey = `agent:${agentId}:main`;
    const byUpdated = (a, b) => (b?.updatedAt || 0) - (a?.updatedAt || 0);

    const main = list.find(s => (s?.key || s?.sessionKey || s?.id) === mainKey);
    const rest = list
        .filter(s => (s?.key || s?.sessionKey || s?.id) !== mainKey)
        .sort(byUpdated);

    const max = Math.max(1, Number(limit) || 30);
    const take = main ? max - 1 : max;
    const trimmed = rest.slice(0, take);
    if (main) return [main, ...trimmed];
    return trimmed;
}

const ALLOWED_PROVIDERS = new Set([
    'google-antigravity',
    'openai',
    'azure',
    'anthropic',
    'gemini'
]);

const PROVIDER_CATALOG = [
    {
        key: 'google',
        label: 'Google',
        authMethods: ['api_key', 'paste_token'],
        authLabels: {
            api_key: 'Google Gemini API key',
            paste_token: 'Paste token'
        }
    },
    { key: 'google-antigravity', label: 'Google Antigravity', authMethods: ['api_key', 'paste_token'] },
    { key: 'gemini', label: 'Gemini', authMethods: ['api_key', 'paste_token'] },
    { key: 'openai', label: 'OpenAI', authMethods: ['api_key', 'paste_token'] },
    { key: 'anthropic', label: 'Anthropic', authMethods: ['api_key', 'paste_token'] },
    { key: 'openrouter', label: 'OpenRouter', authMethods: ['api_key', 'paste_token'] },
    { key: 'xai', label: 'xAI (Grok)', authMethods: ['api_key', 'paste_token'] },
    { key: 'together', label: 'Together AI', authMethods: ['api_key', 'paste_token'] },
    { key: 'groq', label: 'Groq', authMethods: ['api_key', 'paste_token'] },
    { key: 'fireworks', label: 'Fireworks', authMethods: ['api_key', 'paste_token'] },
    { key: 'perplexity', label: 'Perplexity', authMethods: ['api_key', 'paste_token'] },
    { key: 'mistral', label: 'Mistral', authMethods: ['api_key', 'paste_token'] },
    { key: 'cohere', label: 'Cohere', authMethods: ['api_key', 'paste_token'] },
    { key: 'huggingface', label: 'Hugging Face', authMethods: ['api_key', 'paste_token'] },
    { key: 'cloudflare', label: 'Cloudflare AI Gateway', authMethods: ['api_key', 'paste_token'] },
    { key: 'vercel-ai-gateway', label: 'Vercel AI Gateway', authMethods: ['api_key', 'paste_token'] },
    { key: 'custom', label: 'Custom Provider', authMethods: ['api_key', 'paste_token'] }
];

const OAUTH_SESSIONS = new Map();

function requireApiSecret(req, res) {
    if (!LOCAL_API_SECRET) {
        res.status(500).json({ error: 'LOCAL_API_SECRET not set' });
        return false;
    }
    const provided = req.headers['x-api-secret'];
    if (!provided || provided !== LOCAL_API_SECRET) {
        res.status(401).json({ error: 'Unauthorized' });
        return false;
    }
    return true;
}

function runOpenClaw(args, { timeoutMs = 20000, stdin, env } = {}) {
    return new Promise((resolve, reject) => {
        const child = spawn(OPENCLAW_CLI, args, {
            stdio: ['pipe', 'pipe', 'pipe'],
            env: {
                ...process.env,
                OPENCLAW_DIR,
                OPENCLAW_CONFIG_PATH,
                OPENCLAW_WORKSPACE: WORKSPACE_DIR,
                ...(env || {})
            }
        });

        let stdout = '';
        let stderr = '';
        const timeout = setTimeout(() => {
            try { child.kill(); } catch { /* ignore */ }
        }, timeoutMs);

        child.stdout.on('data', (data) => { stdout += data.toString(); });
        child.stderr.on('data', (data) => { stderr += data.toString(); });

        child.on('error', (err) => {
            clearTimeout(timeout);
            reject(err);
        });

        child.on('close', (code) => {
            clearTimeout(timeout);
            resolve({ code, stdout, stderr });
        });

        if (stdin !== undefined) {
            child.stdin.write(String(stdin));
            child.stdin.end();
        } else {
            child.stdin.end();
        }
    });
}

async function runOpenClawJson(args, options) {
    const { code, stdout, stderr } = await runOpenClaw(args, options);
    if (code !== 0) {
        const err = new Error(`openclaw ${args.join(' ')} failed with code ${code}`);
        err.stdout = stdout;
        err.stderr = stderr;
        throw err;
    }
    try {
        return JSON.parse(stdout);
    } catch (parseError) {
        const err = new Error('Failed to parse openclaw JSON output');
        err.stdout = stdout;
        err.stderr = stderr;
        err.parseError = parseError;
        throw err;
    }
}

async function restartGatewayCli() {
    const { code, stdout, stderr } = await runOpenClaw(['gateway', 'restart'], { timeoutMs: 120000 });
    if (code !== 0) {
        const err = new Error(`openclaw gateway restart failed with code ${code}`);
        err.stdout = stdout;
        err.stderr = stderr;
        throw err;
    }
    return { stdout, stderr };
}

async function ensurePluginEnabled(pluginId) {
    const { code, stdout, stderr } = await runOpenClaw(['plugins', 'enable', String(pluginId)], { timeoutMs: 45000 });
    if (code !== 0) {
        const err = new Error(`openclaw plugins enable ${pluginId} failed with code ${code}`);
        err.stdout = stdout;
        err.stderr = stderr;
        throw err;
    }
    return { stdout, stderr };
}

function newSessionId() {
    return crypto.randomBytes(16).toString('hex');
}

const allowedOrigins = [
    'https://openclaw-frontend.vercel.app',
    'https://openclaw.ai',
    'https://app.openclaw.ai',
    'https://api.magicteams.ai'
];

app.use(cors({
    origin: (origin, callback) => {
        if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
        return callback(new Error('Not allowed by CORS'));
    },
    credentials: true
}));
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
        if (Array.isArray(data.agents?.list)) {
            for (const agent of data.agents.list) {
                if (agent && typeof agent === 'object' && agent.description !== undefined) {
                    delete agent.description;
                }
            }
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
    if (!requireApiSecret(req, res)) return;

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

    const child = spawn(OPENCLAW_CLI, args, { stdio: ['pipe', 'pipe', 'pipe'] });
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
        try {
            const parsed = JSON.parse(content);
            writeJson(OPENCLAW_CONFIG_PATH, parsed);
        } catch {
            fs.writeFileSync(OPENCLAW_CONFIG_PATH, content);
        }
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

app.get('/api/models/gateway', async (req, res) => {
    try {
        try {
            const toolCandidates = ['models_list', 'models.list', 'list_models', 'modelsList', 'session_status'];
            let lastError = null;
            for (const tool of toolCandidates) {
                try {
                    const response = await invokeTool(tool, {});
                    const details = response?.result?.details || {};
                    const models = response?.models || details.models || details.availableModels || details.model || [];
                    if (Array.isArray(models)) {
                        return res.json({ models, source: tool });
                    }
                    if (typeof models === 'string') {
                        return res.json({ models: [models], source: tool });
                    }
                } catch (err) {
                    lastError = err;
                }
            }
            if (lastError) throw lastError;
        } catch (error) {
            // Fallback: derive models from active sessions if models_list is not exposed.
            const fallback = await invokeTool('sessions_list', { activeMinutes: 1440, limit: 500 });
            const details = fallback?.result?.details || {};
            const sessions = details.sessions || fallback.sessions || [];
            const seen = new Set();
            const models = [];
            for (const session of sessions) {
                const model = session?.model;
                if (model && !seen.has(model)) {
                    seen.add(model);
                    models.push(model);
                }
            }
            return res.json({ models, source: 'sessions_list', note: 'models_list tool not available' });
        }
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
});

app.get('/api/models/catalog-all', async (req, res) => {
    try {
        execFile(
            OPENCLAW_CLI,
            ['models', 'list', '--all', '--json'],
            { timeout: 15000, maxBuffer: 10 * 1024 * 1024, env: { ...process.env } },
            (error, stdout, stderr) => {
                if (error) {
                    return res.status(500).json({
                        error: error.message,
                        stderr: stderr?.toString()?.slice(0, 500)
                    });
                }
                try {
                    const parsed = JSON.parse(stdout);
                    const models = parsed?.models || parsed?.data || parsed || [];
                    return res.json({ models, source: 'cli' });
                } catch (parseError) {
                    return res.status(500).json({
                        error: 'Failed to parse models list output',
                        details: parseError.message
                    });
                }
            }
        );
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

app.post('/api/providers/oauth/start', (req, res) => {
    if (!LOCAL_API_SECRET) {
        return res.status(500).json({ error: 'LOCAL_API_SECRET not set' });
    }
    if (!requireApiSecret(req, res)) return;
    const { provider } = req.body || {};
    if (!provider) return res.status(400).json({ error: 'Provider is required' });

    const child = spawn(OPENCLAW_CLI, ['models', 'auth', 'login', '--provider', provider], {
        stdio: ['pipe', 'pipe', 'pipe']
    });

    const sessionId = newSessionId();
    let stdout = '';
    let stderr = '';
    let resolved = false;

    const cleanup = () => {
        if (OAUTH_SESSIONS.has(sessionId)) {
            OAUTH_SESSIONS.delete(sessionId);
        }
    };

    const timeout = setTimeout(() => {
        if (!resolved) {
            resolved = true;
            cleanup();
            try { child.kill(); } catch { /* ignore */ }
        }
    }, 5 * 60 * 1000);

    child.stdout.on('data', (data) => {
        stdout += data.toString();
        const pattern = new RegExp('https://accounts\\.google\\.com/o/oauth2/v2/auth\\S+');
        const match = stdout.match(pattern);
        if (match && !resolved) {
            resolved = true;
            const authUrl = match[0];
            OAUTH_SESSIONS.set(sessionId, { child, provider, startedAt: Date.now(), timeout });
            return res.json({ sessionId, authUrl });
        }
    });

    child.stderr.on('data', (data) => {
        stderr += data.toString();
    });

    child.on('close', (code) => {
        if (!resolved) {
            clearTimeout(timeout);
            cleanup();
            return res.status(500).json({
                error: `OAuth process exited with code ${code}`,
                stderr: stderr.slice(0, 500)
            });
        }
    });
});

app.post('/api/providers/oauth/complete', (req, res) => {
    if (!LOCAL_API_SECRET) {
        return res.status(500).json({ error: 'LOCAL_API_SECRET not set' });
    }
    if (!requireApiSecret(req, res)) return;
    const { sessionId, redirectUrl } = req.body || {};
    if (!sessionId || !redirectUrl) {
        return res.status(400).json({ error: 'sessionId and redirectUrl are required' });
    }
    const session = OAUTH_SESSIONS.get(sessionId);
    if (!session) {
        return res.status(404).json({ error: 'OAuth session not found or expired' });
    }

    const { child, timeout } = session;
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => { stdout += data.toString(); });
    child.stderr.on('data', (data) => { stderr += data.toString(); });

    child.on('close', (code) => {
        clearTimeout(timeout);
        OAUTH_SESSIONS.delete(sessionId);
        if (code !== 0) {
            return res.status(500).json({
                error: `OAuth completion failed with code ${code}`,
                stderr: stderr.slice(0, 500)
            });
        }
        return res.json({ ok: true, output: stdout.slice(0, 2000) });
    });

    child.stdin.write(`${redirectUrl}\n`);
    child.stdin.end();
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

app.get('/api/plugins', async (req, res) => {
    try {
        const attempts = [
            { source: 'plugins.list --json', args: ['plugins', 'list', '--json'] },
            { source: 'plugins.list', args: ['plugins', 'list'] },
            { source: 'plugins', args: ['plugins'] }
        ];
        let last = null;
        for (const attempt of attempts) {
            const { code, stdout, stderr } = await runOpenClaw(attempt.args, { timeoutMs: 20000 });
            if (code !== 0) {
                last = { code, stdout, stderr, source: attempt.source };
                continue;
            }
            const parsed = parseToolOutputJson(stdout, stderr);
            return res.json({ ok: true, source: attempt.source, ...(parsed ? { parsed } : {}), ...(stdout ? { stdout } : {}), ...(stderr ? { stderr } : {}) });
        }
        return res.status(500).json({
            error: `Command failed${last?.source ? ` (${last.source})` : ''}`,
            stderr: last?.stderr?.slice(0, 2000),
            stdout: last?.stdout?.slice(0, 2000)
        });
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
});

app.post('/api/plugins/enable', async (req, res) => {
    if (!requireApiSecret(req, res)) return;
    const { id } = req.body || {};
    if (!id) return res.status(400).json({ error: 'Plugin id is required' });
    try {
        const enable = await ensurePluginEnabled(id);
        const restarted = await restartGatewayCli();
        return res.json({ ok: true, enable, restarted });
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
});

app.post('/api/gateway/restart', async (req, res) => {
    if (!requireApiSecret(req, res)) return;
    try {
        const restarted = await restartGatewayCli();
        return res.json({ ok: true, restarted });
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
});

app.get('/api/channels/status', async (req, res) => {
    const attempts = [
        { source: 'channels.status --probe --json', args: ['channels', 'status', '--probe', '--json'], timeoutMs: 20000 },
        { source: 'gateway.call status', args: ['gateway', 'call', 'status', '--json'], timeoutMs: 15000 },
        { source: 'gateway.call health', args: ['gateway', 'call', 'health', '--json'], timeoutMs: 15000 },
        { source: 'status', args: ['status'], timeoutMs: 15000 }
    ];
    let lastError = null;
    for (const attempt of attempts) {
        try {
            const { code, stdout, stderr } = await runOpenClaw(attempt.args, { timeoutMs: attempt.timeoutMs });
            if (code !== 0) throw Object.assign(new Error(`Command failed (${attempt.source})`), { stderr, stdout, code });
            const parsed = parseToolOutputJson(stdout, stderr);
            if (parsed) return res.json({ ok: true, source: attempt.source, parsed });
            return res.json({ ok: true, source: attempt.source, stdout, stderr });
        } catch (error) {
            lastError = error;
        }
    }
    return res.status(500).json({ error: lastError?.message || 'Failed to fetch channel status' });
});

app.get('/api/channels/list', async (req, res) => {
    const attempts = [
        { source: 'channels.list --json', args: ['channels', 'list', '--json'] },
        { source: 'channels.list', args: ['channels', 'list'] }
    ];
    let lastError = null;
    for (const attempt of attempts) {
        try {
            const { code, stdout, stderr } = await runOpenClaw(attempt.args, { timeoutMs: 15000 });
            if (code !== 0) throw Object.assign(new Error(`Command failed (${attempt.source})`), { stderr, stdout, code });
            const parsed = parseToolOutputJson(stdout, stderr);
            if (parsed) return res.json({ ok: true, source: attempt.source, parsed });
            return res.json({ ok: true, source: attempt.source, stdout, stderr });
        } catch (error) {
            lastError = error;
        }
    }
    return res.status(500).json({ error: lastError?.message || 'Failed to list channels' });
});

app.post('/api/channels/add', async (req, res) => {
    if (!requireApiSecret(req, res)) return;
    const {
        channel,
        account,
        name,
        token,
        tokenFile,
        useEnv,
        slackBotToken,
        slackAppToken
    } = req.body || {};

    if (!channel) return res.status(400).json({ error: 'channel is required' });
    const args = ['channels', 'add', '--channel', String(channel)];
    if (account) args.push('--account', String(account));
    if (name) args.push('--name', String(name));

    const chan = String(channel);
    if (chan === 'telegram') {
        if (tokenFile) args.push('--token-file', String(tokenFile));
        else if (useEnv) args.push('--use-env');
        else if (token) args.push('--token', String(token));
        else return res.status(400).json({ error: 'telegram requires token, tokenFile, or useEnv' });
    } else if (chan === 'discord') {
        if (useEnv) args.push('--use-env');
        else if (token) args.push('--token', String(token));
        else return res.status(400).json({ error: 'discord requires token or useEnv' });
    } else if (chan === 'slack') {
        if (slackBotToken) args.push('--bot-token', String(slackBotToken));
        if (slackAppToken) args.push('--app-token', String(slackAppToken));
        if (!slackBotToken && !slackAppToken) {
            return res.status(400).json({ error: 'slack requires slackBotToken and/or slackAppToken' });
        }
    } else {
        return res.status(400).json({ error: `Unsupported channel: ${chan}` });
    }

    try {
        const plugin = await ensurePluginEnabled(chan);
        const { code, stdout, stderr } = await runOpenClaw(args, { timeoutMs: 45000 });
        if (code !== 0) {
            return res.status(500).json({ error: `Command failed with code ${code}`, stderr: stderr.slice(0, 2000), stdout: stdout.slice(0, 2000) });
        }
        const restarted = await restartGatewayCli();
        return res.json({ ok: true, plugin, command: { stdout, stderr }, restarted });
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
});

app.post('/api/channels/remove', async (req, res) => {
    if (!requireApiSecret(req, res)) return;
    const { channel, account } = req.body || {};
    if (!channel) return res.status(400).json({ error: 'channel is required' });
    const args = ['channels', 'remove', '--channel', String(channel)];
    if (account) args.push('--account', String(account));
    try {
        const { code, stdout, stderr } = await runOpenClaw(args, { timeoutMs: 30000 });
        if (code !== 0) {
            return res.status(500).json({ error: `Command failed with code ${code}`, stderr: stderr.slice(0, 2000), stdout: stdout.slice(0, 2000) });
        }
        const restarted = await restartGatewayCli();
        return res.json({ ok: true, command: { stdout, stderr }, restarted });
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
});

app.post('/api/channels/logout', async (req, res) => {
    if (!requireApiSecret(req, res)) return;
    const { channel, account } = req.body || {};
    if (!channel) return res.status(400).json({ error: 'channel is required' });
    const args = ['channels', 'logout', '--channel', String(channel)];
    if (account) args.push('--account', String(account));
    try {
        const { code, stdout, stderr } = await runOpenClaw(args, { timeoutMs: 45000 });
        if (code !== 0) {
            return res.status(500).json({ error: `Command failed with code ${code}`, stderr: stderr.slice(0, 2000), stdout: stdout.slice(0, 2000) });
        }
        const restarted = await restartGatewayCli();
        return res.json({ ok: true, command: { stdout, stderr }, restarted });
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
});

app.post('/api/channels/login', async (req, res) => {
    if (!requireApiSecret(req, res)) return;
    const { channel, account, verbose } = req.body || {};
    if (!channel) return res.status(400).json({ error: 'channel is required' });

    const chan = String(channel);
    if (chan === 'whatsapp') {
        try {
            await ensurePluginEnabled('whatsapp');
            await restartGatewayCli();
        } catch (error) {
            return res.status(500).json({ error: error.message });
        }
    }

    const args = ['channels', 'login', '--channel', String(channel)];
    if (account) args.push('--account', String(account));
    if (verbose) args.push('--verbose');

    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.flushHeaders?.();

    const child = spawn(OPENCLAW_CLI, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const killTimer = setTimeout(() => {
        try { child.kill(); } catch { /* ignore */ }
    }, 5 * 60 * 1000);

    const writeChunk = (prefix, data) => {
        try {
            res.write(`${prefix}${data.toString()}`);
        } catch {
            // If client disconnects, stop the child.
            try { child.kill(); } catch { /* ignore */ }
        }
    };

    child.stdout.on('data', (data) => writeChunk('', data));
    child.stderr.on('data', (data) => writeChunk('[stderr] ', data));

    child.on('close', (code) => {
        clearTimeout(killTimer);
        try { res.write(`\n[exit] code=${code}\n`); } catch { /* ignore */ }
        res.end();
    });

    child.on('error', (err) => {
        clearTimeout(killTimer);
        try { res.write(`\n[error] ${err.message}\n`); } catch { /* ignore */ }
        res.end();
    });
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
            const requestedLimit = limit ? parseInt(limit, 10) : 30;

            // 1) Try gateway tool (fast when available)
            try {
                const response = await invokeTool('sessions_list', {
                    limit: requestedLimit,
                    activeMinutes: 43200,
                    messageLimit: 3
                });
                const details = response?.result?.details || {};
                const raw = details.sessions || response.sessions || [];
                const sessions = (Array.isArray(raw) ? raw : []).map(sanitizeSessionSummary);
                if (sessions.length > 1) {
                    sessions.sort((a, b) => (b?.updatedAt || 0) - (a?.updatedAt || 0));
                    const limited = takeRecentSessionsWithMain(sessions, { agentId: 'main', limit: requestedLimit });
                    return res.json({ sessions: limited, total: details.count || response.total || sessions.length, source: 'gateway' });
                }
            } catch {
                // ignore and fall back
            }

            // 2) Try CLI (matches what TUI shows)
            try {
                const { sessions, total } = await listSessionsCli({ limit: requestedLimit });
                const list = (Array.isArray(sessions) ? sessions : []).map(sanitizeSessionSummary);
                list.sort((a, b) => (b?.updatedAt || 0) - (a?.updatedAt || 0));
                const limited = takeRecentSessionsWithMain(list, { agentId: 'main', limit: requestedLimit });
                return res.json({ sessions: limited, total: total || list.length, source: 'cli' });
            } catch {
                // ignore and fall back
            }

            // 3) Read from disk
            const index = readSessionsIndex('main');
            if (!index) return res.status(500).json({ error: 'Failed to load sessions (no sessions index found)' });
            const list = sessionsIndexToList(index);
            list.sort((a, b) => (b?.updatedAt || 0) - (a?.updatedAt || 0));
            const limited = takeRecentSessionsWithMain(list, { agentId: 'main', limit: requestedLimit });
            return res.json({ sessions: limited, total: list.length, source: 'disk' });
        }

        // Prefer disk-based history (avoids relying on tools/invoke).
        const requestedLimit = limit ? parseInt(limit, 10) : 50;
        const wantTools = includeTools === 'true';
        const disk = readSessionHistoryFromDisk(sessionKey, { limit: requestedLimit, includeTools: wantTools, agentId: 'main' });
        if (disk) {
            return res.json({ sessionKey, messages: disk.messages, total: disk.total, source: 'disk' });
        }

        const response = await invokeTool('sessions_history', {
            sessionKey,
            limit: requestedLimit,
            includeTools: wantTools
        });
        const details = response?.result?.details || {};
        return res.json({
            sessionKey,
            messages: details.messages || response.messages || [],
            total: details.total || response.total || 0,
            source: 'gateway'
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
