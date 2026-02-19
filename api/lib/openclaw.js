const GATEWAY_URL = process.env.OPENCLAW_GATEWAY_URL;
const GATEWAY_TOKEN = process.env.OPENCLAW_GATEWAY_TOKEN;

// Detailed logger
function debugLog(context, data) {
    if (process.env.DEBUG_OPENCLAW || true) { // Always log for now
        console.log(`[OpenClaw:${context}]`, JSON.stringify(data, null, 2));
    }
}

/**
 * Call OpenClaw Chat Completions API
 * @param {Object} options
 * @param {string} options.userId - User ID for session isolation
 * @param {Array} options.messages - Chat messages
 * @param {string} options.agentId - Agent ID (optional, defaults to 'main')
 */
export async function sendChatMessage({ userId, messages, agentId = 'main', sessionKey }) {
    debugLog('sendChatMessage:start', { userId, agentId, sessionKey, messageCount: messages?.length });

    if (!GATEWAY_URL || !GATEWAY_TOKEN) {
        console.error('[OpenClaw:Error] Missing Env Vars');
        throw new Error('OPENCLAW_GATEWAY_URL or OPENCLAW_GATEWAY_TOKEN is not configured in environment variables');
    }

    try {
        const url = `${GATEWAY_URL.replace(/\/$/, '')}/v1/chat/completions`;
        debugLog('sendChatMessage:request', { url });

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${GATEWAY_TOKEN}`,
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                ...(agentId !== 'main' && { 'x-openclaw-agent-id': agentId }),
                ...(sessionKey && { 'x-openclaw-session-key': sessionKey })
            },
            body: JSON.stringify({
                model: `openclaw:${agentId}`,
                // Use a stable user string so the gateway can derive a stable session key.
                user: sessionKey || `user:${userId}`,
                messages,
                stream: false // Set to true for streaming responses
            }),
            cache: 'no-store'
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error(`[OpenClaw:Error] Chat API Failed: ${response.status}`, errorText);
            throw new Error(`OpenClaw API error (${response.status}): ${errorText}`);
        }

        const data = await response.json();
        debugLog('sendChatMessage:success', { id: data.id, model: data.model });
        return data;
    } catch (e) {
        console.error('[OpenClaw:Error] sendChatMessage Exception:', e);
        throw e;
    }
}

/**
 * Call OpenClaw Chat Completions API (streaming)
 * Returns the raw fetch Response so the caller can pipe SSE.
 */
export async function sendChatMessageStream({ userId, messages, agentId = 'main', sessionKey }) {
    debugLog('sendChatMessageStream:start', { userId, agentId, sessionKey, messageCount: messages?.length });

    if (!GATEWAY_URL || !GATEWAY_TOKEN) {
        console.error('[OpenClaw:Error] Missing Env Vars');
        throw new Error('OPENCLAW_GATEWAY_URL or OPENCLAW_GATEWAY_TOKEN is not configured in environment variables');
    }

    const url = `${GATEWAY_URL.replace(/\/$/, '')}/v1/chat/completions`;
    debugLog('sendChatMessageStream:request', { url });

    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${GATEWAY_TOKEN}`,
            'Content-Type': 'application/json',
            'Accept': 'text/event-stream',
            ...(agentId !== 'main' && { 'x-openclaw-agent-id': agentId }),
            ...(sessionKey && { 'x-openclaw-session-key': sessionKey })
        },
        body: JSON.stringify({
            model: `openclaw:${agentId}`,
            user: sessionKey || `user:${userId}`,
            messages,
            stream: true
        }),
        cache: 'no-store'
    });

    if (!response.ok) {
        const errorText = await response.text();
        console.error(`[OpenClaw:Error] Chat Stream Failed: ${response.status}`, errorText);
        throw new Error(`OpenClaw API error (${response.status}): ${errorText}`);
    }

    return response;
}

/**
 * Call OpenClaw Tools Invoke API
 * @param {Object} options
 * @param {string} options.tool - Tool name (e.g., 'agents_list', 'sessions_list')
 * @param {Object} options.args - Tool arguments
 * @param {string} options.sessionKey - Optional session key
 */
export async function invokeTool({ tool, args = {}, sessionKey }) {
    debugLog('invokeTool:start', { tool, args: Object.keys(args), sessionKey });

    if (!GATEWAY_URL || !GATEWAY_TOKEN) {
        throw new Error('OPENCLAW_GATEWAY_URL or OPENCLAW_GATEWAY_TOKEN is not configured in environment variables');
    }

    try {
        const url = `${GATEWAY_URL.replace(/\/$/, '')}/tools/invoke`;
        // debugLog('invokeTool:request', { url }); 

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${GATEWAY_TOKEN}`,
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            body: JSON.stringify({
                tool,
                args,
                ...(sessionKey && { sessionKey })
            }),
            cache: 'no-store'
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error(`[OpenClaw:Error] Tool Invoke Failed (${tool}): ${response.status}`, errorText);
            throw new Error(`OpenClaw Tools API error (${response.status}): ${errorText}`);
        }

        const data = await response.json();
        // debugLog('invokeTool:success', { tool, responseKeys: Object.keys(data) });
        return data;
    } catch (e) {
        console.error(`[OpenClaw:Error] invokeTool Exception (${tool}):`, e);
        throw e;
    }
}

function extractToolDetails(response) {
    if (response?.result?.details) return response.result.details;
    if (response?.details) return response.details;
    return null;
}

function extractTextContent(response) {
    const content = response?.result?.content || response?.content || response?.data;
    if (Array.isArray(content)) {
        const textItem = content.find(item => item?.type === 'text' && typeof item.text === 'string');
        return textItem?.text || '';
    }
    if (typeof content === 'string') return content;
    return '';
}

function safeJsonParse(raw) {
    if (!raw || typeof raw !== 'string') return null;
    try {
        return JSON.parse(raw);
    } catch {
        return null;
    }
}

export async function getGatewayConfig() {
    try {
        const response = await invokeTool({
            tool: 'gateway',
            args: { action: 'config.get' }
        });

        const details = extractToolDetails(response);
        const parsed = details?.parsed || details?.config || null;
        if (parsed) return parsed;

        const raw = details?.raw || extractTextContent(response);
        const parsedRaw = safeJsonParse(raw);
        if (parsedRaw) return parsedRaw;

        throw new Error('Gateway config not available');
    } catch (error) {
        console.error('[OpenClaw:Error] getGatewayConfig failed:', error);
        throw error;
    }
}

export async function readFile(filePath) {
    const attempts = [
        { tool: 'read', args: { file_path: filePath } },
        { tool: 'fs', args: { action: 'read', path: filePath } },
        { tool: 'fs', args: { action: 'read', file_path: filePath } },
        { tool: 'fs.read', args: { path: filePath } },
        { tool: 'file.read', args: { path: filePath } },
        { tool: 'core.read', args: { path: filePath } }
    ];

    let lastError;
    for (const attempt of attempts) {
        try {
            const response = await invokeTool(attempt);
            const details = extractToolDetails(response);
            const content = details?.content || details?.data || response?.content || response?.data || extractTextContent(response);
            if (typeof content === 'string') {
                return content;
            }
        } catch (error) {
            lastError = error;
        }
    }
    throw lastError || new Error('File read failed');
}

export async function writeFile(filePath, content) {
    const attempts = [
        { tool: 'write', args: { file_path: filePath, content } },
        { tool: 'fs', args: { action: 'write', path: filePath, content } },
        { tool: 'fs', args: { action: 'write', file_path: filePath, content } },
        { tool: 'fs.write', args: { path: filePath, content } },
        { tool: 'file.write', args: { path: filePath, content } },
        { tool: 'core.write', args: { path: filePath, content } }
    ];

    let lastError;
    for (const attempt of attempts) {
        try {
            const response = await invokeTool(attempt);
            return response;
        } catch (error) {
            lastError = error;
        }
    }
    throw lastError || new Error('File write failed');
}

/**
 * List agents
 */
export async function listAgents() {
    try {
        const response = await invokeTool({ tool: 'agents_list' });

        // OpenClaw returns nested structure: { ok, result: { details: { agents: [...] } } }
        if (response?.result?.details?.agents) {
            return {
                agents: response.result.details.agents,
                requester: response.result.details.requester || 'main'
            };
        }

        // Fallback if structure is different
        if (response?.agents) {
            return response;
        }

        return {
            agents: [],
            note: 'No agents found'
        };
    } catch (error) {
        console.error('Failed to list agents:', error);
        throw error; // Let API return 500 so logs show the real error
    }
}

/**
 * List available models
 */
export async function listModels() {
    debugLog('listModels:start', {});

    try {
        // Use standard models_list tool
        const response = await invokeTool({
            tool: 'models_list',
            args: {}
        });

        debugLog('listModels:response', {
            count: response?.count,
            firstModel: response?.models?.[0]?.name
        });

        if (response?.models) {
            return response.models;
        }
        if (response?.result?.details?.models) {
            return response.result.details.models;
        }

        // Fallback: If models_list not available, try sessions list
        console.warn('models_list tool didn\'t return expected format, trying sessions_list...');
        const sessionsResponse = await invokeTool({
            tool: 'sessions_list',
            args: { activeMinutes: 1440, limit: 200 }
        });
        const details = sessionsResponse?.result?.details || {};
        const sessions = details.sessions || sessionsResponse.sessions || [];
        const models = [];
        const seen = new Set();
        for (const session of sessions) {
            const model = session?.model;
            if (model && !seen.has(model)) {
                seen.add(model);
                models.push({ key: model, name: model });
            }
        }
        if (models.length > 0) {
            return models;
        }

        // Final fallback: Use a safe default list so UI doesn't break
        console.warn('sessions_list had no models, returning fallback list.');
        return [
            { key: 'google-antigravity/claude-opus-4-6-thinking', name: 'claude-opus-4-6-thinking' },
            { key: 'google-antigravity/gemini-3-flash', name: 'gemini-3-flash' },
            { key: 'google-antigravity/gemini-3-pro-high', name: 'gemini-3-pro-high' },
            { key: 'google-antigravity/gemini-3-pro-low', name: 'gemini-3-pro-low' }
        ];

        throw new Error('Could not list models via models_list or read config options');

    } catch (error) {
        console.error('[OpenClaw:Error] listModels: Failed completely:', error);
        // Fallback: Return a default list of models so the UI doesn't break
        return [
            { key: 'custom_openai/Kimi-K2.5', name: 'Kimi-K2.5' },
            { key: 'custom_openai/Qwen-2.5', name: 'Qwen-2.5' },
            { key: 'custom_openai/DeepSeek-V3', name: 'DeepSeek-V3' }
        ];
    }
}

function parseModelsFromConfig(config) {
    const models = [];
    const seen = new Set();

    // 1. Add Primary Model
    const primary = config.agents?.defaults?.model?.primary;
    if (primary) {
        models.push({ key: primary, name: primary.split('/').pop() + ' (Primary)', tags: ['primary'] });
        seen.add(primary);
    }

    // 2. Parse models from models.providers (the actual config structure)
    const providers = config.models?.providers || {};
    for (const [providerKey, provider] of Object.entries(providers)) {
        const providerModels = provider.models || [];
        for (const model of providerModels) {
            const modelKey = `${providerKey}/${model.id}`;
            if (!seen.has(modelKey)) {
                models.push({
                    key: modelKey,
                    name: model.name || model.id,
                    tags: ['configured'],
                    provider: providerKey,
                    api: model.api || provider.api
                });
                seen.add(modelKey);
            }
        }
    }

    // 3. Add Fallback Models
    const fallbacks = config.agents?.defaults?.model?.fallbacks || [];
    for (const fb of fallbacks) {
        if (!seen.has(fb)) {
            models.push({ key: fb, name: fb, tags: ['fallback'] });
            seen.add(fb);
        }
    }

    return models;
}

/**
 * Get health status
 */
export async function getHealth() {
    try {
        // Try the chat completions endpoint with a lightweight check
        // The /health endpoint returns HTML (Control UI), not JSON
        const response = await fetch(`${GATEWAY_URL}/v1/chat/completions`, {
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
            cache: 'no-store',
            signal: AbortSignal.timeout(5000)
        });

        // Any response (even 4xx) means the gateway is online and reachable
        return {
            status: 'online',
            gateway_url: GATEWAY_URL,
            timestamp: new Date().toISOString(),
            message: 'Gateway is running and reachable'
        };
    } catch (e) {
        // Network error = gateway is truly offline
        console.error('Health check failed:', e.message);
    }

    return {
        status: 'offline',
        gateway_url: GATEWAY_URL,
        timestamp: new Date().toISOString(),
        message: 'Gateway is not reachable'
    };
}
