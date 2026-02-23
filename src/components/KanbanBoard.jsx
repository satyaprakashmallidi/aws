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
        const byStatus = (status) => tasks.filter(t => getTaskStatus(t) === status);

        if (columnId === 'done') return byStatus('completed');
        if (columnId === 'failed') return byStatus('failed');
        if (columnId === 'review') return byStatus('review');
        if (columnId === 'active') return byStatus('picked_up');
        if (columnId === 'assigned') return byStatus('assigned').concat(byStatus('run_requested')).concat(byStatus('scheduled'));
        if (columnId === 'inbox') return byStatus('disabled');
        return [];
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
            <div className="p-4 border-b border-gray-100 flex justify-between items-center bg-white">
                <h2 className="text-lg font-bold text-gray-800 flex items-center gap-2">
                    <Calendar className="w-5 h-5 text-blue-600" />
                    Mission Queue
                </h2>
                <button
                    onClick={handleCreateTask}
                    disabled={saving}
                    className="px-3 py-1.5 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700 shadow-sm flex items-center gap-1 disabled:opacity-50"
                >
                    <Plus className="w-4 h-4" />
                    {saving ? 'Creating…' : 'New Task'}
                </button>
            </div>

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
                                                {task.payload?.message || 'No description'}
                                            </p>

                                            <div className="mt-2 flex items-center gap-2 flex-wrap">
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
