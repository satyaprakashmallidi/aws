import React, { useEffect, useState, useRef } from 'react';
import { OpenClawClient } from '../lib/openclaw';

const OpenClawDebug = () => {
    const [status, setStatus] = useState('Disconnected');
    const [config, setConfig] = useState(null);
    const [logs, setLogs] = useState([]);
    const clientRef = useRef(null);

    // Hardcoded for testing - in production, this should come from env or user input
    // The user's token from `openclaw config get gateway.auth.token`
    const TOKEN = "edab28196150389fb26eaa357b3843dd25f9d04a6119f23f";

    useEffect(() => {
        // Connect to the permanent Cloudflare tunnel
        const wsUrl = 'wss://automation.magicteams.ai';

        const client = new OpenClawClient(wsUrl, TOKEN);
        clientRef.current = client;

        const connect = async () => {
            setStatus('Connecting...');
            try {
                await client.connect();
                setStatus('Connected');

                // Fetch config once connected
                const cfg = await client.send('config.get');
                setConfig(cfg);

            } catch (err) {
                setStatus(`Error: ${err.message}`);
            }
        };

        connect();

        return () => {
            if (client.ws) client.ws.close();
        };
    }, []);

    return (
        <div className="p-4 bg-gray-100 rounded-lg border border-gray-300">
            <h2 className="text-xl font-bold mb-4">OpenClaw Debugger</h2>

            <div className="mb-4">
                <strong>Status:</strong>
                <span className={`ml-2 px-2 py-1 rounded ${status === 'Connected' ? 'bg-green-200 text-green-800' : 'bg-red-200 text-red-800'}`}>
                    {status}
                </span>
            </div>

            <div className="mb-4">
                <h3 className="font-semibold">Config Snapshot:</h3>
                <pre className="bg-gray-800 text-white p-2 rounded text-xs overflow-auto max-h-40">
                    {config ? JSON.stringify(config, null, 2) : 'Loading...'}
                </pre>
            </div>
        </div>
    );
};

export default OpenClawDebug;
