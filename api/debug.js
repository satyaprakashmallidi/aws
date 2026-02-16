export default async function handler(req, res) {
    try {
        const envCheck = {
            nodeVersion: process.version,
            gatewayUrl: process.env.OPENCLAW_GATEWAY_URL ? 'Set' : 'Missing',
            gatewayToken: process.env.OPENCLAW_GATEWAY_TOKEN ? 'Set' : 'Missing'
        };

        let importStatus = 'Not attempted';
        try {
            const { getAgentStatus } = await import('./lib/openclaw-agent.js');
            importStatus = 'Success';
            const status = await getAgentStatus();
            return res.status(200).json({
                env: envCheck,
                imports: importStatus,
                agentStatus: status
            });
        } catch (importError) {
            importStatus = `Failed: ${importError.message}`;
            return res.status(200).json({
                env: envCheck,
                imports: importStatus,
                error: importError.toString()
            });
        }
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
}
