import { invokeTool } from './openclaw.js';

/**
 * Get full agent configuration
 * @param {string} agentId - Agent ID (e.g., 'main', 'work')
 */
export async function getAgentConfig(agentId) {
    try {
        const configPath = '~/.openclaw/openclaw.json';
        // Use read tool instead of exec
        const response = await invokeTool({
            tool: 'read',
            args: {
                file_path: configPath
            }
        });

        // Extract content from read response
        const content = response?.content || response?.data || '';
        const config = JSON.parse(content || '{}');

        // Extract agent info from actual config structure
        const primary = config.agents?.defaults?.model?.primary || '';
        const providers = config.models?.providers || {};
        const identity = config.identity || { name: 'OpenClaw', emoji: '🦞' };

        // Build model list from providers
        const modelList = [];
        for (const [providerKey, provider] of Object.entries(providers)) {
            for (const model of (provider.models || [])) {
                modelList.push(`${providerKey}/${model.id}`);
            }
        }

        return {
            id: agentId,
            description: 'AI Agent',
            model: primary,
            identity,
            workspace: config.agents?.defaults?.workspace || '/home/ubuntu/.openclaw/workspace',
            availableModels: modelList,
            providers: Object.keys(providers)
        };
    } catch (error) {
        console.warn(`Failed to read agent config: ${error.message}. Returning fallback.`);

        // Return a valid default configuration so the UI still loads
        return {
            id: agentId,
            description: 'AI Agent (Gateway Unavailable)',
            model: 'custom_openai/Kimi-K2.5',
            identity: {
                name: agentId === 'main' ? 'OpenClaw' : 'Agent',
                emoji: '⚠️'
            },
            workspace: '/home/ubuntu/.openclaw/workspace',
            availableModels: [
                'custom_openai/Kimi-K2.5',
                'custom_openai/Qwen-2.5',
                'custom_openai/DeepSeek-V3'
            ],
            providers: ['custom_openai'],
            error: 'Configuration could not be loaded from Gateway.'
        };
    }
}

/**
 * Update agent configuration
 * @param {string} agentId - Agent ID
 * @param {Object} updates - Config updates
 */
export async function updateAgentConfig(agentId, updates) {
    const configPath = '~/.openclaw/openclaw.json';

    // Read current config using read tool
    const readResponse = await invokeTool({
        tool: 'read',
        args: {
            file_path: configPath
        }
    });

    const content = readResponse?.content || readResponse?.data || '{}';
    const config = JSON.parse(content);

    // Apply updates to agents.defaults
    if (!config.agents) config.agents = {};
    if (!config.agents.defaults) config.agents.defaults = {};

    if (updates.model) {
        config.agents.defaults.model = { primary: updates.model };
    }
    if (updates.workspace) {
        config.agents.defaults.workspace = updates.workspace;
    }

    // Write back using write tool
    const configStr = JSON.stringify(config, null, 2);
    await invokeTool({
        tool: 'write',
        args: {
            file_path: configPath,
            content: configStr
        }
    });

    return {
        id: agentId,
        ...config.agents.defaults,
        ...updates
    };
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
