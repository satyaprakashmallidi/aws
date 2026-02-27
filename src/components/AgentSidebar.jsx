import React, { useState, useEffect, useCallback } from 'react';
import { apiUrl } from '../lib/apiBase';
import { Settings, Circle, Cpu, Zap, Plus, RefreshCw, Clock } from 'lucide-react';
import SpawnSubAgentModal from './CreateAgentModal';

const FOCUS_RING = 'focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2';

function timeAgo(ms) {
    if (!ms) return '';
    const diff = Date.now() - ms;
    if (diff < 60000) return 'just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return `${Math.floor(diff / 86400000)}d ago`;
}

const AgentSidebar = ({ onAgentClick, selectedAgentId }) => {
    const [subagents, setSubagents] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [isSpawnOpen, setIsSpawnOpen] = useState(false);

    const fetchSubAgents = useCallback(async () => {
        try {
            setError(null);
            const response = await fetch(apiUrl('/api/subagents'));
            if (!response.ok) throw new Error('Failed to fetch sub-agents');
            const data = await response.json();
            setSubagents(data.subagents || []);
        } catch (err) {
            console.error(err);
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchSubAgents();
        // Poll every 15s to pick up newly spawned agents
        const interval = setInterval(fetchSubAgents, 15000);
        return () => clearInterval(interval);
    }, [fetchSubAgents]);

    if (loading) {
        return (
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm flex items-center justify-center">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-violet-600"></div>
            </div>
        );
    }

    return (
        <div className="h-full rounded-xl border border-slate-200 bg-white shadow-sm flex flex-col overflow-hidden lg:sticky lg:top-6 lg:max-h-full">
            <div className="p-4 border-b border-gray-100 flex justify-between items-center">
                <h2 className="text-lg font-bold text-gray-800 flex items-center gap-2">
                    <Zap className="w-5 h-5 text-violet-600" aria-hidden="true" />
                    Sub-Agents
                </h2>
                <div className="flex items-center gap-2">
                    <span className="bg-violet-100 text-violet-800 text-xs font-medium px-2.5 py-0.5 rounded-full">
                        {subagents.length}
                    </span>
                    <button
                        type="button"
                        onClick={() => { setLoading(true); fetchSubAgents(); }}
                        aria-label="Refresh sub-agents"
                        className={`rounded-md p-1.5 text-gray-500 transition-colors hover:bg-violet-100 hover:text-violet-700 ${FOCUS_RING}`}
                    >
                        <RefreshCw className="w-4 h-4" aria-hidden="true" />
                    </button>
                    <button
                        type="button"
                        onClick={() => setIsSpawnOpen(true)}
                        aria-label="Spawn sub-agent"
                        className={`rounded-md p-1.5 text-gray-500 transition-colors hover:bg-violet-100 hover:text-violet-700 ${FOCUS_RING}`}
                    >
                        <Plus className="w-4 h-4" aria-hidden="true" />
                    </button>
                </div>
            </div>

            {error && (
                <div className="mx-4 mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                    {error}
                    <button
                        type="button"
                        className={`ml-2 underline ${FOCUS_RING}`}
                        onClick={() => { setLoading(true); fetchSubAgents(); }}
                    >
                        Retry
                    </button>
                </div>
            )}

            <div className="flex-1 overflow-y-auto p-2 space-y-2">
                {subagents.map((agent) => (
                    <div
                        key={agent.sessionKey}
                        className={`group p-3 rounded-lg border transition-all hover:shadow-md ${selectedAgentId === agent.sessionKey
                                ? 'border-violet-500 bg-violet-50'
                                : 'border-gray-200 hover:border-violet-300'
                            }`}
                    >
                        <div className="flex justify-between items-start mb-2">
                            <div className="flex items-center gap-2">
                                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center text-white font-bold text-sm">
                                    {(agent.label?.[0] || 'S').toUpperCase()}
                                </div>
                                <div>
                                    <h3 className="font-semibold text-gray-800 text-sm">{agent.label}</h3>
                                    <div className="flex items-center gap-1">
                                        <Circle className="w-2 h-2 text-green-500 fill-green-500" aria-hidden="true" />
                                        <span className="text-xs text-gray-500">Active</span>
                                    </div>
                                </div>
                            </div>

                            {onAgentClick && (
                                <button
                                    type="button"
                                    onClick={(e) => { e.stopPropagation(); onAgentClick(agent); }}
                                    aria-label={`View sub-agent ${agent.label}`}
                                    className={`rounded-md p-1.5 text-gray-500 transition-colors hover:bg-violet-100 hover:text-violet-700 ${FOCUS_RING}`}
                                >
                                    <Settings className="w-4 h-4" aria-hidden="true" />
                                </button>
                            )}
                        </div>

                        <div className="flex items-center justify-between gap-2 mt-1">
                            {agent.model && (
                                <div className="flex items-center gap-1.5 bg-gray-100 px-2 py-1 rounded text-xs text-gray-600 w-fit">
                                    <Cpu className="w-3 h-3" aria-hidden="true" />
                                    <span className="truncate max-w-[120px]">{agent.model}</span>
                                </div>
                            )}
                            {agent.updatedAt && (
                                <div className="flex items-center gap-1 text-xs text-gray-400 ml-auto">
                                    <Clock className="w-3 h-3" />
                                    <span>{timeAgo(agent.updatedAt)}</span>
                                </div>
                            )}
                        </div>
                    </div>
                ))}

                {subagents.length === 0 && (
                    <div className="text-center py-10 text-gray-400 text-sm">
                        <Zap className="w-8 h-8 mx-auto mb-2 opacity-30" />
                        <p className="font-medium text-gray-500">No sub-agents running</p>
                        <p className="text-xs mt-1">Click <strong>+</strong> to spawn one</p>
                    </div>
                )}
            </div>

            <SpawnSubAgentModal
                isOpen={isSpawnOpen}
                onClose={() => setIsSpawnOpen(false)}
                onCreated={() => {
                    setIsSpawnOpen(false);
                    setLoading(true);
                    fetchSubAgents();
                }}
            />
        </div>
    );
};

export default AgentSidebar;
