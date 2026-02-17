import { getAgentConfig, updateAgentConfig, getAgentStatus } from './lib/openclaw-agent.js';
import { listAgents, listModels } from './lib/openclaw.js';

export default async function handler(req, res) {
    const { id, action } = req.query;

    // GET /api/agents - List all agents
    // GET /api/agents?id=main - Get specific agent config
    // GET /api/agents?action=status - Get agent status
    // PATCH /api/agents?id=main - Update agent config

    if (req.method === 'GET') {
        // Get agent status
        if (action === 'status') {
            try {
                const status = await getAgentStatus();
                return res.status(200).json(status);
            } catch (error) {
                console.error('Failed to get agent status:', error);
                return res.status(500).json({ error: error.message });
            }
        }

        // Get available models
        if (action === 'models') {
            try {
                const models = await listModels();
                return res.status(200).json(models);
            } catch (error) {
                console.error('Failed to list models:', error);
                return res.status(500).json({ error: error.message });
            }
        }

        // Get specific agent config
        if (id) {
            try {
                const config = await getAgentConfig(id);
                return res.status(200).json(config);
            } catch (error) {
                console.error(`Failed to get agent config for ${id}:`, error);
                return res.status(404).json({ error: error.message });
            }
        }

        // List all agents
        try {
            const agents = await listAgents();
            return res.status(200).json(agents);
        } catch (error) {
            console.error('Failed to list agents:', error);
            return res.status(500).json({ error: error.message });
        }
    }

    if (req.method === 'PATCH') {
        if (!id) {
            return res.status(400).json({ error: 'Agent ID required' });
        }

        try {
            const updates = req.body;
            const updatedConfig = await updateAgentConfig(id, updates);
            return res.status(200).json(updatedConfig);
        } catch (error) {
            console.error(`Failed to update agent config for ${id}:`, error);
            return res.status(500).json({ error: error.message });
        }
    }

    return res.status(405).json({ error: 'Method not allowed' });
}
