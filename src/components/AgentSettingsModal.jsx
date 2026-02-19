import React, { useState, useEffect } from 'react';
import { apiUrl } from '../lib/apiBase';
import { X, Save, AlertCircle } from 'lucide-react';

const AgentSettingsModal = ({ agent, isOpen, onClose, onUpdate }) => {
    const [formData, setFormData] = useState({
        description: '',
        model: '',
        identityName: '',
        identityEmoji: ''
    });
    const [availableModels, setAvailableModels] = useState([]);
    const [loadingModels, setLoadingModels] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState(null);

    useEffect(() => {
        if (isOpen && agent) {
            const timestamp = Date.now();
            // Fetch models
            setLoadingModels(true);
            fetch(apiUrl(`/api/agents?action=models&t=${timestamp}`))
                .then(res => res.json())
                .then(data => {
                    setAvailableModels(Array.isArray(data) ? data : []);
                })
                .catch(err => console.error('Failed to load models', err))
                .finally(() => setLoadingModels(false));

            // Fetch full agent config
            fetch(apiUrl(`/api/agents?id=${agent.id}&t=${timestamp}`))
                .then(res => res.json())
                .then(fullConfig => {
                    setFormData({
                        description: fullConfig.description || '',
                        model: fullConfig.model || '',
                        identityName: fullConfig.identity?.name || '',
                        identityEmoji: fullConfig.identity?.emoji || ''
                    });
                })
                .catch(err => console.error('Failed to load full config', err));
        }
    }, [isOpen, agent]);

    if (!isOpen || !agent) return null;

    const handleSubmit = async (e) => {
        e.preventDefault();
        setSaving(true);
        setError(null);

        try {
            const updates = {
                description: formData.description,
                model: formData.model,
                identity: {
                    ...agent.identity,
                    name: formData.identityName,
                    emoji: formData.identityEmoji
                }
            };

            const response = await fetch(apiUrl(`/api/agents?id=${agent.id}`), {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(updates)
            });

            if (!response.ok) throw new Error('Failed to update agent');

            const updatedAgent = await response.json();
            onUpdate(updatedAgent);
            onClose();
        } catch (err) {
            setError(err.message);
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg overflow-hidden animate-in fade-in zoom-in duration-200">
                <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-gray-50">
                    <h3 className="text-xl font-bold text-gray-900">
                        Edit Agent: {agent.id}
                    </h3>
                    <button
                        onClick={onClose}
                        className="text-gray-400 hover:text-gray-600 hover:bg-gray-200 p-1 rounded-full transition-colors"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="p-6 space-y-4">
                    {error && (
                        <div className="bg-red-50 text-red-600 p-3 rounded-lg text-sm flex items-center gap-2">
                            <AlertCircle className="w-4 h-4" />
                            {error}
                        </div>
                    )}

                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                Display Name
                            </label>
                            <input
                                type="text"
                                value={formData.identityName}
                                onChange={(e) => setFormData({ ...formData, identityName: e.target.value })}
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
                                placeholder="e.g. Research Assistant"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                Emoji Avatar
                            </label>
                            <input
                                type="text"
                                value={formData.identityEmoji}
                                onChange={(e) => setFormData({ ...formData, identityEmoji: e.target.value })}
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
                                placeholder="e.g. 🤖"
                            />
                        </div>
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                            Model Selection
                        </label>
                        {loadingModels ? (
                            <div className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-gray-50 text-gray-400 text-sm">
                                Loading models...
                            </div>
                        ) : (
                            <div className="relative">
                                <select
                                    value={formData.model}
                                    onChange={(e) => setFormData({ ...formData, model: e.target.value })}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all appearance-none bg-white"
                                >
                                    <option value="">Select a model...</option>
                                    {availableModels.map((model) => (
                                        <option key={model.key} value={model.key}>
                                            {model.name} ({model.key})
                                        </option>
                                    ))}
                                </select>
                                <div className="absolute inset-y-0 right-0 flex items-center px-2 pointer-events-none">
                                    <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path></svg>
                                </div>
                            </div>
                        )}
                        <p className="mt-1 text-xs text-gray-500">
                            Select the primary AI model for this agent.
                        </p>
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                            Description & Directives
                        </label>
                        <textarea
                            value={formData.description}
                            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                            rows={4}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
                            placeholder="Describe what this agent does..."
                        />
                    </div>

                    <div className="flex justify-end gap-3 pt-4">
                        <button
                            type="button"
                            onClick={onClose}
                            className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg font-medium transition-colors"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={saving}
                            className="px-4 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 transition-colors shadow-sm"
                        >
                            {saving ? (
                                <>
                                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                    Saving...
                                </>
                            ) : (
                                <>
                                    <Save className="w-4 h-4" />
                                    Save Changes
                                </>
                            )}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default AgentSettingsModal;
