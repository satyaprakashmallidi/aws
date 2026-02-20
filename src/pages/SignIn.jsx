import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useSignIn } from '@clerk/clerk-react';
import { Bot, ArrowRight } from 'lucide-react';

const SignInPage = () => {
    const navigate = useNavigate();
    const { isLoaded, signIn, setActive } = useSignIn();
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!isLoaded) return;

        setLoading(true);
        setError('');
        try {
            const result = await signIn.create({
                identifier: email,
                password
            });

            if (result.status === 'complete') {
                await setActive({ session: result.createdSessionId });
                navigate('/app');
                return;
            }

            setError('Additional verification required. Please use the default Clerk UI.');
        } catch (err) {
            const message = err?.errors?.[0]?.message || err?.message || 'Failed to sign in';
            setError(message);
        } finally {
            setLoading(false);
        }
    };

    const handleGoogle = async () => {
        if (!isLoaded) return;
        setLoading(true);
        setError('');
        try {
            await signIn.authenticateWithRedirect({
                strategy: 'oauth_google',
                redirectUrl: '/sign-in',
                redirectUrlComplete: '/app'
            });
        } catch (err) {
            const message = err?.errors?.[0]?.message || err?.message || 'Failed to start Google sign-in';
            setError(message);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen bg-slate-50 text-slate-900 selection:bg-blue-200 selection:text-slate-900 flex items-center justify-center px-6 py-12">
            <div className="w-full max-w-md bg-white border border-slate-200 rounded-2xl p-8 shadow-lg">
                <div className="flex items-center gap-3 mb-8">
                    <div className="w-10 h-10 bg-blue-600 rounded-lg flex items-center justify-center shadow-sm">
                        <Bot className="w-6 h-6 text-white" />
                    </div>
                    <div>
                        <div className="text-lg font-bold">Magic Teams</div>
                        <div className="text-xs text-slate-500">OpenClaw Control</div>
                    </div>
                </div>

                <h1 className="text-2xl font-bold mb-2">Welcome back</h1>
                <p className="text-sm text-slate-600 mb-6">
                    Sign in to continue to your command center.
                </p>

                <button
                    type="button"
                    onClick={handleGoogle}
                    disabled={!isLoaded || loading}
                    className="w-full mb-4 px-4 py-2 bg-slate-900 text-white rounded-lg font-semibold hover:bg-slate-800 transition-colors disabled:opacity-50"
                >
                    Continue with Google
                </button>

                <form onSubmit={handleSubmit} className="space-y-4">
                    <div>
                        <label className="block text-xs font-medium text-slate-600 mb-1">Email</label>
                        <input
                            type="email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            className="w-full px-4 py-2 bg-white border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                            placeholder="you@company.com"
                            required
                        />
                    </div>

                    <div>
                        <label className="block text-xs font-medium text-slate-600 mb-1">Password</label>
                        <input
                            type="password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            className="w-full px-4 py-2 bg-white border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                            placeholder="********"
                            required
                        />
                    </div>

                    {error && (
                        <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-3">
                            {error}
                        </div>
                    )}

                    <button
                        type="submit"
                        disabled={!isLoaded || loading}
                        className="w-full px-4 py-2 bg-blue-600 rounded-lg font-semibold text-white hover:bg-blue-700 transition-colors disabled:opacity-50"
                    >
                        {loading ? 'Signing in...' : 'Sign In'}
                    </button>
                </form>

                <div className="mt-6 text-sm text-slate-600">
                    Don't have an account?{' '}
                    <Link to="/sign-up" className="text-blue-600 hover:text-blue-700">
                        Sign up
                    </Link>
                </div>

                <div className="mt-6">
                    <Link to="/" className="text-xs text-slate-500 hover:text-slate-700 inline-flex items-center gap-1">
                        Back to home <ArrowRight className="w-3 h-3" />
                    </Link>
                </div>
            </div>
        </div>
    );
};

export default SignInPage;
