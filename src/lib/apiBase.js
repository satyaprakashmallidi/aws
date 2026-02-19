const API_BASE = import.meta.env.VITE_API_BASE || '';

export function apiUrl(path) {
    if (!path) return path;
    const normalized = path.startsWith('/') ? path : `/${path}`;
    if (!API_BASE) return normalized;
    return `${API_BASE.replace(/\/$/, '')}${normalized}`;
}
