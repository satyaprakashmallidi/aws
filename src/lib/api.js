/**
 * API client for backend endpoints
 */

const API_BASE = import.meta.env.VITE_API_BASE || '';

// Get auth token from localStorage
function getAuthToken() {
    const session = JSON.parse(localStorage.getItem('supabase.auth.token') || '{}');
    return session.access_token;
}

// Generic fetch wrapper
async function apiFetch(endpoint, options = {}) {
    const token = getAuthToken();

    const response = await fetch(`${API_BASE}${endpoint}`, {
        ...options,
        headers: {
            'Content-Type': 'application/json',
            ...(token && { 'Authorization': `Bearer ${token}` }),
            ...options.headers
        }
    });

    if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Request failed' }));
        throw new Error(error.error || 'Request failed');
    }

    return response.json();
}

// Auth API
export const auth = {
    login: (email, password) =>
        apiFetch('/api/auth/login', {
            method: 'POST',
            body: JSON.stringify({ email, password })
        }),

    signup: (email, password) =>
        apiFetch('/api/auth/signup', {
            method: 'POST',
            body: JSON.stringify({ email, password })
        }),

    getUser: () => apiFetch('/api/auth/user')
};

// Chat API
export const chat = {
    send: (message, agentId = 'main', sessionId = null) =>
        apiFetch('/api/chat/send', {
            method: 'POST',
            body: JSON.stringify({ message, agentId, sessionId })
        })
};

// Sessions API
export const sessions = {
    list: () => apiFetch('/api/sessions/list'),

    get: (id) => apiFetch(`/api/sessions/${id}`)
};

// Agents API
export const agents = {
    list: () => apiFetch('/api/agents/list')
};

// Health API
export const health = {
    check: () => apiFetch('/api/health')
};
