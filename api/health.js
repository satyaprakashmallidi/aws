import { getHealth } from './lib/openclaw.js';

export default async function handler(req, res) {
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        console.log('API: Health check requested');
        console.log('API: Environment check:', {
            gateway_url: process.env.OPENCLAW_GATEWAY_URL ? 'Set ✓' : 'Missing ✗',
            gateway_token: process.env.OPENCLAW_GATEWAY_TOKEN ? 'Set ✓' : 'Missing ✗'
        });

        const result = await getHealth();
        console.log('API: Health check success');
        return res.status(200).json(result);
    } catch (error) {
        console.error('API: Health check error details:', error);
        return res.status(500).json({
            error: error.message,
            details: error.stack,
            env_check: {
                gateway_url: process.env.OPENCLAW_GATEWAY_URL || 'NOT SET',
                gateway_token: process.env.OPENCLAW_GATEWAY_TOKEN ? '***' + process.env.OPENCLAW_GATEWAY_TOKEN.slice(-4) : 'NOT SET'
            }
        });
    }
}
