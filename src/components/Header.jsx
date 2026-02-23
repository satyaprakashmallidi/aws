import React, { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { UserButton } from "@clerk/clerk-react";
import { health } from '../lib/api';
import { apiUrl } from '../lib/apiBase';
import { Menu, X } from 'lucide-react';

const Header = () => {
    const location = useLocation();
    const [gatewayStatus, setGatewayStatus] = useState('offline');
    const [activeAgentCount, setActiveAgentCount] = useState(0);
    const [mobileOpen, setMobileOpen] = useState(false);

    useEffect(() => {
        fetchStatus();
        const interval = setInterval(fetchStatus, 5000); // Update every 5s
        return () => clearInterval(interval);
    }, []);

    const fetchStatus = async () => {
        try {
            // Get gateway health
            const healthData = await health.check();
            setGatewayStatus(healthData?.status === 'online' ? 'online' : 'offline');

            // Get active agent count
            const response = await fetch(apiUrl(`/api/agents?action=status&t=${Date.now()}`));
            const data = await response.json();
            setActiveAgentCount(data.activeCount || 0);
        } catch (error) {
            console.error('Failed to fetch status:', error);
            setGatewayStatus('offline');
        }
    };

    const isActive = (path) => location.pathname === path;

    const links = [
        { to: '/app', label: 'Home' },
        { to: '/app/chat', label: 'Chat' },
        { to: '/app/broadcast', label: 'Broadcast' },
        { to: '/app/settings', label: 'Settings' }
    ];

    return (
        <header className="sticky top-0 z-50 shrink-0 bg-slate-950 text-white shadow">
            <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
                <div className="flex h-16 items-center justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-4">
                        <h1 className="min-w-0 text-base font-semibold tracking-tight sm:text-lg">
                            OpenClaw Control
                        </h1>

                        <div className="hidden items-center gap-2 rounded-lg bg-white/5 px-3 py-1 sm:flex" aria-live="polite">
                            <div
                                className={`h-2 w-2 rounded-full ${gatewayStatus === 'online' ? 'bg-emerald-400' : 'bg-rose-400'}`}
                                aria-hidden="true"
                            />
                            <span className="text-sm font-medium text-white/90">
                                {gatewayStatus === 'online' ? 'Connected' : 'Offline'}
                            </span>
                        </div>

                        <div className="hidden rounded-lg bg-blue-600/90 px-3 py-1 sm:block">
                            <span className="text-sm font-semibold tabular-nums">
                                {activeAgentCount} Active Agent{activeAgentCount !== 1 ? 's' : ''}
                            </span>
                        </div>
                    </div>

                    <nav className="hidden items-center gap-1 sm:flex" aria-label="Primary">
                        {links.map((l) => (
                            <Link
                                key={l.to}
                                to={l.to}
                                className={`rounded-lg px-3 py-2 text-sm font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 ${isActive(l.to)
                                    ? 'bg-blue-600 text-white'
                                    : 'text-white/80 hover:bg-white/10 hover:text-white'
                                    }`}
                            >
                                {l.label}
                            </Link>
                        ))}
                    </nav>

                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            className="inline-flex items-center justify-center rounded-lg p-2 text-white/90 hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 sm:hidden"
                            aria-label={mobileOpen ? 'Close navigation' : 'Open navigation'}
                            onClick={() => setMobileOpen((v) => !v)}
                        >
                            {mobileOpen ? <X className="h-5 w-5" aria-hidden="true" /> : <Menu className="h-5 w-5" aria-hidden="true" />}
                        </button>

                        <UserButton
                            afterSignOutUrl="/"
                            appearance={{
                                elements: {
                                    footer: "hidden",
                                    footerAction: "hidden",
                                    footerActionLink: "hidden",
                                    userButtonPopoverFooter: "hidden",
                                    userProfileFooter: "hidden"
                                }
                            }}
                        />
                    </div>
                </div>

                {mobileOpen && (
                    <div className="border-t border-white/10 py-3 sm:hidden">
                        <div className="mb-3 flex items-center justify-between gap-3 rounded-lg bg-white/5 px-3 py-2" aria-live="polite">
                            <div className="flex items-center gap-2">
                                <div
                                    className={`h-2 w-2 rounded-full ${gatewayStatus === 'online' ? 'bg-emerald-400' : 'bg-rose-400'}`}
                                    aria-hidden="true"
                                />
                                <span className="text-sm font-semibold text-white/90">
                                    {gatewayStatus === 'online' ? 'Connected' : 'Offline'}
                                </span>
                            </div>
                            <span className="text-sm font-semibold tabular-nums text-white/90">
                                {activeAgentCount}
                            </span>
                        </div>

                        <nav className="grid gap-1" aria-label="Primary">
                            {links.map((l) => (
                                <Link
                                    key={l.to}
                                    to={l.to}
                                    onClick={() => setMobileOpen(false)}
                                    className={`rounded-lg px-3 py-2 text-sm font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 ${isActive(l.to)
                                        ? 'bg-blue-600 text-white'
                                        : 'text-white/80 hover:bg-white/10 hover:text-white'
                                        }`}
                                >
                                    {l.label}
                                </Link>
                            ))}
                        </nav>
                    </div>
                )}
            </div>
        </header>
    );
};

export default Header;
