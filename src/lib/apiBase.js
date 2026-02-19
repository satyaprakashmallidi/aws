const API_BASE =
    import.meta.env.VITE_API_BASE
    || (typeof window !== 'undefined' && window.__API_BASE__)
    || (import.meta.env.MODE === 'production' ? 'https://api.magicteams.ai' : '')
    || '';

export function apiUrl(path) {
    if (!path) return path;
    const normalized = path.startsWith('/') ? path : `/${path}`;
    if (!API_BASE) return normalized;
    return `${API_BASE.replace(/\/$/, '')}${normalized}`;
}
