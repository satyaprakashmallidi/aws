import React from 'react';
import { Outlet } from 'react-router-dom';
import Header from './Header';

const Layout = () => {
    return (
        <div className="flex h-dvh flex-col overflow-hidden bg-slate-50 text-slate-900">
            <a
                href="#main"
                className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-white focus:px-3 focus:py-2 focus:text-sm focus:font-semibold focus:text-slate-900 focus:shadow focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2"
            >
                Skip to content
            </a>
            <Header />
            <main id="main" className="min-h-0 flex-1">
                <div className="mx-auto h-full min-h-0 w-full max-w-7xl overflow-y-auto px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
                    <Outlet />
                </div>
            </main>
        </div>
    );
};

export default Layout;
