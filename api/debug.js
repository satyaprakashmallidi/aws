export default async function handler(req, res) {
    try {
        const envCheck = {
            nodeVersion: process.version,
            gatewayUrl: process.env.OPENCLAW_GATEWAY_URL ? 'Set' : 'Missing',
            gatewayToken: process.env.OPENCLAW_GATEWAY_TOKEN ?
                `${process.env.OPENCLAW_GATEWAY_TOKEN.substring(0, 4)}...${process.env.OPENCLAW_GATEWAY_TOKEN.slice(-4)}` :
                'Missing'
        };

        let importStatus = 'Not attempted';
        try {
            const { invokeTool } = await import('./lib/openclaw.js');

            importStatus = 'Success';

            const results = {};
            const toolsToTest = [
                'tools_list', 'list_tools', 'agents_list', 'sessions_list',
                'read', 'fs.read', 'core.read', 'file.read',
                'models_list', 'list_models', 'models.list',
                'config.get', 'config_get', 'agent.config'
            ];

            for (const tool of toolsToTest) {
                try {
                    const res = await invokeTool({ tool });
                    results[tool] = { ok: true, data: res };
                } catch (e) {
                    results[tool] = { ok: false, error: e.message };
                }
            }

            return res.status(200).json({
                env: envCheck,
                imports: importStatus,
                results,
                note: "Testing which tools are actually exposed to the Gateway API."
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
