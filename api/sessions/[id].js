import { getUserFromRequest, supabaseAdmin } from '../../lib/supabase.js';

export default async function handler(req, res) {
    const { id } = req.query;

    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    // Authenticate user
    const { user, error: authError } = await getUserFromRequest(req);
    if (authError || !user) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
        // Get session
        const { data: session, error: sessionError } = await supabaseAdmin
            .from('sessions')
            .select('*')
            .eq('id', id)
            .eq('user_id', user.id)
            .single();

        if (sessionError) throw sessionError;

        // Get messages
        const { data: messages, error: messagesError } = await supabaseAdmin
            .from('messages')
            .select('*')
            .eq('session_id', id)
            .order('created_at', { ascending: true });

        if (messagesError) throw messagesError;

        return res.status(200).json({
            session,
            messages
        });
    } catch (error) {
        console.error('Session get error:', error);
        return res.status(500).json({ error: error.message });
    }
}
