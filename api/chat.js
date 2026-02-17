import { sendChatMessage } from './lib/openclaw.js';
import { getChatHistory, listSessions } from './lib/openclaw-chat.js';
import { getUserFromRequest, supabaseAdmin } from './lib/supabase.js';

export default async function handler(req, res) {
    const { action, sessionKey, limit, includeTools } = req.query;

    // POST /api/chat - Send message
    // GET /api/chat?action=history&sessionKey=xxx - Get history
    // GET /api/chat?action=sessions - List sessions

    if (req.method === 'POST') {
        // Send chat message
        // const { user, error } = await getUserFromRequest(req);

        // if (error || !user) {
        //     return res.status(401).json({ error: 'Unauthorized' });
        // }
        const user = { id: 'dev-user' }; // TEMP: Mock user for development

        const { message, agentId = 'main', sessionId } = req.body;

        if (!message) {
            return res.status(400).json({ error: 'Message required' });
        }

        const messages = [{ role: 'user', content: message }];

        try {
            const response = await sendChatMessage({
                userId: user.id,
                messages,
                agentId
            });

            // Save to Supabase
            try {
                const supabase = await supabaseAdmin.get();
                if (sessionId) {
                    await supabase
                        .from('messages')
                        .insert({
                            session_id: sessionId,
                            role: 'user',
                            content: message
                        });

                    if (response.choices?.[0]?.message?.content) {
                        await supabase
                            .from('messages')
                            .insert({
                                session_id: sessionId,
                                role: 'assistant',
                                content: response.choices[0].message.content
                            });
                    }
                }
            } catch (dbError) {
                console.error('Failed to save to Supabase:', dbError);
                // Don't fail the request if just storage fails
            }

            return res.status(200).json(response);
        } catch (error) {
            console.error('Chat error:', error);
            // Return full error details including stack for debugging purposes
            return res.status(500).json({
                error: error.message,
                details: error.stack,
                type: error.name
            });
        }
    }

    if (req.method === 'GET') {
        // Get chat history
        if (action === 'history') {
            if (!sessionKey) {
                return res.status(400).json({ error: 'Session key required' });
            }

            try {
                const history = await getChatHistory(sessionKey, {
                    limit: limit ? parseInt(limit) : 50,
                    includeTools: includeTools === 'true'
                });
                return res.status(200).json(history);
            } catch (error) {
                console.error('Failed to get chat history:', error);
                return res.status(500).json({ error: error.message });
            }
        }

        // List sessions
        if (action === 'sessions') {
            try {
                const sessions = await listSessions();
                return res.status(200).json(sessions);
            } catch (error) {
                console.error('Failed to list sessions:', error);
                return res.status(500).json({ error: error.message });
            }
        }

        return res.status(400).json({ error: 'Invalid action' });
    }

    return res.status(405).json({ error: 'Method not allowed' });
}
