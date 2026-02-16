import { invokeTool } from './openclaw.js';

/**
 * Get chat history for a session
 * @param {string} sessionKey - Session key (e.g., 'agent:main:user123')
 * @param {Object} options - Query options
 */
export async function getChatHistory(sessionKey, options = {}) {
    const { limit = 50, includeTools = false } = options;

    try {
        const response = await invokeTool({
            tool: 'sessions_history',
            args: {
                sessionKey,
                limit,
                includeTools
            }
        });

        return {
            sessionKey,
            messages: response.messages || [],
            total: response.total || 0
        };
    } catch (error) {
        console.error(`Failed to get chat history for ${sessionKey}:`, error);
        throw error;
    }
}

/**
 * Get all sessions
 * @param {Object} options - Query options
 */
export async function listSessions(options = {}) {
    const {
        kinds = ['main', 'group', 'cron'],
        limit = 50,
        activeMinutes = 1440,
        messageLimit = 3
    } = options;

    try {
        const response = await invokeTool({
            tool: 'sessions_list',
            args: {
                kinds,
                limit,
                activeMinutes,
                messageLimit
            }
        });

        return {
            sessions: response.sessions || [],
            total: response.total || 0
        };
    } catch (error) {
        console.error('Failed to list sessions:', error);
        throw error;
    }
}
