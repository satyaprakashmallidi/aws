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

let chatInFlight = 0;

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

function parseAgentIdFromSessionKey(sessionKey) {
    const s = String(sessionKey || '');
    const m = s.match(/^agent:([^:]+):/);
    return m ? m[1] : null;
}

function parseSessionKeyParts(sessionKey) {
    const s = String(sessionKey || '').trim();
    if (!s.startsWith('agent:')) return null;
    const parts = s.split(':');
    if (parts.length < 4) return null;
    const agentId = parts[1];
    const sessionId = parts[parts.length - 1];
    return { agentId, sessionId, sessionKey: s };
}

function listAgentIdsOnDisk() {
    try {
        const agentsDir = path.join(OPENCLAW_DIR, 'agents');
        if (!fs.existsSync(agentsDir)) return [];
        return fs.readdirSync(agentsDir, { withFileTypes: true })
            .filter(d => d.isDirectory())
            .map(d => d.name)
            .filter(Boolean);
    } catch {
        return [];
    }
}

function findSessionJsonlPath({ sessionId, agentId } = {}) {
    const id = String(sessionId || '').trim();
    if (!id) return null;

    const candidates = [];
    if (agentId) {
        candidates.push(path.join(OPENCLAW_DIR, 'agents', String(agentId), 'sessions', `${id}.jsonl`));
    }
    for (const a of listAgentIdsOnDisk()) {
        if (a === agentId) continue;
        candidates.push(path.join(OPENCLAW_DIR, 'agents', a, 'sessions', `${id}.jsonl`));
    }
    for (const p of candidates) {
        try {
            if (p && fs.existsSync(p)) return p;
        } catch {
            // ignore
        }
    }
    return null;
}

function extractUuidsDeep(value, out = new Set()) {
    if (!value) return out;
    if (typeof value === 'string') {
        const m = String(value).match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/ig);
        if (m) for (const id of m) out.add(id);
        return out;
    }
    if (Array.isArray(value)) {
        for (const v of value) extractUuidsDeep(v, out);
        return out;
    }
    if (typeof value === 'object') {
        for (const v of Object.values(value)) extractUuidsDeep(v, out);
        return out;
    }
    return out;
}

function extractSessionKeysDeep(value, out = new Set()) {
    if (!value) return out;
    if (typeof value === 'string') {
        const m = String(value).match(/agent:[^:\s]+:[^:\s]+:[^:\s]+/g);
        if (m) for (const k of m) out.add(k);
        return out;
    }
    if (Array.isArray(value)) {
        for (const v of value) extractSessionKeysDeep(v, out);
        return out;
    }
    if (typeof value === 'object') {
        for (const v of Object.values(value)) extractSessionKeysDeep(v, out);
        return out;
    }
    return out;
}

function coerceToolArgs(args) {
    if (!args) return null;
    if (typeof args === 'string') {
        const parsed = parseJsonLoose(args);
        return parsed && typeof parsed === 'object' ? parsed : { value: args };
    }
    if (typeof args === 'object') return args;
    return { value: args };
}

function clipText(text, maxChars = 2000) {
    const s = String(text || '');
    if (!s) return '';
    return s.length > maxChars ? `${s.slice(0, maxChars - 1)}…` : s;
}

function simpleUnifiedDiff(oldText, newText, { context = 2, maxLines = 120 } = {}) {
    const a = String(oldText ?? '').split(/\r?\n/);
    const b = String(newText ?? '').split(/\r?\n/);
    let start = 0;
    while (start < a.length && start < b.length && a[start] === b[start]) start += 1;

    let endA = a.length - 1;
    let endB = b.length - 1;
    while (endA >= start && endB >= start && a[endA] === b[endB]) {
        endA -= 1;
        endB -= 1;
    }

    const beforeStart = Math.max(0, start - context);
    const afterEndA = Math.min(a.length, endA + 1 + context);
    const afterEndB = Math.min(b.length, endB + 1 + context);

    const removed = a.slice(start, endA + 1);
    const added = b.slice(start, endB + 1);
    const before = a.slice(beforeStart, start);
    const after = a.slice(endA + 1, afterEndA);

    const header = `@@ -${start + 1},${removed.length} +${start + 1},${added.length} @@`;
    const out = [header];
    for (const line of before) out.push(` ${line}`);
    for (const line of removed) out.push(`-${line}`);
    for (const line of added) out.push(`+${line}`);
    for (const line of after) out.push(` ${line}`);

    return out.slice(0, maxLines).join('\n');
}

function extractFileChangesFromEvents(events, { pathPrefix = 'memory/', maxItems = 50 } = {}) {
    const changes = [];
    const add = (change) => {
        if (!change?.path) return;
        if (pathPrefix && !String(change.path).startsWith(pathPrefix)) return;
        changes.push(change);
    };

    for (const ev of Array.isArray(events) ? events : []) {
        const ts = ev?.timestamp || ev?.ts || null;
        const msg = ev?.message;
        if (!msg) continue;
        const content = msg?.content;
        const parts = Array.isArray(content) ? content : [];

        for (const part of parts) {
            if (!part || typeof part !== 'object') continue;
            const type = part.type || part.kind;
            if (type !== 'toolCall') continue;

            const name = String(part.name || part.tool || part.toolName || '').trim();
            if (!name) continue;
            if (name !== 'write' && name !== 'edit') continue;

            const args = coerceToolArgs(part.arguments);
            const p = args?.path || args?.file_path || args?.filePath || args?.target || args?.to;
            const filePath = typeof p === 'string' ? p : null;
            if (!filePath) continue;

            if (name === 'write') {
                const body = args?.content ?? args?.text ?? args?.data ?? '';
                add({
                    ts,
                    tool: 'write',
                    path: filePath,
                    summary: `write ${filePath} (${String(body).length} chars)`,
                    preview: clipText(body, 2000)
                });
            }

            if (name === 'edit') {
                const oldText = args?.oldText ?? args?.old_text ?? args?.before ?? args?.old;
                const newText = args?.newText ?? args?.new_text ?? args?.after ?? args?.new;
                const patch = args?.patch ?? args?.input;
                const diff = (typeof patch === 'string' && patch.trim())
                    ? patch
                    : (typeof oldText === 'string' || typeof newText === 'string')
                        ? simpleUnifiedDiff(oldText || '', newText || '')
                        : '';

                add({
                    ts,
                    tool: 'edit',
                    path: filePath,
                    summary: `edit ${filePath}`,
                    diff: clipText(diff, 4000)
                });
            }
        }

        if (changes.length >= maxItems) break;
    }

    return changes;
}

function readSessionJsonlById({ sessionId, agentId, limit = 400 } = {}) {
    const filePath = findSessionJsonlPath({ sessionId, agentId });
    if (!filePath) return { filePath: null, events: [], total: 0 };
    const raw = fs.readFileSync(filePath, 'utf8');
    const lines = raw.split(/\r?\n/).filter(Boolean);
    const parsed = [];
    for (const line of lines) {
        const obj = parseJsonLoose(line);
        if (obj && typeof obj === 'object') parsed.push(obj);
    }
    const total = parsed.length;
    const sliced = limit > 0 ? parsed.slice(Math.max(0, total - limit)) : parsed;
    return { filePath, events: sliced, total };
}

function summarizeSessionActivity(events, { hideThinking = true, showToolArgs = true, maxLineLen = 500, defaultAgentId = 'main' } = {}) {
    const lines = [];
    const toolCalls = new Map();
    const spawnCallIds = new Set();
    const spawnCalls = new Map(); // callId -> { agentId }
    const childSessions = new Map(); // key -> { agentId, sessionId, sessionKey? }

    const push = (s) => {
        const t = String(s || '').trim();
        if (!t) return;
        const clipped = t.length > maxLineLen ? `${t.slice(0, maxLineLen - 1)}…` : t;
        lines.push(clipped);
    };

    for (const ev of Array.isArray(events) ? events : []) {
        const ts = ev?.timestamp || ev?.ts;
        const msg = ev?.message;
        const role = msg?.role;
        const content = msg?.content;
        const prefix = ts ? `[${new Date(ts).toISOString()}] ` : '';

        const handlePart = (part) => {
            if (!part || typeof part !== 'object') return;
            const type = part.type || part.kind;
            if (type === 'thinking' && hideThinking) return;
            if (type === 'text' && typeof part.text === 'string') push(`${prefix}${role || 'assistant'}: ${part.text}`);

            if (type === 'toolCall') {
                const name = part.name || part.tool || part.toolName;
                const id = part.id || part.callId || part.toolCallId;
                const args = part.arguments;
                if (id) toolCalls.set(String(id), { name, args });
                if (String(name) === 'sessions_spawn' && id) {
                    spawnCallIds.add(String(id));
                    const targetAgent = args && typeof args === 'object'
                        ? (args.agentId || args.agent || null)
                        : null;
                    spawnCalls.set(String(id), { agentId: targetAgent ? String(targetAgent) : null });
                }
                if (showToolArgs) push(`${prefix}tool: ${String(name || 'unknown')} ${args !== undefined ? JSON.stringify(args) : ''}`);
                else push(`${prefix}tool: ${String(name || 'unknown')}`);
            }

            if (type === 'toolResult' || type === 'tool_result') {
                const id = part.id || part.callId || part.toolCallId;
                const forCall = id ? toolCalls.get(String(id)) : null;
                if (forCall && String(forCall.name) === 'sessions_spawn' && id) {
                    const payload = part.output || part.result || part.value || part.content || part;
                    const keys = extractSessionKeysDeep(payload);
                    for (const k of keys) {
                        const parsed = parseSessionKeyParts(k);
                        if (parsed?.agentId && parsed?.sessionId) {
                            childSessions.set(`${parsed.agentId}:${parsed.sessionId}`, parsed);
                        }
                    }

                    if (childSessions.size === 0) {
                        // Fallback: some outputs only include a raw session UUID.
                        const ids = extractUuidsDeep(payload);
                        const spawn = spawnCalls.get(String(id)) || {};
                        const agent = spawn.agentId || defaultAgentId;
                        for (const sid of ids) {
                            const sessionId = String(sid || '').trim();
                            if (!sessionId) continue;
                            childSessions.set(`${agent}:${sessionId}`, { agentId: agent, sessionId });
                        }
                    }
                }
            }
        };

        if (typeof content === 'string') {
            if (role === 'assistant' || role === 'user') push(`${prefix}${role}: ${content}`);
            continue;
        }

        if (Array.isArray(content)) {
            for (const part of content) handlePart(part);
            continue;
        }

        if (content && typeof content === 'object') {
            // Some events store tool calls/results as objects directly.
            handlePart(content);
        }
    }

    // Also scan toolResult-style messages for sessions_spawn child sessionIds/keys.
    for (const ev of Array.isArray(events) ? events : []) {
        const msg = ev?.message;
        const role = msg?.role;
        if (role !== 'tool' && role !== 'toolResult' && role !== 'tool_result') continue;
        const content = msg?.content;
        const toolCallId = msg?.toolCallId || msg?.tool_call_id || ev?.toolCallId;
        if (toolCallId && spawnCallIds.has(String(toolCallId))) {
            const keys = extractSessionKeysDeep(content);
            for (const k of keys) {
                const parsed = parseSessionKeyParts(k);
                if (parsed?.agentId && parsed?.sessionId) {
                    childSessions.set(`${parsed.agentId}:${parsed.sessionId}`, parsed);
                }
            }

            if (keys.size === 0) {
                const spawn = spawnCalls.get(String(toolCallId)) || {};
                const agent = spawn.agentId || defaultAgentId;
                const ids = extractUuidsDeep(content);
                for (const sid of ids) {
                    const sessionId = String(sid || '').trim();
                    if (!sessionId) continue;
                    childSessions.set(`${agent}:${sessionId}`, { agentId: agent, sessionId });
                }
            }
        }
    }

    return { lines: lines.slice(-800), childSessions: Array.from(childSessions.values()) };
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
        let finished = false;

        const finish = (err, result) => {
            if (finished) return;
            finished = true;
            clearTimeout(timeout);
            try { child.kill('SIGKILL'); } catch { /* ignore */ }
            if (err) reject(err);
            else resolve(result);
        };

        const timeout = setTimeout(() => {
            const err = new Error(`openclaw ${args.join(' ')} timed out after ${timeoutMs}ms`);
            err.code = 'OPENCLAW_TIMEOUT';
            err.stdout = stdout;
            err.stderr = stderr;
            try { child.kill('SIGKILL'); } catch { /* ignore */ }
            finish(err);
        }, Math.max(1000, timeoutMs || 20000));

        child.stdout.on('data', (data) => { stdout += data.toString(); });
        child.stderr.on('data', (data) => { stderr += data.toString(); });

        child.on('error', (err) => {
            err.stdout = stdout;
            err.stderr = stderr;
            finish(err);
        });

        child.on('close', (code) => {
            finish(null, { code, stdout, stderr });
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

function isLikelyGatewayTimeout(err) {
    const msg = String(err?.stderr || err?.stdout || err?.message || '').toLowerCase();
    return msg.includes('gateway timeout') || msg.includes('timed out') || msg.includes('econnrefused') || msg.includes('other side closed');
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

    const controller = new AbortController();
    const timeoutMs = process.env.TOOLS_TIMEOUT_MS ? Number(process.env.TOOLS_TIMEOUT_MS) : 5000;
    const timeout = setTimeout(() => controller.abort(), Math.max(1000, timeoutMs || 5000));

    const response = await fetch(`${GATEWAY_URL.replace(/\/$/, '')}/tools/invoke`, {
        method: 'POST',
        signal: controller.signal,
        headers: {
            'Authorization': `Bearer ${GATEWAY_TOKEN}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ tool, args })
    }).finally(() => clearTimeout(timeout));
    if (!response.ok) {
        const text = await response.text();
        throw new Error(`Tools API error (${response.status}): ${text}`);
    }
    return response.json();
}

const HEARTBEAT_PATH = path.join(OPENCLAW_DIR, 'heartbeat.json');
let lastHeartbeat = null;
try {
    if (fs.existsSync(HEARTBEAT_PATH)) {
        const raw = fs.readFileSync(HEARTBEAT_PATH, 'utf8');
        const parsed = JSON.parse(raw);
        lastHeartbeat = parsed?.ts || parsed?.timestamp || null;
    }
} catch {
    // ignore
}

function recordHeartbeat(ts = new Date().toISOString()) {
    lastHeartbeat = ts;
    try {
        fs.mkdirSync(path.dirname(HEARTBEAT_PATH), { recursive: true });
        fs.writeFileSync(HEARTBEAT_PATH, JSON.stringify({ ts }, null, 2), 'utf8');
    } catch {
        // ignore
    }
    return ts;
}

const CRON_JOBS_PATH = path.join(OPENCLAW_DIR, 'cron', 'jobs.json');
const TASK_META_PATH = path.join(OPENCLAW_DIR, 'cron', 'tasks-meta.json');

function readCronJobsFile() {
    try {
        if (!fs.existsSync(CRON_JOBS_PATH)) return { version: 1, jobs: [], exists: false };
        const raw = fs.readFileSync(CRON_JOBS_PATH, 'utf8');
        const parsed = JSON.parse(raw);
        const jobs = Array.isArray(parsed?.jobs) ? parsed.jobs : [];
        return { ...(parsed || {}), version: parsed?.version || 1, jobs, exists: true };
    } catch {
        return { version: 1, jobs: [], exists: false };
    }
}

function writeCronJobsFile(next) {
    fs.mkdirSync(path.dirname(CRON_JOBS_PATH), { recursive: true });
    fs.writeFileSync(CRON_JOBS_PATH, JSON.stringify(next, null, 2), 'utf8');
}

function mergeJobPatch(job, patch) {
    const next = { ...(job || {}), ...(patch || {}) };
    if (job?.payload || patch?.payload) next.payload = { ...(job?.payload || {}), ...(patch?.payload || {}) };
    if (job?.metadata || patch?.metadata) next.metadata = { ...(job?.metadata || {}), ...(patch?.metadata || {}) };
    if (job?.schedule || patch?.schedule) next.schedule = { ...(job?.schedule || {}), ...(patch?.schedule || {}) };
    return next;
}

function readTaskMetaFile() {
    try {
        if (!fs.existsSync(TASK_META_PATH)) return {};
        const raw = fs.readFileSync(TASK_META_PATH, 'utf8');
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
        return {};
    }
}

function writeTaskMetaFile(next) {
    try {
        fs.mkdirSync(path.dirname(TASK_META_PATH), { recursive: true });
        fs.writeFileSync(TASK_META_PATH, JSON.stringify(next || {}, null, 2), 'utf8');
    } catch {
        // ignore
    }
}

function upsertTaskMeta(jobId, patch) {
    const id = String(jobId);
    const current = readTaskMetaFile();
    const prev = (current && typeof current === 'object' ? current[id] : null) || {};
    const next = {
        ...prev,
        ...(patch || {}),
        priority: normalizePriority(patch?.priority ?? prev?.priority ?? 3),
        updatedAt: new Date().toISOString()
    };
    const merged = { ...(current || {}), [id]: next };
    writeTaskMetaFile(merged);
    return next;
}

function deleteTaskMeta(jobId) {
    const id = String(jobId);
    const current = readTaskMetaFile();
    if (!current || typeof current !== 'object' || !(id in current)) return;
    const next = { ...current };
    delete next[id];
    writeTaskMetaFile(next);
}

function getTaskMeta(jobId) {
    const id = String(jobId);
    const current = readTaskMetaFile();
    const entry = current && typeof current === 'object' ? current[id] : null;
    return entry && typeof entry === 'object' ? entry : null;
}

function appendTaskLog(jobId, line) {
    const id = String(jobId);
    const meta = getTaskMeta(id) || {};
    const prev = Array.isArray(meta?.log) ? meta.log : [];
    const text = String(line || '').trim();
    const nextLog = text ? [...prev, `[${new Date().toISOString()}] ${text}`].slice(-200) : prev;
    return upsertTaskMeta(id, { ...meta, log: nextLog });
}

function appendTaskNarrative(jobId, entry) {
    const id = String(jobId);
    const meta = getTaskMeta(id) || {};
    const prev = Array.isArray(meta?.narrative) ? meta.narrative : [];
    const e = entry && typeof entry === 'object' ? entry : {};
    const text = String(e.text || '').trim();
    if (!text) return meta;
    const next = [...prev, {
        ts: e.ts || new Date().toISOString(),
        agentId: e.agentId || meta?.agentId || null,
        role: e.role || 'assistant',
        text
    }].slice(-500);
    return upsertTaskMeta(id, { ...meta, narrative: next });
}

function deriveStatusFromCronJob(job) {
    const last = String(job?.state?.lastStatus || '').toLowerCase();
    if (last === 'ok') return 'completed';
    if (last) return 'review';
    if (job?.enabled === false) return 'disabled';
    return 'scheduled';
}

async function cronCliList() {
    const parsed = await runOpenClawJson(['cron', 'list', '--all', '--json'], { timeoutMs: 6000 });
    return Array.isArray(parsed?.jobs) ? parsed.jobs : [];
}

async function cronCliAdd({ agentId, name, message, sessionTarget = 'isolated', atIso = '2099-01-01T00:00:00Z', disabled = true } = {}) {
    const args = [
        'cron',
        'add',
        '--name',
        String(name || `Task: ${summarizeMessage(message)}`),
        '--session',
        String(sessionTarget || 'isolated'),
        '--agent',
        String(agentId || 'main'),
        '--message',
        String(message || ''),
        '--at',
        String(atIso),
        '--keep-after-run',
        '--no-deliver',
        '--json'
    ];
    if (disabled) args.push('--disabled');
    try {
        return await runOpenClawJson(args, { timeoutMs: 30000 });
    } catch (err) {
        if (!isLikelyGatewayTimeout(err)) throw err;
        await sleep(750);
        return runOpenClawJson(args, { timeoutMs: 30000 });
    }
}

async function cronCliEdit(jobId, { noDeliver, enabled } = {}) {
    const args = ['cron', 'edit', String(jobId), '--json'];
    if (noDeliver) args.push('--no-deliver');
    if (enabled === true) args.push('--enabled');
    if (enabled === false) args.push('--disabled');
    return runOpenClawJson(args, { timeoutMs: 15000 });
}

async function cronCliRm(jobId) {
    return runOpenClawJson(['cron', 'rm', String(jobId), '--json'], { timeoutMs: 15000 });
}

async function cronCliRun(jobId) {
    const attempts = [
        ['cron', 'run', String(jobId), '--expect-final'],
        ['cron', 'run', String(jobId)]
    ];
    let last = null;
    for (const args of attempts) {
        try {
            const { code, stdout, stderr } = await runOpenClaw(args, { timeoutMs: 120000 });
            if (code !== 0) {
                const err = new Error(`openclaw ${args.join(' ')} failed with code ${code}`);
                err.stdout = stdout;
                err.stderr = stderr;
                throw err;
            }
            return parseToolOutputJson(stdout, stderr) || { stdout, stderr };
        } catch (e) {
            last = e;
        }
    }
    throw last || new Error('cron run failed');
}

async function cronCliRuns({ jobId, limit = 50 } = {}) {
    const id = jobId ? String(jobId) : '';
    const limitNum = Number(limit);
    const max = Number.isFinite(limitNum) ? Math.max(1, Math.min(500, Math.floor(limitNum))) : 50;

    if (id) {
        // Disk-backed JSONL (fast, works when gateway is down)
        try {
            const runsPath = path.join(OPENCLAW_DIR, 'cron', 'runs', `${id}.jsonl`);
            if (fs.existsSync(runsPath)) {
                const raw = fs.readFileSync(runsPath, 'utf8');
                const lines = raw.split(/\r?\n/).filter(Boolean);
                const parsed = [];
                for (const line of lines.slice(Math.max(0, lines.length - max * 3))) {
                    const obj = parseJsonLoose(line);
                    if (obj && typeof obj === 'object') parsed.push(obj);
                }
                parsed.sort((a, b) => Number(b?.ts || 0) - Number(a?.ts || 0));
                return parsed.slice(0, max);
            }
        } catch {
            // ignore
        }
    }

    // CLI fallback
    const args = ['cron', 'runs', '--limit', String(max)];
    if (id) args.push('--id', id);
    const parsed = await runOpenClawJson(args, { timeoutMs: 6000 });
    const entries = Array.isArray(parsed?.entries) ? parsed.entries : [];
    return entries.slice(0, max);
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function cronInvoke(args) {
    const attempts = [
        { tool: 'cron', payload: args },
        { tool: 'cron', payload: { command: args.action, ...args } }
    ];
    let lastErr = null;
    for (const attempt of attempts) {
        try {
            return await invokeTool(attempt.tool, attempt.payload);
        } catch (e) {
            lastErr = e;
        }
    }
    throw lastErr || new Error('cron invoke failed');
}

async function cronList() {
    // 1) Disk (fast, works even if gateway is down)
    const disk = readCronJobsFile();
    if (disk?.exists) return disk.jobs;

    // 2) CLI
    try {
        const jobs = await cronCliList();
        if (Array.isArray(jobs)) return jobs;
    } catch {
        // ignore
    }

    // 3) Gateway tool (best-effort)
    try {
        const response = await cronInvoke({ action: 'list' });
        const details = response?.result?.details || {};
        const jobs = details.jobs || response.jobs || [];
        if (Array.isArray(jobs)) return jobs;
    } catch {
        // ignore
    }

    return [];
}

async function cronAdd(job) {
    // 1) Gateway tool
    try {
        const response = await cronInvoke({ action: 'add', job });
        const createdId =
            response?.result?.details?.job?.id
            || response?.result?.details?.id
            || response?.job?.id
            || response?.id
            || job?.id;
        return { ok: true, id: createdId, response, source: 'tool' };
    } catch {
        // ignore
    }

    // 2) Disk
    const current = readCronJobsFile();
    const jobs = Array.isArray(current.jobs) ? current.jobs : [];
    const id = job?.id || crypto.randomUUID();
    const nextJob = { ...(job || {}), id };
    writeCronJobsFile({ ...current, jobs: [...jobs, nextJob] });
    return { ok: true, id, source: 'disk' };
}

async function cronEdit(jobId, patch) {
    // 1) Gateway tool (prefer edit)
    const actions = ['edit', 'update'];
    for (const action of actions) {
        try {
            const response = await cronInvoke({ action, jobId, updates: patch, patch });
            return { ok: true, response, source: 'tool', action };
        } catch {
            // ignore
        }
    }

    // 2) Disk
    const current = readCronJobsFile();
    const jobs = Array.isArray(current.jobs) ? current.jobs : [];
    const idx = jobs.findIndex(j => String(j?.id) === String(jobId));
    if (idx === -1) return { ok: false, error: 'Task not found', source: 'disk' };
    const nextJobs = [...jobs];
    nextJobs[idx] = mergeJobPatch(nextJobs[idx], patch);
    writeCronJobsFile({ ...current, jobs: nextJobs });
    return { ok: true, source: 'disk' };
}

async function cronRm(jobId) {
    // 1) CLI
    try {
        const response = await cronCliRm(jobId);
        return { ok: true, response, source: 'cli' };
    } catch {
        // ignore
    }

    // 2) Gateway tool
    const actions = ['rm', 'delete', 'remove'];
    for (const action of actions) {
        try {
            const response = await cronInvoke({ action, jobId });
            return { ok: true, response, source: 'tool', action };
        } catch {
            // ignore
        }
    }

    // 3) Disk
    const current = readCronJobsFile();
    const jobs = Array.isArray(current.jobs) ? current.jobs : [];
    const nextJobs = jobs.filter(j => String(j?.id) !== String(jobId));
    if (nextJobs.length === jobs.length) return { ok: false, error: 'Task not found', source: 'disk' };
    writeCronJobsFile({ ...current, jobs: nextJobs });
    return { ok: true, source: 'disk' };
}

function ensureTaskMetaForCronJob(job) {
    const id = String(job?.id || '').trim();
    if (!id) return false;
    const existing = getTaskMeta(id);
    if (existing) return false;

    const agentId = String(job?.agentId || 'main');
    const createdAt = new Date(job?.createdAtMs || Date.now()).toISOString();
    const status = deriveStatusFromCronJob(job);
    upsertTaskMeta(id, {
        status,
        priority: 3,
        createdAt,
        agentId,
        name: job?.name || `Task ${id}`,
        message: job?.payload?.message ? String(job.payload.message) : '',
        attempts: 0,
        maxAttempts: 3,
        lastSeenRunAtMs: Number(job?.state?.lastRunAtMs || 0) || 0,
        lastDecision: null,
        lastRun: null,
        error: job?.state?.lastError || null,
        log: [],
        narrative: []
    });
    appendTaskNarrative(id, { role: 'system', agentId, text: `Imported cron job: ${job?.name || id}` });
    if (job?.payload?.message) appendTaskNarrative(id, { role: 'user', agentId, text: String(job.payload.message) });
    if (job?.state?.lastError) appendTaskNarrative(id, { role: 'system', agentId, text: `Last error: ${String(job.state.lastError)}` });
    return true;
}

function syncTaskMetaFromCronJobs(jobs) {
    const list = Array.isArray(jobs) ? jobs : [];
    let wrote = false;
    for (const j of list) {
        if (j?.payload?.kind !== 'agentTurn') continue;
        const created = ensureTaskMetaForCronJob(j);
        if (created) wrote = true;
    }
    return wrote;
}

async function listCronJobs({ includeDisabled = true } = {}) {
    const jobs = await cronList();
    syncTaskMetaFromCronJobs(jobs);
    const metaMap = readTaskMetaFile();
    const merged = (Array.isArray(jobs) ? jobs : [])
        .filter(j => j?.payload?.kind === 'agentTurn')
        .map(j => {
            const meta = (metaMap && typeof metaMap === 'object') ? metaMap[String(j?.id)] : null;
            const base = meta && typeof meta === 'object' ? meta : {};

            if (!meta) {
                const status = deriveStatusFromCronJob(j);

                return {
                    ...j,
                    metadata: {
                        status,
                        priority: 3,
                        createdAt: new Date(j?.createdAtMs || Date.now()).toISOString(),
                        updatedAt: new Date(j?.updatedAtMs || j?.createdAtMs || Date.now()).toISOString(),
                        pickedUpAt: null,
                        completedAt: null,
                        result: null,
                        error: j?.state?.lastError || null,
                        attempts: 0,
                        maxAttempts: 3,
                        narrative: [],
                        lastDecision: null,
                        lastRun: null,
                        log: []
                    }
                };
            }

            return {
                ...j,
                metadata: {
                    status: base.status || 'assigned',
                    priority: normalizePriority(base.priority ?? 3),
                    createdAt: base.createdAt || new Date(j?.createdAtMs || Date.now()).toISOString(),
                    updatedAt: base.updatedAt || new Date(j?.updatedAtMs || Date.now()).toISOString(),
                    pickedUpAt: base.pickedUpAt || null,
                    completedAt: base.completedAt || null,
                    result: base.result ?? null,
                    error: base.error ?? null,
                    attempts: Number.isFinite(Number(base.attempts)) ? Number(base.attempts) : 0,
                    maxAttempts: Number.isFinite(Number(base.maxAttempts)) ? Math.max(1, Math.min(10, Number(base.maxAttempts))) : 3,
                    narrative: Array.isArray(base.narrative) ? base.narrative : [],
                    lastDecision: base.lastDecision || null,
                    lastRun: base.lastRun || null,
                    log: Array.isArray(base.log) ? base.log : []
                }
            };
        });
    const filtered = includeDisabled ? merged : merged.filter(j => j?.enabled !== false);
    return filtered;
}

async function getCronJob(jobId) {
    const jobs = await listCronJobs({ includeDisabled: true });
    return jobs.find(j => String(j?.id) === String(jobId)) || null;
}

async function updateCronJob(jobId, updates) {
    return cronEdit(jobId, updates);
}

function normalizePriority(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return 3;
    return Math.max(1, Math.min(5, Math.round(n)));
}

function jobPriority(job) {
    const p = job?.metadata?.priority ?? job?.priority;
    return normalizePriority(p);
}

function coerceTimeMs(value) {
    if (!value) return 0;
    if (typeof value === 'number') return value;
    const n = Number(value);
    if (Number.isFinite(n) && n > 0) return n;
    const t = Date.parse(String(value));
    return Number.isNaN(t) ? 0 : t;
}

function summarizeMessage(message) {
    const s = String(message || '').trim().replace(/\s+/g, ' ');
    if (!s) return 'New task';
    return s.length > 60 ? `${s.slice(0, 57)}...` : s;
}

function buildTaskJob({ message, agentId = 'main', priority = 3, source = 'ui', name } = {}) {
    const safeAgent = String(agentId || 'main');
    const title = name || `Task: ${summarizeMessage(message)}`;
    return {
        agentId: safeAgent,
        name: title,
        payload: {
            message: String(message || ''),
            source
        },
        metadata: {
            status: 'assigned',
            priority: normalizePriority(priority),
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            log: []
        }
    };
}

async function createTask({ message, agentId = 'main', priority = 3, source = 'ui', name, autoRun = true } = {}) {
    const spec = buildTaskJob({ message, agentId, priority, source, name });
    const job = await cronCliAdd({
        agentId: spec.agentId,
        name: spec.name,
        message: spec.payload.message,
        sessionTarget: 'isolated',
        atIso: '2099-01-01T00:00:00Z',
        disabled: true
    });

    const id = String(job?.id);
    const createdAt = new Date(job?.createdAtMs || Date.now()).toISOString();
    upsertTaskMeta(id, {
        status: autoRun ? 'run_requested' : 'assigned',
        priority: spec?.metadata?.priority ?? priority,
        source,
        createdAt,
        agentId: job?.agentId || spec.agentId,
        name: job?.name || spec.name,
        message: spec.payload.message,
        attempts: 0,
        maxAttempts: 3,
        log: []
    });
    appendTaskLog(id, `Created (source=${source}, agent=${job?.agentId || spec.agentId})`);
    appendTaskNarrative(id, { role: 'system', agentId: job?.agentId || spec.agentId, text: `Task created: ${job?.name || spec.name}` });
    appendTaskNarrative(id, { role: 'user', agentId: job?.agentId || spec.agentId, text: spec.payload.message });
    if (autoRun) appendTaskLog(id, 'Run requested');
    if (autoRun) appendTaskNarrative(id, { role: 'system', agentId: job?.agentId || spec.agentId, text: 'Run requested' });

    if (autoRun) {
        setTimeout(() => {
            taskWorkerTick().catch(() => { /* ignore */ });
        }, 250);
    }

    return { id, job };
}

function appendJobLog(job, line) {
    const text = String(line || '').trim();
    if (!text) return job?.metadata?.log || [];
    const prev = Array.isArray(job?.metadata?.log) ? job.metadata.log : [];
    const next = [...prev, `[${new Date().toISOString()}] ${text}`].slice(-200);
    return next;
}

function extractCompletionText(data) {
    const choice = data?.choices?.[0];
    const msg = choice?.message;
    const content = msg?.content ?? choice?.delta?.content ?? data?.content;
    if (Array.isArray(content)) {
        return content.map((c) => (typeof c === 'string' ? c : (c?.text || JSON.stringify(c)))).join('');
    }
    if (typeof content === 'string') return content;
    if (content && typeof content === 'object') return JSON.stringify(content, null, 2);
    return '';
}

async function runAgentTask({ agentId = 'main', sessionId, message }) {
    const payload = {
        model: `openclaw:${agentId}`,
        user: sessionId || `agent:${agentId}:task`,
        messages: [{ role: 'user', content: String(message || '') }],
        stream: false
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
    const text = await response.text();
    if (!response.ok) {
        throw new Error(`Agent call failed (${response.status}): ${text.slice(0, 500)}`);
    }
    const parsed = parseJsonLoose(text) || {};
    const content = extractCompletionText(parsed) || text;
    return { raw: parsed, content: String(content || '').trim() };
}

function shouldAutoCreateTaskFromChat(message) {
    const s = String(message || '').trim().toLowerCase();
    return s.startsWith('task:') || s.startsWith('/task');
}

async function autoCreateTaskFromChat({ message, agentId = 'main' }) {
    try {
        const raw = String(message || '').trim();
        if (!shouldAutoCreateTaskFromChat(raw)) return;
        const stripped = raw.replace(/^task:\s*/i, '').replace(/^\/task\s*/i, '').trim();
        if (!stripped) return;
        await createTask({ message: stripped, agentId, priority: 3, source: 'chat', autoRun: true });
    } catch {
        // ignore
    }
}

async function inferTaskSpecFromMessage(message) {
    const text = String(message || '').trim();
    if (!text) return null;

    const system = [
        'You are a task router for an AI agent system.',
        'Decide if the user message should be captured as a background task.',
        'Return ONLY valid JSON (no markdown).',
        'Schema:',
        '{"createTask":boolean,"title":string,"priority":1|2|3|4|5,"agentId"?:string}',
        'Set createTask=false for greetings, chit-chat, or questions that do not require work.',
        'If createTask=true, choose a short title and a reasonable priority (3 default).'
    ].join('\n');

    try {
        const payload = {
            model: 'openclaw:main',
            user: `agent:main:task-router:${crypto.randomUUID()}`,
            messages: [
                { role: 'system', content: system },
                { role: 'user', content: text }
            ],
            stream: false
        };

        const response = await fetch(`${GATEWAY_URL.replace(/\/$/, '')}/v1/chat/completions`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${GATEWAY_TOKEN}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });
        const raw = await response.text();
        if (!response.ok) return null;
        const parsed = parseJsonLoose(raw) || {};
        const assistantText = extractCompletionText(parsed) || raw;
        const spec = parseJsonLoose(assistantText);
        if (!spec || typeof spec !== 'object') return null;
        if (typeof spec.createTask !== 'boolean') return null;
        if (!spec.createTask) return { createTask: false };
        return {
            createTask: true,
            title: typeof spec.title === 'string' && spec.title.trim() ? spec.title.trim() : undefined,
            priority: normalizePriority(spec.priority),
            agentId: typeof spec.agentId === 'string' && spec.agentId.trim() ? spec.agentId.trim() : undefined
        };
    } catch {
        return null;
    }
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
    chatInFlight += 1;
    try {
        const { message, agentId = 'main', sessionId, stream } = req.body || {};
        if (!message) return res.status(400).json({ error: 'Message required' });

        // Fire-and-forget: if a chat message looks like an actionable task request, capture it as a task.
        if (shouldAutoCreateTaskFromChat(message)) {
            setTimeout(() => {
                autoCreateTaskFromChat({ message, agentId }).catch(() => { /* ignore */ });
            }, 0);
        }

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
            response.body.pipeTo(WritableStreamToNode(res)).finally(() => {
                chatInFlight = Math.max(0, chatInFlight - 1);
            });
            return;
        }
        const data = await response.json();
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: error.message });
    } finally {
        chatInFlight = Math.max(0, chatInFlight - 1);
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
        const idsRaw = String(req.query?.ids || '').trim();
        const ids = idsRaw
            ? idsRaw.split(',').map(s => s.trim()).filter(Boolean).slice(0, 200)
            : null;

        const limitRaw = req.query?.limit ? Number(req.query.limit) : 0;
        const limit = Number.isFinite(limitRaw) ? Math.max(0, Math.min(2000, Math.floor(limitRaw))) : 0;

        const includeNarrative = String(req.query?.includeNarrative || 'true') !== 'false';
        const includeLog = String(req.query?.includeLog || 'true') !== 'false';

        const jobsAll = await listCronJobs({ includeDisabled: true });
        let jobs = Array.isArray(jobsAll) ? jobsAll : [];

        if (ids) {
            const set = new Set(ids.map(String));
            jobs = jobs.filter(j => set.has(String(j?.id)));
        }

        jobs.sort((a, b) => {
            const ta = coerceTimeMs(a?.metadata?.updatedAt || a?.updatedAt || a?.state?.lastRunAtMs || a?.updatedAtMs || a?.createdAtMs);
            const tb = coerceTimeMs(b?.metadata?.updatedAt || b?.updatedAt || b?.state?.lastRunAtMs || b?.updatedAtMs || b?.createdAtMs);
            return tb - ta;
        });

        if (limit > 0) jobs = jobs.slice(0, limit);

        if (!includeNarrative || !includeLog) {
            jobs = jobs.map((j) => {
                if (!j || typeof j !== 'object') return j;
                const meta = j?.metadata && typeof j.metadata === 'object' ? { ...j.metadata } : j?.metadata;
                if (meta && typeof meta === 'object') {
                    if (!includeNarrative) delete meta.narrative;
                    if (!includeLog) delete meta.log;
                }
                return { ...j, metadata: meta };
            });
        }

        res.json({ jobs });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/tasks', async (req, res) => {
    try {
        const input = req.body || {};
        const message = input?.payload?.message ?? input?.message ?? input?.payload ?? input?.name;
        if (!message) return res.status(400).json({ error: 'message is required' });
        const agentId = input?.payload?.agentId ?? input?.agentId ?? 'main';
        const priority = input?.metadata?.priority ?? input?.priority ?? 3;
        const source = input?.payload?.source ?? 'ui';
        const name = input?.name;

        const created = await createTask({ message, agentId, priority, source, name, autoRun: true });
        const merged = await getCronJob(created.id);
        res.json({ ok: true, id: created.id, job: merged || created.job });
    } catch (error) {
        res.status(500).json({
            error: error.message,
            stderr: error?.stderr ? String(error.stderr).slice(0, 4000) : undefined,
            stdout: error?.stdout ? String(error.stdout).slice(0, 2000) : undefined
        });
    }
});

app.put('/api/tasks/:id', async (req, res) => {
    try {
        const jobId = req.params.id;
        const current = await getCronJob(jobId);
        if (!current) return res.status(404).json({ error: 'Task not found' });

        const updates = req.body || {};
        const next = upsertTaskMeta(jobId, {
            ...(getTaskMeta(jobId) || {}),
            ...(updates?.metadata || {}),
            ...(typeof updates?.priority !== 'undefined' ? { priority: updates.priority } : {}),
            ...(typeof updates?.status === 'string' ? { status: updates.status } : {}),
            ...(typeof updates?.name === 'string' ? { name: updates.name } : {}),
            ...(typeof updates?.message === 'string' ? { message: updates.message } : {})
        });
        res.json({ ok: true, metadata: next });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.delete('/api/tasks/:id', async (req, res) => {
    const jobId = req.params.id;
    try {
        const result = await cronRm(jobId);
        if (!result.ok) return res.status(404).json({ error: result.error || 'Task not found' });
        deleteTaskMeta(jobId);
        return res.json({ ok: true, source: result.source, response: result.response });
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
});

app.get('/api/tasks/queue', async (req, res) => {
    try {
        const jobs = await listCronJobs({ includeDisabled: true });
        const runnable = jobs
            .filter(j => {
                const st = j?.metadata?.status;
                return st === 'assigned' || st === 'run_requested';
            })
            .sort((a, b) => {
                const pa = jobPriority(a);
                const pb = jobPriority(b);
                if (pb !== pa) return pb - pa;
                return coerceTimeMs(b?.metadata?.updatedAt || b?.updatedAt) - coerceTimeMs(a?.metadata?.updatedAt || a?.updatedAt);
            });
        res.json({ jobs: runnable });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/tasks/runs', async (req, res) => {
    try {
        const jobId = req.query?.id ? String(req.query.id) : null;
        const limitRaw = req.query?.limit ? Number(req.query.limit) : 50;
        const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(500, Math.floor(limitRaw))) : 50;
        const entries = await cronCliRuns({ jobId, limit });
        res.json({ entries });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/tasks/activity', async (req, res) => {
    try {
        const idsRaw = String(req.query?.ids || '').trim();
        const ids = idsRaw
            ? idsRaw.split(',').map(s => s.trim()).filter(Boolean).slice(0, 50)
            : [];
        if (ids.length === 0) return res.json({ items: [] });

        const limitRaw = req.query?.limit ? Number(req.query.limit) : 400;
        const limit = Number.isFinite(limitRaw) ? Math.max(50, Math.min(2000, Math.floor(limitRaw))) : 400;
        const includeChildren = String(req.query?.includeChildren || 'true') !== 'false';

        const items = [];
        for (const jobId of ids) {
            const entries = await cronCliRuns({ jobId, limit: 1 });
            const entry = entries?.[0] || null;
            const sessionId = entry?.sessionId ? String(entry.sessionId) : null;
            const agentId = parseAgentIdFromSessionKey(entry?.sessionKey) || null;
            if (!sessionId) {
                items.push({ jobId, sessionId: null, agentId, lines: [], children: [], error: 'No run sessionId found yet' });
                continue;
            }

            const root = readSessionJsonlById({ sessionId, agentId, limit });
            const rootSummary = summarizeSessionActivity(root.events, { hideThinking: true, showToolArgs: true, defaultAgentId: agentId || 'main' });
            const rootChanges = extractFileChangesFromEvents(root.events, { pathPrefix: 'memory/' });

            const children = [];
            if (includeChildren) {
                for (const childRef of (rootSummary.childSessions || []).slice(0, 5)) {
                    const child = readSessionJsonlById({ sessionId: childRef.sessionId, agentId: childRef.agentId, limit: Math.min(300, limit) });
                    const childSummary = summarizeSessionActivity(child.events, { hideThinking: true, showToolArgs: true, defaultAgentId: childRef.agentId || 'main' });
                    const childChanges = extractFileChangesFromEvents(child.events, { pathPrefix: 'memory/' });
                    children.push({ sessionId: childRef.sessionId, agentId: childRef.agentId || null, sessionKey: childRef.sessionKey || null, lines: childSummary.lines, changes: childChanges });
                }
            }

            items.push({
                jobId,
                agentId,
                sessionId,
                lines: rootSummary.lines,
                children,
                changes: rootChanges
            });
        }

        res.json({ items });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/tasks/:id/activity', async (req, res) => {
    try {
        const jobId = String(req.params.id || '').trim();
        if (!jobId) return res.status(400).json({ error: 'id is required' });

        const limitRaw = req.query?.limit ? Number(req.query.limit) : 400;
        const limit = Number.isFinite(limitRaw) ? Math.max(50, Math.min(2000, Math.floor(limitRaw))) : 400;
        const includeChildren = String(req.query?.includeChildren || 'true') !== 'false';

        const entries = await cronCliRuns({ jobId, limit: 1 });
        const entry = entries?.[0] || null;
        const sessionId = entry?.sessionId ? String(entry.sessionId) : null;
        const agentId = parseAgentIdFromSessionKey(entry?.sessionKey) || null;
        if (!sessionId) return res.json({ jobId, sessionId: null, agentId, lines: [], children: [], error: 'No run sessionId found yet' });

        const root = readSessionJsonlById({ sessionId, agentId, limit });
        const rootSummary = summarizeSessionActivity(root.events, { hideThinking: true, showToolArgs: true, defaultAgentId: agentId || 'main' });
        const rootChanges = extractFileChangesFromEvents(root.events, { pathPrefix: 'memory/' });

        const children = [];
        if (includeChildren) {
            for (const childRef of (rootSummary.childSessions || []).slice(0, 5)) {
                const child = readSessionJsonlById({ sessionId: childRef.sessionId, agentId: childRef.agentId, limit: Math.min(300, limit) });
                const childSummary = summarizeSessionActivity(child.events, { hideThinking: true, showToolArgs: true, defaultAgentId: childRef.agentId || 'main' });
                const childChanges = extractFileChangesFromEvents(child.events, { pathPrefix: 'memory/' });
                children.push({ sessionId: childRef.sessionId, agentId: childRef.agentId || null, sessionKey: childRef.sessionKey || null, lines: childSummary.lines, changes: childChanges });
            }
        }

        res.json({ jobId, agentId, sessionId, lines: rootSummary.lines, children, changes: rootChanges });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/tasks/:id/run', async (req, res) => {
    try {
        const jobId = req.params.id;
        const current = await getCronJob(jobId);
        if (!current) return res.status(404).json({ error: 'Task not found' });

        upsertTaskMeta(jobId, {
            ...(getTaskMeta(jobId) || {}),
            status: 'run_requested'
        });
        appendTaskLog(jobId, 'Run requested');
        setTimeout(() => {
            taskWorkerTick().catch(() => { /* ignore */ });
        }, 100);

        res.json({ ok: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/tasks/:id/pickup', async (req, res) => {
    try {
        const jobId = req.params.id;
        const current = await getCronJob(jobId);
        if (!current) return res.status(404).json({ error: 'Task not found' });
        upsertTaskMeta(jobId, {
            ...(getTaskMeta(jobId) || {}),
            status: 'picked_up',
            pickedUpAt: new Date().toISOString()
        });
        appendTaskLog(jobId, 'Picked up');
        res.json({ ok: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/tasks/:id/complete', async (req, res) => {
    try {
        const jobId = req.params.id;
        const current = await getCronJob(jobId);
        if (!current) return res.status(404).json({ error: 'Task not found' });
        upsertTaskMeta(jobId, {
            ...(getTaskMeta(jobId) || {}),
            status: 'completed',
            completedAt: new Date().toISOString(),
            result: req.body?.result || current?.metadata?.result || null
        });
        appendTaskLog(jobId, 'Completed');
        res.json({ ok: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/heartbeat', (req, res) => {
    return res.json({ ts: lastHeartbeat });
});

app.post('/api/heartbeat', (req, res) => {
    const ts = recordHeartbeat();
    return res.json({ ok: true, ts });
});

app.post('/api/broadcast', async (req, res) => {
    try {
        const { message, agentIds } = req.body || {};
        if (!message || !Array.isArray(agentIds) || agentIds.length === 0) {
            return res.status(400).json({ error: 'message and agentIds are required' });
        }

        const created = [];
        for (const agentId of agentIds) {
            const t = await createTask({ message, agentId, priority: 4, source: 'broadcast', autoRun: true });
            const merged = await getCronJob(t.id);
            created.push({ agentId, id: t.id, name: merged?.name || t.job?.name || 'Task' });
        }

        res.json({
            ok: true,
            totalAgents: agentIds.length,
            tasks: created
        });
    } catch (error) {
        res.status(500).json({
            error: error.message,
            stderr: error?.stderr ? String(error.stderr).slice(0, 4000) : undefined,
            stdout: error?.stdout ? String(error.stdout).slice(0, 2000) : undefined
        });
    }
});

async function callGatewayCompletion({ model = 'openclaw:main', messages, timeoutMs = 20000 } = {}) {
    if (!GATEWAY_TOKEN) {
        const err = new Error('OPENCLAW_GATEWAY_TOKEN not set');
        err.code = 'MISSING_GATEWAY_TOKEN';
        throw err;
    }
    const payload = {
        model,
        messages: Array.isArray(messages) ? messages : [],
        stream: false
    };
    const response = await fetch(`${GATEWAY_URL.replace(/\/$/, '')}/v1/chat/completions`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${GATEWAY_TOKEN}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(Math.max(2000, timeoutMs || 20000))
    });
    const raw = await response.text();
    if (!response.ok) {
        const err = new Error(`Gateway completion failed (${response.status}): ${raw.slice(0, 400)}`);
        err.stdout = raw;
        throw err;
    }
    const parsed = parseJsonLoose(raw) || {};
    const content = extractCompletionText(parsed) || raw;
    return { raw: parsed, content: String(content || '').trim() };
}

function clipTextBlock(text, maxChars) {
    const s = String(text || '');
    if (s.length <= maxChars) return s;
    return `${s.slice(0, Math.max(0, maxChars - 1))}…`;
}

function normalizeAiDecision(decision) {
    const d = decision && typeof decision === 'object' ? decision : {};
    const raw = String(d.decision || d.status || '').toLowerCase();
    const allowed = new Set(['retry', 'failed', 'completed', 'review']);
    const nextDecision = allowed.has(raw) ? raw : 'review';
    const reason = typeof d.reason === 'string' ? d.reason.trim() : '';
    const narration = Array.isArray(d.narration)
        ? d.narration.map(s => String(s || '').trim()).filter(Boolean).slice(0, 30)
        : [];
    const edits = d.edits && typeof d.edits === 'object' ? d.edits : {};
    const noDeliver = edits.noDeliver === true;
    const enabled = typeof edits.enabled === 'boolean' ? edits.enabled : null;
    return {
        decision: nextDecision,
        reason: reason || 'No reason provided',
        narration,
        edits: {
            noDeliver,
            enabled
        }
    };
}

async function aiTriageRun({ job, meta, runEntry, activity }) {
    const system = [
        'You are the supervisor for an autonomous multi-agent task system running OpenClaw cron jobs.',
        'You must decide the NEXT action for this job and produce a narrated step-by-step summary of what happened.',
        'Do NOT include private chain-of-thought or hidden reasoning.',
        'Return ONLY valid JSON (no markdown).',
        'Schema:',
        '{"decision":"completed"|"retry"|"failed"|"review","reason":string,"edits"?:{"noDeliver"?:boolean,"enabled"?:boolean},"narration"?:string[]}',
        'Guidance:',
        '- If the run failed due to delivery (e.g. "announce delivery failed"), prefer edits.noDeliver=true and decision=retry.',
        '- If the core work appears completed (summary present) but delivery failed, you may choose decision=completed with edits.noDeliver=true.',
        '- Only choose decision=retry if another attempt is likely to succeed.'
    ].join('\n');

    const payload = {
        job: {
            id: job?.id,
            name: job?.name,
            agentId: job?.agentId,
            message: job?.payload?.message,
            enabled: job?.enabled,
            delivery: job?.delivery,
            schedule: job?.schedule,
            state: job?.state
        },
        meta: {
            status: meta?.status,
            attempts: meta?.attempts,
            maxAttempts: meta?.maxAttempts
        },
        run: runEntry || null,
        activity: {
            lines: Array.isArray(activity?.lines) ? activity.lines.slice(-120) : [],
            children: Array.isArray(activity?.children)
                ? activity.children.slice(0, 3).map(c => ({
                    agentId: c?.agentId || null,
                    sessionId: c?.sessionId || null,
                    lines: Array.isArray(c?.lines) ? c.lines.slice(-60) : []
                }))
                : [],
            childCount: Array.isArray(activity?.children) ? activity.children.length : 0,
            memoryChanges: Array.isArray(activity?.changes) ? activity.changes.map(c => c.summary).slice(0, 30) : []
        }
    };

    const { content } = await callGatewayCompletion({
        model: 'openclaw:main',
        timeoutMs: 25000,
        messages: [
            { role: 'system', content: system },
            { role: 'user', content: JSON.stringify(payload) }
        ]
    });

    const parsed = parseJsonLoose(content);
    if (!parsed || typeof parsed !== 'object') {
        return normalizeAiDecision({ decision: 'review', reason: `Supervisor returned non-JSON: ${clipTextBlock(content, 200)}` });
    }
    return normalizeAiDecision(parsed);
}

async function applyAiEdits(jobId, edits) {
    const e = edits && typeof edits === 'object' ? edits : {};
    let applied = [];
    if (e.noDeliver) {
        try {
            await cronCliEdit(jobId, { noDeliver: true });
            applied.push('noDeliver');
        } catch {
            try {
                await cronEdit(jobId, { delivery: { mode: 'none', channel: 'last' } });
                applied.push('noDeliver(disk)');
            } catch {
                // ignore
            }
        }
    }
    if (typeof e.enabled === 'boolean') {
        try {
            await cronCliEdit(jobId, { enabled: e.enabled });
            applied.push(e.enabled ? 'enabled' : 'disabled');
        } catch {
            try {
                await cronEdit(jobId, { enabled: e.enabled });
                applied.push(e.enabled ? 'enabled(disk)' : 'disabled(disk)');
            } catch {
                // ignore
            }
        }
    }
    return applied;
}

const TASK_WORKER_ENABLED = process.env.TASK_WORKER_ENABLED !== 'false';
const TASK_WORKER_INTERVAL_MS = process.env.TASK_WORKER_INTERVAL_MS
    ? Number(process.env.TASK_WORKER_INTERVAL_MS)
    : 15_000;

const GATEWAY_KEEPALIVE_ENABLED = process.env.GATEWAY_KEEPALIVE_ENABLED !== 'false';
const GATEWAY_KEEPALIVE_INTERVAL_MS = process.env.GATEWAY_KEEPALIVE_INTERVAL_MS
    ? Number(process.env.GATEWAY_KEEPALIVE_INTERVAL_MS)
    : 60_000;

let taskWorkerRunning = false;

async function taskWorkerTick() {
    if (!TASK_WORKER_ENABLED) return;
    if (chatInFlight > 0) return;
    if (taskWorkerRunning) return;
    taskWorkerRunning = true;

    try {
        recordHeartbeat();
        const all = await cronList();
        const allJobs = (Array.isArray(all) ? all : []).filter(j => j?.payload?.kind === 'agentTurn');
        syncTaskMetaFromCronJobs(allJobs);

        const metaMap = readTaskMetaFile();
        const byPriority = (a, b) => {
            const ma = metaMap[String(a?.id)] || {};
            const mb = metaMap[String(b?.id)] || {};
            const pa = normalizePriority(ma?.priority ?? 3);
            const pb = normalizePriority(mb?.priority ?? 3);
            if (pb !== pa) return pb - pa;
            return coerceTimeMs(mb?.updatedAt) - coerceTimeMs(ma?.updatedAt);
        };

        // Detect new runs from OpenClaw (including scheduled jobs) and move them into AI review/completed.
        for (const j of allJobs) {
            const id = String(j?.id || '');
            if (!id) continue;
            const meta = metaMap[id] || getTaskMeta(id) || {};
            const seen = Number(meta?.lastSeenRunAtMs || 0) || 0;
            const lastRunAt = Number(j?.state?.lastRunAtMs || 0) || 0;
            if (!lastRunAt || lastRunAt <= seen) continue;
            const nextStatus = deriveStatusFromCronJob(j);
            const nextMeta = upsertTaskMeta(id, {
                ...meta,
                status: nextStatus,
                lastSeenRunAtMs: lastRunAt,
                error: nextStatus === 'review' ? (j?.state?.lastError || meta?.error || null) : null
            });
            metaMap[id] = nextMeta;
            appendTaskNarrative(id, { role: 'system', agentId: j?.agentId || meta?.agentId || 'main', text: `New run detected: ${j?.state?.lastStatus || 'unknown'}${j?.state?.lastError ? ` — ${j.state.lastError}` : ''}` });
        }

        const runQueue = [...allJobs]
            .filter(j => {
                const meta = metaMap[String(j?.id)] || {};
                return meta?.status === 'assigned' || meta?.status === 'run_requested';
            })
            .sort(byPriority);

        const reviewQueue = [...allJobs]
            .filter(j => {
                const meta = metaMap[String(j?.id)] || {};
                if (meta?.status !== 'review') return false;
                const lastTs = Date.parse(String(meta?.lastDecision?.ts || ''));
                if (!Number.isFinite(lastTs)) return true;
                return (Date.now() - lastTs) > 60_000;
            })
            .sort(byPriority);

        const job = runQueue[0] || reviewQueue[0] || null;
        if (!job) return;

        const jobId = String(job.id);
        const agentId = String(job?.agentId || 'main');
        const meta0 = getTaskMeta(jobId) || {};

        const getLatestRunContext = async () => {
            const entries = await cronCliRuns({ jobId, limit: 1 });
            const entry = entries?.[0] || null;
            const sessionId = entry?.sessionId ? String(entry.sessionId) : null;
            const runAgentId = parseAgentIdFromSessionKey(entry?.sessionKey) || agentId;
            if (!sessionId) return { entry, activity: { lines: [], children: [], changes: [] } };

            const root = readSessionJsonlById({ sessionId, agentId: runAgentId, limit: 600 });
            const rootSummary = summarizeSessionActivity(root.events, { hideThinking: true, showToolArgs: true, defaultAgentId: runAgentId || 'main' });
            const rootChanges = extractFileChangesFromEvents(root.events, { pathPrefix: 'memory/' });

            const children = [];
            for (const childRef of (rootSummary.childSessions || []).slice(0, 5)) {
                const child = readSessionJsonlById({ sessionId: childRef.sessionId, agentId: childRef.agentId, limit: 400 });
                const childSummary = summarizeSessionActivity(child.events, { hideThinking: true, showToolArgs: true, defaultAgentId: childRef.agentId || 'main' });
                const childChanges = extractFileChangesFromEvents(child.events, { pathPrefix: 'memory/' });
                children.push({ sessionId: childRef.sessionId, agentId: childRef.agentId || null, sessionKey: childRef.sessionKey || null, lines: childSummary.lines, changes: childChanges });
            }

            return {
                entry,
                activity: {
                    lines: rootSummary.lines,
                    changes: rootChanges,
                    children
                }
            };
        };

        if (runQueue.length > 0) {
            const attempts = Number.isFinite(Number(meta0?.attempts)) ? Number(meta0.attempts) : 0;
            const maxAttempts = Number.isFinite(Number(meta0?.maxAttempts)) ? Math.max(1, Math.min(10, Number(meta0.maxAttempts))) : 3;
            const nextAttempt = attempts + 1;

            upsertTaskMeta(jobId, {
                ...meta0,
                status: 'picked_up',
                pickedUpAt: new Date().toISOString(),
                attempts: nextAttempt,
                maxAttempts,
                error: null
            });
            appendTaskLog(jobId, `Worker picked up (agent=${agentId}, attempt=${nextAttempt}/${maxAttempts})`);
            appendTaskNarrative(jobId, { role: 'system', agentId, text: `Attempt ${nextAttempt}/${maxAttempts} started` });

            try {
                await cronCliRun(jobId);
            } catch (err) {
                const msg = err?.message || String(err);
                upsertTaskMeta(jobId, { ...(getTaskMeta(jobId) || {}), status: 'review', error: msg });
                appendTaskLog(jobId, `Error: ${msg}`);
                appendTaskNarrative(jobId, { role: 'system', agentId, text: `Run error: ${msg}` });
                return;
            }
        }

        // Either we just ran, or we're triaging an existing review.
        const meta1 = getTaskMeta(jobId) || meta0;
        let runEntry = null;
        let activity = { lines: [], children: [], changes: [] };
        try {
            const ctx = await getLatestRunContext();
            runEntry = ctx.entry;
            activity = ctx.activity;
        } catch {
            // ignore
        }

        const runStatus = String(runEntry?.status || job?.state?.lastStatus || '').toLowerCase();
        const runSummary = String(runEntry?.summary || '').trim();
        const runError = String(runEntry?.error || job?.state?.lastError || '').trim();

        upsertTaskMeta(jobId, {
            ...(getTaskMeta(jobId) || {}),
            lastSeenRunAtMs: Number(job?.state?.lastRunAtMs || meta1?.lastSeenRunAtMs || 0) || 0,
            lastRun: {
                ts: Number(runEntry?.ts || 0) || null,
                status: runStatus || null,
                summary: runSummary || null,
                error: runError || null,
                sessionId: runEntry?.sessionId ? String(runEntry.sessionId) : null,
                sessionKey: runEntry?.sessionKey ? String(runEntry.sessionKey) : null
            }
        });

        let decision;
        try {
            decision = await aiTriageRun({ job, meta: getTaskMeta(jobId) || meta1, runEntry, activity });
        } catch (err) {
            const msg = err?.message || String(err);
            appendTaskLog(jobId, `Supervisor error: ${msg}`);
            appendTaskNarrative(jobId, { role: 'system', agentId, text: `Supervisor error: ${msg}` });
            upsertTaskMeta(jobId, { ...(getTaskMeta(jobId) || {}), status: 'review', error: runError || msg, lastDecision: { ts: new Date().toISOString(), decision: 'review', reason: msg } });
            return;
        }

        const applied = await applyAiEdits(jobId, decision?.edits);
        if (applied.length) {
            appendTaskLog(jobId, `Applied edits: ${applied.join(', ')}`);
            appendTaskNarrative(jobId, { role: 'system', agentId, text: `Applied edits: ${applied.join(', ')}` });
        }

        for (const line of (decision?.narration || []).slice(0, 30)) {
            appendTaskNarrative(jobId, { role: 'assistant', agentId, text: line });
        }

        const meta2 = getTaskMeta(jobId) || meta1;
        const attempts2 = Number.isFinite(Number(meta2?.attempts)) ? Number(meta2.attempts) : 0;
        const maxAttempts2 = Number.isFinite(Number(meta2?.maxAttempts)) ? Math.max(1, Math.min(10, Number(meta2.maxAttempts))) : 3;

        const nowIso = new Date().toISOString();
        const baseDecision = {
            ts: nowIso,
            decision: decision?.decision,
            reason: decision?.reason,
            editsApplied: applied
        };

        if (decision.decision === 'completed' || runStatus === 'ok') {
            upsertTaskMeta(jobId, {
                ...meta2,
                status: 'completed',
                completedAt: nowIso,
                result: runSummary || meta2?.result || 'Completed',
                error: null,
                attempts: 0,
                lastDecision: baseDecision
            });
            appendTaskLog(jobId, 'Worker marked completed');
            appendTaskNarrative(jobId, { role: 'system', agentId, text: `Completed: ${decision?.reason || 'ok'}` });
            return;
        }

        if (decision.decision === 'retry') {
            if (attempts2 >= maxAttempts2) {
                upsertTaskMeta(jobId, {
                    ...meta2,
                    status: 'failed',
                    completedAt: nowIso,
                    error: decision?.reason || runError || 'Failed',
                    lastDecision: { ...baseDecision, decision: 'failed', reason: `Max attempts reached. ${decision?.reason || ''}`.trim() }
                });
                appendTaskLog(jobId, 'Worker marked failed (max attempts)');
                appendTaskNarrative(jobId, { role: 'system', agentId, text: `Failed after ${maxAttempts2} attempts: ${decision?.reason}` });
                return;
            }

            upsertTaskMeta(jobId, {
                ...meta2,
                status: 'run_requested',
                error: decision?.reason || runError || null,
                lastDecision: baseDecision
            });
            appendTaskLog(jobId, `Retry requested: ${decision?.reason}`);
            appendTaskNarrative(jobId, { role: 'system', agentId, text: `Retry requested: ${decision?.reason}` });
            setTimeout(() => {
                taskWorkerTick().catch(() => { /* ignore */ });
            }, 500);
            return;
        }

        if (decision.decision === 'failed') {
            upsertTaskMeta(jobId, {
                ...meta2,
                status: 'failed',
                completedAt: nowIso,
                error: decision?.reason || runError || 'Failed',
                lastDecision: baseDecision
            });
            appendTaskLog(jobId, `Worker marked failed: ${decision?.reason}`);
            appendTaskNarrative(jobId, { role: 'system', agentId, text: `Failed: ${decision?.reason}` });
            return;
        }

        upsertTaskMeta(jobId, {
            ...meta2,
            status: 'review',
            error: decision?.reason || runError || meta2?.error || null,
            lastDecision: baseDecision
        });
        appendTaskLog(jobId, `Worker left in review: ${decision?.reason}`);
        appendTaskNarrative(jobId, { role: 'system', agentId, text: `In review: ${decision?.reason}` });
    } catch {
        // ignore
    } finally {
        taskWorkerRunning = false;
    }
}

if (TASK_WORKER_ENABLED) {
    setInterval(() => {
        taskWorkerTick().catch(() => { /* ignore */ });
    }, Math.max(5_000, TASK_WORKER_INTERVAL_MS));
    setTimeout(() => {
        taskWorkerTick().catch(() => { /* ignore */ });
    }, 2500);
}

async function gatewayKeepaliveTick() {
    try {
        const baseUrl = GATEWAY_URL.replace(/\/$/, '');
        await fetch(`${baseUrl}/`, {
            method: 'GET',
            signal: AbortSignal.timeout(1500)
        });
    } catch {
        // ignore
    }
}

if (GATEWAY_KEEPALIVE_ENABLED) {
    setInterval(() => {
        gatewayKeepaliveTick().catch(() => { /* ignore */ });
    }, Math.max(5_000, GATEWAY_KEEPALIVE_INTERVAL_MS));
    setTimeout(() => {
        gatewayKeepaliveTick().catch(() => { /* ignore */ });
    }, 2000);
}

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
