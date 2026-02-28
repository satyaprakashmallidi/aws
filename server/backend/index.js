import express from 'express';
import fs from 'fs';
import path from 'path';
import os from 'os';
import * as readline from 'node:readline';
import cors from 'cors';
import { execFile, spawn } from 'child_process';
import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';
import { verifyToken } from '@clerk/backend';
import { createProxyMiddleware } from 'http-proxy-middleware';

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
const AGENT_WORKSPACES_DIR = process.env.OPENCLAW_AGENT_WORKSPACES_DIR || path.join(OPENCLAW_DIR, 'workspaces');
const SOUL_PATHS = [
    path.join(OPENCLAW_DIR, 'memory', 'SOUL.md'),
    path.join(OPENCLAW_DIR, 'SOUL.md'),
    path.join(WORKSPACE_DIR, 'SOUL.md'),
    path.join(WORKSPACE_DIR, 'memory', 'SOUL.md')
];

try {
    fs.mkdirSync(WORKSPACE_DIR, { recursive: true });
    fs.mkdirSync(path.join(WORKSPACE_DIR, 'skills'), { recursive: true });
    fs.mkdirSync(AGENT_WORKSPACES_DIR, { recursive: true });
} catch {
    // ignore
}

const GATEWAY_URL = process.env.OPENCLAW_GATEWAY_URL || 'http://127.0.0.1:18789';
const GATEWAY_TOKEN = process.env.OPENCLAW_GATEWAY_TOKEN;
const LOCAL_API_SECRET = process.env.LOCAL_API_SECRET || '';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const CLERK_SECRET_KEY = process.env.CLERK_SECRET_KEY;
const CLERK_JWT_KEY = process.env.CLERK_JWT_KEY;

const supabaseAdmin = (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY)
    ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
    })
    : null;

let chatInFlight = 0;

function requireSupabaseAdmin(req, res) {
    if (supabaseAdmin) return supabaseAdmin;
    if (!SUPABASE_URL) res.status(500).json({ error: 'SUPABASE_URL not set' });
    else if (!SUPABASE_SERVICE_ROLE_KEY) res.status(500).json({ error: 'SUPABASE_SERVICE_ROLE_KEY not set' });
    else res.status(500).json({ error: 'Supabase admin client not configured' });
    return null;
}

function getBearerToken(req) {
    const header = req.headers?.authorization || req.headers?.Authorization;
    if (!header || typeof header !== 'string') return null;
    const match = header.match(/^Bearer\s+(.+)$/i);
    return match?.[1]?.trim() || null;
}

async function requireClerkUserId(req, res) {
    const token = getBearerToken(req);
    if (!token) {
        res.status(401).json({ error: 'Missing Authorization: Bearer <token>' });
        return null;
    }

    if (!CLERK_JWT_KEY && !CLERK_SECRET_KEY) {
        res.status(500).json({ error: 'Set CLERK_JWT_KEY (recommended) or CLERK_SECRET_KEY to verify tokens' });
        return null;
    }

    try {
        const verified = await verifyToken(token, {
            ...(CLERK_JWT_KEY ? { jwtKey: CLERK_JWT_KEY } : {}),
            ...(CLERK_SECRET_KEY ? { secretKey: CLERK_SECRET_KEY } : {})
        });
        const userId = verified?.sub;
        if (!userId) {
            res.status(401).json({ error: 'Invalid token (missing sub claim)' });
            return null;
        }
        return userId;
    } catch {
        res.status(401).json({ error: 'Invalid token' });
        return null;
    }
}

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

function isInternalSessionKey(sessionKey) {
    const key = String(sessionKey || '');
    if (!key.startsWith('agent:')) return false;
    const parts = key.split(':');
    const last = parts[parts.length - 1] || '';
    const bg = String(process.env.TASK_BACKGROUND_SESSION_SUFFIX || 'tasks');
    return last === 'supervisor' || last === 'task-router' || last === bg;
}

function filterInternalSessions(sessions, { includeInternal = false } = {}) {
    const list = Array.isArray(sessions) ? sessions : [];
    if (includeInternal) return list;
    return list.filter(s => !isInternalSessionKey(s?.key || s?.sessionKey));
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
    'https://automation-1.magicteams.ai',
    'http://127.0.0.1:4444',
    'http://localhost:4444',
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    'https://openclaw-api.magicteams.ai',
    'https://openclaw.ai',
    'https://app.openclaw.ai'
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

function isValidAgentId(agentId) {
    const id = String(agentId || '').trim();
    if (!id) return false;
    if (id.length > 64) return false;
    return /^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(id);
}

function generateAgentId({ prefix = 'agent' } = {}) {
    const p = String(prefix || 'agent').trim().replace(/[^A-Za-z0-9_-]/g, '').slice(0, 20) || 'agent';
    const rand = crypto.randomBytes(4).toString('hex');
    return `${p}-${rand}`;
}

function agentIdExists(id, config) {
    if (!id) return false;
    if (listAgentIdsFromDisk().includes(id)) return true;
    const list = Array.isArray(config?.agents?.list) ? config.agents.list : [];
    return list.some((a) => a?.id === id);
}

function listAgentIdsFromDisk() {
    try {
        const agentsDir = path.join(OPENCLAW_DIR, 'agents');
        if (!fs.existsSync(agentsDir)) return [];
        const entries = fs.readdirSync(agentsDir, { withFileTypes: true });
        return entries
            .filter((e) => e.isDirectory())
            .map((e) => e.name)
            .filter((name) => isValidAgentId(name));
    } catch {
        return [];
    }
}

function normalizeModelConfig(value, fallback = { primary: '', fallbacks: [] }) {
    if (!value) return { ...fallback };
    if (typeof value === 'string') {
        const primary = value.trim();
        if (!primary) return { ...fallback };
        return { primary, fallbacks: [] };
    }
    if (value && typeof value === 'object') {
        const primary = typeof value.primary === 'string' ? value.primary.trim() : '';
        if (!primary) return { ...fallback };
        const fallbacks = Array.isArray(value.fallbacks)
            ? value.fallbacks
                .map((m) => (typeof m === 'string' ? m.trim() : ''))
                .filter((m) => m && m !== primary)
            : [];
        return { primary, fallbacks };
    }
    return { ...fallback };
}

function getDefaultModelConfig(config) {
    const raw = config?.agents?.defaults?.model;
    if (typeof raw === 'string') return { primary: raw, fallbacks: [] };
    return normalizeModelConfig(raw, { primary: '', fallbacks: [] });
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

let usageCache = { key: '', expiresAtMs: 0, data: null };

function pickUsageFields(usage) {
    const u = usage && typeof usage === 'object' ? usage : {};
    const num = (v) => {
        const n = Number(v);
        return Number.isFinite(n) ? n : 0;
    };

    const input = num(u.input ?? u.promptTokens ?? u.inputTokens);
    const output = num(u.output ?? u.completionTokens ?? u.outputTokens);
    const cacheRead = num(u.cacheRead ?? u.cache_read);
    const cacheWrite = num(u.cacheWrite ?? u.cache_write);
    const totalTokens = num(u.totalTokens ?? u.total ?? (input + output + cacheRead + cacheWrite));

    const costObj = u.cost && typeof u.cost === 'object' ? u.cost : {};
    const costTotal = num(costObj.total ?? u.costTotal ?? u.totalCost);
    return { input, output, cacheRead, cacheWrite, totalTokens, costTotal };
}

async function scanJsonlForUsage(filePath, sinceMs, out) {
    const stream = fs.createReadStream(filePath, { encoding: 'utf8' });
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
    try {
        for await (const line of rl) {
            const s = String(line || '').trim();
            if (!s) continue;
            const evt = parseJsonLoose(s);
            if (!evt || typeof evt !== 'object') continue;
            const ts = evt?.timestamp || evt?.message?.timestamp || evt?.data?.timestamp;
            const tms = coerceTimeMs(ts);
            if (!tms || tms < sinceMs) continue;

            const msg = evt?.message;
            const usage = msg?.usage;
            if (!usage) continue;

            const { input, output, cacheRead, cacheWrite, totalTokens, costTotal } = pickUsageFields(usage);
            if (!totalTokens && !costTotal) continue;

            const provider = String(msg?.provider || msg?.api || evt?.provider || 'unknown');
            const model = String(msg?.model || evt?.modelId || 'unknown');
            const key = `${provider}/${model}`;

            out.totals.input += input;
            out.totals.output += output;
            out.totals.cacheRead += cacheRead;
            out.totals.cacheWrite += cacheWrite;
            out.totals.totalTokens += totalTokens;
            out.totals.costTotal += costTotal;
            out.totals.messages += 1;

            const bucket = out.byModel[key] || { provider, model, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, costTotal: 0, messages: 0 };
            bucket.input += input;
            bucket.output += output;
            bucket.cacheRead += cacheRead;
            bucket.cacheWrite += cacheWrite;
            bucket.totalTokens += totalTokens;
            bucket.costTotal += costTotal;
            bucket.messages += 1;
            out.byModel[key] = bucket;
        }
    } finally {
        try { rl.close(); } catch { /* ignore */ }
        try { stream.destroy(); } catch { /* ignore */ }
    }
}

async function computeUsageSummary({ hours = 24 } = {}) {
    const nowMs = Date.now();
    const windowHours = Math.max(1, Math.min(24 * 14, Number(hours) || 24));
    const sinceMs = nowMs - windowHours * 60 * 60 * 1000;

    const key = `${windowHours}`;
    if (usageCache.data && usageCache.key === key && usageCache.expiresAtMs > nowMs) return usageCache.data;

    const out = {
        windowHours,
        since: new Date(sinceMs).toISOString(),
        until: new Date(nowMs).toISOString(),
        totals: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, costTotal: 0, messages: 0 },
        byModel: {}
    };

    const candidates = [];

    // Agent session JSONL
    const agentsDir = path.join(OPENCLAW_DIR, 'agents');
    try {
        if (fs.existsSync(agentsDir)) {
            const agents = fs.readdirSync(agentsDir, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name);
            for (const agentId of agents) {
                const sessionsDir = path.join(agentsDir, agentId, 'sessions');
                if (!fs.existsSync(sessionsDir)) continue;
                const items = fs.readdirSync(sessionsDir, { withFileTypes: true });
                for (const item of items) {
                    if (!item.isFile()) continue;
                    if (!item.name.endsWith('.jsonl')) continue;
                    const fp = path.join(sessionsDir, item.name);
                    try {
                        const stat = fs.statSync(fp);
                        if (stat.mtimeMs >= sinceMs) candidates.push(fp);
                    } catch {
                        // ignore
                    }
                }
            }
        }
    } catch {
        // ignore
    }

    // Cron run JSONL
    const cronRunsDir = path.join(OPENCLAW_DIR, 'cron', 'runs');
    try {
        if (fs.existsSync(cronRunsDir)) {
            const items = fs.readdirSync(cronRunsDir, { withFileTypes: true });
            for (const item of items) {
                if (!item.isFile()) continue;
                if (!item.name.endsWith('.jsonl')) continue;
                const fp = path.join(cronRunsDir, item.name);
                try {
                    const stat = fs.statSync(fp);
                    if (stat.mtimeMs >= sinceMs) candidates.push(fp);
                } catch {
                    // ignore
                }
            }
        }
    } catch {
        // ignore
    }

    for (const fp of candidates) {
        try {
            await scanJsonlForUsage(fp, sinceMs, out);
        } catch {
            // ignore
        }
    }

    const byModel = Object.values(out.byModel)
        .sort((a, b) => (b.costTotal - a.costTotal) || (b.totalTokens - a.totalTokens))
        .slice(0, 200);

    const result = { ...out, byModel };
    usageCache = { key, expiresAtMs: nowMs + 30_000, data: result };
    return result;
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

function defaultTaskAtIso() {
    // We keep tasks "disabled" and run them via our worker; schedule.at is just a required field.
    // Use a near-future time so it's never "years ahead" and doesn't trip OpenClaw validation.
    const msRaw = process.env.TASK_DEFAULT_AT_MS ? Number(process.env.TASK_DEFAULT_AT_MS) : 2000;
    const ms = Number.isFinite(msRaw) ? Math.max(1_000, Math.min(24 * 60 * 60 * 1000, Math.floor(msRaw))) : 60_000;
    return new Date(Date.now() + ms).toISOString();
}

async function cronCliList() {
    const parsed = await runOpenClawJson(['cron', 'list', '--all', '--json'], { timeoutMs: 6000 });
    return Array.isArray(parsed?.jobs) ? parsed.jobs : [];
}

async function cronCliAdd({ agentId, name, message, sessionTarget = 'isolated', atIso = defaultTaskAtIso(), disabled = true } = {}) {
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
    try {
        const args = ['cron', 'runs', '--limit', String(max)];
        if (id) args.push('--id', id);
        const parsed = await runOpenClawJson(args, { timeoutMs: 6000 });
        const entries = Array.isArray(parsed?.entries) ? parsed.entries : [];
        return entries.slice(0, max);
    } catch {
        // `openclaw cron runs` may not exist in this version — return empty
        return [];
    }
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
    const timeoutMsRaw = process.env.TASK_AGENT_TIMEOUT_MS ? Number(process.env.TASK_AGENT_TIMEOUT_MS) : 120_000;
    const timeoutMs = Number.isFinite(timeoutMsRaw) ? Math.max(5_000, Math.min(10 * 60_000, Math.floor(timeoutMsRaw))) : 120_000;

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
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(timeoutMs)
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
        const routerSessionKey = 'agent:main:task-router';
        const payload = {
            model: 'openclaw:main',
            user: routerSessionKey,
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
                'Content-Type': 'application/json',
                'x-openclaw-session-key': routerSessionKey
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

// ── Sub-agents ────────────────────────────────────────────────────────────────

app.get('/api/subagents', async (req, res) => {
    try {
        const params = JSON.stringify({
            limit: 200
        });
        const { code, stdout, stderr } = await runOpenClaw(
            ['gateway', 'call', 'sessions.list', '--params', params],
            { timeoutMs: 15000 }
        );
        if (code !== 0) {
            return res.status(500).json({ error: 'Failed to list sub-agents', stderr: stderr?.slice(0, 500) });
        }
        const parsed = parseToolOutputJson(stdout, stderr);
        const sessions = Array.isArray(parsed) ? parsed
            : Array.isArray(parsed?.sessions) ? parsed.sessions
                : [];
        // Filter out main sessions, keep only subagent-keyed sessions
        const subagents = sessions.filter(s => {
            const key = String(s?.key || '');
            return key.includes(':subagent:');
        }).map(s => ({
            sessionKey: s.key,
            sessionId: s.sessionId,
            label: s.label || s.displayName || s.key?.split(':').pop() || 'Sub-Agent',
            model: s.model || '',
            updatedAt: s.updatedAt || null,
            channel: s.channel || 'internal',
            kind: s.kind || 'node'
        }));
        return res.json({ subagents });
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
});

app.post('/api/subagents/spawn', async (req, res) => {
    const { label, task, model, agentId = 'main' } = req.body || {};
    if (!task || typeof task !== 'string' || !task.trim()) {
        return res.status(400).json({ error: 'task is required' });
    }
    try {
        const params = {
            task: task.trim(),
            agentId: String(agentId || 'main')
        };
        if (label && typeof label === 'string' && label.trim()) {
            params.label = label.trim();
        }
        if (model && typeof model === 'string' && model.trim()) {
            params.model = model.trim();
        }
        const { code, stdout, stderr } = await runOpenClaw(
            ['gateway', 'call', 'sessions.spawn', '--params', JSON.stringify(params)],
            { timeoutMs: 20000 }
        );
        if (code !== 0) {
            return res.status(500).json({ error: 'Failed to spawn sub-agent', stderr: stderr?.slice(0, 500) });
        }
        const parsed = parseToolOutputJson(stdout, stderr);
        return res.json({
            ok: true,
            status: parsed?.status || 'accepted',
            runId: parsed?.runId || null,
            childSessionKey: parsed?.childSessionKey || null,
            raw: parsed
        });
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
});

app.post('/api/user/profile/sync', async (req, res) => {
    const userId = await requireClerkUserId(req, res);
    if (!userId) return;

    const { username } = req.body || {};
    const normalizedUsername = typeof username === 'string' ? username.trim() : '';
    if (!normalizedUsername) {
        return res.status(400).json({ error: 'username is required' });
    }

    const sb = requireSupabaseAdmin(req, res);
    if (!sb) return;

    try {
        const { data, error } = await sb
            .from('user_profiles')
            .upsert({ userid: userId, username: normalizedUsername }, { onConflict: 'userid' })
            .select('*')
            .single();

        if (error) return res.status(500).json({ error: error.message });

        if (data.operation_status === 'onboarded') {
            const controlPlaneUrl = process.env.OPENCLAW_CONTROL_PLANE_URL || 'http://localhost:4445';
            fetch(`${controlPlaneUrl}/api/provision/user`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-Internal-Secret': process.env.OPENCLAW_INTERNAL_SECRET || '' },
                body: JSON.stringify({ userId, username: normalizedUsername }),
            }).catch((err) => console.error('[profile/sync] provision trigger failed:', err));
        }

        return res.json({ profile: data });
    } catch (error) {
        return res.status(500).json({ error: error?.message || 'Failed to sync profile' });
    }
});

app.get('/api/user/profile', async (req, res) => {
    const userId = await requireClerkUserId(req, res);
    if (!userId) return;

    const sb = requireSupabaseAdmin(req, res);
    if (!sb) return;

    try {
        const { data, error } = await sb
            .from('user_profiles')
            .select('*')
            .eq('userid', userId)
            .maybeSingle();

        if (error) return res.status(500).json({ error: error.message });
        return res.json({ profile: data || null });
    } catch (error) {
        return res.status(500).json({ error: error?.message || 'Failed to fetch profile' });
    }
});

// ── Multi-Tenant Proxy ────────────────────────────────────────────────────────
app.use('/api', async (req, res, next) => {
    // Exclude root health check or profile endpoints from proxying
    if (req.path === '/health' || req.path.startsWith('/user/profile')) {
        return next();
    }

    const userId = await requireClerkUserId(req, res);
    if (!userId) return;

    const sb = requireSupabaseAdmin(req, res);
    if (!sb) return;

    try {
        const { data, error } = await sb
            .from('user_profiles')
            .select('instance_url, gateway_token')
            .eq('userid', userId)
            .maybeSingle();

        if (error || !data || !data.instance_url) {
            return res.status(403).json({ error: 'User is not provisioned or instance URL not found' });
        }

        const targetUrl = new URL(data.instance_url).origin;

        // Apply proxy middleware dynamically for this request
        const proxy = createProxyMiddleware({
            target: targetUrl,
            changeOrigin: true,
            secure: false, // In case of local dev self-signed certs
            onProxyReq: (proxyReq, req, res) => {
                // Attach the user's specific gateway token to the underlying request headers
                if (data.gateway_token) {
                    proxyReq.setHeader('x-gateway-token', data.gateway_token);
                }
            },
            onError: (err, req, res) => {
                res.status(502).json({ error: 'Failed to proxy request to instance: ' + err.message });
            }
        });

        return proxy(req, res, next);
    } catch (error) {
        return res.status(500).json({ error: 'Internal proxy routing error' });
    }
});


