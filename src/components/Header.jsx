import React, { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { UserButton } from "@clerk/clerk-react";
import { health } from '../lib/api';

const Header = () => {
    const location = useLocation();
    const [gatewayStatus, setGatewayStatus] = useState('offline');
    const [activeAgentCount, setActiveAgentCount] = useState(0);

    useEffect(() => {
        fetchStatus();
        const interval = setInterval(fetchStatus, 30000); // Update every 30s
        return () => clearInterval(interval);
    }, []);

    const fetchStatus = async () => {
        try {
            // Get gateway health
            await health.check();
            setGatewayStatus('online');

            // Get active agent count
            const response = await fetch('/api/agents?action=status');
            const data = await response.json();
            setActiveAgentCount(data.activeCount || 0);
        } catch (error) {
            console.error('Failed to fetch status:', error);
            setGatewayStatus('offline');
        }
    };

    const isActive = (path) => location.pathname === path;

    const handleSignOut = () => {
        // TODO: Implement sign out logic
        window.location.href = '/login';
    };

    return (
        <header className="bg-gray-900 text-white shadow-lg">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                <div className="flex items-center justify-between h-16">
                    {/* Left: Logo + Status */}
                    <div className="flex items-center gap-6">
                        <h1 className="text-xl font-bold">OpenClaw Control</h1>

                        <div className="flex items-center gap-2 px-3 py-1 bg-gray-800 rounded-lg">
                            <div className={`w-2 h-2 rounded-full ${gatewayStatus === 'online' ? 'bg-green-500' : 'bg-red-500'
                                }`}></div>
                            <span className="text-sm font-medium">
                                {gatewayStatus === 'online' ? 'Connected' : 'Offline'}
                            </span>
                        </div>

                        <div className="px-3 py-1 bg-blue-600 rounded-lg">
                            <span className="text-sm font-medium">
                                {activeAgentCount} Active Agent{activeAgentCount !== 1 ? 's' : ''}
                            </span>
                        </div>
                    </div>

                    {/* Center: Navigation */}
                    <nav className="flex gap-4">
                        <Link
                            to="/app"
                            className={`px-4 py-2 rounded-lg font-medium transition-colors ${isActive('/app')
                                ? 'bg-blue-600 text-white'
                                : 'text-gray-300 hover:bg-gray-800'
                                }`}
                        >
                            Home
                        </Link>
                        <Link
                            to="/app/chat"
                            className={`px-4 py-2 rounded-lg font-medium transition-colors ${isActive('/app/chat')
                                ? 'bg-blue-600 text-white'
                                : 'text-gray-300 hover:bg-gray-800'
                                }`}
                        >
                            Chat
                        </Link>
                        <Link
                            to="/app/broadcast"
                            className={`px-4 py-2 rounded-lg font-medium transition-colors ${isActive('/app/broadcast')
                                ? 'bg-blue-600 text-white'
                                : 'text-gray-300 hover:bg-gray-800'
                                }`}
                        >
                            Broadcast
                        </Link>
                    </nav>

                    {/* Right: User Profile */}
                    <div className="flex items-center gap-4">
                        <UserButton afterSignOutUrl="/" />
                    </div>
                </div>
            </div>
        </header>
    );
};

export default Header;
