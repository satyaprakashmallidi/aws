import React, { useEffect, useMemo, useState } from 'react';
import { apiUrl } from '../lib/apiBase';
import { Save, RefreshCw } from 'lucide-react';

const FOCUS_RING = 'focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2';

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
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
            <h2 className="mb-6 text-2xl font-bold text-gray-900">Settings</h2>

            <div className="mb-6 flex flex-wrap gap-2 border-b border-gray-200" role="tablist" aria-label="Settings">
                {TABS.map(tab => (
                    <button
                        key={tab.id}
                        type="button"
                        onClick={() => setActiveTab(tab.id)}
                        id={`tab-${tab.id}`}
                        role="tab"
                        aria-selected={activeTab === tab.id}
                        aria-controls={`panel-${tab.id}`}
                        className={`-mb-px rounded-t-lg border-b-2 px-4 py-2 text-sm font-semibold transition-colors ${FOCUS_RING} ${activeTab === tab.id
                                ? 'border-blue-600 text-blue-600'
                                : 'border-transparent text-gray-600 hover:text-gray-900'
                            }`}
                    >
                        {tab.label}
                    </button>
                ))}
            </div>

            <section id={`panel-${activeTab}`} role="tabpanel" aria-labelledby={`tab-${activeTab}`} className="min-w-0">
                {activeTab === 'models' && <ModelsTab />}
                {activeTab === 'channels' && <ChannelsTab />}
                {activeTab === 'soul' && <SoulTab />}
                {activeTab === 'workspace' && <WorkspaceFileTab />}
                {activeTab === 'openclaw' && <OpenClawConfigTab />}
            </section>
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
                    name="provider"
                    aria-label="Provider"
                    className={`w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm md:w-1/2 ${FOCUS_RING}`}
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
                            className={`rounded-full border px-3 py-1.5 text-xs font-semibold shadow-sm transition-colors ${FOCUS_RING} ${authMethod === method ? 'border-blue-600 bg-blue-50 text-blue-700' : 'border-gray-200 text-gray-700 hover:bg-gray-50'}`}
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
                        name="token"
                        autoComplete="off"
                        aria-label="Provider token"
                        className={`rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm ${FOCUS_RING}`}
                        placeholder="Provider token"
                    />
                    <input
                        type="text"
                        value={tokenExpiry}
                        onChange={(e) => setTokenExpiry(e.target.value)}
                        name="tokenExpiry"
                        autoComplete="off"
                        aria-label="Token expiry"
                        className={`rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm ${FOCUS_RING}`}
                        placeholder="Expires in (e.g. 365d)"
                    />
                    <button
                        type="button"
                        onClick={handleSaveToken}
                        disabled={saving || !token}
                        className={`rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS_RING}`}
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
                            aria-label="Custom provider key"
                            className={`rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm ${FOCUS_RING}`}
                            placeholder="Provider key (e.g. custom_openai)"
                        />
                        <input
                            type="text"
                            value={customLabel}
                            onChange={(e) => setCustomLabel(e.target.value)}
                            aria-label="Custom provider label"
                            className={`rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm ${FOCUS_RING}`}
                            placeholder="Provider label"
                        />
                        <input
                            type="text"
                            value={customBaseUrl}
                            onChange={(e) => setCustomBaseUrl(e.target.value)}
                            aria-label="Custom provider base URL"
                            className={`rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm ${FOCUS_RING}`}
                            placeholder="Base URL"
                        />
                        <select
                            value={customApi}
                            onChange={(e) => setCustomApi(e.target.value)}
                            aria-label="Custom provider API type"
                            className={`rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm ${FOCUS_RING}`}
                        >
                            <option value="openai">OpenAI-compatible</option>
                            <option value="anthropic">Anthropic-compatible</option>
                            <option value="google">Google/Gemini-compatible</option>
                        </select>
                        <input
                            type="text"
                            value={customAuthHeader}
                            onChange={(e) => setCustomAuthHeader(e.target.value)}
                            aria-label="Custom provider auth header"
                            className={`rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm ${FOCUS_RING}`}
                            placeholder="Auth header (default: Authorization)"
                        />
                        <textarea
                            value={customHeadersJson}
                            onChange={(e) => setCustomHeadersJson(e.target.value)}
                            rows={3}
                            aria-label="Additional headers JSON"
                            className={`rounded-lg border border-gray-300 px-3 py-2 text-xs font-mono shadow-sm ${FOCUS_RING}`}
                            placeholder="Additional headers JSON (optional)"
                        />
                        <textarea
                            value={customModels}
                            onChange={(e) => setCustomModels(e.target.value)}
                            rows={4}
                            aria-label="Custom model IDs"
                            className={`rounded-lg border border-gray-300 px-3 py-2 text-xs font-mono shadow-sm md:col-span-2 ${FOCUS_RING}`}
                            placeholder="Model IDs, one per line"
                        />
                    </div>
                    <button
                        type="button"
                        onClick={handleSaveCustomProvider}
                        className={`mt-3 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS_RING}`}
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
                    name="modelSearch"
                    autoComplete="off"
                    aria-label="Search models"
                    className={`mb-3 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm md:w-1/2 ${FOCUS_RING}`}
                    placeholder="Search models…"
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
                            className={`rounded-full border px-3 py-1.5 text-xs font-semibold shadow-sm transition-colors ${FOCUS_RING} ${enabledModels.includes(modelKey) ? 'border-blue-600 bg-blue-50 text-blue-700' : 'border-gray-200 text-gray-700 hover:bg-gray-50'}`}
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
                        name="manualModel"
                        autoComplete="off"
                        aria-label="Add model ID"
                        className={`flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm ${FOCUS_RING}`}
                        placeholder="Add model ID (e.g. gpt-4.1)"
                    />
                    <button
                        type="button"
                        onClick={addManualModel}
                        className={`rounded-lg bg-gray-100 px-4 py-2 text-sm font-semibold text-gray-900 transition-colors hover:bg-gray-200 ${FOCUS_RING}`}
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
                        name="primaryModel"
                        aria-label="Primary model"
                        className={`rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm ${FOCUS_RING}`}
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
                        name="fallbackModels"
                        aria-label="Fallback models"
                        className={`h-28 rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm ${FOCUS_RING}`}
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
                    className={`flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 font-semibold text-white shadow-sm transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS_RING}`}
                >
                    <Save className="w-4 h-4" aria-hidden="true" />
                    {saving ? 'Saving…' : 'Save Configuration'}
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
                    type="button"
                    onClick={loadSoul}
                    className={`flex items-center gap-2 rounded-lg px-2 py-1 text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-100 hover:text-gray-900 ${FOCUS_RING}`}
                    aria-label="Refresh SOUL.md"
                >
                    <RefreshCw className="w-4 h-4" aria-hidden="true" />
                    Refresh
                </button>
            </div>
            {path && (
                <div className="text-xs text-gray-500 mb-2">Path: <span className="font-mono">{path}</span></div>
            )}
            {loading ? (
                <div className="text-gray-500 text-sm">Loading SOUL.md…</div>
            ) : (
                <textarea
                    value={content}
                    onChange={(e) => setContent(e.target.value)}
                    rows={14}
                    name="soul"
                    aria-label="SOUL.md"
                    className={`w-full rounded-lg border border-gray-300 p-3 font-mono text-sm shadow-sm ${FOCUS_RING}`}
                />
            )}

            {error && <div className="mt-3 text-sm text-red-600">{error}</div>}
            {status && <div className="mt-3 text-sm text-green-600">{status}</div>}

            <div className="mt-4">
                <button
                    type="button"
                    onClick={handleSave}
                    disabled={saving}
                    className={`flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 font-semibold text-white shadow-sm transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS_RING}`}
                >
                    <Save className="w-4 h-4" aria-hidden="true" />
                    {saving ? 'Saving…' : 'Save'}
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
                    type="button"
                    onClick={loadFile}
                    className={`flex items-center gap-2 rounded-lg px-2 py-1 text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-100 hover:text-gray-900 disabled:opacity-50 ${FOCUS_RING}`}
                    disabled={!fileName}
                >
                    <RefreshCw className="w-4 h-4" aria-hidden="true" />
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
                    name="file"
                    aria-label="Workspace file"
                    className={`rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm ${FOCUS_RING}`}
                >
                    <option value="">Select a file…</option>
                    {files.map((f) => (
                        <option key={f} value={f}>{f}</option>
                    ))}
                </select>
                <input
                    type="text"
                    value={fileName}
                    onChange={(e) => setFileName(e.target.value)}
                    name="fileName"
                    autoComplete="off"
                    aria-label="Workspace file path"
                    className={`rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm md:col-span-2 ${FOCUS_RING}`}
                    placeholder="or type a path (e.g. README.md or notes/todo.md)"
                />
            </div>

            {path && (
                <div className="text-xs text-gray-500 mb-2">Path: <span className="font-mono">{path}</span></div>
            )}

            {loading ? (
                <div className="text-gray-500 text-sm">Loading file…</div>
            ) : (
                <textarea
                    value={content}
                    onChange={(e) => setContent(e.target.value)}
                    rows={14}
                    name="workspaceFile"
                    aria-label="Workspace file content"
                    className={`w-full rounded-lg border border-gray-300 p-3 font-mono text-sm shadow-sm ${FOCUS_RING}`}
                />
            )}

            {error && <div className="mt-3 text-sm text-red-600">{error}</div>}
            {status && <div className="mt-3 text-sm text-green-600">{status}</div>}

            <div className="mt-4">
                <button
                    type="button"
                    onClick={handleSave}
                    disabled={saving || !fileName}
                    className={`flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 font-semibold text-white shadow-sm transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS_RING}`}
                >
                    <Save className="w-4 h-4" aria-hidden="true" />
                    {saving ? 'Saving…' : 'Save'}
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
                    type="button"
                    onClick={loadConfig}
                    className={`flex items-center gap-2 rounded-lg px-2 py-1 text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-100 hover:text-gray-900 ${FOCUS_RING}`}
                    aria-label="Refresh openclaw.json"
                >
                    <RefreshCw className="w-4 h-4" aria-hidden="true" />
                    Refresh
                </button>
            </div>
            {path && (
                <div className="text-xs text-gray-500 mb-2">Path: <span className="font-mono">{path}</span></div>
            )}
            {loading ? (
                <div className="text-gray-500 text-sm">Loading config…</div>
            ) : (
                <textarea
                    value={content}
                    onChange={(e) => setContent(e.target.value)}
                    rows={16}
                    name="openclawConfig"
                    aria-label="openclaw.json"
                    className={`w-full rounded-lg border border-gray-300 p-3 font-mono text-sm shadow-sm ${FOCUS_RING}`}
                />
            )}

            {error && <div className="mt-3 text-sm text-red-600">{error}</div>}
            {status && <div className="mt-3 text-sm text-green-600">{status}</div>}

            <div className="mt-4">
                <button
                    type="button"
                    onClick={handleSave}
                    disabled={saving}
                    className={`flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 font-semibold text-white shadow-sm transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS_RING}`}
                >
                    <Save className="w-4 h-4" aria-hidden="true" />
                    {saving ? 'Saving…' : 'Save'}
                </button>
            </div>
        </div>
    );
};

const ChannelsTab = () => {
    const [loading, setLoading] = useState(true);
    const [channelStatus, setChannelStatus] = useState(null);
    const [channelList, setChannelList] = useState(null);
    const [error, setError] = useState('');
    const [status, setStatus] = useState('');
    const [saving, setSaving] = useState(false);
    const [busyMessage, setBusyMessage] = useState('');

    const [editMode, setEditMode] = useState({
        telegram: false,
        discord: false,
        slack: false
    });

    const [telegramToken, setTelegramToken] = useState('');
    const [discordToken, setDiscordToken] = useState('');
    const [slackBotToken, setSlackBotToken] = useState('');
    const [slackAppToken, setSlackAppToken] = useState('');

    const [loginOutput, setLoginOutput] = useState('');
    const [whatsappQr, setWhatsappQr] = useState('');
    const [whatsappPairing, setWhatsappPairing] = useState(false);
    const [whatsappModalOpen, setWhatsappModalOpen] = useState(false);

    const secretHeaders = useMemo(() => {
        return import.meta.env.VITE_LOCAL_API_SECRET
            ? { 'x-api-secret': import.meta.env.VITE_LOCAL_API_SECRET }
            : {};
    }, []);

    const hasSecret = Boolean(import.meta.env.VITE_LOCAL_API_SECRET);
    const isBusy = Boolean(busyMessage) || saving;

    const withBusy = async (message, fn) => {
        setBusyMessage(message);
        setSaving(true);
        try {
            return await fn();
        } finally {
            setSaving(false);
            setBusyMessage('');
        }
    };

    const loadAll = async () => {
        setLoading(true);
        setError('');
        setStatus('');
        try {
            const [statusRes, listRes] = await Promise.all([
                fetch(apiUrl('/api/channels/status')).catch(() => null),
                fetch(apiUrl('/api/channels/list')).catch(() => null)
            ]);

            const readJson = async (res) => {
                if (!res) return null;
                const text = await res.text().catch(() => '');
                if (!text) return null;
                try {
                    return JSON.parse(text);
                } catch {
                    return { stdout: text };
                }
            };

            const [statusData, listData] = await Promise.all([
                readJson(statusRes),
                readJson(listRes)
            ]);

            if (statusRes && !statusRes.ok) {
                setError(prev => prev || statusData?.error || 'Failed to load channel status');
            }

            if (listRes && !listRes.ok) {
                setError(prev => prev || listData?.error || 'Failed to load channel list');
            }

            if (statusRes?.ok) {
                setChannelStatus(statusData);
            }

            if (listRes?.ok) {
                setChannelList(listData);
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

    const addChannel = async (payload) => {
        await withBusy(`Saving ${payload.channel}…`, async () => {
            setError('');
            setStatus('');
            const res = await fetch(apiUrl('/api/channels/add'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...secretHeaders },
                body: JSON.stringify(payload)
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.error || 'Failed to add/update channel');

            const channel = payload?.channel;
            if (channel === 'telegram') setTelegramToken('');
            if (channel === 'discord') setDiscordToken('');
            if (channel === 'slack') {
                setSlackBotToken('');
                setSlackAppToken('');
            }
            if (channel && editMode[channel] !== undefined) {
                setEditMode(prev => ({ ...prev, [channel]: false }));
            }

            setStatus(`${payload.channel} saved. Gateway restarted.`);
            await loadAll();
        }).catch((e) => setError(e.message));
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
        setWhatsappModalOpen(true);
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

    const getCandidateStates = (parsed, channelId) => {
        if (!parsed || typeof parsed !== 'object') return [];

        const states = [];

        const pushState = (value) => {
            if (value === undefined || value === null) return;
            if (typeof value === 'string') {
                states.push(value);
                return;
            }
            if (typeof value === 'object') {
                const state =
                    value.state
                    || value.status
                    || value.connectionState
                    || value.phase
                    || (value.connected ? 'connected' : '')
                    || (value.ready ? 'ready' : '')
                    || '';
                if (state) states.push(String(state));
            }
        };

        const channelsObj = parsed?.channels;
        if (channelsObj && typeof channelsObj === 'object' && !Array.isArray(channelsObj)) {
            for (const [key, value] of Object.entries(channelsObj)) {
                const matchKey = String(key || '').toLowerCase();
                const matchObj = value && typeof value === 'object'
                    ? String(value.channel || value.provider || value.kind || '').toLowerCase()
                    : '';
                const target = String(channelId).toLowerCase();
                if (matchKey === target || matchKey.startsWith(`${target}:`) || matchKey.includes(`${target}`) || matchObj === target) {
                    pushState(value);
                }
            }
        }

        const accountsObj = parsed?.channelAccounts;
        if (accountsObj && typeof accountsObj === 'object' && !Array.isArray(accountsObj)) {
            for (const [key, value] of Object.entries(accountsObj)) {
                const matchKey = String(key || '').toLowerCase();
                const matchObj = value && typeof value === 'object'
                    ? String(value.channel || value.provider || value.kind || '').toLowerCase()
                    : '';
                const target = String(channelId).toLowerCase();
                if (matchKey === target || matchKey.startsWith(`${target}:`) || matchKey.includes(`${target}`) || matchObj === target) {
                    pushState(value);
                }
            }
        }

        const summary = parsed?.channelSummary;
        if (Array.isArray(summary)) {
            for (const item of summary) {
                const target = String(channelId).toLowerCase();
                if (typeof item === 'string') {
                    const lower = item.toLowerCase();
                    if (lower.includes(target)) pushState(item);
                    continue;
                }
                if (!item || typeof item !== 'object') continue;
                const ch = String(item.channel || item.provider || item.kind || '').toLowerCase();
                if (ch === target) {
                    pushState(item);
                    pushState(item.state);
                    pushState(item.status);
                }
            }
        }

        const chatObj = parsed?.chat;
        if (chatObj && typeof chatObj === 'object' && !Array.isArray(chatObj)) {
            const value = chatObj?.[channelId];
            if (Array.isArray(value) && value.length) {
                pushState('configured');
            } else if (value) {
                pushState(value);
                pushState('configured');
            }
        }

        return states;
    };

    const classifyState = (state) => {
        const normalized = String(state || 'unknown').toLowerCase();
        const ok = ['connected', 'ready', 'online', 'linked', 'ok'].some(s => normalized.includes(s));
        const mid = ['configured', 'enabled', 'connecting', 'auth', 'pair', 'login', 'sync', 'starting', 'initializing'].some(s => normalized.includes(s));
        const configured = ok || normalized.includes('configured') || normalized.includes('token:config');
        return { ok, mid, configured, normalized };
    };

    const getAggregateState = (channelId) => {
        const candidates = [
            ...getCandidateStates(channelStatus?.parsed, channelId),
            ...getCandidateStates(channelList?.parsed, channelId)
        ].filter(Boolean);

        if (!candidates.length) return '';
        const scored = candidates.map(s => ({
            s,
            c: classifyState(s)
        }));
        const best = scored.find(x => x.c.ok) || scored.find(x => x.c.mid) || scored[0];
        return best?.s || '';
    };

    const renderStatePill = (state) => {
        if (loading) {
            return (
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold border bg-gray-100 text-gray-700 border-gray-200">
                    loading…
                </span>
            );
        }
        const { ok, mid } = classifyState(state);
        const className = ok
            ? 'bg-green-100 text-green-700 border-green-200'
            : mid
                ? 'bg-amber-100 text-amber-800 border-amber-200'
                : 'bg-red-100 text-red-700 border-red-200';
        const label = state ? String(state) : 'unknown';
        return (
            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold border ${className}`}>
                {label}
            </span>
        );
    };

    const ChannelCard = ({ title, pluginId, children }) => {
        const rawState = getAggregateState(pluginId);
        const state = rawState || 'not set up';
        const { ok: connected, configured } = classifyState(state);
        return (
            <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
                <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                        <h4 className="font-semibold text-gray-800">{title}</h4>
                        {renderStatePill(state)}
                    </div>
                </div>
                {typeof children === 'function' ? children({ state, connected, configured }) : children}
            </div>
        );
    };

    const Overlay = ({ title }) => {
        if (!title) return null;
        return (
            <div className="fixed inset-0 z-50 overscroll-contain">
                <div className="absolute inset-0 bg-black/40" aria-hidden="true" />
                <div className="relative flex min-h-full items-center justify-center p-4">
                    <div role="dialog" aria-modal="true" aria-label={title} className="w-full max-w-md rounded-xl border border-gray-200 bg-white p-5 shadow-xl">
                    <div className="flex items-center gap-3">
                        <div className="w-5 h-5 border-2 border-gray-300 border-t-gray-900 rounded-full animate-spin motion-reduce:animate-none" aria-hidden="true" />
                        <div className="text-sm font-semibold text-gray-900">{title}</div>
                    </div>
                    <div className="mt-2 text-xs text-gray-600">Please wait… (this can take ~1–2 minutes)</div>
                    </div>
                </div>
            </div>
        );
    };

    const WhatsAppModal = () => {
        if (!whatsappModalOpen) return null;
        return (
            <div className="fixed inset-0 z-50 overscroll-contain">
                <button
                    type="button"
                    aria-label="Close dialog"
                    className="absolute inset-0 bg-black/40"
                    onClick={() => !whatsappPairing && setWhatsappModalOpen(false)}
                />
                <div className="relative flex min-h-full items-center justify-center p-4">
                    <div role="dialog" aria-modal="true" aria-labelledby="whatsapp-title" className="w-full max-w-3xl rounded-xl border border-gray-200 bg-white p-5 shadow-xl">
                    <div className="flex items-start justify-between gap-4">
                        <div>
                            <div id="whatsapp-title" className="text-base font-semibold text-gray-900">WhatsApp pairing</div>
                            <div className="text-xs text-gray-600 mt-1">
                                Open WhatsApp on your phone → Linked devices → Link a device → scan this QR.
                            </div>
                        </div>
                        <button
                            type="button"
                            onClick={() => setWhatsappModalOpen(false)}
                            disabled={whatsappPairing}
                            className={`rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-semibold text-gray-900 shadow-sm transition-colors hover:bg-gray-50 disabled:opacity-50 ${FOCUS_RING}`}
                        >
                            {whatsappPairing ? 'Pairing…' : 'Close'}
                        </button>
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-4">
                        <div className="border border-gray-200 rounded-lg bg-gray-50 p-3 flex items-center justify-center min-h-[320px]">
                            {whatsappQr ? (
                                <img src={whatsappQr} alt="WhatsApp QR" className="w-72 h-72" />
                            ) : (
                                <div className="flex items-center gap-3 text-sm text-gray-700">
                                    <div className="w-5 h-5 border-2 border-gray-300 border-t-gray-900 rounded-full animate-spin motion-reduce:animate-none" aria-hidden="true" />
                                    Generating QR…
                                </div>
                            )}
                        </div>
                        <textarea
                            value={loginOutput}
                            readOnly
                            rows={14}
                            aria-label="Pairing output"
                            className={`w-full rounded-lg border border-gray-300 bg-white p-3 font-mono text-xs shadow-sm ${FOCUS_RING}`}
                            placeholder="Pairing output will appear here…"
                        />
                    </div>
                    </div>
                </div>
            </div>
        );
    };

    return (
        <div className="space-y-6">
            <Overlay title={busyMessage} />
            <WhatsAppModal />

            <div className="flex items-center justify-between">
                <div>
                    <h3 className="text-lg font-semibold text-gray-800">Channels</h3>
                    <div className="text-xs text-gray-500">
                        No-code setup: enable a plugin, add credentials, and it will restart the gateway automatically.
                    </div>
                </div>
                <div className="flex gap-2">
                    <button
                        type="button"
                        onClick={loadAll}
                        disabled={loading || isBusy || whatsappPairing}
                        className={`flex items-center gap-2 rounded-lg bg-gray-100 px-3 py-2 text-sm font-semibold text-gray-900 transition-colors hover:bg-gray-200 disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS_RING}`}
                    >
                        <RefreshCw className="w-4 h-4" aria-hidden="true" />
                        Refresh
                    </button>
                </div>
            </div>

            {!hasSecret && (
                <div className="border border-amber-200 bg-amber-50 text-amber-900 rounded-lg p-3 text-sm">
                    Admin secret not configured. Set <span className="font-mono">VITE_LOCAL_API_SECRET</span> in Vercel and <span className="font-mono">LOCAL_API_SECRET</span> on the VPS service.
                </div>
            )}

            {loading && (
                <div className="border border-gray-200 bg-gray-50 text-gray-800 rounded-lg p-3 text-sm">
                    Loading channel configuration… just a moment.
                </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <ChannelCard title="Telegram" pluginId="telegram">
                    {({ connected, configured }) => (
                        (connected || configured) && !editMode.telegram ? (
                            <div className="flex items-center justify-between gap-3">
                                <div className="text-sm text-gray-700">
                                    Telegram is configured. Open Telegram and send <span className="font-mono">/start</span> to your bot.
                                </div>
                                <button
                                    type="button"
                                    onClick={() => setEditMode(prev => ({ ...prev, telegram: true }))}
                                    disabled={loading || isBusy || whatsappPairing}
                                    className={`rounded-lg border border-gray-300 bg-white px-3 py-2 text-xs font-semibold text-gray-900 shadow-sm transition-colors hover:bg-gray-50 disabled:opacity-50 ${FOCUS_RING}`}
                                >
                                    Update token
                                </button>
                            </div>
                        ) : (
                            <div className="grid grid-cols-1 gap-2">
                                <input
                                    type="password"
                                    value={telegramToken}
                                    onChange={(e) => setTelegramToken(e.target.value)}
                                    disabled={loading || isBusy || whatsappPairing}
                                    aria-label="Telegram bot token"
                                    className={`rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm ${FOCUS_RING}`}
                                    placeholder="Bot token"
                                />
                                <button
                                    type="button"
                                    onClick={() => addChannel({ channel: 'telegram', token: telegramToken })}
                                    disabled={loading || isBusy || whatsappPairing || !telegramToken}
                                    className={`rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS_RING}`}
                                >
                                    Save Telegram
                                </button>
                            </div>
                        )
                    )}
                </ChannelCard>

                <ChannelCard title="Discord" pluginId="discord">
                    {({ connected, configured }) => (
                        (connected || configured) && !editMode.discord ? (
                            <div className="flex items-center justify-between gap-3">
                                <div className="text-sm text-gray-700">
                                    Discord is configured. Invite your bot to a server and send it a message.
                                </div>
                                <button
                                    type="button"
                                    onClick={() => setEditMode(prev => ({ ...prev, discord: true }))}
                                    disabled={loading || isBusy || whatsappPairing}
                                    className={`rounded-lg border border-gray-300 bg-white px-3 py-2 text-xs font-semibold text-gray-900 shadow-sm transition-colors hover:bg-gray-50 disabled:opacity-50 ${FOCUS_RING}`}
                                >
                                    Update token
                                </button>
                            </div>
                        ) : (
                            <div className="grid grid-cols-1 gap-2">
                                <input
                                    type="password"
                                    value={discordToken}
                                    onChange={(e) => setDiscordToken(e.target.value)}
                                    disabled={loading || isBusy || whatsappPairing}
                                    aria-label="Discord bot token"
                                    className={`rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm ${FOCUS_RING}`}
                                    placeholder="Bot token"
                                />
                                <button
                                    type="button"
                                    onClick={() => addChannel({ channel: 'discord', token: discordToken })}
                                    disabled={loading || isBusy || whatsappPairing || !discordToken}
                                    className={`rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS_RING}`}
                                >
                                    Save Discord
                                </button>
                            </div>
                        )
                    )}
                </ChannelCard>

                <ChannelCard title="Slack" pluginId="slack">
                    {({ connected, configured }) => (
                        (connected || configured) && !editMode.slack ? (
                            <div className="flex items-center justify-between gap-3">
                                <div className="text-sm text-gray-700">
                                    Slack is configured. Mention the bot in a channel to test.
                                </div>
                                <button
                                    type="button"
                                    onClick={() => setEditMode(prev => ({ ...prev, slack: true }))}
                                    disabled={loading || isBusy || whatsappPairing}
                                    className={`rounded-lg border border-gray-300 bg-white px-3 py-2 text-xs font-semibold text-gray-900 shadow-sm transition-colors hover:bg-gray-50 disabled:opacity-50 ${FOCUS_RING}`}
                                >
                                    Update tokens
                                </button>
                            </div>
                        ) : (
                            <div className="grid grid-cols-1 gap-2">
                                <input
                                    type="password"
                                    value={slackBotToken}
                                    onChange={(e) => setSlackBotToken(e.target.value)}
                                    disabled={loading || isBusy || whatsappPairing}
                                    aria-label="Slack bot token"
                                    className={`rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm ${FOCUS_RING}`}
                                    placeholder="Bot token (xoxb-...)"
                                />
                                <input
                                    type="password"
                                    value={slackAppToken}
                                    onChange={(e) => setSlackAppToken(e.target.value)}
                                    disabled={loading || isBusy || whatsappPairing}
                                    aria-label="Slack app token"
                                    className={`rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm ${FOCUS_RING}`}
                                    placeholder="App token (xapp-...)"
                                />
                                <button
                                    type="button"
                                    onClick={() => addChannel({ channel: 'slack', slackBotToken, slackAppToken })}
                                    disabled={loading || isBusy || whatsappPairing || (!slackBotToken && !slackAppToken)}
                                    className={`rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS_RING}`}
                                >
                                    Save Slack
                                </button>
                            </div>
                        )
                    )}
                </ChannelCard>

                <ChannelCard title="WhatsApp" pluginId="whatsapp">
                    {({ connected, configured }) => (
                        <div className="space-y-2">
                            {(connected || configured) ? (
                                <div className="text-sm text-gray-700">
                                    WhatsApp is configured. Send a message to this WhatsApp account to test.
                                </div>
                            ) : (
                                <div className="text-sm text-gray-700">
                                    Pair WhatsApp by scanning a QR code from your phone.
                                </div>
                            )}

                            <button
                                type="button"
                                onClick={startWhatsAppLogin}
                                disabled={loading || isBusy || whatsappPairing || (connected || configured)}
                                className={`rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS_RING}`}
                            >
                                {whatsappPairing ? 'Pairing…' : 'Start pairing (QR)'}
                            </button>

                            {(connected || configured) && (
                                <button
                                    type="button"
                                    onClick={startWhatsAppLogin}
                                    disabled={loading || isBusy || whatsappPairing}
                                    className={`rounded-lg border border-gray-300 bg-white px-3 py-2 text-xs font-semibold text-gray-900 shadow-sm transition-colors hover:bg-gray-50 disabled:opacity-50 ${FOCUS_RING}`}
                                >
                                    Re-pair WhatsApp
                                </button>
                            )}

                            <div className="text-xs text-gray-600">
                                This will open a pairing window with a QR code.
                            </div>
                        </div>
                    )}
                </ChannelCard>
            </div>

            {error && <div className="text-sm text-red-600">{error}</div>}
            {status && <div className="text-sm text-green-600">{status}</div>}
        </div>
    );
};

export default Settings;
