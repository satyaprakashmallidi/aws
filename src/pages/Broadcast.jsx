import React, { useEffect, useMemo, useState } from 'react';
import { apiUrl } from '../lib/apiBase';
import { Send, Loader2, RefreshCw } from 'lucide-react';

const Broadcast = () => {
    const [agents, setAgents] = useState([]);
    const [selectedAgents, setSelectedAgents] = useState([]);
    const [message, setMessage] = useState('');
    const [sending, setSending] = useState(false);
    const [created, setCreated] = useState([]);
    const [jobsById, setJobsById] = useState({});
    const [loadingJobs, setLoadingJobs] = useState(false);
    const [activityByJobId, setActivityByJobId] = useState({});
    const [loadingActivity, setLoadingActivity] = useState(false);
    const [recentJobs, setRecentJobs] = useState([]);
    const [loadingRecent, setLoadingRecent] = useState(false);
    const [showTechnical, setShowTechnical] = useState(false);

    const createdIds = useMemo(() => new Set(created.map(t => t.id)), [created]);

    useEffect(() => {
        fetchAgents();
    }, []);

    useEffect(() => {
        // Show narration even before a broadcast (history feed).
        fetchRecent();
        const interval = setInterval(() => {
            if (createdIds.size === 0) fetchRecent();
        }, 15_000);
        return () => clearInterval(interval);
    }, [createdIds]);

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
        setCreated([]);
        setJobsById({});

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
            if (!response.ok) throw new Error(data?.error || 'Broadcast failed');
            setCreated(Array.isArray(data.tasks) ? data.tasks : []);
            setMessage('');
        } catch (error) {
            console.error('Broadcast failed:', error);
        } finally {
            setSending(false);
        }
    };

    const fetchRecent = async () => {
        setLoadingRecent(true);
        try {
            const response = await fetch(apiUrl(`/api/tasks?limit=80&includeNarrative=true&includeLog=false&t=${Date.now()}`));
            if (!response.ok) return;
            const data = await response.json();
            setRecentJobs(Array.isArray(data.jobs) ? data.jobs : []);
        } catch {
            // ignore
        } finally {
            setLoadingRecent(false);
        }
    };

    const fetchJobs = async () => {
        if (createdIds.size === 0) return;
        setLoadingJobs(true);
        try {
            const ids = Array.from(createdIds).join(',');
            const response = await fetch(apiUrl(`/api/tasks?ids=${encodeURIComponent(ids)}&includeNarrative=true&includeLog=false&t=${Date.now()}`));
            if (!response.ok) return;
            const data = await response.json();
            const jobs = Array.isArray(data.jobs) ? data.jobs : [];
            const next = {};
            for (const job of jobs) {
                if (createdIds.has(job?.id)) next[job.id] = job;
            }
            setJobsById(next);
        } catch {
            // ignore
        } finally {
            setLoadingJobs(false);
        }
    };

    const fetchActivity = async () => {
        if (createdIds.size === 0) return;
        setLoadingActivity(true);
        try {
            const ids = Array.from(createdIds).join(',');
            const response = await fetch(apiUrl(`/api/tasks/activity?ids=${encodeURIComponent(ids)}&limit=500&t=${Date.now()}`));
            if (!response.ok) return;
            const data = await response.json();
            const items = Array.isArray(data.items) ? data.items : [];
            const next = {};
            for (const item of items) {
                if (item?.jobId) next[item.jobId] = item;
            }
            setActivityByJobId(next);
        } catch {
            // ignore
        } finally {
            setLoadingActivity(false);
        }
    };

    useEffect(() => {
        if (createdIds.size === 0) return;
        fetchJobs();
        fetchActivity();
        const interval = setInterval(() => {
            fetchJobs();
            fetchActivity();
            fetch(apiUrl('/api/heartbeat'), { method: 'POST' }).catch(() => { /* ignore */ });
        }, 10_000);
        return () => clearInterval(interval);
    }, [createdIds]);

    const getStatus = (job) => job?.metadata?.status || job?.status || 'unknown';
    const statusClass = (status) => {
        const s = String(status || '').toLowerCase();
        if (s.includes('completed')) return 'bg-green-100 text-green-700 border-green-200';
        if (s.includes('picked') || s.includes('active') || s.includes('run')) return 'bg-blue-100 text-blue-700 border-blue-200';
        if (s.includes('review') || s.includes('failed') || s.includes('error')) return 'bg-red-100 text-red-700 border-red-200';
        if (s.includes('assigned')) return 'bg-amber-100 text-amber-800 border-amber-200';
        return 'bg-gray-100 text-gray-700 border-gray-200';
    };

    const activityLines = useMemo(() => {
        const lines = [];
        for (const task of created) {
            const item = activityByJobId?.[task.id];
            const root = Array.isArray(item?.lines) ? item.lines : [];
            for (const l of root.slice(-30)) lines.push(`[${task.agentId}] ${l}`);
            const changes = Array.isArray(item?.changes) ? item.changes : [];
            for (const ch of changes.slice(-10)) lines.push(`[${task.agentId}] ${ch.summary}`);
            const children = Array.isArray(item?.children) ? item.children : [];
            for (const c of children) {
                const childLines = Array.isArray(c?.lines) ? c.lines : [];
                for (const l of childLines.slice(-10)) lines.push(`[${task.agentId} child] ${l}`);
                const childChanges = Array.isArray(c?.changes) ? c.changes : [];
                for (const ch of childChanges.slice(-6)) lines.push(`[${task.agentId} child] ${ch.summary}`);
            }
        }
        return lines.slice(-400);
    }, [created, activityByJobId]);

    const narrationMessages = useMemo(() => {
        const all = [];
        for (const task of created) {
            const job = jobsById?.[task.id];
            const narrative = Array.isArray(job?.metadata?.narrative) ? job.metadata.narrative : [];
            for (const n of narrative) {
                if (!n || typeof n !== 'object') continue;
                const ts = n.ts || null;
                all.push({
                    ts,
                    agentId: n.agentId || task.agentId || 'main',
                    role: n.role || 'assistant',
                    text: n.text || '',
                    jobId: task.id,
                    taskName: job?.name || task.name || task.id
                });
            }
        }
        all.sort((a, b) => String(a.ts || '').localeCompare(String(b.ts || '')));
        return all.filter(m => String(m.text || '').trim()).slice(-250);
    }, [created, jobsById]);

    const recentNarrationMessages = useMemo(() => {
        const all = [];
        for (const job of (Array.isArray(recentJobs) ? recentJobs : [])) {
            const narrative = Array.isArray(job?.metadata?.narrative) ? job.metadata.narrative : [];
            for (const n of narrative) {
                if (!n || typeof n !== 'object') continue;
                all.push({
                    ts: n.ts || null,
                    agentId: n.agentId || job?.agentId || 'main',
                    role: n.role || 'assistant',
                    text: n.text || '',
                    jobId: job?.id,
                    taskName: job?.name || job?.id
                });
            }
        }
        all.sort((a, b) => String(a.ts || '').localeCompare(String(b.ts || '')));
        return all.filter(m => String(m.text || '').trim()).slice(-250);
    }, [recentJobs]);

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

                {!created.length && !sending && (
                    <div className="flex-1 grid grid-cols-1 lg:grid-cols-3 gap-4">
                        <div className="lg:col-span-2 flex flex-col items-center justify-center text-gray-400 border-2 border-dashed border-gray-100 rounded-lg">
                            <Send className="w-12 h-12 mb-4 opacity-20" />
                            <p>Select agents and send a task to see progress here</p>
                        </div>
                        <div className="border border-gray-200 rounded-lg bg-white flex flex-col min-h-[24rem]">
                            <div className="px-4 py-2 border-b border-gray-200 text-sm font-semibold text-gray-800">
                                AI narration (recent)
                            </div>
                            <div className="flex-1 overflow-auto p-4 space-y-3">
                                {loadingRecent && (
                                    <div className="text-sm text-gray-500">Loading recent narration…</div>
                                )}
                                {!loadingRecent && recentNarrationMessages.length === 0 && (
                                    <div className="text-sm text-gray-500">No narrated activity yet.</div>
                                )}
                                {recentNarrationMessages.map((m, idx) => {
                                    const role = String(m.role || 'assistant');
                                    const isUser = role === 'user';
                                    const isSystem = role === 'system';
                                    const bubble = isUser
                                        ? 'bg-blue-50 border-blue-100'
                                        : isSystem
                                            ? 'bg-gray-50 border-gray-200'
                                            : 'bg-white border-gray-200';
                                    return (
                                        <div key={`${m.jobId}-${idx}`} className={`border rounded-lg p-3 ${bubble}`}>
                                            <div className="text-[10px] text-gray-500 mb-1">
                                                {m.ts || ''}{m.agentId ? ` • ${m.agentId}` : ''}{m.taskName ? ` • ${m.taskName}` : ''}
                                            </div>
                                            <div className="text-sm text-gray-800 whitespace-pre-wrap">{m.text}</div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    </div>
                )}

                {sending && (
                    <div className="flex-1 flex flex-col items-center justify-center">
                        <Loader2 className="w-12 h-12 text-blue-600 animate-spin mb-4" />
                        <p className="text-gray-600 font-medium">Creating tasks for agents…</p>
                    </div>
                )}

                {created.length > 0 && (
                    <div className="flex-1 overflow-y-auto space-y-6">
                        <div className="flex items-center justify-between">
                            <div className="text-sm text-gray-600">
                                Tracking {created.length} task(s). Agents will pick these up automatically.
                            </div>
                            <div className="flex items-center gap-2">
                                <button
                                    type="button"
                                    onClick={() => setShowTechnical(v => !v)}
                                    className="text-sm px-3 py-2 rounded border border-gray-200 bg-white disabled:opacity-50"
                                >
                                    {showTechnical ? 'Hide details' : 'Show details'}
                                </button>
                                <button
                                    type="button"
                                    onClick={() => {
                                        fetchJobs();
                                        fetchActivity();
                                    }}
                                    disabled={loadingJobs || loadingActivity}
                                    className="text-sm px-3 py-2 rounded border border-gray-200 bg-gray-50 flex items-center gap-2 disabled:opacity-50"
                                >
                                    <RefreshCw className="w-4 h-4" />
                                    Refresh
                                </button>
                            </div>
                        </div>

                        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                            <div className="lg:col-span-2 space-y-4">
                                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                                    {created.map((task) => {
                                        const job = jobsById?.[task.id];
                                        const status = getStatus(job);
                                        const result = job?.metadata?.result;
                                        const decisionReason = job?.metadata?.lastDecision?.reason || job?.metadata?.error || '';
                                        const attempts = job?.metadata?.attempts;
                                        const maxAttempts = job?.metadata?.maxAttempts;
                                        const item = activityByJobId?.[task.id];
                                        const rootLines = Array.isArray(item?.lines) ? item.lines : [];
                                        const changes = Array.isArray(item?.changes) ? item.changes : [];
                                        const children = Array.isArray(item?.children) ? item.children : [];
                                        return (
                                            <div key={task.id} className="border rounded-lg p-4 bg-gray-50">
                                                <div className="flex items-start justify-between gap-3">
                                                    <div>
                                                        <div className="font-semibold text-gray-800">{task.agentId}</div>
                                                        <div className="text-xs text-gray-500 mt-0.5">{task.name || task.id}</div>
                                                    </div>
                                                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold border ${statusClass(status)}`}>
                                                        {status}
                                                    </span>
                                                </div>

                                                {(typeof attempts === 'number' || decisionReason) && (
                                                    <div className="mt-2 text-xs text-gray-600">
                                                        {typeof attempts === 'number' && (
                                                            <span>
                                                                attempt {attempts}/{maxAttempts || 3}
                                                            </span>
                                                        )}
                                                        {typeof attempts === 'number' && decisionReason ? ' • ' : ''}
                                                        {decisionReason ? (
                                                            <span className="line-clamp-1">{String(decisionReason)}</span>
                                                        ) : null}
                                                    </div>
                                                )}

                                                {result && (
                                                    <div className="mt-3 bg-white p-3 rounded border border-gray-200 text-xs font-mono text-gray-800 whitespace-pre-wrap max-h-40 overflow-auto">
                                                        {result}
                                                    </div>
                                                )}

                                                {showTechnical && rootLines.length > 0 && (
                                                    <div className="mt-3 bg-white p-3 rounded border border-gray-200 text-[11px] font-mono text-gray-700 whitespace-pre-wrap max-h-40 overflow-auto">
                                                        {rootLines.slice(-18).join('\n')}
                                                    </div>
                                                )}

                                                {showTechnical && changes.length > 0 && (
                                                    <div className="mt-3 bg-white p-3 rounded border border-gray-200">
                                                        <div className="text-[10px] font-semibold text-gray-600 mb-2">Memory changes</div>
                                                        <div className="space-y-2">
                                                            {changes.slice(-3).map((ch, idx) => (
                                                                <div key={`${ch.path}-${idx}`} className="border border-gray-100 rounded p-2 bg-gray-50">
                                                                    <div className="text-[10px] font-semibold text-gray-700">
                                                                        {ch.tool}: {ch.path}
                                                                    </div>
                                                                    {ch.preview && (
                                                                        <pre className="mt-1 text-[11px] font-mono text-gray-700 whitespace-pre-wrap max-h-28 overflow-auto">
                                                                            {ch.preview}
                                                                        </pre>
                                                                    )}
                                                                    {ch.diff && (
                                                                        <pre className="mt-1 text-[11px] font-mono text-gray-700 whitespace-pre-wrap max-h-28 overflow-auto">
                                                                            {ch.diff}
                                                                        </pre>
                                                                    )}
                                                                </div>
                                                            ))}
                                                        </div>
                                                    </div>
                                                )}

                                                {showTechnical && children.map((c) => {
                                                    const childLines = Array.isArray(c?.lines) ? c.lines : [];
                                                    const childChanges = Array.isArray(c?.changes) ? c.changes : [];
                                                    if (!childLines.length) return null;
                                                    return (
                                                        <div key={c.sessionId} className="mt-3 bg-white p-3 rounded border border-gray-200">
                                                            <div className="text-[10px] font-semibold text-gray-600 mb-2">
                                                                Delegated session: {c.agentId ? `${c.agentId}:` : ''}{c.sessionId}
                                                            </div>
                                                            <pre className="text-[11px] font-mono text-gray-700 whitespace-pre-wrap max-h-32 overflow-auto">
                                                                {childLines.slice(-12).join('\n')}
                                                            </pre>

                                                            {childChanges.length > 0 && (
                                                                <div className="mt-3">
                                                                    <div className="text-[10px] font-semibold text-gray-600 mb-2">Child memory changes</div>
                                                                    <div className="space-y-2">
                                                                        {childChanges.slice(-2).map((ch, idx) => (
                                                                            <div key={`${ch.path}-${idx}`} className="border border-gray-100 rounded p-2 bg-gray-50">
                                                                                <div className="text-[10px] font-semibold text-gray-700">
                                                                                    {ch.tool}: {ch.path}
                                                                                </div>
                                                                                {ch.preview && (
                                                                                    <pre className="mt-1 text-[11px] font-mono text-gray-700 whitespace-pre-wrap max-h-24 overflow-auto">
                                                                                        {ch.preview}
                                                                                    </pre>
                                                                                )}
                                                                                {ch.diff && (
                                                                                    <pre className="mt-1 text-[11px] font-mono text-gray-700 whitespace-pre-wrap max-h-24 overflow-auto">
                                                                                        {ch.diff}
                                                                                    </pre>
                                                                                )}
                                                                            </div>
                                                                        ))}
                                                                    </div>
                                                                </div>
                                                            )}
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        );
                                    })}
                                </div>

                                {showTechnical && (
                                    <div className="border border-gray-200 rounded-lg bg-white">
                                        <div className="px-4 py-2 border-b border-gray-200 text-sm font-semibold text-gray-800">
                                            Agent activity (raw)
                                        </div>
                                        <pre className="p-4 text-xs text-gray-700 whitespace-pre-wrap max-h-64 overflow-auto">
                                            {activityLines.length ? activityLines.join('\n') : 'Waiting for agent activity…'}
                                        </pre>
                                    </div>
                                )}
                            </div>

                            <div className="border border-gray-200 rounded-lg bg-white flex flex-col min-h-[24rem]">
                                <div className="px-4 py-2 border-b border-gray-200 text-sm font-semibold text-gray-800">
                                    AI narration
                                </div>
                                <div className="flex-1 overflow-auto p-4 space-y-3">
                                    {narrationMessages.length === 0 && (
                                        <div className="text-sm text-gray-500">Waiting for narrated steps…</div>
                                    )}
                                    {narrationMessages.map((m, idx) => {
                                        const role = String(m.role || 'assistant');
                                        const isUser = role === 'user';
                                        const isSystem = role === 'system';
                                        const bubble = isUser
                                            ? 'bg-blue-50 border-blue-100'
                                            : isSystem
                                                ? 'bg-gray-50 border-gray-200'
                                                : 'bg-white border-gray-200';
                                        return (
                                            <div key={`${m.jobId}-${idx}`} className={`border rounded-lg p-3 ${bubble}`}>
                                                <div className="text-[10px] text-gray-500 mb-1">
                                                    {m.ts || ''}{m.agentId ? ` • ${m.agentId}` : ''}{m.taskName ? ` • ${m.taskName}` : ''}
                                                </div>
                                                <div className="text-sm text-gray-800 whitespace-pre-wrap">{m.text}</div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default Broadcast;
