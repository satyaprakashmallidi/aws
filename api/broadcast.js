import { sendChatMessage } from './lib/openclaw.js';

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { message, agentIds, userId } = req.body;

    if (!message || !agentIds || !Array.isArray(agentIds) || agentIds.length === 0) {
        return res.status(400).json({
            error: 'Message and agent IDs array required'
        });
    }

    try {
        const results = await Promise.allSettled(
            agentIds.map(agentId =>
                sendChatMessage({
                    userId: userId || 'broadcast',
                    messages: [{ role: 'user', content: message }],
                    agentId
                })
            )
        );

        const responses = results.map((result, index) => ({
            agentId: agentIds[index],
            status: result.status,
            response: result.status === 'fulfilled' ? result.value : null,
            error: result.status === 'rejected' ? result.reason.message : null
        }));

        const successCount = responses.filter(r => r.status === 'fulfilled').length;
        const failureCount = responses.filter(r => r.status === 'rejected').length;

        return res.status(200).json({
            message: 'Broadcast sent',
            totalAgents: agentIds.length,
            successCount,
            failureCount,
            responses
        });
    } catch (error) {
        console.error('Broadcast failed:', error);
        return res.status(500).json({ error: error.message });
    }
}
