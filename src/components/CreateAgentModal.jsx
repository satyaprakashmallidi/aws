import React, { useEffect, useState } from 'react';
import { useAuth } from '@clerk/clerk-react';
import { apiUrl } from '../lib/apiBase';
import { X, Plus, AlertCircle } from 'lucide-react';

const FOCUS_RING = 'focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2';

const CreateAgentModal = ({ isOpen, onClose, onCreated }) => {
    const { getToken } = useAuth();

    const [availableModels, setAvailableModels] = useState([]);
    const [loadingModels, setLoadingModels] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState(null);

    const [formData, setFormData] = useState({
        id: '',
        identityName: '',
        identityEmoji: '',
        modelPrimary: '',
        modelFallbacks: []
    });

    useEffect(() => {
        if (!isOpen) return;
        setError(null);

        const load = async () => {
            setLoadingModels(true);
            try {
                const token = await getToken();
                const res = await fetch(apiUrl(`/api/agents?action=models&t=${Date.now()}`), {
                    headers: {
                        ...(token ? { Authorization: `Bearer ${token}` } : {})
                    }
                });
                const data = await res.json().catch(() => []);
                setAvailableModels(Array.isArray(data) ? data : []);
            } catch (err) {
                console.error('Failed to load models', err);
                setAvailableModels([]);
            } finally {
                setLoadingModels(false);
            }
        };

        load();
    }, [getToken, isOpen]);

    if (!isOpen) return null;

    const handleSubmit = async (e) => {
        e.preventDefault();
        setSaving(true);
        setError(null);

        try {
            const token = await getToken();
            const body = {
                id: formData.id,
                identity: {
                    name: formData.identityName,
                    emoji: formData.identityEmoji
                },
                model: {
                    primary: formData.modelPrimary,
                    fallbacks: formData.modelFallbacks
                }
            };

            const response = await fetch(apiUrl('/api/agents'), {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(token ? { Authorization: `Bearer ${token}` } : {})
                },
                body: JSON.stringify(body)
            });

            const data = await response.json().catch(() => null);
            if (!response.ok) throw new Error(data?.error || 'Failed to create agent');

            onCreated?.(data);
            onClose();
            setFormData({
                id: '',
                identityName: '',
                identityEmoji: '',
                modelPrimary: '',
                modelFallbacks: []
            });
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
                    <h3 className="text-xl font-bold text-gray-900">Create Agent</h3>
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

                    <div>
                        <label htmlFor="agent-id" className="block text-sm font-medium text-gray-700 mb-1">
                            Agent ID
                        </label>
                        <input
                            id="agent-id"
                            name="id"
                            type="text"
                            value={formData.id}
                            onChange={(e) => setFormData({ ...formData, id: e.target.value })}
                            required
                            autoComplete="off"
                            className={`w-full rounded-lg border border-gray-300 px-3 py-2 shadow-sm transition-colors ${FOCUS_RING}`}
                            placeholder="e.g. Hai"
                        />
                        <p className="mt-1 text-xs text-gray-500">Letters, numbers, _ and - only.</p>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label htmlFor="create-agent-name" className="block text-sm font-medium text-gray-700 mb-1">
                                Display Name
                            </label>
                            <input
                                id="create-agent-name"
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
                            <label htmlFor="create-agent-emoji" className="block text-sm font-medium text-gray-700 mb-1">
                                Emoji Avatar
                            </label>
                            <input
                                id="create-agent-emoji"
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
                        <label htmlFor="create-agent-primary" className="block text-sm font-medium text-gray-700 mb-1">
                            Primary Model
                        </label>
                        {loadingModels ? (
                            <div className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-gray-50 text-gray-400 text-sm">
                                Loading models…
                            </div>
                        ) : (
                            <select
                                id="create-agent-primary"
                                value={formData.modelPrimary}
                                onChange={(e) => {
                                    const primary = e.target.value;
                                    setFormData({
                                        ...formData,
                                        modelPrimary: primary,
                                        modelFallbacks: formData.modelFallbacks.filter(fb => fb !== primary)
                                    });
                                }}
                                required
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
                        <label htmlFor="create-agent-fallbacks" className="block text-sm font-medium text-gray-700 mb-1">
                            Fallback Models (optional)
                        </label>
                        {loadingModels ? (
                            <div className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-gray-50 text-gray-400 text-sm">
                                Loading models…
                            </div>
                        ) : (
                            <select
                                id="create-agent-fallbacks"
                                multiple
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

                    <div className="flex justify-end gap-3 pt-4">
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
                            <Plus className="w-4 h-4" aria-hidden="true" />
                            {saving ? 'Creating…' : 'Create'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default CreateAgentModal;
