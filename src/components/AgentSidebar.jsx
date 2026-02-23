import React, { useState, useEffect } from 'react';
import { apiUrl } from '../lib/apiBase';
import { Settings, Circle, Cpu, Users } from 'lucide-react';

const FOCUS_RING = 'focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2';

const AgentSidebar = ({ onAgentClick, selectedAgentId }) => {
    const [agents, setAgents] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    useEffect(() => {
        fetchAgents();
    }, []);

    const fetchAgents = async () => {
        try {
            const response = await fetch(apiUrl('/api/agents'));
            if (!response.ok) throw new Error('Failed to fetch agents');
            const data = await response.json();
            setAgents(data.agents || []);
        } catch (err) {
            console.error(err);
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    if (loading) {
        return (
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm flex items-center justify-center">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
            </div>
        );
    }

    return (
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm flex flex-col overflow-hidden lg:sticky lg:top-6 lg:max-h-[calc(100dvh-10rem)]">
            <div className="p-4 border-b border-gray-100 flex justify-between items-center">
                <h2 className="text-lg font-bold text-gray-800 flex items-center gap-2">
                    <Users className="w-5 h-5 text-blue-600" aria-hidden="true" />
                    Agents
                </h2>
                <span className="bg-blue-100 text-blue-800 text-xs font-medium px-2.5 py-0.5 rounded-full">
                    {agents.length}
                </span>
            </div>

            <div className="flex-1 overflow-y-auto p-2 space-y-2">
                {agents.map((agent) => (
                    <div
                        key={agent.id}
                        className={`group p-3 rounded-lg border transition-colors transition-shadow hover:shadow-md ${selectedAgentId === agent.id
                                ? 'border-blue-500 bg-blue-50'
                                : 'border-gray-200 hover:border-blue-300'
                            }`}
                    >
                        <div className="flex justify-between items-start mb-2">
                            <div className="flex items-center gap-2">
                                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white font-bold text-sm">
                                    {agent.identity?.emoji || agent.id[0].toUpperCase()}
                                </div>
                                <div>
                                    <h3 className="font-semibold text-gray-800 text-sm">{agent.identity?.name || agent.id}</h3>
                                    <div className="flex items-center gap-1">
                                        <Circle className="w-2 h-2 text-green-500 fill-green-500" aria-hidden="true" />
                                        <span className="text-xs text-gray-500">{agent.status || 'Active'}</span>
                                    </div>
                                </div>
                            </div>

                            <button
                                type="button"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    onAgentClick(agent);
                                }}
                                aria-label={`Edit agent ${agent.identity?.name || agent.id}`}
                                className={`rounded-md p-1.5 text-gray-500 transition-colors hover:bg-blue-100 hover:text-blue-700 ${FOCUS_RING}`}
                            >
                                <Settings className="w-4 h-4" aria-hidden="true" />
                            </button>
                        </div>

                        {agent.description && (
                            <p className="text-xs text-gray-600 line-clamp-2 mb-2">
                                {agent.description}
                            </p>
                        )}

                        <div className="flex items-center gap-1.5 bg-gray-100 px-2 py-1 rounded text-xs text-gray-600 w-fit">
                            <Cpu className="w-3 h-3" aria-hidden="true" />
                            <span className="truncate max-w-[120px]">{agent.model}</span>
                        </div>
                    </div>
                ))}

                {agents.length === 0 && (
                    <div className="text-center py-8 text-gray-500 text-sm">
                        No agents found
                    </div>
                )}
            </div>
        </div>
    );
};

export default AgentSidebar;
