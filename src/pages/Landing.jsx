import React from 'react';
import { Link, useLocation, Navigate } from 'react-router-dom';
import { useUser } from '@clerk/clerk-react';
import { ArrowRight, Bot, Zap, Shield, Globe } from 'lucide-react';

const Landing = () => {
    const { isSignedIn, isLoaded } = useUser();
    const location = useLocation();
    const loginState = location.state ? { from: location.state.from } : null;

    if (isLoaded && isSignedIn) {
        return <Navigate to="/app" replace />;
    }

    return (
        <div className="min-h-screen bg-slate-50 text-slate-900 selection:bg-blue-200 selection:text-slate-900 overflow-hidden">
            {/* Background Shapes */}
            <div className="fixed inset-0 z-0 pointer-events-none">
                <div className="absolute top-[-6%] left-[8%] w-[18rem] h-[18rem] bg-blue-100/60 rounded-full" />
                <div className="absolute bottom-[4%] right-[6%] w-[16rem] h-[16rem] bg-emerald-100/70 rounded-full" />
                <div className="absolute top-[22%] right-[18%] w-[10rem] h-[10rem] bg-orange-100/70 rounded-full" />
            </div>

            {/* Navbar */}
            <nav className="relative z-10 container mx-auto px-6 py-6 flex justify-between items-center">
                <div className="flex items-center gap-2">
                    <div className="w-9 h-9 bg-blue-600 rounded-lg flex items-center justify-center shadow-sm">
                        <Bot className="w-5 h-5 text-white" />
                    </div>
                    <span className="text-xl font-bold tracking-tight text-slate-900">Magic Teams</span>
                </div>
                <div className="flex items-center gap-4">
                    <Link to="/sign-in" state={loginState} className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-900 transition-colors">
                        Login
                    </Link>
                    <Link to="/sign-up" className="px-4 py-2 text-sm font-medium bg-blue-600 text-white rounded-full hover:bg-blue-700 transition-colors shadow-sm">
                        Sign Up
                    </Link>
                </div>
            </nav>

            {/* Hero Section */}
            <main className="relative z-10 container mx-auto px-6 pt-20 pb-32 md:pt-28 md:pb-36 text-center">
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white border border-slate-200 mb-8 shadow-sm">
                    <span className="flex h-2 w-2 rounded-full bg-emerald-500"></span>
                    <span className="text-xs font-medium text-slate-600">OpenClaw Gateway Online</span>
                </div>

                <h1 className="text-5xl md:text-7xl font-bold tracking-tight mb-8 text-slate-900">
                    Orchestrate Your
                    <br />
                    AI Workforce
                </h1>

                <p className="text-lg md:text-xl text-slate-600 max-w-2xl mx-auto mb-12 leading-relaxed">
                    Assign tasks, monitor progress, and scale your operations with autonomous AI agents.
                    The command center for your digital workforce.
                </p>

                <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
                    <Link to="/sign-up" className="group relative px-8 py-4 bg-blue-600 rounded-full font-semibold text-white shadow-sm hover:bg-blue-700 transition-all">
                        Get Started
                        <ArrowRight className="inline-block ml-2 w-4 h-4 group-hover:translate-x-1 transition-transform" />
                    </Link>
                    <Link to="/sign-in" state={loginState} className="px-8 py-4 bg-white border border-slate-200 text-slate-700 rounded-full font-semibold hover:bg-slate-100 transition-all">
                        Log In
                    </Link>
                </div>

                {/* Feature Grid */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mt-24 text-left">
                    <FeatureCard
                        icon={<Bot className="w-6 h-6 text-blue-600" />}
                        title="Autonomous Agents"
                        desc="Deploy specialized agents that work 24/7 to execute complex workflows without supervision."
                    />
                    <FeatureCard
                        icon={<Zap className="w-6 h-6 text-orange-600" />}
                        title="Real-time Control"
                        desc="Monitor execution streams, intervene when needed, and broadcast tasks instantly."
                    />
                    <FeatureCard
                        icon={<Globe className="w-6 h-6 text-emerald-600" />}
                        title="Universal Connectivity"
                        desc="Connect to any LLM, local or cloud, through the secure OpenClaw Gateway protocol."
                    />
                </div>
            </main>
        </div>
    );
};

const FeatureCard = ({ icon, title, desc }) => (
    <div className="p-6 rounded-2xl bg-white border border-slate-200 hover:border-slate-300 shadow-sm transition-colors">
        <div className="w-12 h-12 rounded-lg bg-slate-100 flex items-center justify-center mb-4">
            {icon}
        </div>
        <h3 className="text-xl font-semibold text-slate-900 mb-2">{title}</h3>
        <p className="text-slate-600 leading-relaxed">{desc}</p>
    </div>
);

export default Landing;
