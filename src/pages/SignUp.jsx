import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useSignUp } from '@clerk/clerk-react';
import { Bot, ArrowRight, ShieldCheck } from 'lucide-react';

const SignUpPage = () => {
    const navigate = useNavigate();
    const { isLoaded, signUp, setActive } = useSignUp();
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [code, setCode] = useState('');
    const [step, setStep] = useState('form');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!isLoaded) return;

        setLoading(true);
        setError('');
        try {
            await signUp.create({
                emailAddress: email,
                password
            });

            await signUp.prepareEmailAddressVerification({ strategy: 'email_code' });
            setStep('verify');
        } catch (err) {
            const message = err?.errors?.[0]?.message || err?.message || 'Failed to sign up';
            setError(message);
        } finally {
            setLoading(false);
        }
    };

    const handleVerify = async (e) => {
        e.preventDefault();
        if (!isLoaded) return;

        setLoading(true);
        setError('');
        try {
            const result = await signUp.attemptEmailAddressVerification({ code });
            if (result.status === 'complete') {
                await setActive({ session: result.createdSessionId });
                navigate('/app');
                return;
            }
            setError('Verification incomplete. Try again.');
        } catch (err) {
            const message = err?.errors?.[0]?.message || err?.message || 'Failed to verify';
            setError(message);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen bg-slate-950 text-white selection:bg-cyan-500 selection:text-white flex items-center justify-center px-6 py-12">
            <div className="w-full max-w-md bg-slate-900/60 border border-slate-800 rounded-2xl p-8 shadow-2xl">
                <div className="flex items-center gap-3 mb-8">
                    <div className="w-10 h-10 bg-gradient-to-tr from-cyan-500 to-purple-600 rounded-lg flex items-center justify-center">
                        <Bot className="w-6 h-6 text-white" />
                    </div>
                    <div>
                        <div className="text-lg font-bold">Magic Teams</div>
                        <div className="text-xs text-slate-400">OpenClaw Control</div>
                    </div>
                </div>

                <h1 className="text-2xl font-bold mb-2">Create your account</h1>
                <p className="text-sm text-slate-400 mb-6">
                    Spin up your command center in minutes.
                </p>

                {step === 'form' && (
                    <form onSubmit={handleSubmit} className="space-y-4">
                        <div>
                            <label className="block text-xs font-medium text-slate-400 mb-1">Email</label>
                            <input
                                type="email"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                className="w-full px-4 py-2 bg-slate-950 border border-slate-800 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-cyan-500"
                                placeholder="you@company.com"
                                required
                            />
                        </div>

                        <div>
                            <label className="block text-xs font-medium text-slate-400 mb-1">Password</label>
                            <input
                                type="password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                className="w-full px-4 py-2 bg-slate-950 border border-slate-800 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-cyan-500"
                                placeholder="••••••••"
                                required
                            />
                        </div>

                        {error && (
                            <div className="text-sm text-red-400 bg-red-950/40 border border-red-900 rounded-lg p-3">
                                {error}
                            </div>
                        )}

                        <button
                            type="submit"
                            disabled={!isLoaded || loading}
                            className="w-full px-4 py-2 bg-gradient-to-r from-cyan-500 to-purple-600 rounded-lg font-semibold text-white hover:opacity-90 transition-opacity disabled:opacity-50"
                        >
                            {loading ? 'Creating...' : 'Create Account'}
                        </button>
                    </form>
                )}

                {step === 'verify' && (
                    <form onSubmit={handleVerify} className="space-y-4">
                        <div className="flex items-center gap-2 text-sm text-slate-300 mb-2">
                            <ShieldCheck className="w-4 h-4 text-cyan-400" />
                            Enter the 6-digit code sent to {email}
                        </div>

                        <div>
                            <label className="block text-xs font-medium text-slate-400 mb-1">Verification Code</label>
                            <input
                                type="text"
                                value={code}
                                onChange={(e) => setCode(e.target.value)}
                                className="w-full px-4 py-2 bg-slate-950 border border-slate-800 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-cyan-500"
                                placeholder="123456"
                                required
                            />
                        </div>

                        {error && (
                            <div className="text-sm text-red-400 bg-red-950/40 border border-red-900 rounded-lg p-3">
                                {error}
                            </div>
                        )}

                        <button
                            type="submit"
                            disabled={!isLoaded || loading}
                            className="w-full px-4 py-2 bg-gradient-to-r from-cyan-500 to-purple-600 rounded-lg font-semibold text-white hover:opacity-90 transition-opacity disabled:opacity-50"
                        >
                            {loading ? 'Verifying...' : 'Verify Email'}
                        </button>
                    </form>
                )}

                <div className="mt-6 text-sm text-slate-400">
                    Already have an account?{' '}
                    <Link to="/sign-in" className="text-cyan-400 hover:text-cyan-300">
                        Sign in
                    </Link>
                </div>

                <div className="mt-6">
                    <Link to="/" className="text-xs text-slate-500 hover:text-slate-300 inline-flex items-center gap-1">
                        Back to home <ArrowRight className="w-3 h-3" />
                    </Link>
                </div>
            </div>
        </div>
    );
};

export default SignUpPage;
