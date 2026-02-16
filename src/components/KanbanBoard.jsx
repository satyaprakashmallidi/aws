import React, { useState, useEffect } from 'react';
import { Plus, MoreHorizontal, Calendar, Play } from 'lucide-react';

const COLUMNS = [
    { id: 'inbox', title: 'Inbox', color: 'bg-gray-100' },
    { id: 'assigned', title: 'Assigned', color: 'bg-blue-50' },
    { id: 'active', title: 'In Progress', color: 'bg-green-50' },
    { id: 'review', title: 'Review', color: 'bg-yellow-50' },
    { id: 'done', title: 'Done', color: 'bg-purple-50' }
];

const KanbanBoard = () => {
    const [tasks, setTasks] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        fetchTasks();
    }, []);

    const fetchTasks = async () => {
        try {
            const response = await fetch('/api/cron?includeDisabled=true');
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

    const getColumnTasks = (columnId) => {
        // For now, map cron jobs to columns based on logic
        // Real implementation would track status in metadata
        if (columnId === 'inbox') return tasks.filter(t => !t.enabled);
        if (columnId === 'active') return tasks.filter(t => t.enabled);
        return [];
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
                    <button className="px-3 py-1.5 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700 shadow-sm flex items-center gap-1">
                        <Plus className="w-4 h-4" />
                        New Task
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
                                        <div key={task.id} className="bg-white p-3 rounded shadow-sm border border-gray-200 hover:shadow-md transition-shadow cursor-pointer group relative">
                                            <div className="flex justify-between items-start mb-2">
                                                <h4 className="font-medium text-gray-800 text-sm line-clamp-2">
                                                    {task.name}
                                                </h4>
                                                <button className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-blue-600 transition-opacity">
                                                    <Play className="w-3 h-3" />
                                                </button>
                                            </div>

                                            <p className="text-xs text-gray-500 line-clamp-2 mb-3">
                                                {task.payload?.message || 'No description'}
                                            </p>

                                            <div className="flex items-center gap-2">
                                                <span className="bg-blue-50 text-blue-700 text-[10px] px-1.5 py-0.5 rounded border border-blue-100">
                                                    {task.schedule?.expr || 'Manual'}
                                                </span>
                                                {task.sessionTarget && (
                                                    <span className="bg-purple-50 text-purple-700 text-[10px] px-1.5 py-0.5 rounded border border-purple-100">
                                                        {task.sessionTarget}
                                                    </span>
                                                )}
                                            </div>
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
