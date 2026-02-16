import React, { useEffect, useState } from 'react';
import { health, agents } from '../lib/api';

const Dashboard = () => {
    const [status, setStatus] = useState('Loading...');
    const [gatewayInfo, setGatewayInfo] = useState(null);
    const [agentsList, setAgentsList] = useState([]);

    useEffect(() => {
        fetchDashboardData();
        // Refresh data every 30 seconds
        const interval = setInterval(fetchDashboardData, 30000);
        return () => clearInterval(interval);
    }, []);

    const fetchDashboardData = async () => {
        try {
            setStatus('Loading...');

            // Fetch health status
            console.log('📊 Fetching health status...');
            const healthData = await health.check();
            console.log('📊 Health response:', healthData);
            setGatewayInfo(healthData);

            // Fetch agents list
            console.log('🤖 Fetching agents list...');
            const agentsData = await agents.list();
            console.log('🤖 Agents response:', agentsData);

            // Extract agents array
            const agentsArray = agentsData?.agents || [];
            setAgentsList(agentsArray);

            setStatus('Connected');
        } catch (error) {
            console.error("Failed to fetch dashboard data:", error);
            setStatus('Error: ' + error.message);
        }
    };

    return (
        <div className="min-h-screen bg-gray-50 text-gray-900 font-sans">
            {/* Top Navigation Bar */}
            <header className="bg-white shadow-sm border-b border-gray-200">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <span className="text-2xl">🦞</span>
                        <h1 className="text-xl font-bold text-gray-900 tracking-tight">OpenClaw Control</h1>
                    </div>

                    <div className="flex items-center gap-4">
                        <div className={`flex items-center gap-2 px-3 py-1 rounded-full text-sm font-medium ${status === 'Connected' ? 'bg-green-100 text-green-700' :
                            status === 'Error' ? 'bg-red-100 text-red-700' :
                                'bg-yellow-100 text-yellow-700'
                            }`}>
                            <span className={`w-2 h-2 rounded-full ${status === 'Connected' ? 'bg-green-500' :
                                status === 'Error' ? 'bg-red-500' :
                                    'bg-yellow-500'
                                }`}></span>
                            {status}
                        </div>
                    </div>
                </div>
            </header>

            <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
                {/* Stats Grid */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                    <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
                        <h3 className="text-sm font-medium text-gray-500 mb-1">Gateway Status</h3>
                        <p className="text-2xl font-bold text-gray-900">
                            {gatewayInfo?.ok ? 'Operational' : 'Unknown'}
                        </p>
                        <p className="text-xs text-gray-400 mt-2">
                            Uptime: {gatewayInfo?.uptimeMs ? Math.floor(gatewayInfo.uptimeMs / 1000 / 60) + 'm' : '-'}
                        </p>
                    </div>

                    <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
                        <h3 className="text-sm font-medium text-gray-500 mb-1">Active Agents</h3>
                        <p className="text-2xl font-bold text-gray-900">{agents.length}</p>
                        <p className="text-xs text-gray-400 mt-2">Ready to execute tasks</p>
                    </div>

                    <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
                        <h3 className="text-sm font-medium text-gray-500 mb-1">Gateway Version</h3>
                        <p className="text-2xl font-bold text-gray-900">v2026.2.13</p>
                        <p className="text-xs text-gray-400 mt-2">Latest release</p>
                    </div>
                </div>

                {/* Main Content Area */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">

                    {/* Left Column: Agents & Tasks */}
                    <div className="lg:col-span-2 space-y-8">
                        {/* Agents Section */}
                        <section className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                            <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center">
                                <h2 className="text-lg font-semibold text-gray-800">Available Agents</h2>
                                <button className="text-sm text-blue-600 hover:text-blue-700 font-medium">Manage</button>
                            </div>
                            <div className="divide-y divide-gray-50">
                                {(!agentsList || agentsList.length === 0) ? (
                                    <div className="p-8 text-center text-gray-500">
                                        No agents found.
                                    </div>
                                ) : (
                                    agentsList.map((agent, idx) => (
                                        <div key={idx} className="p-6 flex items-center justify-between hover:bg-gray-50 transition-colors">
                                            <div className="flex items-center gap-4">
                                                <div className="w-10 h-10 bg-blue-100 text-blue-600 rounded-lg flex items-center justify-center font-bold">
                                                    {agent.id ? agent.id.substring(0, 2).toUpperCase() : 'AG'}
                                                </div>
                                                <div>
                                                    <h3 className="font-medium text-gray-900">{agent.id}</h3>
                                                    <p className="text-sm text-gray-500">{agent.model || 'Default Model'}</p>
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <span className="px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                                                    Idle
                                                </span>
                                            </div>
                                        </div>
                                    ))
                                )}
                            </div>
                        </section>
                    </div>

                    {/* Right Column: Recent Activity / Logs */}
                    <div className="space-y-8">
                        <section className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden h-full">
                            <div className="px-6 py-4 border-b border-gray-100">
                                <h2 className="text-lg font-semibold text-gray-800">Activity Log</h2>
                            </div>
                            <div className="p-4">
                                <div className="space-y-4">
                                    {gatewayInfo ? (
                                        <div className="text-sm text-gray-600">
                                            <div className="flex gap-2">
                                                <span className="text-gray-400">{new Date().toLocaleTimeString()}</span>
                                                <span>Gateway connected successfully.</span>
                                            </div>
                                            {gatewayInfo.agents && gatewayInfo.agents.map(a => (
                                                <div key={a.agentId} className="flex gap-2 mt-2">
                                                    <span className="text-gray-400">{new Date().toLocaleTimeString()}</span>
                                                    <span>Agent detected: <span className="font-medium">{a.agentId}</span></span>
                                                </div>
                                            ))}
                                        </div>
                                    ) : (
                                        <div className="text-sm text-gray-400 italic">Waiting for connection...</div>
                                    )}
                                </div>
                            </div>
                        </section>
                    </div>
                </div>
            </main>
        </div>
    );
};

export default Dashboard;
