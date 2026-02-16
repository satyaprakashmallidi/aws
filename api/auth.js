import { getSupabase } from './lib/supabase.js';

export default async function handler(req, res) {
    const { action } = req.query;

    // POST /api/auth?action=login - Login
    // POST /api/auth?action=signup - Signup
    // GET /api/auth?action=user - Get current user

    const supabase = await getSupabase();

    if (req.method === 'POST') {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password required' });
        }

        // Login
        if (action === 'login') {
            const { data, error } = await supabase.auth.signInWithPassword({
                email,
                password
            });

            if (error) {
                return res.status(401).json({ error: error.message });
            }

            return res.status(200).json(data);
        }

        // Signup
        if (action === 'signup') {
            const { data, error } = await supabase.auth.signUp({
                email,
                password
            });

            if (error) {
                return res.status(400).json({ error: error.message });
            }

            return res.status(201).json(data);
        }

        return res.status(400).json({ error: 'Invalid action' });
    }

    if (req.method === 'GET' && action === 'user') {
        const token = req.headers.authorization?.replace('Bearer ', '');

        if (!token) {
            return res.status(401).json({ error: 'No authorization token' });
        }

        const { data: { user }, error } = await supabase.auth.getUser(token);

        if (error || !user) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        return res.status(200).json({ user });
    }

    return res.status(405).json({ error: 'Method not allowed' });
}
