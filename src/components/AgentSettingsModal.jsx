import React, { useState, useEffect } from 'react';
import { useAuth } from '@clerk/clerk-react';
import { apiUrl } from '../lib/apiBase';
import { X, Save, AlertCircle, Trash2 } from 'lucide-react';

const FOCUS_RING = 'focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2';

const AgentSettingsModal = ({ agent, isOpen, onClose, onUpdate }) => {
    const { getToken } = useAuth();
    const [formData, setFormData] = useState({
        modelPrimary: '',
        modelFallbacks: [],
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
            getToken()
                .then((token) => ({ token }))
                .then(({ token }) => {
                    return fetch(apiUrl(`/api/agents?action=models&t=${timestamp}`), {
                        headers: {
                            ...(token ? { Authorization: `Bearer ${token}` } : {})
                        }
                    }).then(res => res.json());
                })
                .then(data => {
                    setAvailableModels(Array.isArray(data) ? data : []);
                })
                .catch(err => console.error('Failed to load models', err))
                .finally(() => setLoadingModels(false));

            // Fetch full agent config
            getToken()
                .then((token) => ({ token }))
                .then(({ token }) => {
                    return fetch(apiUrl(`/api/agents?id=${agent.id}&t=${timestamp}`), {
                        headers: {
                            ...(token ? { Authorization: `Bearer ${token}` } : {})
                        }
                    }).then(res => res.json());
                })
                .then(fullConfig => {
                    const rawModel = fullConfig?.model;
                    const modelPrimary = typeof rawModel === 'string' ? rawModel : (rawModel?.primary || '');
                    const modelFallbacks = Array.isArray(rawModel?.fallbacks) ? rawModel.fallbacks : [];

                    setFormData({
                        modelPrimary,
                        modelFallbacks,
                        identityName: fullConfig.identity?.name || '',
                        identityEmoji: fullConfig.identity?.emoji || ''
                    });
                })
                .catch(err => console.error('Failed to load full config', err));
        }
    }, [getToken, isOpen, agent]);

    if (!isOpen || !agent) return null;

    const handleSubmit = async (e) => {
        e.preventDefault();
        setSaving(true);
        setError(null);

        try {
            const updates = {
                model: {
                    primary: formData.modelPrimary,
                    fallbacks: formData.modelFallbacks
                },
                identity: {
                    name: formData.identityName,
                    emoji: formData.identityEmoji
                }
            };

            const token = await getToken();

            const response = await fetch(apiUrl(`/api/agents?id=${agent.id}`), {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                    ...(token ? { Authorization: `Bearer ${token}` } : {})
                },
                body: JSON.stringify(updates)
            });

            const data = await response.json().catch(() => null);
            if (!response.ok) throw new Error(data?.error || 'Failed to update agent');

            onUpdate(data?.agent || { id: agent.id });
            onClose();
        } catch (err) {
            setError(err.message);
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async () => {
        if (!window.confirm(`Delete agent "${agent.id}"? This will remove it from the gateway.`)) return;
        setSaving(true);
        setError(null);

        try {
            const token = await getToken();
            const response = await fetch(apiUrl(`/api/agents?id=${agent.id}`), {
                method: 'DELETE',
                headers: {
                    ...(token ? { Authorization: `Bearer ${token}` } : {})
                }
            });

            const data = await response.json().catch(() => null);
            if (!response.ok) throw new Error(data?.error || 'Failed to delete agent');
            onUpdate({ id: agent.id, deleted: true });
            onClose();
        } catch (err) {
            setError(err.message);
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm overscroll-contain">
            <div role="dialog" aria-modal="true" className="w-full max-w-lg overflow-hidden rounded-xl bg-white shadow-2xl animate-in fade-in zoom-in duration-200">
                <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-gray-50">
                    <h3 className="text-xl font-bold text-gray-900">
                        Edit Agent: {agent.id}
                    </h3>
                    <button
                        type="button"
                        onClick={onClose}
                        aria-label="Close dialog"
                        className={`rounded-full p-1 text-gray-500 transition-colors hover:bg-gray-200 hover:text-gray-700 ${FOCUS_RING}`}
                    >
                        <X className="w-5 h-5" aria-hidden="true" />
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="p-6 space-y-4">
                    {error && (
                        <div className="bg-red-50 text-red-600 p-3 rounded-lg text-sm flex items-center gap-2">
                            <AlertCircle className="w-4 h-4" aria-hidden="true" />
                            {error}
                        </div>
                    )}

                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label htmlFor="agent-name" className="block text-sm font-medium text-gray-700 mb-1">
                                Display Name
                            </label>
                            <input
                                id="agent-name"
                                name="identityName"
                                type="text"
                                value={formData.identityName}
                                onChange={(e) => setFormData({ ...formData, identityName: e.target.value })}
                                autoComplete="off"
                                className={`w-full rounded-lg border border-gray-300 px-3 py-2 shadow-sm transition-colors ${FOCUS_RING}`}
                                placeholder="e.g. Research Assistant"
                            />
                        </div>
                        <div>
                            <label htmlFor="agent-emoji" className="block text-sm font-medium text-gray-700 mb-1">
                                Emoji Avatar
                            </label>
                            <input
                                id="agent-emoji"
                                name="identityEmoji"
                                type="text"
                                value={formData.identityEmoji}
                                onChange={(e) => setFormData({ ...formData, identityEmoji: e.target.value })}
                                autoComplete="off"
                                className={`w-full rounded-lg border border-gray-300 px-3 py-2 shadow-sm transition-colors ${FOCUS_RING}`}
                                placeholder="e.g. 🤖"
                            />
                        </div>
                    </div>

                    <div>
                        <label htmlFor="agent-model-primary" className="block text-sm font-medium text-gray-700 mb-1">
                            Primary Model
                        </label>
                        {loadingModels ? (
                            <div className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-gray-50 text-gray-400 text-sm">
                                Loading models…
                            </div>
                        ) : (
                            <select
                                id="agent-model-primary"
                                name="modelPrimary"
                                value={formData.modelPrimary}
                                onChange={(e) => setFormData({ ...formData, modelPrimary: e.target.value, modelFallbacks: formData.modelFallbacks.filter(fb => fb !== e.target.value) })}
                                className={`w-full rounded-lg border border-gray-300 bg-white px-3 py-2 shadow-sm transition-colors ${FOCUS_RING}`}
                            >
                                <option value="">Select a model…</option>
                                {availableModels.map((model) => (
                                    <option key={model.key} value={model.key}>
                                        {model.name} ({model.key})
                                    </option>
                                ))}
                            </select>
                        )}
                    </div>

                    <div>
                        <label htmlFor="agent-model-fallbacks" className="block text-sm font-medium text-gray-700 mb-1">
                            Fallback Models (optional)
                        </label>
                        {loadingModels ? (
                            <div className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-gray-50 text-gray-400 text-sm">
                                Loading models…
                            </div>
                        ) : (
                            <select
                                id="agent-model-fallbacks"
                                multiple
                                name="modelFallbacks"
                                value={formData.modelFallbacks}
                                onChange={(e) => {
                                    const values = Array.from(e.target.selectedOptions).map(o => o.value);
                                    setFormData({ ...formData, modelFallbacks: values.filter(v => v && v !== formData.modelPrimary) });
                                }}
                                className={`w-full rounded-lg border border-gray-300 bg-white px-3 py-2 shadow-sm transition-colors min-h-[120px] ${FOCUS_RING}`}
                            >
                                {availableModels.map((model) => (
                                    <option key={model.key} value={model.key}>
                                        {model.name} ({model.key})
                                    </option>
                                ))}
                            </select>
                        )}
                        <p className="mt-1 text-xs text-gray-500">Hold Ctrl/Cmd to select multiple.</p>
                    </div>

                    <div className="flex items-center justify-between gap-3 pt-4">
                        <button
                            type="button"
                            onClick={handleDelete}
                            disabled={saving || agent.id === 'main'}
                            className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 font-semibold text-red-700 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS_RING}`}
                        >
                            <Trash2 className="w-4 h-4" aria-hidden="true" />
                            Delete
                        </button>

                        <div className="flex items-center gap-3">
                            <button
                                type="button"
                                onClick={onClose}
                                className={`rounded-lg px-4 py-2 font-semibold text-gray-700 transition-colors hover:bg-gray-100 ${FOCUS_RING}`}
                            >
                                Cancel
                            </button>
                            <button
                                type="submit"
                                disabled={saving}
                                className={`flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 font-semibold text-white shadow-sm transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS_RING}`}
                            >
                                {saving ? (
                                    <>
                                        <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin motion-reduce:animate-none" aria-hidden="true" />
                                        Saving…
                                    </>
                                ) : (
                                    <>
                                        <Save className="w-4 h-4" aria-hidden="true" />
                                        Save Changes
                                    </>
                                )}
                            </button>
                        </div>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default AgentSettingsModal;
