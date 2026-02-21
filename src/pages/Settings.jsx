import React, { useEffect, useMemo, useState } from 'react';
import { apiUrl } from '../lib/apiBase';
import { Save, RefreshCw } from 'lucide-react';

const TABS = [
    { id: 'models', label: 'Models' },
    { id: 'channels', label: 'Channels' },
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
            {activeTab === 'channels' && <ChannelsTab />}
            {activeTab === 'soul' && <SoulTab />}
            {activeTab === 'workspace' && <WorkspaceFileTab />}
            {activeTab === 'openclaw' && <OpenClawConfigTab />}
        </div>
    );
};

const PROVIDERS = [
    { key: 'google-antigravity', label: 'Google Antigravity' },
    { key: 'openai', label: 'OpenAI' },
    { key: 'azure', label: 'Azure OpenAI' },
    { key: 'anthropic', label: 'Anthropic' },
    { key: 'gemini', label: 'Gemini' }
];

const ModelsTab = () => {
    const [providerCatalog, setProviderCatalog] = useState([]);
    const [providerKey, setProviderKey] = useState('openai');
    const [authMethod, setAuthMethod] = useState('api_key');
    const [token, setToken] = useState('');
    const [tokenExpiry, setTokenExpiry] = useState('');
    const [models, setModels] = useState([]);
    const [gatewayModels, setGatewayModels] = useState([]);
    const [modelSearch, setModelSearch] = useState('');
    const [enabledModels, setEnabledModels] = useState([]);
    const [primaryModel, setPrimaryModel] = useState('');
    const [fallbacks, setFallbacks] = useState([]);
    const [manualModel, setManualModel] = useState('');
    const [customKey, setCustomKey] = useState('custom_provider');
    const [customLabel, setCustomLabel] = useState('Custom Provider');
    const [customBaseUrl, setCustomBaseUrl] = useState('');
    const [customApi, setCustomApi] = useState('openai');
    const [customAuthHeader, setCustomAuthHeader] = useState('Authorization');
    const [customHeadersJson, setCustomHeadersJson] = useState('');
    const [customModels, setCustomModels] = useState('');
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const [status, setStatus] = useState('');

    const loadCatalog = async () => {
        try {
            const response = await fetch(apiUrl('/api/providers/catalog'));
            if (!response.ok) return;
            const data = await response.json();
            const list = Array.isArray(data.providers) ? data.providers : [];
            setProviderCatalog(list);
            if (list.length && !list.find(p => p.key === providerKey)) {
                setProviderKey(list[0].key);
            }
        } catch {
            // ignore
        }
    };

    const loadGatewayModels = async () => {
        try {
            const response = await fetch(apiUrl('/api/models/catalog-all'));
            if (response.ok) {
                const data = await response.json();
                const list = Array.isArray(data.models) ? data.models : [];
                if (list.length) {
                    setGatewayModels(list);
                    return;
                }
            }
        } catch {
            // ignore
        }
        try {
            const response = await fetch(apiUrl('/api/models/gateway'));
            if (!response.ok) return;
            const data = await response.json();
            const list = Array.isArray(data.models) ? data.models : [];
            setGatewayModels(list);
        } catch {
            // ignore
        }
    };

    const loadConfig = async () => {
        setLoading(true);
        try {
            const response = await fetch(apiUrl('/api/models/config'));
            if (!response.ok) throw new Error('Failed to load model config');
            const data = await response.json();
            const allowed = Array.isArray(data.allowedModels) ? data.allowedModels : [];
            setEnabledModels(allowed);
            setPrimaryModel(data.primary || '');
            setFallbacks(Array.isArray(data.fallbacks) ? data.fallbacks : []);
        } catch (e) {
            setError(e.message);
        } finally {
            setLoading(false);
        }
    };

    const loadModels = async (nextProvider) => {
        const provider = nextProvider || providerKey;
        if (!provider || provider === 'custom') {
            setModels([]);
            return;
        }
        try {
            const response = await fetch(apiUrl(`/api/models/catalog?provider=${encodeURIComponent(provider)}`));
            if (!response.ok) return;
            const data = await response.json();
            const list = Array.isArray(data.models) ? data.models : [];
            setModels(list);
        } catch {
            // ignore
        }
    };

    useEffect(() => {
        loadCatalog();
        loadConfig();
        loadGatewayModels();
    }, []);

    useEffect(() => {
        loadModels(providerKey);
        const provider = providerCatalog.find(p => p.key === providerKey);
        if (provider?.authMethods?.length) {
            setAuthMethod(provider.authMethods[0]);
        }
    }, [providerKey, providerCatalog]);

    const getAuthLabel = (method) => {
        const provider = providerCatalog.find(p => p.key === providerKey);
        if (provider?.authLabels?.[method]) return provider.authLabels[method];
        if (method === 'api_key') return 'API Key';
        if (method === 'paste_token') return 'Paste Token';
        return method;
    };

    const normalizeModelKey = (provider, modelId) => {
        if (!modelId) return '';
        const trimmed = String(modelId).trim();
        if (!trimmed) return '';
        if (trimmed.includes('/')) return trimmed;
        return `${provider}/${trimmed}`;
    };

    const resolveModelKey = (model) => {
        if (!model) return '';
        if (typeof model === 'string') return model;
        return model.key || model.id || model.name || '';
    };

    const toggleModel = (modelKey) => {
        setEnabledModels(prev => {
            if (prev.includes(modelKey)) {
                const next = prev.filter(m => m !== modelKey);
                if (primaryModel === modelKey) setPrimaryModel('');
                setFallbacks(f => f.filter(m => m !== modelKey));
                return next;
            }
            return [...prev, modelKey];
        });
    };

    const addManualModel = () => {
        const modelKey = normalizeModelKey(providerKey, manualModel);
        if (!modelKey) return;
        setEnabledModels(prev => (prev.includes(modelKey) ? prev : [...prev, modelKey]));
        setManualModel('');
    };

    const handleSaveConfig = async () => {
        setSaving(true);
        setError('');
        setStatus('');
        try {
            const allowed = Array.from(new Set([
                ...enabledModels,
                ...(primaryModel ? [primaryModel] : []),
                ...fallbacks
            ]));

            const response = await fetch(apiUrl('/api/models/config'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    primary: primaryModel,
                    fallbacks,
                    allowedModels: allowed
                })
            });
            if (!response.ok) {
                const data = await response.json().catch(() => ({}));
                throw new Error(data.error || 'Failed to save configuration');
            }
            setStatus('Models configuration saved.');
        } catch (e) {
            setError(e.message);
        } finally {
            setSaving(false);
        }
    };

    const handleSaveToken = async () => {
        setSaving(true);
        setError('');
        setStatus('');
        try {
            const response = await fetch(apiUrl('/api/providers/connect'), {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(import.meta.env.VITE_LOCAL_API_SECRET
                        ? { 'x-api-secret': import.meta.env.VITE_LOCAL_API_SECRET }
                        : {})
                },
                body: JSON.stringify({
                    provider: providerKey,
                    token,
                    ...(tokenExpiry ? { expiresIn: tokenExpiry } : {})
                })
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) {
                throw new Error(data.error || 'Failed to save token');
            }
            setStatus('Token saved.');
            setToken('');
            setTokenExpiry('');
            loadGatewayModels();
        } catch (e) {
            setError(e.message);
        } finally {
            setSaving(false);
        }
    };

    const handleSaveCustomProvider = async () => {
        setSaving(true);
        setError('');
        setStatus('');
        try {
            let headers = undefined;
            if (customHeadersJson.trim()) {
                headers = JSON.parse(customHeadersJson);
            }
            const modelList = customModels
                .split('\n')
                .map(line => line.trim())
                .filter(Boolean)
                .map(id => ({ id }));

            const response = await fetch(apiUrl('/api/providers/custom'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    key: customKey,
                    label: customLabel,
                    baseUrl: customBaseUrl,
                    api: customApi,
                    authHeader: customAuthHeader,
                    headers,
                    models: modelList
                })
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) {
                throw new Error(data.error || 'Failed to save custom provider');
            }
            setStatus('Custom provider saved.');
            await loadCatalog();
            await loadModels(customKey);
            setProviderKey(customKey);
        } catch (e) {
            setError(e.message);
        } finally {
            setSaving(false);
        }
    };

    const providerModels = models.map(m => normalizeModelKey(providerKey, resolveModelKey(m)));
    const gatewayList = gatewayModels
        .map(m => resolveModelKey(m))
        .filter(Boolean)
        .map(m => (m.includes('/') ? m : normalizeModelKey(providerKey, m)));
    const combined = Array.from(new Set([...providerModels, ...gatewayList]));
    const search = modelSearch.trim().toLowerCase();
    const filteredModels = search
        ? combined.filter(modelKey => modelKey.toLowerCase().includes(search))
        : combined;
    const enabledForProvider = enabledModels.filter(m => m.startsWith(`${providerKey}/`));

    return (
        <div className="space-y-6">
            <div>
                <h3 className="text-lg font-semibold text-gray-800 mb-2">1. Choose Provider</h3>
                <select
                    value={providerKey}
                    onChange={(e) => setProviderKey(e.target.value)}
                    className="border border-gray-300 rounded-lg px-3 py-2 text-sm w-full md:w-1/2"
                >
                    {providerCatalog.map((provider) => (
                        <option key={provider.key} value={provider.key}>
                            {provider.label}
                        </option>
                    ))}
                </select>
            </div>

            <div>
                <h3 className="text-lg font-semibold text-gray-800 mb-2">2. Authenticate</h3>
                <div className="flex flex-wrap gap-2 mb-3">
                    {(providerCatalog.find(p => p.key === providerKey)?.authMethods || ['api_key']).map((method) => (
                        <button
                            key={method}
                            type="button"
                            onClick={() => setAuthMethod(method)}
                            className={`px-3 py-1.5 rounded-full text-xs font-semibold border ${authMethod === method ? 'border-blue-600 bg-blue-50 text-blue-700' : 'border-gray-200 text-gray-600'}`}
                        >
                            {getAuthLabel(method)}
                        </button>
                    ))}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                    <input
                        type="password"
                        value={token}
                        onChange={(e) => setToken(e.target.value)}
                        className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
                        placeholder="Provider token"
                    />
                    <input
                        type="text"
                        value={tokenExpiry}
                        onChange={(e) => setTokenExpiry(e.target.value)}
                        className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
                        placeholder="Expires in (e.g. 365d)"
                    />
                    <button
                        type="button"
                        onClick={handleSaveToken}
                        disabled={saving || !token}
                        className="px-4 py-2 bg-slate-900 text-white rounded-lg text-sm"
                    >
                        Save Token
                    </button>
                </div>
            </div>

            {providerKey === 'custom' && (
                <div>
                    <h3 className="text-lg font-semibold text-gray-800 mb-2">3. Custom Provider Config</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <input
                            type="text"
                            value={customKey}
                            onChange={(e) => setCustomKey(e.target.value)}
                            className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
                            placeholder="Provider key (e.g. custom_openai)"
                        />
                        <input
                            type="text"
                            value={customLabel}
                            onChange={(e) => setCustomLabel(e.target.value)}
                            className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
                            placeholder="Provider label"
                        />
                        <input
                            type="text"
                            value={customBaseUrl}
                            onChange={(e) => setCustomBaseUrl(e.target.value)}
                            className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
                            placeholder="Base URL"
                        />
                        <select
                            value={customApi}
                            onChange={(e) => setCustomApi(e.target.value)}
                            className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
                        >
                            <option value="openai">OpenAI-compatible</option>
                            <option value="anthropic">Anthropic-compatible</option>
                            <option value="google">Google/Gemini-compatible</option>
                        </select>
                        <input
                            type="text"
                            value={customAuthHeader}
                            onChange={(e) => setCustomAuthHeader(e.target.value)}
                            className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
                            placeholder="Auth header (default: Authorization)"
                        />
                        <textarea
                            value={customHeadersJson}
                            onChange={(e) => setCustomHeadersJson(e.target.value)}
                            rows={3}
                            className="border border-gray-300 rounded-lg px-3 py-2 text-xs font-mono"
                            placeholder="Additional headers JSON (optional)"
                        />
                        <textarea
                            value={customModels}
                            onChange={(e) => setCustomModels(e.target.value)}
                            rows={4}
                            className="border border-gray-300 rounded-lg px-3 py-2 text-xs font-mono md:col-span-2"
                            placeholder="Model IDs, one per line"
                        />
                    </div>
                    <button
                        type="button"
                        onClick={handleSaveCustomProvider}
                        className="mt-3 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm"
                        disabled={saving || !customKey || !customBaseUrl}
                    >
                        Save Custom Provider
                    </button>
                </div>
            )}

            <div>
                <h3 className="text-lg font-semibold text-gray-800 mb-2">{providerKey === 'custom' ? '4' : '3'}. Enable Models</h3>
                <input
                    type="text"
                    value={modelSearch}
                    onChange={(e) => setModelSearch(e.target.value)}
                    className="border border-gray-300 rounded-lg px-3 py-2 text-sm w-full md:w-1/2 mb-3"
                    placeholder="Search models..."
                />
                <div className="flex flex-wrap gap-2 mb-3 max-h-64 overflow-y-auto border border-gray-200 rounded-lg p-3">
                    {filteredModels.length === 0 && (
                        <div className="text-sm text-gray-500">No models found. Add models manually.</div>
                    )}
                    {filteredModels.map((modelKey) => (
                        <button
                            key={modelKey}
                            type="button"
                            onClick={() => toggleModel(modelKey)}
                            className={`px-3 py-1.5 rounded-full text-xs font-semibold border ${enabledModels.includes(modelKey) ? 'border-blue-600 bg-blue-50 text-blue-700' : 'border-gray-200 text-gray-600'}`}
                        >
                            {modelKey}
                        </button>
                    ))}
                </div>
                <div className="flex gap-2 mb-3">
                    <input
                        type="text"
                        value={manualModel}
                        onChange={(e) => setManualModel(e.target.value)}
                        className="border border-gray-300 rounded-lg px-3 py-2 text-sm flex-1"
                        placeholder="Add model ID (e.g. gpt-4.1)"
                    />
                    <button
                        type="button"
                        onClick={addManualModel}
                        className="px-4 py-2 bg-gray-100 rounded-lg text-sm"
                    >
                        Add
                    </button>
                </div>
                <div className="text-xs text-gray-500">Enabled for provider: {enabledForProvider.length}</div>
            </div>

            <div>
                <h3 className="text-lg font-semibold text-gray-800 mb-2">{providerKey === 'custom' ? '5' : '4'}. Primary + Fallbacks</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <select
                        value={primaryModel}
                        onChange={(e) => setPrimaryModel(e.target.value)}
                        className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
                    >
                        <option value="">Select primary model</option>
                        {enabledModels.map((modelKey) => (
                            <option key={modelKey} value={modelKey}>{modelKey}</option>
                        ))}
                    </select>
                    <select
                        multiple
                        value={fallbacks}
                        onChange={(e) => {
                            const values = Array.from(e.target.selectedOptions).map(o => o.value);
                            setFallbacks(values);
                        }}
                        className="border border-gray-300 rounded-lg px-3 py-2 text-sm h-28"
                    >
                        {enabledModels.filter(m => m !== primaryModel).map((modelKey) => (
                            <option key={modelKey} value={modelKey}>{modelKey}</option>
                        ))}
                    </select>
                </div>
                <div className="text-xs text-gray-500 mt-2">Hold Ctrl/Cmd to select multiple fallbacks.</div>
            </div>

            {error && <div className="text-sm text-red-600">{error}</div>}
            {status && <div className="text-sm text-green-600">{status}</div>}

            <div>
                <button
                    type="button"
                    onClick={handleSaveConfig}
                    disabled={saving || !primaryModel}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                >
                    <Save className="w-4 h-4" />
                    {saving ? 'Saving...' : 'Save Configuration'}
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

const ChannelsTab = () => {
    const [loading, setLoading] = useState(true);
    const [plugins, setPlugins] = useState([]);
    const [channelStatus, setChannelStatus] = useState(null);
    const [channelList, setChannelList] = useState(null);
    const [error, setError] = useState('');
    const [status, setStatus] = useState('');
    const [saving, setSaving] = useState(false);

    const [telegramToken, setTelegramToken] = useState('');
    const [discordToken, setDiscordToken] = useState('');
    const [slackBotToken, setSlackBotToken] = useState('');
    const [slackAppToken, setSlackAppToken] = useState('');

    const [loginOutput, setLoginOutput] = useState('');
    const [whatsappQr, setWhatsappQr] = useState('');
    const [whatsappPairing, setWhatsappPairing] = useState(false);

    const secretHeaders = useMemo(() => {
        return import.meta.env.VITE_LOCAL_API_SECRET
            ? { 'x-api-secret': import.meta.env.VITE_LOCAL_API_SECRET }
            : {};
    }, []);

    const loadAll = async () => {
        setLoading(true);
        setError('');
        setStatus('');
        try {
            const [pluginsRes, statusRes, listRes] = await Promise.all([
                fetch(apiUrl('/api/plugins')).catch(() => null),
                fetch(apiUrl('/api/channels/status')).catch(() => null),
                fetch(apiUrl('/api/channels/list')).catch(() => null)
            ]);

            if (pluginsRes?.ok) {
                const data = await pluginsRes.json();
                const parsed = data.parsed;
                const nextPlugins = Array.isArray(parsed?.plugins) ? parsed.plugins : Array.isArray(parsed) ? parsed : [];
                setPlugins(nextPlugins);
            }

            if (statusRes?.ok) {
                const data = await statusRes.json();
                setChannelStatus(data);
            }

            if (listRes?.ok) {
                const data = await listRes.json();
                setChannelList(data);
            }
        } catch (e) {
            setError(e.message);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadAll();
    }, []);

    const pluginEnabled = (id) => {
        const p = plugins.find(pl => pl?.id === id);
        return Boolean(p?.enabled) || p?.status === 'loaded';
    };

    const enablePlugin = async (id) => {
        setSaving(true);
        setError('');
        setStatus('');
        try {
            const res = await fetch(apiUrl('/api/plugins/enable'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...secretHeaders },
                body: JSON.stringify({ id })
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.error || 'Failed to enable plugin');
            setStatus(`Enabled plugin ${id}.`);
            await loadAll();
        } catch (e) {
            setError(e.message);
        } finally {
            setSaving(false);
        }
    };

    const restartGateway = async () => {
        setSaving(true);
        setError('');
        setStatus('');
        try {
            const res = await fetch(apiUrl('/api/gateway/restart'), {
                method: 'POST',
                headers: { ...secretHeaders }
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.error || 'Failed to restart gateway');
            setStatus('Gateway restarted.');
            await loadAll();
        } catch (e) {
            setError(e.message);
        } finally {
            setSaving(false);
        }
    };

    const addChannel = async (payload) => {
        setSaving(true);
        setError('');
        setStatus('');
        try {
            const res = await fetch(apiUrl('/api/channels/add'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...secretHeaders },
                body: JSON.stringify(payload)
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.error || 'Failed to add/update channel');
            setStatus(`${payload.channel} updated.`);
            await loadAll();
        } catch (e) {
            setError(e.message);
        } finally {
            setSaving(false);
        }
    };

    const extractDataUri = (text) => {
        const idx = text.indexOf('data:image/png;base64,');
        if (idx === -1) return '';
        const rest = text.slice(idx);
        const match = rest.match(/^data:image\/png;base64,[A-Za-z0-9+/=]+/);
        return match ? match[0] : '';
    };

    const startWhatsAppLogin = async () => {
        setWhatsappPairing(true);
        setLoginOutput('');
        setWhatsappQr('');
        setError('');
        setStatus('');
        try {
            const res = await fetch(apiUrl('/api/channels/login'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...secretHeaders },
                body: JSON.stringify({ channel: 'whatsapp', verbose: true })
            });
            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                throw new Error(data.error || 'Failed to start WhatsApp login');
            }
            if (!res.body) throw new Error('No response stream');

            const reader = res.body.getReader();
            const decoder = new TextDecoder();
            let buf = '';
            while (true) {
                const { value, done } = await reader.read();
                if (done) break;
                const chunk = decoder.decode(value, { stream: true });
                buf += chunk;
                setLoginOutput(prev => prev + chunk);
                const uri = extractDataUri(buf);
                if (uri && uri !== whatsappQr) setWhatsappQr(uri);
            }
            setStatus('WhatsApp login finished.');
            await loadAll();
        } catch (e) {
            setError(e.message);
        } finally {
            setWhatsappPairing(false);
        }
    };

    const renderStatus = () => {
        if (!channelStatus) return 'No status loaded.';
        if (channelStatus.parsed) return JSON.stringify(channelStatus.parsed, null, 2);
        if (channelStatus.stdout) return String(channelStatus.stdout);
        return JSON.stringify(channelStatus, null, 2);
    };

    const renderList = () => {
        if (!channelList) return 'No list loaded.';
        if (channelList.parsed) return JSON.stringify(channelList.parsed, null, 2);
        if (channelList.stdout) return String(channelList.stdout);
        return JSON.stringify(channelList, null, 2);
    };

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h3 className="text-lg font-semibold text-gray-800">Channels</h3>
                    <div className="text-xs text-gray-500">
                        Tokens are sent to the local API once and configured via the OpenClaw CLI.
                    </div>
                </div>
                <div className="flex gap-2">
                    <button
                        type="button"
                        onClick={loadAll}
                        disabled={loading || saving || whatsappPairing}
                        className="px-3 py-2 bg-gray-100 rounded-lg text-sm flex items-center gap-2"
                    >
                        <RefreshCw className="w-4 h-4" />
                        Refresh
                    </button>
                    <button
                        type="button"
                        onClick={restartGateway}
                        disabled={loading || saving || whatsappPairing}
                        className="px-3 py-2 bg-slate-900 text-white rounded-lg text-sm"
                    >
                        Restart Gateway
                    </button>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                    <div className="flex items-center justify-between mb-2">
                        <h4 className="font-semibold text-gray-800">Telegram</h4>
                        <button
                            type="button"
                            onClick={() => enablePlugin('telegram')}
                            disabled={saving || pluginEnabled('telegram')}
                            className="text-xs px-2 py-1 rounded border border-gray-300 bg-white disabled:opacity-50"
                        >
                            {pluginEnabled('telegram') ? 'Plugin enabled' : 'Enable plugin'}
                        </button>
                    </div>
                    <div className="grid grid-cols-1 gap-2">
                        <input
                            type="password"
                            value={telegramToken}
                            onChange={(e) => setTelegramToken(e.target.value)}
                            className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
                            placeholder="Bot token"
                        />
                        <button
                            type="button"
                            onClick={() => addChannel({ channel: 'telegram', token: telegramToken })}
                            disabled={saving || !telegramToken}
                            className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm disabled:opacity-50"
                        >
                            Save Telegram
                        </button>
                    </div>
                </div>

                <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                    <div className="flex items-center justify-between mb-2">
                        <h4 className="font-semibold text-gray-800">Discord</h4>
                        <button
                            type="button"
                            onClick={() => enablePlugin('discord')}
                            disabled={saving || pluginEnabled('discord')}
                            className="text-xs px-2 py-1 rounded border border-gray-300 bg-white disabled:opacity-50"
                        >
                            {pluginEnabled('discord') ? 'Plugin enabled' : 'Enable plugin'}
                        </button>
                    </div>
                    <div className="grid grid-cols-1 gap-2">
                        <input
                            type="password"
                            value={discordToken}
                            onChange={(e) => setDiscordToken(e.target.value)}
                            className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
                            placeholder="Bot token"
                        />
                        <button
                            type="button"
                            onClick={() => addChannel({ channel: 'discord', token: discordToken })}
                            disabled={saving || !discordToken}
                            className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm disabled:opacity-50"
                        >
                            Save Discord
                        </button>
                    </div>
                </div>

                <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                    <div className="flex items-center justify-between mb-2">
                        <h4 className="font-semibold text-gray-800">Slack</h4>
                        <button
                            type="button"
                            onClick={() => enablePlugin('slack')}
                            disabled={saving || pluginEnabled('slack')}
                            className="text-xs px-2 py-1 rounded border border-gray-300 bg-white disabled:opacity-50"
                        >
                            {pluginEnabled('slack') ? 'Plugin enabled' : 'Enable plugin'}
                        </button>
                    </div>
                    <div className="grid grid-cols-1 gap-2">
                        <input
                            type="password"
                            value={slackBotToken}
                            onChange={(e) => setSlackBotToken(e.target.value)}
                            className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
                            placeholder="Bot token (xoxb-...)"
                        />
                        <input
                            type="password"
                            value={slackAppToken}
                            onChange={(e) => setSlackAppToken(e.target.value)}
                            className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
                            placeholder="App token (xapp-...)"
                        />
                        <button
                            type="button"
                            onClick={() => addChannel({ channel: 'slack', slackBotToken, slackAppToken })}
                            disabled={saving || (!slackBotToken && !slackAppToken)}
                            className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm disabled:opacity-50"
                        >
                            Save Slack
                        </button>
                    </div>
                </div>

                <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                    <div className="flex items-center justify-between mb-2">
                        <h4 className="font-semibold text-gray-800">WhatsApp</h4>
                        <button
                            type="button"
                            onClick={() => enablePlugin('whatsapp')}
                            disabled={saving || pluginEnabled('whatsapp')}
                            className="text-xs px-2 py-1 rounded border border-gray-300 bg-white disabled:opacity-50"
                        >
                            {pluginEnabled('whatsapp') ? 'Plugin enabled' : 'Enable plugin'}
                        </button>
                    </div>
                    <div className="space-y-2">
                        <button
                            type="button"
                            onClick={startWhatsAppLogin}
                            disabled={saving || whatsappPairing}
                            className="px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm disabled:opacity-50"
                        >
                            {whatsappPairing ? 'Pairing…' : 'Start pairing (QR)'}
                        </button>
                        {whatsappQr && (
                            <div className="border border-gray-200 rounded bg-white p-2 inline-block">
                                <img src={whatsappQr} alt="WhatsApp QR" className="w-56 h-56" />
                            </div>
                        )}
                        <textarea
                            value={loginOutput}
                            readOnly
                            rows={6}
                            className="w-full border border-gray-300 rounded-lg p-2 font-mono text-xs bg-white"
                            placeholder="WhatsApp login output will appear here..."
                        />
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div>
                    <h4 className="font-semibold text-gray-800 mb-2">Current channel status</h4>
                    <textarea
                        value={loading ? 'Loading…' : renderStatus()}
                        readOnly
                        rows={10}
                        className="w-full border border-gray-300 rounded-lg p-3 font-mono text-xs bg-white"
                    />
                </div>
                <div>
                    <h4 className="font-semibold text-gray-800 mb-2">Configured channels</h4>
                    <textarea
                        value={loading ? 'Loading…' : renderList()}
                        readOnly
                        rows={10}
                        className="w-full border border-gray-300 rounded-lg p-3 font-mono text-xs bg-white"
                    />
                </div>
            </div>

            {error && <div className="text-sm text-red-600">{error}</div>}
            {status && <div className="text-sm text-green-600">{status}</div>}
        </div>
    );
};

export default Settings;
