import { getUserFromRequest, supabaseAdmin } from '../lib/supabase.js';
import { sendChatMessage } from '../lib/openclaw.js';

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    // Authenticate user
    const { user, error: authError } = await getUserFromRequest(req);
    if (authError || !user) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    const { message, agentId = 'main', sessionId } = req.body;

    if (!message) {
        return res.status(400).json({ error: 'Message required' });
    }

    try {
        // Get or create session
        let session;
        if (sessionId) {
            // Fetch existing session
            const { data } = await supabaseAdmin
                .from('sessions')
                .select('*')
                .eq('id', sessionId)
                .eq('user_id', user.id)
                .single();
            session = data;
        }

        if (!session) {
            // Create new session
            const { data, error: sessionError } = await supabaseAdmin
                .from('sessions')
                .insert({
                    user_id: user.id,
                    agent_id: agentId,
                    session_key: `user:${user.id}:${Date.now()}`,
                    title: message.substring(0, 50)
                })
                .select()
                .single();

            if (sessionError) throw sessionError;
            session = data;
        }

        // Save user message to database
        await supabaseAdmin.from('messages').insert({
            session_id: session.id,
            role: 'user',
            content: message
        });

        // Call OpenClaw
        const response = await sendChatMessage({
            userId: user.id,
            agentId,
            messages: [{ role: 'user', content: message }]
        });

        const assistantMessage = response.choices[0].message.content;

        // Save assistant response to database
        await supabaseAdmin.from('messages').insert({
            session_id: session.id,
            role: 'assistant',
            content: assistantMessage
        });

        // Update session timestamp
        await supabaseAdmin
            .from('sessions')
            .update({ updated_at: new Date().toISOString() })
            .eq('id', session.id);

        return res.status(200).json({
            sessionId: session.id,
            message: assistantMessage,
            response
        });

    } catch (error) {
        console.error('Chat error:', error);
        return res.status(500).json({ error: error.message });
    }
}
