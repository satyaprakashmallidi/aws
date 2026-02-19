import { Readable } from 'stream';
import { listAgents, listModels, sendChatMessage, sendChatMessageStream, invokeTool, getHealth } from './lib/openclaw.js';
import { getAgentConfig, updateAgentConfig, getAgentStatus } from './lib/openclaw-agent.js';
import { getChatHistory, listSessions } from './lib/openclaw-chat.js';
import { listCronJobs, addCronJob, updateCronJob, deleteCronJob, runCronJob } from './lib/openclaw-cron.js';
import { getUserFromRequest, getSupabase, supabaseAdmin } from './lib/supabase.js';

const OPENCLAW_CONFIG_PATH = '~/.openclaw/openclaw.json';
const SOUL_PATH_CANDIDATES = [
    '~/.openclaw/memory/SOUL.md',
    '~/.openclaw/SOUL.md'
];
const WORKSPACE_ROOT = '~/.openclaw/workspace';

function toArray(value) {
    if (!value) return [];
    return Array.isArray(value) ? value : [value];
}

function sendJson(res, status, body) {
    res.status(status).json(body);
}

async function readConfig() {
    const response = await invokeTool({
        tool: 'read',
        args: { file_path: OPENCLAW_CONFIG_PATH }
    });
    const content = response?.content || response?.data || '{}';
    return JSON.parse(content || '{}');
}

async function writeConfig(config) {
    const content = JSON.stringify(config, null, 2);
    await invokeTool({
        tool: 'write',
        args: { file_path: OPENCLAW_CONFIG_PATH, content }
    });
}

async function readFirstExisting(paths) {
    let lastError = null;
    for (const filePath of paths) {
        try {
            const response = await invokeTool({
                tool: 'read',
                args: { file_path: filePath }
            });
            const content = response?.content || response?.data || '';
            return { filePath, content };
        } catch (err) {
            lastError = err;
        }
    }
    throw lastError || new Error('File not found');
}

function normalizeWorkspacePath(name) {
    if (!name || typeof name !== 'string') return null;
    const safeName = name.replace(/\\/g, '/').trim();
    if (safeName.startsWith('/') || safeName.includes('..')) return null;
    const normalized = safeName.replace(/\/+/g, '/');
    if (normalized.startsWith('..') || normalized.startsWith('/')) return null;
    return `${WORKSPACE_ROOT}/${normalized}`;
}

export default async function handler(req, res) {
    const pathParts = toArray(req.query.path);
    const [resource, id, action] = pathParts;

    // /api/health
    if (resource === 'health') {
        if (req.method !== 'GET') return sendJson(res, 405, { error: 'Method not allowed' });
        try {
            const result = await getHealth();
            return sendJson(res, 200, result);
        } catch (error) {
            return sendJson(res, 500, { error: error.message });
        }
    }

    // /api/agents
    if (resource === 'agents') {
        res.setHeader('Cache-Control', 'no-store, max-age=0, must-revalidate');
        const { id: agentId, action: agentAction } = req.query;

        if (req.method === 'GET') {
            if (agentAction === 'status') {
                try {
                    const status = await getAgentStatus();
                    return sendJson(res, 200, status);
                } catch (error) {
                    return sendJson(res, 500, { error: error.message });
                }
            }

            if (agentAction === 'models') {
                try {
                    const models = await listModels();
                    return sendJson(res, 200, models);
                } catch (error) {
                    return sendJson(res, 500, { error: error.message, details: error.stack, type: error.name });
                }
            }

            if (agentId) {
                try {
                    const config = await getAgentConfig(agentId);
                    return sendJson(res, 200, config);
                } catch (error) {
                    return sendJson(res, 404, { error: error.message });
                }
            }

            try {
                const agents = await listAgents();
                return sendJson(res, 200, agents);
            } catch (error) {
                return sendJson(res, 500, { error: error.message });
            }
        }

        if (req.method === 'PATCH') {
            if (!agentId) return sendJson(res, 400, { error: 'Agent ID required' });
            try {
                const updates = req.body;
                const updatedConfig = await updateAgentConfig(agentId, updates);
                return sendJson(res, 200, updatedConfig);
            } catch (error) {
                return sendJson(res, 500, { error: error.message });
            }
        }

        return sendJson(res, 405, { error: 'Method not allowed' });
    }

    // /api/chat
    if (resource === 'chat') {
        const { action: chatAction, sessionKey, limit, includeTools } = req.query;

        if (req.method === 'POST') {
            const user = { id: 'dev-user' };
            const { message, agentId = 'main', sessionId, stream } = req.body || {};

            if (!message) return sendJson(res, 400, { error: 'Message required' });

            const messages = [{ role: 'user', content: message }];
            try {
                const sessionKeyResolved = sessionId || `agent:${agentId}`;

                if (stream) {
                    const upstream = await sendChatMessageStream({
                        userId: user.id,
                        messages,
                        agentId,
                        sessionKey: sessionKeyResolved
                    });

                    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
                    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
                    res.setHeader('Connection', 'keep-alive');

                    const nodeStream = Readable.fromWeb(upstream.body);
                    nodeStream.pipe(res);
                    return;
                }

                const response = await sendChatMessage({
                    userId: user.id,
                    messages,
                    agentId,
                    sessionKey: sessionKeyResolved
                });

                try {
                    const supabase = await supabaseAdmin.get();
                    if (sessionId) {
                        await supabase.from('messages').insert({
                            session_id: sessionId,
                            role: 'user',
                            content: message
                        });

                        if (response.choices?.[0]?.message?.content) {
                            await supabase.from('messages').insert({
                                session_id: sessionId,
                                role: 'assistant',
                                content: response.choices[0].message.content
                            });
                        }
                    }
                } catch (dbError) {
                    console.error('Failed to save to Supabase:', dbError);
                }

                return sendJson(res, 200, response);
            } catch (error) {
                return sendJson(res, 500, { error: error.message, details: error.stack, type: error.name });
            }
        }

        if (req.method === 'GET') {
            if (chatAction === 'history') {
                if (!sessionKey) return sendJson(res, 400, { error: 'Session key required' });
                try {
                    const history = await getChatHistory(sessionKey, {
                        limit: limit ? parseInt(limit, 10) : 50,
                        includeTools: includeTools === 'true'
                    });
                    return sendJson(res, 200, history);
                } catch (error) {
                    return sendJson(res, 500, { error: error.message });
                }
            }

            if (chatAction === 'sessions') {
                try {
                    const sessions = await listSessions();
                    return sendJson(res, 200, sessions);
                } catch (error) {
                    return sendJson(res, 500, { error: error.message });
                }
            }

            return sendJson(res, 400, { error: 'Invalid action' });
        }

        return sendJson(res, 405, { error: 'Method not allowed' });
    }

    // /api/broadcast
    if (resource === 'broadcast') {
        if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });
        const { message, agentIds, userId } = req.body || {};

        if (!message || !agentIds || !Array.isArray(agentIds) || agentIds.length === 0) {
            return sendJson(res, 400, { error: 'Message and agent IDs array required' });
        }

        try {
            const results = await Promise.allSettled(
                agentIds.map(agentId => sendChatMessage({
                    userId: userId || 'broadcast',
                    messages: [{ role: 'user', content: message }],
                    agentId
                }))
            );

            const responses = results.map((result, index) => ({
                agentId: agentIds[index],
                status: result.status,
                response: result.status === 'fulfilled' ? result.value : null,
                error: result.status === 'rejected' ? result.reason.message : null
            }));

            const successCount = responses.filter(r => r.status === 'fulfilled').length;
            const failureCount = responses.filter(r => r.status === 'rejected').length;

            return sendJson(res, 200, {
                message: 'Broadcast sent',
                totalAgents: agentIds.length,
                successCount,
                failureCount,
                responses
            });
        } catch (error) {
            return sendJson(res, 500, { error: error.message });
        }
    }

    // /api/cron
    if (resource === 'cron') {
        res.setHeader('Cache-Control', 'no-store, max-age=0, must-revalidate');
        const { id: cronId, action: cronAction, includeDisabled } = req.query;

        if (req.method === 'GET') {
            try {
                const jobs = await listCronJobs({ includeDisabled: includeDisabled === 'true' });
                return sendJson(res, 200, jobs);
            } catch (error) {
                return sendJson(res, 500, { error: error.message });
            }
        }

        if (req.method === 'POST') {
            if (cronId && cronAction === 'run') {
                try {
                    const result = await runCronJob(cronId);
                    return sendJson(res, 200, result);
                } catch (error) {
                    return sendJson(res, 500, { error: error.message });
                }
            }

            try {
                const job = req.body;
                const result = await addCronJob(job);
                return sendJson(res, 201, result);
            } catch (error) {
                return sendJson(res, 500, { error: error.message });
            }
        }

        if (req.method === 'PATCH') {
            if (!cronId) return sendJson(res, 400, { error: 'Job ID required' });
            try {
                const updates = req.body;
                const result = await updateCronJob(cronId, updates);
                return sendJson(res, 200, result);
            } catch (error) {
                return sendJson(res, 500, { error: error.message });
            }
        }

        if (req.method === 'DELETE') {
            if (!cronId) return sendJson(res, 400, { error: 'Job ID required' });
            try {
                const result = await deleteCronJob(cronId);
                return sendJson(res, 200, result);
            } catch (error) {
                return sendJson(res, 500, { error: error.message });
            }
        }

        return sendJson(res, 405, { error: 'Method not allowed' });
    }

    // /api/models
    if (resource === 'models') {
        if (req.method !== 'GET') return sendJson(res, 405, { error: 'Method not allowed' });
        try {
            const [models, config] = await Promise.all([
                listModels(),
                readConfig().catch(() => ({}))
            ]);
            const currentModel = config?.agents?.defaults?.model?.primary || '';
            return sendJson(res, 200, { models, currentModel });
        } catch (error) {
            return sendJson(res, 500, { error: error.message });
        }
    }

    // /api/model
    if (resource === 'model') {
        if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });
        const { model } = req.body || {};
        if (!model) return sendJson(res, 400, { error: 'Model is required' });
        try {
            const config = await readConfig();
            if (!config.agents) config.agents = {};
            if (!config.agents.defaults) config.agents.defaults = {};
            if (!config.agents.defaults.model) config.agents.defaults.model = {};
            config.agents.defaults.model.primary = model;
            await writeConfig(config);
            return sendJson(res, 200, { ok: true, model });
        } catch (error) {
            return sendJson(res, 500, { error: error.message });
        }
    }

    // /api/soul
    if (resource === 'soul') {
        if (req.method === 'GET') {
            try {
                const { filePath, content } = await readFirstExisting(SOUL_PATH_CANDIDATES);
                return sendJson(res, 200, { path: filePath, content });
            } catch (error) {
                return sendJson(res, 500, { error: error.message });
            }
        }

        if (req.method === 'PUT') {
            const { content } = req.body || {};
            if (typeof content !== 'string') return sendJson(res, 400, { error: 'Content is required' });
            try {
                let filePath = SOUL_PATH_CANDIDATES[0];
                try {
                    const found = await readFirstExisting(SOUL_PATH_CANDIDATES);
                    filePath = found.filePath;
                } catch {
                    // Ignore and write to default.
                }
                await invokeTool({
                    tool: 'write',
                    args: { file_path: filePath, content }
                });
                return sendJson(res, 200, { ok: true, path: filePath });
            } catch (error) {
                return sendJson(res, 500, { error: error.message });
            }
        }

        return sendJson(res, 405, { error: 'Method not allowed' });
    }

    // /api/workspace-file
    if (resource === 'workspace-file') {
        const { name } = req.query || {};
        const filePath = normalizeWorkspacePath(name);
        if (!filePath) return sendJson(res, 400, { error: 'Invalid file name' });

        if (req.method === 'GET') {
            try {
                const response = await invokeTool({
                    tool: 'read',
                    args: { file_path: filePath }
                });
                const content = response?.content || response?.data || '';
                return sendJson(res, 200, { path: filePath, content });
            } catch (error) {
                return sendJson(res, 500, { error: error.message });
            }
        }

        if (req.method === 'PUT') {
            const { content } = req.body || {};
            if (typeof content !== 'string') return sendJson(res, 400, { error: 'Content is required' });
            try {
                await invokeTool({
                    tool: 'write',
                    args: { file_path: filePath, content }
                });
                return sendJson(res, 200, { ok: true, path: filePath });
            } catch (error) {
                return sendJson(res, 500, { error: error.message });
            }
        }

        return sendJson(res, 405, { error: 'Method not allowed' });
    }

    // /api/tasks
    if (resource === 'tasks') {
        // /api/tasks/queue
        if (id === 'queue') {
            if (req.method !== 'GET') return sendJson(res, 405, { error: 'Method not allowed' });
            try {
                const jobs = await listCronJobs({ includeDisabled: false });
                return sendJson(res, 200, jobs);
            } catch (error) {
                return sendJson(res, 500, { error: error.message });
            }
        }

        // /api/tasks/:id/run|pickup|complete
        if (id && action) {
            if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });
            try {
                if (action === 'run') {
                    const result = await runCronJob(id);
                    return sendJson(res, 200, result);
                }
                if (action === 'pickup') {
                    const { pickedUpBy } = req.body || {};
                    const updates = {
                        metadata: {
                            status: 'picked_up',
                            pickedUpAt: new Date().toISOString(),
                            ...(pickedUpBy ? { pickedUpBy } : {})
                        }
                    };
                    const result = await updateCronJob(id, updates);
                    return sendJson(res, 200, result);
                }
                if (action === 'complete') {
                    const { result, completedBy } = req.body || {};
                    const updates = {
                        metadata: {
                            status: 'completed',
                            completedAt: new Date().toISOString(),
                            ...(result ? { result } : {}),
                            ...(completedBy ? { completedBy } : {})
                        }
                    };
                    const resultPayload = await updateCronJob(id, updates);
                    return sendJson(res, 200, resultPayload);
                }
            } catch (error) {
                return sendJson(res, 500, { error: error.message });
            }
            return sendJson(res, 404, { error: 'Not found' });
        }

        // /api/tasks/:id
        if (id) {
            if (req.method === 'PUT') {
                try {
                    const updates = req.body;
                    const result = await updateCronJob(id, updates);
                    return sendJson(res, 200, result);
                } catch (error) {
                    return sendJson(res, 500, { error: error.message });
                }
            }
            if (req.method === 'DELETE') {
                try {
                    const result = await deleteCronJob(id);
                    return sendJson(res, 200, result);
                } catch (error) {
                    return sendJson(res, 500, { error: error.message });
                }
            }
            return sendJson(res, 405, { error: 'Method not allowed' });
        }

        if (req.method === 'GET') {
            try {
                const jobs = await listCronJobs({ includeDisabled: true });
                return sendJson(res, 200, jobs);
            } catch (error) {
                return sendJson(res, 500, { error: error.message });
            }
        }

        if (req.method === 'POST') {
            try {
                const job = req.body;
                const result = await addCronJob(job);
                return sendJson(res, 201, result);
            } catch (error) {
                return sendJson(res, 500, { error: error.message });
            }
        }

        return sendJson(res, 405, { error: 'Method not allowed' });
    }

    // /api/auth
    if (resource === 'auth') {
        const { action: authAction } = req.query || {};
        const supabase = await getSupabase();

        if (req.method === 'POST') {
            const { email, password } = req.body || {};
            if (!email || !password) return sendJson(res, 400, { error: 'Email and password required' });

            if (authAction === 'login') {
                const { data, error } = await supabase.auth.signInWithPassword({ email, password });
                if (error) return sendJson(res, 401, { error: error.message });
                return sendJson(res, 200, data);
            }

            if (authAction === 'signup') {
                const { data, error } = await supabase.auth.signUp({ email, password });
                if (error) return sendJson(res, 400, { error: error.message });
                return sendJson(res, 201, data);
            }

            return sendJson(res, 400, { error: 'Invalid action' });
        }

        if (req.method === 'GET' && authAction === 'user') {
            const token = req.headers.authorization?.replace('Bearer ', '');
            if (!token) return sendJson(res, 401, { error: 'No authorization token' });

            const { data: { user }, error } = await supabase.auth.getUser(token);
            if (error || !user) return sendJson(res, 401, { error: 'Unauthorized' });

            return sendJson(res, 200, { user });
        }

        return sendJson(res, 405, { error: 'Method not allowed' });
    }

    // /api/debug
    if (resource === 'debug') {
        try {
            const envCheck = {
                nodeVersion: process.version,
                gatewayUrl: process.env.OPENCLAW_GATEWAY_URL ? 'Set' : 'Missing',
                gatewayToken: process.env.OPENCLAW_GATEWAY_TOKEN
                    ? `${process.env.OPENCLAW_GATEWAY_TOKEN.substring(0, 4)}...${process.env.OPENCLAW_GATEWAY_TOKEN.slice(-4)}`
                    : 'Missing'
            };

            let importStatus = 'Not attempted';
            try {
                importStatus = 'Success';
                const results = {};
                const toolsToTest = [
                    'tools_list', 'list_tools', 'agents_list', 'sessions_list',
                    'read', 'fs.read', 'core.read', 'file.read',
                    'models_list', 'list_models', 'models.list',
                    'config.get', 'config_get', 'agent.config'
                ];

                for (const tool of toolsToTest) {
                    try {
                        const resTool = await invokeTool({ tool });
                        results[tool] = { ok: true, data: resTool };
                    } catch (e) {
                        results[tool] = { ok: false, error: e.message };
                    }
                }

                return sendJson(res, 200, {
                    env: envCheck,
                    imports: importStatus,
                    results,
                    note: 'Testing which tools are actually exposed to the Gateway API.'
                });
            } catch (importError) {
                importStatus = `Failed: ${importError.message}`;
                return sendJson(res, 200, {
                    env: envCheck,
                    imports: importStatus,
                    error: importError.toString()
                });
            }
        } catch (error) {
            return sendJson(res, 500, { error: error.message });
        }
    }

    // Unknown endpoint
    return sendJson(res, 404, { error: 'Not found' });
}
