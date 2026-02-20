import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useSignUp, useUser } from '@clerk/clerk-react';
import { ArrowRight, ShieldCheck } from 'lucide-react';

const GoogleIcon = () => (
    <svg className="w-5 h-5" viewBox="0 0 48 48" aria-hidden="true">
        <path fill="#EA4335" d="M24 9.5c3.54 0 6.68 1.22 9.17 3.62l6.8-6.8C35.86 2.5 30.34 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.9 6.14C12.38 13.2 17.7 9.5 24 9.5z" />
        <path fill="#4285F4" d="M46.1 24.55c0-1.64-.15-3.21-.43-4.73H24v9.46h12.46c-.54 2.9-2.18 5.35-4.63 7.01l7.11 5.52c4.16-3.83 7.16-9.48 7.16-16.26z" />
        <path fill="#FBBC05" d="M10.46 28.64c-.5-1.5-.78-3.1-.78-4.74 0-1.64.28-3.24.78-4.74l-7.9-6.14C.92 16.2 0 19.99 0 23.9c0 3.9.92 7.7 2.56 10.88l7.9-6.14z" />
        <path fill="#34A853" d="M24 48c6.48 0 11.92-2.14 15.9-5.79l-7.11-5.52c-1.97 1.32-4.48 2.1-8.79 2.1-6.3 0-11.62-3.7-13.54-8.86l-7.9 6.14C6.51 42.62 14.62 48 24 48z" />
    </svg>
);

const SignUpPage = () => {
    const navigate = useNavigate();
    const { isSignedIn, isLoaded: userLoaded } = useUser();
    const { isLoaded, signUp, setActive } = useSignUp();
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [code, setCode] = useState('');
    const [step, setStep] = useState('form');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
        if (userLoaded && isSignedIn) {
            navigate('/app', { replace: true });
        }
    }, [userLoaded, isSignedIn, navigate]);

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

    const handleGoogle = async () => {
        if (!isLoaded) return;
        setLoading(true);
        setError('');
        try {
            await signUp.authenticateWithRedirect({
                strategy: 'oauth_google',
                redirectUrl: '/sign-up',
                redirectUrlComplete: '/app'
            });
        } catch (err) {
            const message = err?.errors?.[0]?.message || err?.message || 'Failed to start Google sign-up';
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
                        <span className="text-white text-lg font-bold">OC</span>
                    </div>
                    <div>
                        <div className="text-lg font-bold">Magic Teams</div>
                        <div className="text-xs text-slate-500">OpenClaw Control</div>
                    </div>
                </div>

                <h1 className="text-2xl font-bold mb-2">Create your account</h1>
                <p className="text-sm text-slate-600 mb-6">
                    Spin up your command center in minutes.
                </p>

                {step === 'form' && (
                    <form onSubmit={handleSubmit} className="space-y-4">
                        <div>
                            <label className="block text-xs font-medium text-slate-600 mb-1">Email</label>
                            <input
                                type="email"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                className="w-full px-4 py-2.5 bg-white border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
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
                                className="w-full px-4 py-2.5 bg-white border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                                placeholder="••••••••"
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
                            className="w-full px-4 py-2.5 bg-blue-600 rounded-lg font-semibold text-white hover:bg-blue-700 transition-colors disabled:opacity-60"
                        >
                            {loading ? 'Creating...' : 'Create Account'}
                        </button>
                    </form>
                )}

                {step === 'verify' && (
                    <form onSubmit={handleVerify} className="space-y-4">
                        <div className="flex items-center gap-2 text-sm text-slate-600 mb-2">
                            <ShieldCheck className="w-4 h-4 text-blue-600" />
                            Enter the 6-digit code sent to {email}
                        </div>

                        <div>
                            <label className="block text-xs font-medium text-slate-600 mb-1">Verification Code</label>
                            <input
                                type="text"
                                value={code}
                                onChange={(e) => setCode(e.target.value)}
                                className="w-full px-4 py-2.5 bg-white border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                                placeholder="123456"
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
                            className="w-full px-4 py-2.5 bg-blue-600 rounded-lg font-semibold text-white hover:bg-blue-700 transition-colors disabled:opacity-60"
                        >
                            {loading ? 'Verifying...' : 'Verify Email'}
                        </button>
                    </form>
                )}

                <div className="mt-6">
                    <div className="text-xs uppercase tracking-[0.25em] text-slate-400 mb-3">Single Sign-On</div>
                    <button
                        type="button"
                        onClick={handleGoogle}
                        disabled={!isLoaded || loading}
                        className="w-full flex items-center justify-center gap-3 px-4 py-2.5 bg-white border border-slate-200 rounded-lg font-semibold text-slate-800 hover:bg-slate-100 transition-colors disabled:opacity-60"
                    >
                        {loading ? (
                            <span className="w-5 h-5 border-2 border-slate-300 border-t-slate-800 rounded-full animate-spin" />
                        ) : (
                            <GoogleIcon />
                        )}
                        Continue with Google
                    </button>
                </div>

                <div className="mt-6 text-sm text-slate-600">
                    Already have an account?{' '}
                    <Link to="/sign-in" className="text-blue-600 hover:text-blue-700">
                        Sign in
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

export default SignUpPage;
