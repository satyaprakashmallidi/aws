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
        <div className="min-h-screen bg-slate-950 text-white selection:bg-cyan-500 selection:text-white overflow-hidden">
            {/* Background Gradients */}
            <div className="fixed inset-0 z-0 pointer-events-none">
                <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-purple-500/10 rounded-full blur-[120px]" />
                <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-cyan-500/10 rounded-full blur-[120px]" />
            </div>

            {/* Navbar */}
            <nav className="relative z-10 container mx-auto px-6 py-6 flex justify-between items-center">
                <div className="flex items-center gap-2">
                    <div className="w-8 h-8 bg-gradient-to-tr from-cyan-500 to-purple-600 rounded-lg flex items-center justify-center">
                        <Bot className="w-5 h-5 text-white" />
                    </div>
                    <span className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-white to-slate-400">
                        Magic Teams
                    </span>
                </div>
                <div className="flex items-center gap-4">
                    <Link to="/sign-in" state={loginState} className="px-4 py-2 text-sm font-medium text-slate-300 hover:text-white transition-colors">
                        Login
                    </Link>
                    <Link to="/sign-up" className="px-4 py-2 text-sm font-medium bg-white text-slate-900 rounded-full hover:bg-slate-200 transition-colors">
                        Sign Up
                    </Link>
                </div>
            </nav>

            {/* Hero Section */}
            <main className="relative z-10 container mx-auto px-6 pt-20 pb-32 md:pt-32 md:pb-40 text-center">
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-slate-800/50 border border-slate-700/50 mb-8 animate-fade-in-up">
                    <span className="flex h-2 w-2 rounded-full bg-green-500 animate-pulse"></span>
                    <span className="text-xs font-medium text-slate-300">OpenClaw Gateway Online</span>
                </div>

                <h1 className="text-5xl md:text-7xl font-bold tracking-tight mb-8 bg-clip-text text-transparent bg-gradient-to-b from-white via-white to-slate-500">
                    Orchestrate Your <br />
                    <span className="bg-clip-text text-transparent bg-gradient-to-r from-cyan-400 to-purple-500">AI Workforce</span>
                </h1>

                <p className="text-lg md:text-xl text-slate-400 max-w-2xl mx-auto mb-12 leading-relaxed">
                    Assign tasks, monitor progress, and scale your operations with autonomous AI agents.
                    The command center for your digital workforce.
                </p>

                <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
                    <Link to="/sign-up" className="group relative px-8 py-4 bg-gradient-to-r from-cyan-500 to-purple-600 rounded-full font-semibold text-white shadow-lg shadow-purple-500/25 hover:shadow-purple-500/40 transition-all hover:scale-105">
                        Get Started Free
                        <ArrowRight className="inline-block ml-2 w-4 h-4 group-hover:translate-x-1 transition-transform" />
                    </Link>
                    <Link to="/sign-in" state={loginState} className="px-8 py-4 bg-slate-800/50 border border-slate-700 text-slate-200 rounded-full font-semibold hover:bg-slate-800 transition-all hover:border-slate-600">
                        Live Demo
                    </Link>
                </div>

                {/* Feature Grid */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mt-32 text-left">
                    <FeatureCard
                        icon={<Bot className="w-6 h-6 text-cyan-400" />}
                        title="Autonomous Agents"
                        desc="Deploy specialized agents that work 24/7 to execute complex workflows without supervision."
                    />
                    <FeatureCard
                        icon={<Zap className="w-6 h-6 text-purple-400" />}
                        title="Real-time Control"
                        desc="Monitor execution streams, intervene when needed, and broadcast tasks instantly."
                    />
                    <FeatureCard
                        icon={<Globe className="w-6 h-6 text-emerald-400" />}
                        title="Universal Connectivity"
                        desc="Connect to any LLM, local or cloud, through the secure OpenClaw Gateway protocol."
                    />
                </div>
            </main>
        </div>
    );
};

const FeatureCard = ({ icon, title, desc }) => (
    <div className="p-6 rounded-2xl bg-slate-900/50 border border-slate-800 hover:border-slate-700 transition-colors">
        <div className="w-12 h-12 rounded-lg bg-slate-800 flex items-center justify-center mb-4">
            {icon}
        </div>
        <h3 className="text-xl font-semibold text-white mb-2">{title}</h3>
        <p className="text-slate-400 leading-relaxed">{desc}</p>
    </div>
);

export default Landing;
