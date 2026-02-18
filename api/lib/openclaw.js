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
export async function sendChatMessage({ userId, messages, agentId = 'main' }) {
    debugLog('sendChatMessage:start', { userId, agentId, messageCount: messages?.length });

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
                ...(agentId !== 'main' && { 'x-openclaw-agent-id': agentId })
            },
            body: JSON.stringify({
                model: `openclaw:${agentId}`,
                user: `user:${userId}`, // Session isolation
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

        // Fallback: If models_list not available, try reading config directly
        console.warn('models_list tool didn\'t return expected format, trying to read config...');

        const configPath = '~/.openclaw/openclaw.json';
        const readResponse = await invokeTool({
            tool: 'read',
            args: { file_path: configPath }
        });

        const fileContent = readResponse?.content || readResponse?.data;
        if (fileContent) {
            const config = JSON.parse(fileContent);
            return parseModelsFromConfig(config);
        }

        throw new Error('Could not list models via models_list or read config options');

    } catch (error) {
        console.error('[OpenClaw:Error] listModels: Failed completely:', error);
        // Fallback
        return [
            { key: 'custom_openai/Kimi-K2.5', name: 'Kimi-K2.5 (Fallback)' }
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
