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
    const response = await fetch(`${GATEWAY_URL}/v1/chat/completions`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${GATEWAY_TOKEN}`,
            'Content-Type': 'application/json',
            ...(agentId !== 'main' && { 'x-openclaw-agent-id': agentId })
        },
        body: JSON.stringify({
            model: `openclaw:${agentId}`,
            user: `user:${userId}`, // Session isolation
            messages,
            stream: false // Set to true for streaming responses
        })
    });

    if (!response.ok) {
        const error = await response.text();
        throw new Error(`OpenClaw API error: ${error}`);
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
    const response = await fetch(`${GATEWAY_URL}/tools/invoke`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${GATEWAY_TOKEN}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            tool,
            args,
            ...(sessionKey && { sessionKey })
        })
    });

    if (!response.ok) {
        const error = await response.text();
        throw new Error(`OpenClaw Tools API error: ${error}`);
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

        // Default response
        return {
            agents: [{ id: 'main', status: 'active', model: 'default' }],
            note: 'Using default agent configuration'
        };
    } catch (error) {
        console.error('Failed to list agents:', error);
        return {
            agents: [{ id: 'main', status: 'active', model: 'default' }],
            note: 'Using default agent configuration (error fallback)'
        };
    }
}

/**
 * Get health status
 */
export async function getHealth() {
    // Return basic connectivity status
    // The Gateway root endpoint returns HTML, not JSON
    return {
        status: 'online',
        gateway_url: GATEWAY_URL,
        timestamp: new Date().toISOString(),
        message: 'Gateway connection configured',
        note: 'Use /api/agents/list to verify connectivity'
    };
}
