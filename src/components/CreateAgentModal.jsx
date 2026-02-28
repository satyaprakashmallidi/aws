import React, { useState } from 'react';
import { apiUrl } from '../lib/apiBase';
import { X, Zap, AlertCircle, Info } from 'lucide-react';

const FOCUS_RING = 'focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2';

const SpawnSubAgentModal = ({ isOpen, onClose, onCreated }) => {
    const [spawning, setSpawning] = useState(false);
    const [error, setError] = useState(null);
    const [formData, setFormData] = useState({ label: '', task: '' });

    // Reset on open
    if (!isOpen) return null;
    const resetAndClose = () => { setFormData({ label: '', task: '' }); setError(null); onClose(); };



    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!formData.task.trim()) return;
        setSpawning(true);
        setError(null);

        try {
            const body = {
                task: formData.task.trim(),
                label: formData.label.trim() || undefined,
                agentId: 'main'
            };

            const response = await fetch(apiUrl('/api/subagents/spawn'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });

            const data = await response.json().catch(() => null);
            if (!response.ok) throw new Error(data?.error || 'Failed to spawn sub-agent');

            onCreated?.(data);
        } catch (err) {
            setError(err.message);
        } finally {
            setSpawning(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm overscroll-contain">
            <div role="dialog" aria-modal="true" className="w-full max-w-lg overflow-hidden rounded-xl bg-white shadow-2xl animate-in fade-in zoom-in duration-200">
                <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-gray-50">
                    <h3 className="text-xl font-bold text-gray-900 flex items-center gap-2">
                        <Zap className="w-5 h-5 text-violet-600" />
                        Spawn Sub-Agent
                    </h3>
                    <button
                        type="button"
                        onClick={resetAndClose}
                        aria-label="Close dialog"
                        className={`rounded-full p-1 text-gray-500 transition-colors hover:bg-gray-200 hover:text-gray-700 ${FOCUS_RING}`}
                    >
                        <X className="w-5 h-5" aria-hidden="true" />
                    </button>
                </div>

                {/* Supervised agent info notice */}
                <div className="mx-6 mt-4 flex items-start gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-700">
                    <Info className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
                    <span>Sub-agents are <strong>supervised</strong> — spawning sends a message to the main agent who then creates and monitors the sub-agent. This will appear in the main chat.</span>
                </div>

                <form onSubmit={handleSubmit} className="p-6 space-y-4">
                    {error && (
                        <div className="bg-red-50 text-red-600 p-3 rounded-lg text-sm flex items-center gap-2">
                            <AlertCircle className="w-4 h-4" aria-hidden="true" />
                            {error}
                        </div>
                    )}

                    <div>
                        <label htmlFor="spawn-label" className="block text-sm font-medium text-gray-700 mb-1">
                            Label <span className="text-gray-400 font-normal">(optional)</span>
                        </label>
                        <input
                            id="spawn-label"
                            type="text"
                            value={formData.label}
                            onChange={(e) => setFormData({ ...formData, label: e.target.value })}
                            autoComplete="off"
                            className={`w-full rounded-lg border border-gray-300 px-3 py-2 shadow-sm transition-colors ${FOCUS_RING}`}
                            placeholder="e.g. Research, Coder, Writer"
                        />
                    </div>

                    <div>
                        <label htmlFor="spawn-task" className="block text-sm font-medium text-gray-700 mb-1">
                            Task / Role <span className="text-red-500">*</span>
                        </label>
                        <textarea
                            id="spawn-task"
                            value={formData.task}
                            onChange={(e) => setFormData({ ...formData, task: e.target.value })}
                            required
                            rows={4}
                            className={`w-full rounded-lg border border-gray-300 px-3 py-2 shadow-sm transition-colors resize-none ${FOCUS_RING}`}
                            placeholder="Describe what this sub-agent should do, e.g. 'Search the web and summarize news about AI. Focus on recent developments.'"
                        />
                        <p className="mt-1 text-xs text-gray-500">This becomes the sub-agent's initial instruction.</p>
                    </div>

                    <div className="flex justify-end gap-3 pt-2">
                        <button
                            type="button"
                            onClick={resetAndClose}
                            className={`rounded-lg px-4 py-2 font-semibold text-gray-700 transition-colors hover:bg-gray-100 ${FOCUS_RING}`}
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={spawning || !formData.task.trim()}
                            className={`flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2 font-semibold text-white shadow-sm transition-colors hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS_RING}`}
                        >
                            <Zap className="w-4 h-4" aria-hidden="true" />
                            {spawning ? 'Spawning…' : 'Spawn'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default SpawnSubAgentModal;
