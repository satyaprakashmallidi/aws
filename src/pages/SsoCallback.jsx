import React from 'react';
import { AuthenticateWithRedirectCallback } from '@clerk/clerk-react';

export default function SsoCallback() {
    return (
        <div className="min-h-screen bg-slate-50 text-slate-900 flex items-center justify-center px-6 py-12">
            <div className="w-full max-w-md rounded-2xl bg-white border border-slate-200 p-8 shadow-lg">
                <div className="text-lg font-bold">Signing you in…</div>
                <div className="mt-2 text-sm text-slate-600">Please wait while we complete Google authentication.</div>
                <AuthenticateWithRedirectCallback
                    signInUrl="/sign-in"
                    signUpUrl="/sign-up"
                    signInFallbackRedirectUrl="/app"
                    signUpFallbackRedirectUrl="/app"
                />
            </div>
        </div>
    );
}
