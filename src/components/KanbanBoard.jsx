import React, { useState, useEffect } from 'react';
import { apiUrl } from '../lib/apiBase';
import { Plus, Calendar } from 'lucide-react';

const COLUMNS = [
    { id: 'inbox', title: 'Inbox', dot: 'bg-gray-400' },
    { id: 'assigned', title: 'Assigned', dot: 'bg-blue-500' },
    { id: 'active', title: 'In Progress', dot: 'bg-emerald-500' },
    { id: 'review', title: 'Review', dot: 'bg-amber-500' },
    { id: 'failed', title: 'Failed', dot: 'bg-red-500' },
    { id: 'done', title: 'Done', dot: 'bg-purple-500' }
];

const KanbanBoard = () => {
    const [tasks, setTasks] = useState([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [createOpen, setCreateOpen] = useState(false);
    const [detailsOpen, setDetailsOpen] = useState(false);
    const [detailsLoading, setDetailsLoading] = useState(false);
    const [detailsError, setDetailsError] = useState('');
    const [detailsTask, setDetailsTask] = useState(null);
    const [newMessage, setNewMessage] = useState('');
    const [newPriority, setNewPriority] = useState(3);

    useEffect(() => {
        fetchTasks();
        const interval = setInterval(() => {
            fetchTasks();
            fetch(apiUrl('/api/heartbeat'), { method: 'POST' }).catch(() => { /* ignore */ });
        }, 10_000);
        return () => clearInterval(interval);
    }, []);

    const fetchTasks = async () => {
        try {
            const response = await fetch(apiUrl(`/api/tasks?includeNarrative=false&includeLog=false&limit=800&t=${Date.now()}`));
            if (response.ok) {
                const data = await response.json();
                setTasks(data.jobs || []);
            }
        } catch (error) {
            console.error('Failed to fetch tasks:', error);
        } finally {
            setLoading(false);
        }
    };

    const getTaskStatus = (task) => {
        return task?.metadata?.status || task?.status || '';
    };

    const getColumnTasks = (columnId) => {
        const known = new Set(['completed', 'failed', 'review', 'picked_up', 'assigned', 'run_requested', 'scheduled', 'disabled']);
        const byStatus = (status) => tasks.filter(t => getTaskStatus(t) === status);

        if (columnId === 'done') return byStatus('completed');
        if (columnId === 'failed') return byStatus('failed');
        if (columnId === 'review') return byStatus('review');
        if (columnId === 'active') return byStatus('picked_up');
        if (columnId === 'assigned') return byStatus('assigned').concat(byStatus('run_requested')).concat(byStatus('scheduled'));
        if (columnId === 'inbox') {
            return tasks.filter((t) => {
                const s = String(getTaskStatus(t) || '').trim();
                if (!s) return true;
                if (s === 'disabled') return true;
                return !known.has(s);
            });
        }
        return [];
    };

    const handleCreateTask = async () => {
        const message = String(newMessage || '').trim();
        if (!message) return;
        const priority = Math.max(1, Math.min(5, Number(newPriority) || 3));
        setSaving(true);
        try {
            await fetch(apiUrl('/api/tasks'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    message,
                    agentId: 'main',
                    priority,
                    source: 'kanban',
                    name: `Task: ${message.slice(0, 60)}${message.length > 60 ? '…' : ''}`
                })
            });
            setCreateOpen(false);
            setNewMessage('');
            setNewPriority(3);
            fetchTasks();
        } catch (error) {
            console.error('Failed to create task:', error);
        } finally {
            setSaving(false);
        }
    };

    const openDetails = async (task) => {
        if (!task?.id) return;
        setDetailsOpen(true);
        setDetailsLoading(true);
        setDetailsError('');
        setDetailsTask(null);
        try {
            const res = await fetch(apiUrl(`/api/tasks?ids=${encodeURIComponent(String(task.id))}&includeNarrative=true&includeLog=true&limit=1&t=${Date.now()}`));
            if (!res.ok) {
                const text = await res.text().catch(() => '');
                throw new Error(`Failed to load details: ${res.status} ${text}`);
            }
            const data = await res.json();
            const full = Array.isArray(data?.jobs) ? data.jobs[0] : null;
            setDetailsTask(full || task);
        } catch (err) {
            setDetailsError(err?.message || 'Failed to load details');
            setDetailsTask(task);
        } finally {
            setDetailsLoading(false);
        }
    };

    const closeDetails = () => {
        setDetailsOpen(false);
        setDetailsError('');
        setDetailsLoading(false);
        setDetailsTask(null);
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center h-full">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
            </div>
        );
    }

    return (
        <div className="h-full flex flex-col">
            <div className="p-4 border-b border-gray-100 flex justify-between items-center bg-white">
                <h2 className="text-lg font-bold text-gray-800 flex items-center gap-2">
                    <Calendar className="w-5 h-5 text-blue-600" />
                    Mission Queue
                </h2>
                <button
                    onClick={() => setCreateOpen(true)}
                    disabled={saving}
                    className="px-3 py-1.5 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700 shadow-sm flex items-center gap-1 disabled:opacity-50"
                >
                    <Plus className="w-4 h-4" />
                    {saving ? 'Creating…' : 'New Task'}
                </button>
            </div>

            {createOpen && (
                <div className="fixed inset-0 z-50 overscroll-contain">
                    <button
                        type="button"
                        aria-label="Close dialog"
                        className="absolute inset-0 bg-black/40"
                        onClick={() => !saving && setCreateOpen(false)}
                    />

                    <div className="relative flex min-h-full items-center justify-center p-4">
                        <div
                            role="dialog"
                            aria-modal="true"
                            aria-labelledby="create-task-title"
                            className="w-full max-w-lg overflow-hidden rounded-xl bg-white shadow-xl ring-1 ring-black/5"
                        >
                            <div className="border-b border-gray-200 px-4 py-3">
                                <div id="create-task-title" className="text-sm font-semibold text-gray-900">Create task</div>
                                <div className="text-xs text-gray-500">This will run automatically.</div>
                            </div>

                            <div className="space-y-3 p-4">
                                <div>
                                    <label htmlFor="task-instructions" className="mb-1 block text-xs font-medium text-gray-700">
                                        Task instructions
                                    </label>
                                    <textarea
                                        id="task-instructions"
                                        name="message"
                                        value={newMessage}
                                        onChange={(e) => setNewMessage(e.target.value)}
                                        className="h-28 w-full resize-none rounded-lg border border-gray-300 px-3 py-2 shadow-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 disabled:opacity-60"
                                        placeholder="Describe the task…"
                                        disabled={saving}
                                    />
                                </div>

                                <div>
                                    <label htmlFor="task-priority" className="mb-1 block text-xs font-medium text-gray-700">
                                        Priority
                                    </label>
                                    <select
                                        id="task-priority"
                                        name="priority"
                                        value={newPriority}
                                        onChange={(e) => setNewPriority(Number(e.target.value) || 3)}
                                        className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 disabled:opacity-60"
                                        disabled={saving}
                                    >
                                        <option value={5}>5 (highest)</option>
                                        <option value={4}>4</option>
                                        <option value={3}>3 (normal)</option>
                                        <option value={2}>2</option>
                                        <option value={1}>1 (lowest)</option>
                                    </select>
                                </div>
                            </div>

                            <div className="flex items-center justify-end gap-2 border-t border-gray-200 bg-gray-50 px-4 py-3">
                                <button
                                    type="button"
                                    onClick={() => setCreateOpen(false)}
                                    disabled={saving}
                                    className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-900 shadow-sm transition-colors hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 disabled:opacity-50"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="button"
                                    onClick={handleCreateTask}
                                    disabled={saving || !String(newMessage || '').trim()}
                                    className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 disabled:opacity-50"
                                >
                                    {saving ? 'Creating…' : 'Create'}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            <div className="flex-1 overflow-x-auto p-4">
                <div className="flex gap-4 h-full min-w-max">
                    {COLUMNS.map(column => {
                        const columnTasks = getColumnTasks(column.id);

                        return (
                            <div key={column.id} className="w-72 flex flex-col bg-gray-50 rounded-lg h-full border border-gray-200">
                                <div className="p-3 border-b border-gray-200 flex justify-between items-center bg-white rounded-t-lg">
                                    <div className="flex items-center gap-2">
                                        <div className={`w-2 h-2 rounded-full ${column.dot}`}></div>
                                        <h3 className="font-semibold text-gray-700 text-sm uppercase tracking-wider">
                                            {column.title}
                                        </h3>
                                        <span className="bg-gray-100 text-gray-600 text-xs px-2 py-0.5 rounded-full">
                                            {columnTasks.length}
                                        </span>
                                    </div>
                                </div>

                                <div className="flex-1 overflow-y-auto p-2 space-y-2">
                                    {columnTasks.map(task => (
                                        <div
                                            key={task.id}
                                            className="bg-white p-3 rounded border border-gray-200"
                                        >
                                            <div className="flex justify-between items-start">
                                                <h4 className="font-medium text-gray-800 text-sm line-clamp-2">
                                                    {task.name}
                                                </h4>
                                            </div>

                                            <p className="mt-2 text-xs text-gray-500 line-clamp-2">
                                                {task.payload?.message || task?.metadata?.message || 'No description'}
                                            </p>

                                            <div className="mt-3 flex justify-end">
                                                <button
                                                    type="button"
                                                    onClick={() => openDetails(task)}
                                                    className="rounded-md border border-gray-200 bg-white px-2.5 py-1 text-xs font-semibold text-gray-800 shadow-sm hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
                                                >
                                                    View details
                                                </button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>

            {detailsOpen && (
                <div className="fixed inset-0 z-50 overscroll-contain">
                    <button
                        type="button"
                        aria-label="Close dialog"
                        className="absolute inset-0 bg-black/40"
                        onClick={() => !detailsLoading && closeDetails()}
                    />

                    <div className="relative flex min-h-full items-center justify-center p-4">
                        <div
                            role="dialog"
                            aria-modal="true"
                            className="w-full max-w-3xl overflow-hidden rounded-xl bg-white shadow-xl ring-1 ring-black/5"
                        >
                            <div className="flex items-start justify-between gap-4 border-b border-gray-200 px-4 py-3">
                                <div className="min-w-0">
                                    <div className="text-sm font-semibold text-gray-900">Task details</div>
                                    <div className="mt-0.5 text-xs text-gray-500 line-clamp-1">
                                        {detailsTask?.name || '—'}
                                    </div>
                                </div>
                                <button
                                    type="button"
                                    onClick={closeDetails}
                                    disabled={detailsLoading}
                                    className="shrink-0 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-900 shadow-sm hover:bg-gray-50 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
                                >
                                    Close
                                </button>
                            </div>

                            <div className="max-h-[70vh] overflow-y-auto p-4">
                                {detailsLoading && (
                                    <div className="text-sm text-gray-600">Loading…</div>
                                )}

                                {detailsError && (
                                    <div className="mb-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                                        {detailsError}
                                    </div>
                                )}

                                {detailsTask && (
                                    <div className="space-y-4">
                                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                                            <Field label="ID" value={detailsTask.id} />
                                            <Field label="Status" value={getTaskStatus(detailsTask) || '—'} />
                                            <Field label="Agent" value={detailsTask.agentId || '—'} />
                                            <Field label="Priority" value={detailsTask?.metadata?.priority ? `p${detailsTask.metadata.priority}` : '—'} />
                                            <Field label="Created" value={detailsTask?.metadata?.createdAt || detailsTask?.createdAt || '—'} />
                                            <Field label="Updated" value={detailsTask?.metadata?.updatedAt || detailsTask?.updatedAt || '—'} />
                                        </div>

                                        <div>
                                            <div className="text-xs font-semibold text-gray-700">Message</div>
                                            <div className="mt-1 whitespace-pre-wrap rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm text-gray-800">
                                                {detailsTask?.payload?.message || detailsTask?.metadata?.message || '—'}
                                            </div>
                                        </div>

                                        {detailsTask?.metadata?.lastRun && (
                                            <div>
                                                <div className="text-xs font-semibold text-gray-700">Last run</div>
                                                <div className="mt-1 grid grid-cols-1 gap-3 sm:grid-cols-2">
                                                    <Field label="Run status" value={detailsTask.metadata.lastRun.status || '—'} />
                                                    <Field label="Run ts" value={detailsTask.metadata.lastRun.ts || '—'} />
                                                </div>
                                                {(detailsTask.metadata.lastRun.error || detailsTask.metadata.lastRun.summary) && (
                                                    <div className="mt-2 space-y-2">
                                                        {detailsTask.metadata.lastRun.error && (
                                                            <div>
                                                                <div className="text-xs font-semibold text-gray-700">Error</div>
                                                                <pre className="mt-1 whitespace-pre-wrap rounded-lg border border-gray-200 bg-gray-50 p-3 text-xs text-gray-800">{String(detailsTask.metadata.lastRun.error)}</pre>
                                                            </div>
                                                        )}
                                                        {detailsTask.metadata.lastRun.summary && (
                                                            <div>
                                                                <div className="text-xs font-semibold text-gray-700">Summary</div>
                                                                <pre className="mt-1 whitespace-pre-wrap rounded-lg border border-gray-200 bg-gray-50 p-3 text-xs text-gray-800">{String(detailsTask.metadata.lastRun.summary)}</pre>
                                                            </div>
                                                        )}
                                                    </div>
                                                )}
                                            </div>
                                        )}

                                        {detailsTask?.metadata?.lastDecision && (
                                            <div>
                                                <div className="text-xs font-semibold text-gray-700">Last decision</div>
                                                <div className="mt-1 grid grid-cols-1 gap-3 sm:grid-cols-2">
                                                    <Field label="Decision" value={detailsTask.metadata.lastDecision.decision || '—'} />
                                                    <Field label="Decision ts" value={detailsTask.metadata.lastDecision.ts || '—'} />
                                                </div>
                                                {detailsTask.metadata.lastDecision.reason && (
                                                    <pre className="mt-2 whitespace-pre-wrap rounded-lg border border-gray-200 bg-gray-50 p-3 text-xs text-gray-800">{String(detailsTask.metadata.lastDecision.reason)}</pre>
                                                )}
                                            </div>
                                        )}

                                        {Array.isArray(detailsTask?.metadata?.log) && detailsTask.metadata.log.length > 0 && (
                                            <div>
                                                <div className="text-xs font-semibold text-gray-700">Log</div>
                                                <pre className="mt-1 max-h-56 overflow-y-auto whitespace-pre-wrap rounded-lg border border-gray-200 bg-gray-50 p-3 text-xs text-gray-800">{detailsTask.metadata.log.join('\n')}</pre>
                                            </div>
                                        )}

                                        {Array.isArray(detailsTask?.metadata?.narrative) && detailsTask.metadata.narrative.length > 0 && (
                                            <div>
                                                <div className="text-xs font-semibold text-gray-700">Narrative</div>
                                                <pre className="mt-1 max-h-56 overflow-y-auto whitespace-pre-wrap rounded-lg border border-gray-200 bg-gray-50 p-3 text-xs text-gray-800">{detailsTask.metadata.narrative.map((n) => {
                                                    const ts = n?.ts ? String(n.ts) : '';
                                                    const role = n?.role ? String(n.role) : '';
                                                    const agentId = n?.agentId ? String(n.agentId) : '';
                                                    const text = n?.text ? String(n.text) : '';
                                                    return `${ts} ${agentId ? `[${agentId}] ` : ''}${role ? `${role}: ` : ''}${text}`.trim();
                                                }).join('\n\n')}</pre>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            )}

        </div>
    );
};

const Field = ({ label, value }) => (
    <div className="rounded-lg border border-gray-200 bg-white p-3">
        <div className="text-[11px] font-semibold text-gray-600">{label}</div>
        <div className="mt-1 text-sm font-medium text-gray-900 break-words">{String(value ?? '—')}</div>
    </div>
);

export default KanbanBoard;
