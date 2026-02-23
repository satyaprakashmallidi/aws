import React, { useState, useEffect } from 'react';
import { apiUrl } from '../lib/apiBase';
import { Plus, MoreHorizontal, Calendar, X } from 'lucide-react';

const COLUMNS = [
    { id: 'inbox', title: 'Inbox', color: 'bg-gray-100' },
    { id: 'assigned', title: 'Assigned', color: 'bg-blue-50' },
    { id: 'active', title: 'In Progress', color: 'bg-green-50' },
    { id: 'review', title: 'Review', color: 'bg-yellow-50' },
    { id: 'failed', title: 'Failed', color: 'bg-red-50' },
    { id: 'done', title: 'Done', color: 'bg-purple-50' }
];

const KanbanBoard = () => {
    const [tasks, setTasks] = useState([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [selectedTask, setSelectedTask] = useState(null);
    const [taskRuns, setTaskRuns] = useState([]);
    const [taskActivity, setTaskActivity] = useState(null);
    const [loadingDetails, setLoadingDetails] = useState(false);

    useEffect(() => {
        fetchTasks();
        const interval = setInterval(() => {
            fetchTasks();
            fetch(apiUrl('/api/heartbeat'), { method: 'POST' }).catch(() => { /* ignore */ });
        }, 60_000);
        return () => clearInterval(interval);
    }, []);

    const fetchTasks = async () => {
        try {
            const response = await fetch(apiUrl(`/api/tasks?t=${Date.now()}`));
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

    const formatSchedule = (task) => {
        const s = task?.schedule;
        if (!s || typeof s !== 'object') return 'unknown';
        const kind = s.kind || 'unknown';
        if (kind === 'cron') return `cron: ${s.expr}`;
        if (kind === 'every') {
            const ms = Number(s.everyMs);
            if (!Number.isFinite(ms) || ms <= 0) return 'every';
            const mins = Math.round(ms / 60000);
            if (mins % 60 === 0) return `every ${mins / 60}h`;
            return `every ${mins}m`;
        }
        if (kind === 'at') return `at: ${String(s.at || '').replace('.000Z', 'Z')}`;
        return kind;
    };

    const getColumnTasks = (columnId) => {
        const byStatus = (status) => tasks.filter(t => getTaskStatus(t) === status);

        if (columnId === 'done') return byStatus('completed');
        if (columnId === 'failed') return byStatus('failed');
        if (columnId === 'review') return byStatus('review');
        if (columnId === 'active') return byStatus('picked_up');
        if (columnId === 'assigned') return byStatus('assigned').concat(byStatus('run_requested')).concat(byStatus('scheduled'));
        if (columnId === 'inbox') return byStatus('disabled');
        return [];
    };

    const openTaskDetails = async (task) => {
        if (!task?.id) return;
        setSelectedTask(task);
        setLoadingDetails(true);
        setTaskRuns([]);
        setTaskActivity(null);
        try {
            const [runsRes, activityRes] = await Promise.all([
                fetch(apiUrl(`/api/tasks/runs?id=${encodeURIComponent(task.id)}&limit=20&t=${Date.now()}`)),
                fetch(apiUrl(`/api/tasks/${encodeURIComponent(task.id)}/activity?limit=600&t=${Date.now()}`))
            ]);
            if (runsRes.ok) {
                const data = await runsRes.json();
                setTaskRuns(Array.isArray(data.entries) ? data.entries : []);
            }
            if (activityRes.ok) {
                const data = await activityRes.json();
                setTaskActivity(data || null);
            }
        } catch {
            // ignore
        } finally {
            setLoadingDetails(false);
        }
    };

    const handleCreateTask = async () => {
        const message = prompt('Task instructions:');
        if (!message || !message.trim()) return;
        const rawPriority = prompt('Priority (1=low, 5=high):', '3') || '3';
        const priority = Math.max(1, Math.min(5, Number(rawPriority) || 3));
        setSaving(true);
        try {
            await fetch(apiUrl('/api/tasks'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: `Task: ${message.trim().slice(0, 60)}${message.trim().length > 60 ? '…' : ''}`,
                    payload: { message, agentId: 'main', source: 'kanban' },
                    metadata: { priority, status: 'assigned' },
                    enabled: true,
                    schedule: { expr: 'manual' }
                })
            });
            fetchTasks();
        } catch (error) {
            console.error('Failed to create task:', error);
        } finally {
            setSaving(false);
        }
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
            <div className="p-4 border-b border-gray-100 flex justify-between items-center bg-gray-50">
                <h2 className="text-lg font-bold text-gray-800 flex items-center gap-2">
                    <Calendar className="w-5 h-5 text-blue-600" />
                    Mission Queue
                </h2>
                <div className="flex gap-2">
                    <button className="px-3 py-1.5 bg-white border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50 shadow-sm">
                        Filter
                    </button>
                    <button
                        onClick={handleCreateTask}
                        disabled={saving}
                        className="px-3 py-1.5 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700 shadow-sm flex items-center gap-1 disabled:opacity-50"
                    >
                        <Plus className="w-4 h-4" />
                        {saving ? 'Creating…' : 'New Task'}
                    </button>
                </div>
            </div>

            <div className="flex-1 overflow-x-auto p-4">
                <div className="flex gap-4 h-full min-w-max">
                    {COLUMNS.map(column => {
                        const columnTasks = getColumnTasks(column.id);

                        return (
                            <div key={column.id} className="w-72 flex flex-col bg-gray-50 rounded-lg h-full border border-gray-200">
                                <div className="p-3 border-b border-gray-200 flex justify-between items-center bg-white rounded-t-lg">
                                    <div className="flex items-center gap-2">
                                        <div className={`w-2 h-2 rounded-full ${column.color.replace('bg-', 'bg-')}-500`}></div>
                                        <h3 className="font-semibold text-gray-700 text-sm uppercase tracking-wider">
                                            {column.title}
                                        </h3>
                                        <span className="bg-gray-100 text-gray-600 text-xs px-2 py-0.5 rounded-full">
                                            {columnTasks.length}
                                        </span>
                                    </div>
                                    <button className="text-gray-400 hover:text-gray-600">
                                        <MoreHorizontal className="w-4 h-4" />
                                    </button>
                                </div>

                                <div className="flex-1 overflow-y-auto p-2 space-y-2">
                                    {columnTasks.map(task => (
                                        <button
                                            key={task.id}
                                            type="button"
                                            onClick={() => openTaskDetails(task)}
                                            className="bg-white p-3 rounded shadow-sm border border-gray-200 hover:shadow-md transition-shadow cursor-pointer text-left w-full"
                                        >
                                            <div className="flex justify-between items-start mb-2">
                                                <h4 className="font-medium text-gray-800 text-sm line-clamp-2">
                                                    {task.name}
                                                </h4>
                                            </div>

                                            <p className="text-xs text-gray-500 line-clamp-2 mb-3">
                                                {task.payload?.message || 'No description'}
                                            </p>

                                            <div className="flex items-center gap-2 flex-wrap">
                                                <span className="bg-blue-50 text-blue-700 text-[10px] px-1.5 py-0.5 rounded border border-blue-100">
                                                    {formatSchedule(task)}
                                                </span>
                                                {task?.metadata?.priority && (
                                                    <span className="bg-gray-100 text-gray-700 text-[10px] px-1.5 py-0.5 rounded border border-gray-200">
                                                        p{task.metadata.priority}
                                                    </span>
                                                )}
                                                {task.sessionTarget && (
                                                    <span className="bg-purple-50 text-purple-700 text-[10px] px-1.5 py-0.5 rounded border border-purple-100">
                                                        {task.sessionTarget}
                                                    </span>
                                                )}
                                                {getTaskStatus(task) && (
                                                    <span className="bg-gray-100 text-gray-700 text-[10px] px-1.5 py-0.5 rounded border border-gray-200">
                                                        {getTaskStatus(task)}
                                                    </span>
                                                )}
                                                {task?.metadata?.lastDecision?.reason && (
                                                    <span className="bg-yellow-50 text-yellow-800 text-[10px] px-1.5 py-0.5 rounded border border-yellow-100">
                                                        {String(task.metadata.lastDecision.reason).slice(0, 60)}{String(task.metadata.lastDecision.reason).length > 60 ? '…' : ''}
                                                    </span>
                                                )}
                                            </div>
                                        </button>
                                    ))}
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>

            {selectedTask && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setSelectedTask(null)}>
                    <div className="bg-white rounded-lg shadow-xl w-full max-w-3xl max-h-[85vh] overflow-hidden" onClick={(e) => e.stopPropagation()}>
                        <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
                            <div>
                                <div className="text-sm font-semibold text-gray-900">{selectedTask.name}</div>
                                <div className="text-xs text-gray-500">{selectedTask.id}</div>
                            </div>
                            <button type="button" className="text-gray-500 hover:text-gray-700" onClick={() => setSelectedTask(null)}>
                                <X className="w-4 h-4" />
                            </button>
                        </div>

                        <div className="p-4 overflow-y-auto max-h-[calc(85vh-56px)] space-y-4">
                            <div className="text-sm text-gray-700 whitespace-pre-wrap">
                                {selectedTask.payload?.message || 'No message'}
                            </div>

                            <div className="flex flex-wrap gap-2">
                                {selectedTask?.metadata?.status && (
                                    <span className="text-[11px] px-2 py-1 rounded border bg-gray-50 text-gray-700">
                                        status: {selectedTask.metadata.status}
                                    </span>
                                )}
                                {selectedTask?.metadata?.priority && (
                                    <span className="text-[11px] px-2 py-1 rounded border bg-gray-50 text-gray-700">
                                        priority: {selectedTask.metadata.priority}
                                    </span>
                                )}
                                {typeof selectedTask?.metadata?.attempts === 'number' && (
                                    <span className="text-[11px] px-2 py-1 rounded border bg-gray-50 text-gray-700">
                                        attempts: {selectedTask.metadata.attempts}/{selectedTask.metadata.maxAttempts || 3}
                                    </span>
                                )}
                                {selectedTask?.state?.lastStatus && (
                                    <span className="text-[11px] px-2 py-1 rounded border bg-gray-50 text-gray-700">
                                        last: {selectedTask.state.lastStatus}
                                    </span>
                                )}
                            </div>

                            {selectedTask?.metadata?.error && (
                                <div className="border border-red-200 bg-red-50 rounded p-3 text-sm text-red-800 whitespace-pre-wrap">
                                    {selectedTask.metadata.error}
                                </div>
                            )}

                            {selectedTask?.metadata?.result && (
                                <pre className="border border-gray-200 bg-white rounded p-3 text-xs text-gray-800 whitespace-pre-wrap max-h-56 overflow-auto">
                                    {selectedTask.metadata.result}
                                </pre>
                            )}

                            {selectedTask?.metadata?.narrative?.length > 0 && (
                                <div className="border border-gray-200 rounded">
                                    <div className="px-3 py-2 border-b border-gray-200 text-xs font-semibold text-gray-700">AI narration</div>
                                    <div className="p-3 space-y-2">
                                        {selectedTask.metadata.narrative.slice(-30).map((n, idx) => (
                                            <div key={idx} className="text-sm">
                                                <div className="text-[10px] text-gray-500">{n.ts}{n.agentId ? ` • ${n.agentId}` : ''}</div>
                                                <div className="text-gray-800 whitespace-pre-wrap">{n.text}</div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {loadingDetails && (
                                <div className="text-sm text-gray-500">Loading history…</div>
                            )}

                            {!loadingDetails && taskRuns.length > 0 && (
                                <div className="border border-gray-200 rounded">
                                    <div className="px-3 py-2 border-b border-gray-200 text-xs font-semibold text-gray-700">Run history</div>
                                    <div className="p-3 space-y-2">
                                        {taskRuns.slice(0, 10).map((r, idx) => (
                                            <div key={idx} className="text-xs text-gray-700">
                                                <div className="text-[10px] text-gray-500">{new Date(Number(r.ts || 0)).toISOString()} • {r.status || 'unknown'}{r.error ? ` • ${r.error}` : ''}</div>
                                                {r.summary && <div className="whitespace-pre-wrap">{String(r.summary).slice(0, 400)}{String(r.summary).length > 400 ? '…' : ''}</div>}
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {!loadingDetails && taskActivity?.lines?.length > 0 && (
                                <div className="border border-gray-200 rounded">
                                    <div className="px-3 py-2 border-b border-gray-200 text-xs font-semibold text-gray-700">Recent activity</div>
                                    <pre className="p-3 text-[11px] text-gray-700 whitespace-pre-wrap max-h-64 overflow-auto">
                                        {taskActivity.lines.slice(-120).join('\n')}
                                    </pre>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default KanbanBoard;
