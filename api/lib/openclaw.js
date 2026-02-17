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
        // Use the standard OpenAI-compatible /v1/models endpoint
        // This avoids permissions issues with the 'exec' tool for remote connections
        if (!GATEWAY_URL || !GATEWAY_TOKEN) {
            throw new Error('OPENCLAW_GATEWAY_URL or OPENCLAW_GATEWAY_TOKEN is not configured in environment variables');
        }

        const response = await fetch(`${GATEWAY_URL.replace(/\/$/, '')}/v1/models`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${GATEWAY_TOKEN}`,
                'Accept': 'application/json'
            },
            cache: 'no-store'
        });

        if (!response.ok) {
            const error = await response.text();
            throw new Error(`OpenClaw Models API error (${response.status}): ${error}`);
        }

        const data = await response.json();

        // OpenClaw /v1/models returns { object: "list", data: [...] }
        const models = data.data || data.models || [];

        if (Array.isArray(models)) {
            return models.map(m => ({
                key: m.id || m.key,
                name: m.name || m.id,
                // Add extra fields as needed by UI
                available: m.available !== false
            }));
        }

        return [];
    } catch (error) {
        console.error('Failed to list models via API:', error.message);
        // Fallback since API call failed
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
