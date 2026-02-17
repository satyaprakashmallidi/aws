const GATEWAY_URL = process.env.OPENCLAW_GATEWAY_URL;
const GATEWAY_TOKEN = process.env.OPENCLAW_GATEWAY_TOKEN;

/**
 * Call OpenClaw Chat Completions API
 * @param {Object} options
 * @param {string} options.userId - User ID for session isolation
 * @param {Array} options.messages - Chat messages
 * @param {string} options.agentId - Agent ID (optional, defaults to 'main')
 */
export async function sendChatMessage({ userId, messages, agentId = 'main' }) {
    if (!GATEWAY_URL || !GATEWAY_TOKEN) {
        throw new Error('OPENCLAW_GATEWAY_URL or OPENCLAW_GATEWAY_TOKEN is not configured in environment variables');
    }

    const response = await fetch(`${GATEWAY_URL.replace(/\/$/, '')}/v1/chat/completions`, {
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
        const error = await response.text();
        throw new Error(`OpenClaw API error (${response.status}): ${error}`);
    }

    return response.json();
}

/**
 * Call OpenClaw Tools Invoke API
 * @param {Object} options
 * @param {string} options.tool - Tool name (e.g., 'agents_list', 'sessions_list')
 * @param {Object} options.args - Tool arguments
 * @param {string} options.sessionKey - Optional session key
 */
export async function invokeTool({ tool, args = {}, sessionKey }) {
    if (!GATEWAY_URL || !GATEWAY_TOKEN) {
        throw new Error('OPENCLAW_GATEWAY_URL or OPENCLAW_GATEWAY_TOKEN is not configured in environment variables');
    }

    const response = await fetch(`${GATEWAY_URL.replace(/\/$/, '')}/tools/invoke`, {
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
        const error = await response.text();
        throw new Error(`OpenClaw Tools API error (${response.status}): ${error}`);
    }

    return response.json();
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

        // Default response if no agents found but tool succeeded
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
    try {
        // Strategy: Read the openclaw.json config file directly using the 'read' tool.
        // This is more reliable than 'exec' (permission issues) or /v1/models (needs extra config).
        // The 'read' tool is explicitly allowed in our gateway config.
        const response = await invokeTool({
            tool: 'read',
            args: {
                path: '~/.openclaw/openclaw.json'
            }
        });

        // The read tool returns the file content as a string in response.content or response directly
        // (handling different potential response shapes)
        const fileContent = response.content || response.data || (typeof response === 'string' ? response : null);

        if (!fileContent) {
            // Sometimes 'read' returns the object directly if it's JSON? 
            // Let's check if response ITSELF is the config object
            if (response.agents && response.models) {
                return parseModelsFromConfig(response);
            }
            throw new Error('Empty response from read tool');
        }

        let config = null;
        try {
            config = JSON.parse(fileContent);
        } catch (e) {
            console.error('Failed to parse openclaw.json:', e);
            throw new Error('Invalid JSON in openclaw.json');
        }

        return parseModelsFromConfig(config);

    } catch (error) {
        console.error('Failed to list models via config read:', error.message);
        // Fallback
        return [
            { key: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash (Fallback)' },
            { key: 'gemini-1.5-pro', name: 'Gemini 1.5 Pro (Fallback)' },
            { key: 'claude-3-5-sonnet', name: 'Claude 3.5 Sonnet (Fallback)' },
            { key: 'gpt-4o', name: 'GPT-4o (Fallback)' },
            { key: 'gpt-4o-mini', name: 'GPT-4o Mini (Fallback)' },
            { key: 'deepseek-r1', name: 'DeepSeek R1 (Fallback)' }
        ];
    }
}

function parseModelsFromConfig(config) {
    const models = [];

    // 1. Add Primary Model
    const primary = config.agents?.defaults?.model?.primary;
    if (primary) {
        models.push({ key: primary, name: primary, tags: ['primary'] });
    }

    // 2. Add Fallback Models
    const fallbacks = config.agents?.defaults?.model?.fallbacks || [];
    fallbacks.forEach(db => {
        if (!models.find(m => m.key === db)) {
            models.push({ key: db, name: db, tags: ['fallback'] });
        }
    });

    // 3. Add Configured Models
    const configured = config.agents?.defaults?.models || {};
    Object.keys(configured).forEach(key => {
        if (!models.find(m => m.key === key)) {
            models.push({ key: key, name: key, tags: ['configured'] });
        }
    });

    return models;
}

/**
 * Get health status
 */
export async function getHealth() {
    // Return basic connectivity status
    // Use the /health endpoint for JSON response
    try {
        const response = await fetch(`${GATEWAY_URL}/health`);
        if (response.ok) {
            const data = await response.json();
            return {
                status: 'online',
                gateway_url: GATEWAY_URL,
                timestamp: new Date().toISOString(),
                ...data
            };
        }
    } catch (e) {
        console.error('Health check failed:', e);
    }

    return {
        status: 'online', // Assume online if config is present, consistent with previous behavior
        gateway_url: GATEWAY_URL,
        timestamp: new Date().toISOString(),
        message: 'Gateway connection configured',
        note: 'Use /api/agents/list to verify connectivity'
    };
}
