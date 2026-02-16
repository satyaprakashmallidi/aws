import { getUserFromRequest, supabaseAdmin } from '../lib/supabase.js';

export default async function handler(req, res) {
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    // Authenticate user
    const { user, error: authError } = await getUserFromRequest(req);
    if (authError || !user) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
        const { data: sessions, error } = await supabaseAdmin
            .from('sessions')
            .select('*')
            .eq('user_id', user.id)
            .order('updated_at', { ascending: false });

        if (error) throw error;

        return res.status(200).json({ sessions });
    } catch (error) {
        console.error('Sessions list error:', error);
        return res.status(500).json({ error: error.message });
    }
}
