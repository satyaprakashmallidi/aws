import React, { useEffect, useMemo, useState } from 'react';
import { apiUrl } from '../lib/apiBase';
import { Save, RefreshCw } from 'lucide-react';

const TABS = [
    { id: 'models', label: 'Models' },
    { id: 'soul', label: 'SOUL.md' },
    { id: 'workspace', label: 'Workspace File' },
    { id: 'openclaw', label: 'openclaw.json' }
];

const Settings = () => {
    const [activeTab, setActiveTab] = useState('models');

    return (
        <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-2xl font-bold text-gray-800 mb-6">Settings</h2>

            <div className="flex gap-2 mb-6 border-b border-gray-200">
                {TABS.map(tab => (
                    <button
                        key={tab.id}
                        onClick={() => setActiveTab(tab.id)}
                        className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${activeTab === tab.id
                                ? 'border-blue-600 text-blue-600'
                                : 'border-transparent text-gray-500 hover:text-gray-700'
                            }`}
                    >
                        {tab.label}
                    </button>
                ))}
            </div>

            {activeTab === 'models' && <ModelsTab />}
            {activeTab === 'soul' && <SoulTab />}
            {activeTab === 'workspace' && <WorkspaceFileTab />}
            {activeTab === 'openclaw' && <OpenClawConfigTab />}
        </div>
    );
};

const ModelsTab = () => {
    const [models, setModels] = useState([]);
    const [currentModel, setCurrentModel] = useState('');
    const [selectedModel, setSelectedModel] = useState('');
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const [status, setStatus] = useState('');

    const loadModels = async () => {
        setLoading(true);
        setError('');
        setStatus('');
        try {
            const response = await fetch(apiUrl('/api/models'));
            if (!response.ok) throw new Error('Failed to load models');
            const data = await response.json();
            setModels(data.models || []);
            setCurrentModel(data.currentModel || '');
            setSelectedModel(data.currentModel || '');
        } catch (e) {
            setError(e.message);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadModels();
    }, []);

    const handleSave = async () => {
        if (!selectedModel) return;
        setSaving(true);
        setError('');
        setStatus('');
        try {
            const response = await fetch(apiUrl('/api/model'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ model: selectedModel })
            });
            if (!response.ok) {
                const data = await response.json().catch(() => ({}));
                throw new Error(data.error || 'Failed to update model');
            }
            setCurrentModel(selectedModel);
            setStatus('Model updated');
        } catch (e) {
            setError(e.message);
        } finally {
            setSaving(false);
        }
    };

    const hasChanges = useMemo(
        () => selectedModel && selectedModel !== currentModel,
        [selectedModel, currentModel]
    );

    return (
        <div>
            <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-gray-800">Active Model</h3>
                <button
                    onClick={loadModels}
                    className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-800"
                >
                    <RefreshCw className="w-4 h-4" />
                    Refresh
                </button>
            </div>

            {loading ? (
                <div className="text-gray-500 text-sm">Loading models...</div>
            ) : (
                <div className="space-y-3">
                    <select
                        className="w-full border border-gray-300 rounded-lg px-3 py-2"
                        value={selectedModel}
                        onChange={(e) => setSelectedModel(e.target.value)}
                    >
                        <option value="">Select a model...</option>
                        {models.map(model => (
                            <option key={model.key || model.name} value={model.key || model.name}>
                                {model.name || model.key}
                            </option>
                        ))}
                    </select>

                    <div className="text-xs text-gray-500">
                        Current: <span className="font-mono">{currentModel || 'unknown'}</span>
                    </div>
                </div>
            )}

            {error && (
                <div className="mt-3 text-sm text-red-600">{error}</div>
            )}
            {status && (
                <div className="mt-3 text-sm text-green-600">{status}</div>
            )}

            <div className="mt-4">
                <button
                    onClick={handleSave}
                    disabled={!hasChanges || saving}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                >
                    <Save className="w-4 h-4" />
                    {saving ? 'Saving...' : 'Save'}
                </button>
            </div>
        </div>
    );
};

const SoulTab = () => {
    const [content, setContent] = useState('');
    const [path, setPath] = useState('');
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const [status, setStatus] = useState('');

    const loadSoul = async () => {
        setLoading(true);
        setError('');
        setStatus('');
        try {
            const response = await fetch(apiUrl('/api/soul'));
            if (!response.ok) throw new Error('Failed to load SOUL.md');
            const data = await response.json();
            setContent(data.content || '');
            setPath(data.path || '');
        } catch (e) {
            setError(e.message);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadSoul();
    }, []);

    const handleSave = async () => {
        setSaving(true);
        setError('');
        setStatus('');
        try {
            const response = await fetch(apiUrl('/api/soul'), {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ content })
            });
            if (!response.ok) {
                const data = await response.json().catch(() => ({}));
                throw new Error(data.error || 'Failed to save SOUL.md');
            }
            setStatus('Saved');
        } catch (e) {
            setError(e.message);
        } finally {
            setSaving(false);
        }
    };

    return (
        <div>
            <div className="flex items-center justify-between mb-2">
                <h3 className="text-lg font-semibold text-gray-800">SOUL.md</h3>
                <button
                    onClick={loadSoul}
                    className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-800"
                >
                    <RefreshCw className="w-4 h-4" />
                    Refresh
                </button>
            </div>
            {path && (
                <div className="text-xs text-gray-500 mb-2">Path: <span className="font-mono">{path}</span></div>
            )}
            {loading ? (
                <div className="text-gray-500 text-sm">Loading SOUL.md...</div>
            ) : (
                <textarea
                    value={content}
                    onChange={(e) => setContent(e.target.value)}
                    rows={14}
                    className="w-full border border-gray-300 rounded-lg p-3 font-mono text-sm"
                />
            )}

            {error && <div className="mt-3 text-sm text-red-600">{error}</div>}
            {status && <div className="mt-3 text-sm text-green-600">{status}</div>}

            <div className="mt-4">
                <button
                    onClick={handleSave}
                    disabled={saving}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                >
                    <Save className="w-4 h-4" />
                    {saving ? 'Saving...' : 'Save'}
                </button>
            </div>
        </div>
    );
};

const WorkspaceFileTab = () => {
    const [fileName, setFileName] = useState('');
    const [content, setContent] = useState('');
    const [path, setPath] = useState('');
    const [files, setFiles] = useState([]);
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const [status, setStatus] = useState('');

    const loadFiles = async () => {
        setError('');
        try {
            const response = await fetch(apiUrl('/api/workspace-list'));
            if (!response.ok) {
                const data = await response.json().catch(() => ({}));
                throw new Error(data.error || 'Failed to load file list');
            }
            const data = await response.json();
            const nextFiles = Array.isArray(data.files) ? data.files : [];
            setFiles(nextFiles);
            if (!fileName && nextFiles.length > 0) {
                const first = nextFiles[0];
                setFileName(first);
                loadFile(first);
            }
        } catch (e) {
            setError(e.message);
        }
    };

    const loadFile = async (forcedName) => {
        setLoading(true);
        setError('');
        setStatus('');
        try {
            const target = forcedName || fileName;
            if (!target) throw new Error('Select a file first');
            const response = await fetch(apiUrl(`/api/workspace-file?name=${encodeURIComponent(target)}`));
            if (!response.ok) {
                const data = await response.json().catch(() => ({}));
                throw new Error(data.error || 'Failed to load file');
            }
            const data = await response.json();
            setContent(data.content || '');
            setPath(data.path || '');
        } catch (e) {
            setError(e.message);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadFiles();
    }, []);

    const handleSave = async () => {
        setSaving(true);
        setError('');
        setStatus('');
        try {
            const response = await fetch(apiUrl(`/api/workspace-file?name=${encodeURIComponent(fileName)}`), {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ content })
            });
            if (!response.ok) {
                const data = await response.json().catch(() => ({}));
                throw new Error(data.error || 'Failed to save file');
            }
            setStatus('Saved');
        } catch (e) {
            setError(e.message);
        } finally {
            setSaving(false);
        }
    };

    return (
        <div>
            <div className="flex items-center justify-between mb-3">
                <h3 className="text-lg font-semibold text-gray-800">Workspace File</h3>
                <button
                    onClick={loadFile}
                    className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-800"
                    disabled={!fileName}
                >
                    <RefreshCw className="w-4 h-4" />
                    Load
                </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-2 mb-3">
                <select
                    value={fileName}
                    onChange={(e) => {
                        const next = e.target.value;
                        setFileName(next);
                        if (next) loadFile(next);
                    }}
                    className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
                >
                    <option value="">Select a file...</option>
                    {files.map((f) => (
                        <option key={f} value={f}>{f}</option>
                    ))}
                </select>
                <input
                    type="text"
                    value={fileName}
                    onChange={(e) => setFileName(e.target.value)}
                    className="border border-gray-300 rounded-lg px-3 py-2 text-sm md:col-span-2"
                    placeholder="or type a path (e.g. README.md or notes/todo.md)"
                />
            </div>

            {path && (
                <div className="text-xs text-gray-500 mb-2">Path: <span className="font-mono">{path}</span></div>
            )}

            {loading ? (
                <div className="text-gray-500 text-sm">Loading file...</div>
            ) : (
                <textarea
                    value={content}
                    onChange={(e) => setContent(e.target.value)}
                    rows={14}
                    className="w-full border border-gray-300 rounded-lg p-3 font-mono text-sm"
                />
            )}

            {error && <div className="mt-3 text-sm text-red-600">{error}</div>}
            {status && <div className="mt-3 text-sm text-green-600">{status}</div>}

            <div className="mt-4">
                <button
                    onClick={handleSave}
                    disabled={saving || !fileName}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                >
                    <Save className="w-4 h-4" />
                    {saving ? 'Saving...' : 'Save'}
                </button>
            </div>
        </div>
    );
};

const OpenClawConfigTab = () => {
    const [content, setContent] = useState('');
    const [path, setPath] = useState('');
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const [status, setStatus] = useState('');

    const loadConfig = async () => {
        setLoading(true);
        setError('');
        setStatus('');
        try {
            const response = await fetch(apiUrl('/api/openclaw-config'));
            if (!response.ok) {
                const data = await response.json().catch(() => ({}));
                throw new Error(data.error || 'Failed to load config');
            }
            const data = await response.json();
            setContent(data.content || '');
            setPath(data.path || '');
        } catch (e) {
            setError(e.message);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadConfig();
    }, []);

    const handleSave = async () => {
        setSaving(true);
        setError('');
        setStatus('');
        try {
            const response = await fetch(apiUrl('/api/openclaw-config'), {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ content })
            });
            if (!response.ok) {
                const data = await response.json().catch(() => ({}));
                throw new Error(data.error || 'Failed to save config');
            }
            setStatus('Saved');
        } catch (e) {
            setError(e.message);
        } finally {
            setSaving(false);
        }
    };

    return (
        <div>
            <div className="flex items-center justify-between mb-2">
                <h3 className="text-lg font-semibold text-gray-800">openclaw.json</h3>
                <button
                    onClick={loadConfig}
                    className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-800"
                >
                    <RefreshCw className="w-4 h-4" />
                    Refresh
                </button>
            </div>
            {path && (
                <div className="text-xs text-gray-500 mb-2">Path: <span className="font-mono">{path}</span></div>
            )}
            {loading ? (
                <div className="text-gray-500 text-sm">Loading config...</div>
            ) : (
                <textarea
                    value={content}
                    onChange={(e) => setContent(e.target.value)}
                    rows={16}
                    className="w-full border border-gray-300 rounded-lg p-3 font-mono text-sm"
                />
            )}

            {error && <div className="mt-3 text-sm text-red-600">{error}</div>}
            {status && <div className="mt-3 text-sm text-green-600">{status}</div>}

            <div className="mt-4">
                <button
                    onClick={handleSave}
                    disabled={saving}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                >
                    <Save className="w-4 h-4" />
                    {saving ? 'Saving...' : 'Save'}
                </button>
            </div>
        </div>
    );
};

export default Settings;
