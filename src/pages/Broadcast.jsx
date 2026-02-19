import React, { useState, useEffect } from 'react';
import { apiUrl } from '../lib/apiBase';
import { Send, CheckCircle, AlertCircle, Loader2 } from 'lucide-react';

const Broadcast = () => {
    const [agents, setAgents] = useState([]);
    const [selectedAgents, setSelectedAgents] = useState([]);
    const [message, setMessage] = useState('');
    const [sending, setSending] = useState(false);
    const [results, setResults] = useState(null);

    useEffect(() => {
        fetchAgents();
    }, []);

    const fetchAgents = async () => {
        try {
            const response = await fetch(apiUrl('/api/agents'));
            const data = await response.json();
            setAgents(data.agents || []);
            // Select all by default
            setSelectedAgents((data.agents || []).map(a => a.id));
        } catch (error) {
            console.error('Failed to fetch agents:', error);
        }
    };

    const handleSelectAll = (checked) => {
        if (checked) {
            setSelectedAgents(agents.map(a => a.id));
        } else {
            setSelectedAgents([]);
        }
    };

    const handleAgentToggle = (agentId) => {
        if (selectedAgents.includes(agentId)) {
            setSelectedAgents(selectedAgents.filter(id => id !== agentId));
        } else {
            setSelectedAgents([...selectedAgents, agentId]);
        }
    };

    const handleBroadcast = async (e) => {
        e.preventDefault();
        if (!message.trim() || selectedAgents.length === 0) return;

        setSending(true);
        setResults(null);

        try {
            const response = await fetch(apiUrl('/api/broadcast'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    message,
                    agentIds: selectedAgents
                })
            });

            const data = await response.json();
            setResults(data);
            setMessage('');
        } catch (error) {
            console.error('Broadcast failed:', error);
        } finally {
            setSending(false);
        }
    };

    return (
        <div className="grid grid-cols-12 gap-6 h-[calc(100vh-8rem)]">
            {/* Left: Task Composition */}
            <div className="col-span-4 bg-white rounded-lg shadow p-6 flex flex-col">
                <h2 className="text-xl font-bold text-gray-800 mb-6 flex items-center gap-2">
                    <Send className="w-5 h-5 text-blue-600" />
                    New Broadcast
                </h2>

                <form onSubmit={handleBroadcast} className="flex-1 flex flex-col gap-4">
                    <div className="bg-gray-50 p-4 rounded-lg border border-gray-100 flex-1 flex flex-col">
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                            Select Agents ({selectedAgents.length}/{agents.length})
                        </label>

                        <div className="flex items-center gap-2 mb-3 pb-3 border-b border-gray-200">
                            <input
                                type="checkbox"
                                checked={selectedAgents.length === agents.length && agents.length > 0}
                                onChange={(e) => handleSelectAll(e.target.checked)}
                                className="rounded text-blue-600 focus:ring-blue-500"
                            />
                            <span className="text-sm text-gray-600">Select All</span>
                        </div>

                        <div className="flex-1 overflow-y-auto space-y-2 pr-2">
                            {agents.map(agent => (
                                <label key={agent.id} className="flex items-center gap-3 p-2 hover:bg-white rounded cursor-pointer transition-colors">
                                    <input
                                        type="checkbox"
                                        checked={selectedAgents.includes(agent.id)}
                                        onChange={() => handleAgentToggle(agent.id)}
                                        className="rounded text-blue-600 focus:ring-blue-500"
                                    />
                                    <div className="flex items-center gap-2">
                                        <div className="w-6 h-6 rounded-full bg-gray-200 flex items-center justify-center text-xs">
                                            {agent.identity?.emoji || agent.id[0].toUpperCase()}
                                        </div>
                                        <span className="text-sm font-medium text-gray-700">
                                            {agent.identity?.name || agent.id}
                                        </span>
                                    </div>
                                </label>
                            ))}
                        </div>
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                            Task Instructions
                        </label>
                        <textarea
                            value={message}
                            onChange={(e) => setMessage(e.target.value)}
                            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 h-32 resize-none"
                            placeholder="Describe the task for the selected agents..."
                        />
                    </div>

                    <button
                        type="submit"
                        disabled={sending || selectedAgents.length === 0 || !message.trim()}
                        className="w-full bg-blue-600 text-white py-3 rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 transition-colors shadow-sm"
                    >
                        {sending ? (
                            <>
                                <Loader2 className="w-5 h-5 animate-spin" />
                                Broadcasting...
                            </>
                        ) : (
                            <>
                                <Send className="w-5 h-5" />
                                Send Task
                            </>
                        )}
                    </button>
                </form>
            </div>

            {/* Right: Results Dashboard */}
            <div className="col-span-8 bg-white rounded-lg shadow p-6 flex flex-col">
                <h2 className="text-xl font-bold text-gray-800 mb-6">Broadcast Status</h2>

                {!results && !sending && (
                    <div className="flex-1 flex flex-col items-center justify-center text-gray-400 border-2 border-dashed border-gray-100 rounded-lg">
                        <Send className="w-12 h-12 mb-4 opacity-20" />
                        <p>Select agents and send a task to see results here</p>
                    </div>
                )}

                {sending && (
                    <div className="flex-1 flex flex-col items-center justify-center">
                        <Loader2 className="w-12 h-12 text-blue-600 animate-spin mb-4" />
                        <p className="text-gray-600 font-medium">Dispatching tasks to agents...</p>
                    </div>
                )}

                {results && (
                    <div className="flex-1 overflow-y-auto">
                        <div className="grid grid-cols-3 gap-4 mb-6">
                            <div className="bg-blue-50 p-4 rounded-lg border border-blue-100 text-center">
                                <div className="text-2xl font-bold text-blue-600">{results.totalAgents}</div>
                                <div className="text-xs text-blue-600 font-medium uppercase tracking-wider">Agents Targeted</div>
                            </div>
                            <div className="bg-green-50 p-4 rounded-lg border border-green-100 text-center">
                                <div className="text-2xl font-bold text-green-600">{results.successCount}</div>
                                <div className="text-xs text-green-600 font-medium uppercase tracking-wider">Successful</div>
                            </div>
                            <div className="bg-red-50 p-4 rounded-lg border border-red-100 text-center">
                                <div className="text-2xl font-bold text-red-600">{results.failureCount}</div>
                                <div className="text-xs text-red-600 font-medium uppercase tracking-wider">Failed</div>
                            </div>
                        </div>

                        <div className="space-y-3">
                            {results.responses.map((response, index) => (
                                <div key={index} className="border rounded-lg p-4 bg-gray-50">
                                    <div className="flex justify-between items-start mb-2">
                                        <div className="flex items-center gap-2">
                                            <span className="font-bold text-gray-800">{response.agentId}</span>
                                            {response.status === 'fulfilled' ? (
                                                <span className="bg-green-100 text-green-700 text-xs px-2 py-0.5 rounded-full flex items-center gap-1">
                                                    <CheckCircle className="w-3 h-3" /> Success
                                                </span>
                                            ) : (
                                                <span className="bg-red-100 text-red-700 text-xs px-2 py-0.5 rounded-full flex items-center gap-1">
                                                    <AlertCircle className="w-3 h-3" /> Failed
                                                </span>
                                            )}
                                        </div>
                                    </div>

                                    {response.response && (
                                        <div className="bg-white p-3 rounded border border-gray-200 text-sm font-mono text-gray-700 whitespace-pre-wrap">
                                            {JSON.stringify(response.response, null, 2)}
                                        </div>
                                    )}

                                    {response.error && (
                                        <div className="text-red-600 text-sm bg-red-50 p-2 rounded">
                                            Error: {response.error}
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default Broadcast;
