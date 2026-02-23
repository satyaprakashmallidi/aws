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
                <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => !saving && setCreateOpen(false)}>
                    <div className="bg-white rounded-lg shadow-xl w-full max-w-lg overflow-hidden" onClick={(e) => e.stopPropagation()}>
                        <div className="px-4 py-3 border-b border-gray-200">
                            <div className="text-sm font-semibold text-gray-900">Create task</div>
                            <div className="text-xs text-gray-500">This will run automatically.</div>
                        </div>
                        <div className="p-4 space-y-3">
                            <div>
                                <div className="text-xs font-medium text-gray-700 mb-1">Task instructions</div>
                                <textarea
                                    value={newMessage}
                                    onChange={(e) => setNewMessage(e.target.value)}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 h-28 resize-none"
                                    placeholder="Describe the task..."
                                    disabled={saving}
                                />
                            </div>
                            <div>
                                <div className="text-xs font-medium text-gray-700 mb-1">Priority</div>
                                <select
                                    value={newPriority}
                                    onChange={(e) => setNewPriority(Number(e.target.value) || 3)}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white"
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
                        <div className="px-4 py-3 border-t border-gray-200 flex items-center justify-end gap-2 bg-gray-50">
                            <button
                                type="button"
                                onClick={() => setCreateOpen(false)}
                                disabled={saving}
                                className="px-3 py-2 rounded border border-gray-200 bg-white text-sm disabled:opacity-50"
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                onClick={handleCreateTask}
                                disabled={saving || !String(newMessage || '').trim()}
                                className="px-3 py-2 rounded bg-blue-600 text-white text-sm disabled:opacity-50"
                            >
                                {saving ? 'Creating…' : 'Create'}
                            </button>
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

                                            <div className="mt-2 flex items-center gap-2 flex-wrap">
                                                {task?.agentId && (
                                                    <span className="bg-gray-100 text-gray-700 text-[10px] px-1.5 py-0.5 rounded border border-gray-200">
                                                        {String(task.agentId)}
                                                    </span>
                                                )}
                                                {task?.metadata?.priority && (
                                                    <span className="bg-gray-100 text-gray-700 text-[10px] px-1.5 py-0.5 rounded border border-gray-200">
                                                        p{task.metadata.priority}
                                                    </span>
                                                )}
                                                {getTaskStatus(task) && (
                                                    <span className="bg-gray-100 text-gray-700 text-[10px] px-1.5 py-0.5 rounded border border-gray-200">
                                                        {getTaskStatus(task)}
                                                    </span>
                                                )}
                                            </div>

                                            {task?.metadata?.lastDecision?.reason && (
                                                <div className="mt-2 text-[11px] text-gray-600 line-clamp-2">
                                                    {String(task.metadata.lastDecision.reason)}
                                                </div>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>

        </div>
    );
};

export default KanbanBoard;
