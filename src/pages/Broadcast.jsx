import React, { useEffect, useMemo, useRef, useState } from 'react';
import { apiUrl } from '../lib/apiBase';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Bot, RefreshCw, Send, User, Loader2 } from 'lucide-react';

const FOCUS_RING = 'focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2';

const Broadcast = () => {
    const [agents, setAgents] = useState([]);
    const [selectedAgents, setSelectedAgents] = useState([]);
    const [message, setMessage] = useState('');

    const [sending, setSending] = useState(false);
    const [created, setCreated] = useState([]);
    const createdIds = useMemo(() => new Set(created.map(t => t.id)), [created]);

    const [jobsById, setJobsById] = useState({});
    const [loadingJobs, setLoadingJobs] = useState(false);

    const [recentJobs, setRecentJobs] = useState([]);
    const [loadingRecent, setLoadingRecent] = useState(false);

    const endRef = useRef(null);

    const scrollToBottom = (behavior = 'auto') => {
        const el = endRef.current;
        if (!el) return;
        el.scrollIntoView({ behavior, block: 'end' });
    };

    useEffect(() => {
        fetchAgents();
    }, []);

    useEffect(() => {
        fetchRecent();
        const interval = setInterval(() => {
            if (createdIds.size === 0) fetchRecent();
        }, 15_000);
        return () => clearInterval(interval);
    }, [createdIds]);

    useEffect(() => {
        if (createdIds.size === 0) return;
        fetchJobs();
        const interval = setInterval(() => {
            fetchJobs();
            fetch(apiUrl('/api/heartbeat'), { method: 'POST' }).catch(() => { /* ignore */ });
        }, 10_000);
        return () => clearInterval(interval);
    }, [createdIds]);

    const fetchAgents = async () => {
        try {
            const response = await fetch(apiUrl('/api/agents'));
            const data = await response.json();
            setAgents(data.agents || []);
            setSelectedAgents((data.agents || []).map(a => a.id));
        } catch (error) {
            console.error('Failed to fetch agents:', error);
        }
    };

    const handleSelectAll = (checked) => {
        setSelectedAgents(checked ? agents.map(a => a.id) : []);
    };

    const handleAgentToggle = (agentId) => {
        setSelectedAgents((prev) => prev.includes(agentId)
            ? prev.filter(id => id !== agentId)
            : [...prev, agentId]
        );
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
                body: JSON.stringify({ message, agentIds: selectedAgents })
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

    const narrationMessages = useMemo(() => {
        const shouldInclude = ({ role, text }) => {
            const r = String(role || 'assistant').toLowerCase();
            const t = String(text || '').trim();
            if (!t) return false;
            if (r === 'user') return false;
            if (t.startsWith('Imported cron job:')) return false;
            if (t.startsWith('Last error:')) return false;
            if (t === 'Run requested') return false;
            if (t.startsWith('Task created:')) return false;
            return true;
        };
        const all = [];
        for (const task of created) {
            const job = jobsById?.[task.id];
            const narrative = Array.isArray(job?.metadata?.narrative) ? job.metadata.narrative : [];
            for (const n of narrative) {
                if (!n || typeof n !== 'object') continue;
                all.push({
                    ts: n.ts || null,
                    agentId: n.agentId || task.agentId || 'main',
                    role: n.role || 'assistant',
                    text: n.text || '',
                    jobId: task.id,
                    taskName: job?.name || task.name || task.id
                });
            }
        }
        all.sort((a, b) => String(a.ts || '').localeCompare(String(b.ts || '')));
        return all.filter(shouldInclude).slice(-250);
    }, [created, jobsById]);

    const recentNarrationMessages = useMemo(() => {
        const shouldInclude = ({ role, text }) => {
            const r = String(role || 'assistant').toLowerCase();
            const t = String(text || '').trim();
            if (!t) return false;
            if (r === 'user') return false;
            if (t.startsWith('Imported cron job:')) return false;
            if (t.startsWith('Last error:')) return false;
            if (t === 'Run requested') return false;
            if (t.startsWith('Task created:')) return false;
            return true;
        };
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
        return all.filter(shouldInclude).slice(-250);
    }, [recentJobs]);

    const feedMessages = createdIds.size > 0 ? narrationMessages : recentNarrationMessages;
    const feedLoading = createdIds.size > 0 ? loadingJobs : loadingRecent;
    const feedTitle = createdIds.size > 0 ? `Tracking ${created.length} task(s)` : 'Recent activity';

    useEffect(() => {
        scrollToBottom('auto');
    }, [feedMessages.length, sending]);

    return (
        <div className="flex min-h-[calc(100dvh-10rem)] flex-col gap-6 lg:grid lg:grid-cols-12">
            {/* Left: Task Composition */}
            <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm lg:col-span-4 flex flex-col">
                <h2 className="text-xl font-bold text-gray-800 mb-6 flex items-center gap-2">
                    <Send className="w-5 h-5 text-blue-600" aria-hidden="true" />
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
                        <label htmlFor="broadcast-message" className="block text-sm font-medium text-gray-700 mb-2">
                            Task Instructions
                        </label>
                        <textarea
                            id="broadcast-message"
                            name="message"
                            value={message}
                            onChange={(e) => setMessage(e.target.value)}
                            className={`h-32 w-full resize-none rounded-lg border border-gray-300 px-4 py-3 shadow-sm transition-colors ${FOCUS_RING}`}
                            placeholder="Describe the task for the selected agents…"
                        />
                    </div>

                    <button
                        type="submit"
                        disabled={sending || selectedAgents.length === 0 || !message.trim()}
                        className={`flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 py-3 font-semibold text-white shadow-sm transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS_RING}`}
                    >
                        {sending ? (
                            <>
                                <Loader2 className="w-5 h-5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                                Broadcasting…
                            </>
                        ) : (
                            <>
                                <Send className="w-5 h-5" aria-hidden="true" />
                                Send Task
                            </>
                        )}
                    </button>
                </form>
            </div>

            {/* Right: Chat Feed (no separate status cards) */}
            <div className="min-w-0 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm lg:col-span-8 flex flex-col">
                <div className="p-4 border-b border-gray-100 flex items-center justify-between">
                    <div>
                        <div className="text-lg font-bold text-gray-800">Broadcast feed</div>
                        <div className="text-xs text-gray-500">
                            {feedTitle}
                        </div>
                    </div>

                    <button
                        type="button"
                        onClick={() => {
                            if (createdIds.size > 0) fetchJobs();
                            else fetchRecent();
                        }}
                        disabled={feedLoading}
                        className={`flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm font-semibold text-gray-900 shadow-sm transition-colors hover:bg-white disabled:opacity-50 ${FOCUS_RING}`}
                        aria-label="Refresh feed"
                    >
                        <RefreshCw className="w-4 h-4" aria-hidden="true" />
                        Refresh
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-gray-50/50">
                    {feedLoading && (
                        <div className="flex items-center gap-2 text-sm text-gray-500">
                            <Loader2 className="w-4 h-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                            Loading…
                        </div>
                    )}

                    {feedMessages.length === 0 && !sending && !feedLoading && (
                        <div className="flex flex-col items-center justify-center h-full text-gray-400">
                            <Bot className="w-16 h-16 mb-4 opacity-20" aria-hidden="true" />
                            <p>No activity yet. Send a broadcast to start.</p>
                        </div>
                    )}

                    {feedMessages.map((m, idx) => {
                        const role = String(m.role || 'assistant');
                        const isUser = role === 'user';
                        const isSystem = role === 'system';

                        const avatar = isUser
                            ? (
                                <div className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center text-gray-600 flex-shrink-0 mt-1">
                                    <User className="w-5 h-5" aria-hidden="true" />
                                </div>
                            )
                            : (
                                <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 mt-1 ${isSystem ? 'bg-gray-200 text-gray-700' : 'bg-blue-100 text-blue-600'}`}>
                                    <Bot className="w-5 h-5" aria-hidden="true" />
                                </div>
                            );

                        const bubbleClass = isUser
                            ? 'bg-blue-600 text-white rounded-tr-none'
                            : isSystem
                                ? 'bg-gray-50 text-gray-700 border border-gray-200 rounded-tl-none'
                                : 'bg-white text-gray-800 border border-gray-100 rounded-tl-none';

                        const metaClass = isUser ? 'text-blue-100' : 'text-gray-500';

                        return (
                            <div
                                key={`${m.jobId}-${idx}`}
                                className={`flex gap-3 ${isUser ? 'justify-end' : 'justify-start'}`}
                            >
                                {!isUser && avatar}
                                <div className={`max-w-[75%] p-3 rounded-lg shadow-sm text-sm ${bubbleClass}`}>
                                    <div className={`text-[10px] mb-1 ${metaClass}`}>
                                        {m.ts || ''}{m.agentId ? ` • ${m.agentId}` : ''}{m.taskName ? ` • ${m.taskName}` : ''}
                                    </div>
                                    {isUser ? (
                                        <div className="whitespace-pre-wrap">{m.text}</div>
                                    ) : (
                                        <ReactMarkdown
                                            remarkPlugins={[remarkGfm]}
                                            components={{
                                                h1: ({ children }) => <h1 className="text-lg font-bold mb-2 mt-1">{children}</h1>,
                                                h2: ({ children }) => <h2 className="text-base font-bold mb-2 mt-1">{children}</h2>,
                                                h3: ({ children }) => <h3 className="text-sm font-bold mb-1 mt-1">{children}</h3>,
                                                p: ({ children }) => <p className="mb-2 last:mb-0 leading-relaxed">{children}</p>,
                                                ul: ({ children }) => <ul className="list-disc ml-4 mb-2 space-y-1">{children}</ul>,
                                                ol: ({ children }) => <ol className="list-decimal ml-4 mb-2 space-y-1">{children}</ol>,
                                                li: ({ children }) => <li className="leading-relaxed">{children}</li>,
                                                strong: ({ children }) => <strong className="font-bold">{children}</strong>,
                                                em: ({ children }) => <em className="italic">{children}</em>,
                                                code: ({ inline, children }) => inline
                                                    ? <code className="bg-gray-100 text-red-600 px-1.5 py-0.5 rounded text-xs font-mono">{children}</code>
                                                    : <code className="block bg-gray-900 text-green-400 p-3 rounded-lg text-xs font-mono overflow-x-auto my-2 whitespace-pre">{children}</code>,
                                                pre: ({ children }) => <pre className="my-2">{children}</pre>,
                                                a: ({ href, children }) => <a href={href} target="_blank" rel="noopener noreferrer" className="text-blue-600 underline hover:text-blue-800">{children}</a>,
                                                blockquote: ({ children }) => <blockquote className="border-l-4 border-blue-300 pl-3 my-2 italic text-gray-600">{children}</blockquote>,
                                            }}
                                        >
                                            {m.text}
                                        </ReactMarkdown>
                                    )}
                                </div>
                                {isUser && avatar}
                            </div>
                        );
                    })}

                    {sending && (
                        <div className="flex justify-start gap-3">
                            <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 flex-shrink-0 mt-1">
                                <Bot className="w-5 h-5" aria-hidden="true" />
                            </div>
                            <div className="bg-white p-3 rounded-lg rounded-tl-none border border-gray-100 shadow-sm flex items-center gap-1">
                                <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce motion-reduce:animate-none"></span>
                                <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce delay-75 motion-reduce:animate-none"></span>
                                <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce delay-150 motion-reduce:animate-none"></span>
                            </div>
                        </div>
                    )}

                    <div ref={endRef} />
                </div>
            </div>
        </div>
    );
};

export default Broadcast;
