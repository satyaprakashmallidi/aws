import { listAgents } from '../lib/openclaw.js';

export default async function handler(req, res) {
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const result = await listAgents();
        return res.status(200).json(result);
    } catch (error) {
        console.error('Agents list error:', error);
        return res.status(500).json({ error: error.message });
    }
}
