import { getUserFromRequest } from '../lib/supabase.js';

export default async function handler(req, res) {
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { user, error } = await getUserFromRequest(req);

    if (error || !user) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    return res.status(200).json({ user });
}
