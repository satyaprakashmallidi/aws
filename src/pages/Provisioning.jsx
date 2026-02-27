import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@clerk/clerk-react';
import { apiUrl } from '../lib/apiBase';

const steps = [
    'Allocating your agent environment',
    'Configuring secure container',
    'Setting up your workspace',
    'Almost ready',
];

export default function Provisioning() {
    const navigate = useNavigate();
    const { getToken } = useAuth();
    const [stepIndex, setStepIndex] = useState(0);
    const [error, setError] = useState(null);

    useEffect(() => {
        const stepTimer = setInterval(() => {
            setStepIndex((i) => Math.min(i + 1, steps.length - 1));
        }, 8000);
        return () => clearInterval(stepTimer);
    }, []);

    useEffect(() => {
        let stopped = false;

        const poll = async () => {
            while (!stopped) {
                try {
                    const token = await getToken();
                    const res = await fetch(apiUrl('/api/user/profile'), {
                        headers: { Authorization: `Bearer ${token}` },
                    });
                    if (res.ok) {
                        const { profile } = await res.json();
                        if (profile?.operation_status === 'ready') {
                            navigate('/app', { replace: true });
                            return;
                        }
                        if (profile?.operation_status === 'suspended') {
                            setError('Your account has been suspended. Contact support.');
                            return;
                        }
                    }
                } catch {
                    // network blip — keep polling
                }
                await new Promise((r) => setTimeout(r, 3000));
            }
        };

        poll();
        return () => { stopped = true; };
    }, [getToken, navigate]);

    return (
        <div style={{
            minHeight: '100dvh',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)',
            color: '#f8fafc',
            fontFamily: 'Inter, system-ui, sans-serif',
            padding: '2rem',
        }}>
            {error ? (
                <p style={{ color: '#f87171', fontSize: '1rem', textAlign: 'center' }}>{error}</p>
            ) : (
                <>
                    <div style={{
                        width: 64, height: 64, borderRadius: '50%',
                        border: '3px solid #334155',
                        borderTopColor: '#6366f1',
                        animation: 'spin 1s linear infinite',
                        marginBottom: '2rem',
                    }} />
                    <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>

                    <h1 style={{ fontSize: '1.5rem', fontWeight: 600, marginBottom: '0.75rem', textAlign: 'center' }}>
                        Setting up your OpenClaw agent
                    </h1>
                    <p style={{ color: '#94a3b8', fontSize: '0.95rem', textAlign: 'center', maxWidth: 360 }}>
                        {steps[stepIndex]}…
                    </p>

                    <div style={{ marginTop: '3rem', display: 'flex', gap: '0.5rem' }}>
                        {steps.map((_, i) => (
                            <div key={i} style={{
                                width: 8, height: 8, borderRadius: '50%',
                                background: i <= stepIndex ? '#6366f1' : '#334155',
                                transition: 'background 0.4s',
                            }} />
                        ))}
                    </div>
                </>
            )}
        </div>
    );
}
