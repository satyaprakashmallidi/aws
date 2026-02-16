import { invokeTool } from './openclaw.js';

/**
 * Get full agent configuration
 * @param {string} agentId - Agent ID (e.g., 'main', 'work')
 */
export async function getAgentConfig(agentId) {
    const response = await invokeTool({
        tool: 'read',
        args: {
            path: `${process.env.HOME || '/home/ubuntu'}/.openclaw/openclaw.json`
        }
    });

    // Parse the config
    const config = JSON.parse(response.content || '{}');

    // Find the specific agent
    const agents = config.agents?.list || [];
    const agent = agents.find(a => a.id === agentId);

    if (!agent) {
        throw new Error(`Agent not found: ${agentId}`);
    }

    return {
        id: agent.id,
        workspace: agent.workspace,
        model: agent.model,
        identity: agent.identity,
        tools: agent.tools,
        skills: agent.skills,
        thinkingLevel: agent.thinking?.level,
        sandbox: agent.sandbox,
        description: agent.description || '',
        // Add any additional config fields
        ...agent
    };
}

/**
 * Update agent configuration
 * @param {string} agentId - Agent ID
 * @param {Object} updates - Config updates
 */
export async function updateAgentConfig(agentId, updates) {
    // First, read the current config
    const readResponse = await invokeTool({
        tool: 'read',
        args: {
            path: `${process.env.HOME || '/home/ubuntu'}/.openclaw/openclaw.json`
        }
    });

    const config = JSON.parse(readResponse.content || '{}');

    // Find and update the agent
    const agents = config.agents?.list || [];
    const agentIndex = agents.findIndex(a => a.id === agentId);

    if (agentIndex === -1) {
        throw new Error(`Agent not found: ${agentId}`);
    }

    // Merge updates
    agents[agentIndex] = {
        ...agents[agentIndex],
        ...updates
    };

    // Write back the config
    await invokeTool({
        tool: 'write',
        args: {
            path: `${process.env.HOME || '/home/ubuntu'}/.openclaw/openclaw.json`,
            content: JSON.stringify(config, null, 2)
        }
    });

    return agents[agentIndex];
}

/**
 * Get agent status from active sessions
 */
export async function getAgentStatus() {
    try {
        const response = await invokeTool({
            tool: 'sessions_list',
            args: { activeMinutes: 60 }
        });

        // Count active agents
        const sessions = response.sessions || [];
        const activeAgents = new Set();

        sessions.forEach(session => {
            if (session.sessionKey) {
                const parts = session.sessionKey.split(':');
                if (parts[0] === 'agent' && parts[1]) {
                    activeAgents.add(parts[1]);
                }
            }
        });

        return {
            totalAgents: sessions.length,
            activeAgents: Array.from(activeAgents),
            activeCount: activeAgents.size,
            sessions
        };
    } catch (error) {
        console.error('Failed to get agent status:', error);
        return {
            totalAgents: 0,
            activeAgents: [],
            activeCount: 0,
            sessions: []
        };
    }
}
