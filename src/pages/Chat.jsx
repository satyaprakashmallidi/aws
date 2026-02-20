import React, { useState, useEffect, useRef } from 'react';
import { apiUrl } from '../lib/apiBase';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Send, Bot, User, Loader2, RefreshCw, Trash2, ChevronDown, Plus } from 'lucide-react';

const getOrCreateSessionKey = (agentId) => {
    const storageKey = `openclaw.session.${agentId}`;
    const existing = localStorage.getItem(storageKey);
    if (existing) return existing;

    const uuid = (typeof crypto !== 'undefined' && crypto.randomUUID)
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const sessionKey = `agent:${agentId}:${uuid}`;
    localStorage.setItem(storageKey, sessionKey);
    return sessionKey;
};

const getLocalHistory = (sessionKey) => {
    try {
        const raw = localStorage.getItem(`openclaw.history.${sessionKey}`);
        return raw ? JSON.parse(raw) : [];
    } catch {
        return [];
    }
};

const setLocalHistory = (sessionKey, messages) => {
    try {
        localStorage.setItem(`openclaw.history.${sessionKey}`, JSON.stringify(messages));
    } catch {
        // Ignore storage errors (quota, private mode, etc.)
    }
};

const Chat = () => {
    const [messages, setMessages] = useState([]);
    const [input, setInput] = useState('');
    const [sending, setSending] = useState(false);
    const [loading, setLoading] = useState(true);
    const [agentId, setAgentId] = useState('main'); // Default to main agent
    const [sessionKey, setSessionKey] = useState('');
    const [sessions, setSessions] = useState([]);
    const [sessionsLoading, setSessionsLoading] = useState(false);
    const [errorMessage, setErrorMessage] = useState('');
    const messagesEndRef = useRef(null);

    useEffect(() => {
        const key = getOrCreateSessionKey(agentId);
        setSessionKey(key);
    }, [agentId]);

    useEffect(() => {
        if (sessionKey) {
            fetchHistory();
        }
    }, [agentId, sessionKey]);

    useEffect(() => {
        fetchSessions();
    }, [agentId]);

    useEffect(() => {
        scrollToBottom();
    }, [messages]);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    };

    const fetchHistory = async () => {
        setLoading(true);
        try {
            const response = await fetch(apiUrl(`/api/chat?action=history&sessionKey=${encodeURIComponent(sessionKey)}&limit=50`));

            if (response.ok) {
                const data = await response.json();
                const history = (data.messages || []).map(m => ({
                    role: m.role,
                    content: m.content,
                    timestamp: m.created_at || m.timestamp
                }));

                if (history.length > 0) {
                    setMessages(history);
                    setLocalHistory(sessionKey, history);
                } else {
                    const localHistory = getLocalHistory(sessionKey);
                    setMessages(localHistory);
                }
            }
        } catch (error) {
            console.error('Failed to fetch chat history:', error);
            const localHistory = getLocalHistory(sessionKey);
            setMessages(localHistory);
        } finally {
            setLoading(false);
        }
    };

    const fetchSessions = async () => {
        setSessionsLoading(true);
        try {
            const response = await fetch(apiUrl('/api/chat?action=sessions'));
            if (response.ok) {
                const data = await response.json();
                const list = data.sessions || data?.result?.details?.sessions || [];
                setSessions(list);
            }
        } catch (error) {
            console.error('Failed to fetch sessions:', error);
        } finally {
            setSessionsLoading(false);
        }
    };

    const setSessionKeyPersisted = (key) => {
        if (!key) return;
        try {
            localStorage.setItem(`openclaw.session.${agentId}`, key);
        } catch {
            // Ignore storage errors
        }
        setSessionKey(key);
    };

    const createNewSession = () => {
        const uuid = (typeof crypto !== 'undefined' && crypto.randomUUID)
            ? crypto.randomUUID()
            : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const key = `agent:${agentId}:${uuid}`;
        setSessionKeyPersisted(key);
        setMessages([]);
    };

    const getSessionLabel = (session) => {
        const raw = session?.name
            || session?.title
            || session?.key
            || session?.sessionKey
            || session?.id
            || '';
        if (!raw) return '';
        return raw.length > 42 ? `${raw.slice(0, 20)}…${raw.slice(-18)}` : raw;
    };

    const currentSessionLabel = () => {
        if (!sessionKey) return 'No session';
        const match = sessions.find(s => (s?.key || s?.sessionKey || s?.id) === sessionKey);
        return getSessionLabel(match) || (sessionKey.length > 42 ? `${sessionKey.slice(0, 20)}…${sessionKey.slice(-18)}` : sessionKey);
    };

    const handleSend = async (e) => {
        e.preventDefault();
        if (!input.trim() || sending) return;

        const userMessage = {
            role: 'user',
            content: input,
            timestamp: new Date().toISOString()
        };

        // Optimistically add user message
        setMessages(prev => {
            const next = [...prev, userMessage];
            setLocalHistory(sessionKey, next);
            return next;
        });
        setInput('');
        setSending(true);
        setErrorMessage('');

        try {
            const response = await fetch(apiUrl('/api/chat'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    message: userMessage.content,
                    agentId,
                    sessionId: sessionKey,
                    stream: true
                })
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(errorText || `Request failed: ${response.status}`);
            }

            const reader = response.body?.getReader();
            if (!reader) {
                const data = await response.json();
                const content = data.choices?.[0]?.message?.content;
                if (content) {
                    const botMessage = {
                        role: 'assistant',
                        content,
                        timestamp: new Date().toISOString()
                    };
                    setMessages(prev => {
                        const next = [...prev, botMessage];
                        setLocalHistory(sessionKey, next);
                        return next;
                    });
                }
                return;
            }

            let assistantIndex = null;
            const decoder = new TextDecoder('utf-8');
            let buffer = '';

            const ensureAssistantMessage = () => {
                if (assistantIndex !== null) return;
                setMessages(prev => {
                    const next = [...prev, { role: 'assistant', content: '', timestamp: new Date().toISOString() }];
                    assistantIndex = next.length - 1;
                    setLocalHistory(sessionKey, next);
                    return next;
                });
            };

            while (true) {
                const { value, done } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });

                const lines = buffer.split('\n');
                buffer = lines.pop() || '';

                for (const line of lines) {
                    const trimmed = line.trim();
                    if (!trimmed.startsWith('data:')) continue;
                    const dataStr = trimmed.replace(/^data:\s*/, '');
                    if (dataStr === '[DONE]') {
                        break;
                    }
                    try {
                        const payload = JSON.parse(dataStr);
                        const delta = payload?.choices?.[0]?.delta?.content
                            ?? payload?.choices?.[0]?.message?.content
                            ?? '';
                        if (!delta) continue;

                        ensureAssistantMessage();
                        setMessages(prev => {
                            const next = [...prev];
                            const current = next[assistantIndex];
                            next[assistantIndex] = {
                                ...current,
                                content: (current?.content || '') + delta
                            };
                            setLocalHistory(sessionKey, next);
                            return next;
                        });
                    } catch (e) {
                        // Ignore non-JSON SSE lines
                    }
                }
            }
        } catch (error) {
            console.error('Failed to send message:', error);
            const message = error?.message || 'Request failed. Please try again.';
            setErrorMessage(message);
            setMessages(prev => {
                const next = [...prev, { role: 'error', content: message, timestamp: new Date().toISOString() }];
                setLocalHistory(sessionKey, next);
                return next;
            });
        } finally {
            setSending(false);
        }
    };

    const handleClear = async () => {
        if (!confirm('Clear chat history?')) return;
        // In a real app, call API to clear history. For now just clear local.
        setMessages([]);
    };

    return (
        <div className="flex flex-col h-[calc(100vh-8rem)] bg-white rounded-lg shadow overflow-hidden">
            {/* Chat Header */}
            <div className="p-4 border-b border-gray-100 flex justify-between items-center bg-gray-50">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center text-blue-600">
                        <Bot className="w-6 h-6" />
                    </div>
                    <div>
                        <h2 className="font-bold text-gray-800">Agent Chat</h2>
                        <div className="flex items-center gap-2 text-xs text-gray-500">
                            <span className="w-2 h-2 rounded-full bg-green-500"></span>
                            Online
                        </div>
                    </div>
                </div>

                <div className="flex items-center gap-2">
                    <div className="relative">
                        <select
                            value={sessionKey}
                            onChange={(e) => setSessionKeyPersisted(e.target.value)}
                            className="appearance-none bg-white border border-gray-200 rounded-lg px-3 py-2 pr-9 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 min-w-[220px]"
                            disabled={sessionsLoading}
                        >
                            <option value={sessionKey}>{currentSessionLabel()}</option>
                            {sessions.map((session) => {
                                const value = session?.key || session?.sessionKey || session?.id || '';
                                if (!value || value === sessionKey) return null;
                                return (
                                    <option key={value} value={value}>
                                        {getSessionLabel(session)}
                                    </option>
                                );
                            })}
                        </select>
                        <ChevronDown className="w-4 h-4 text-gray-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                    </div>
                    <button
                        onClick={createNewSession}
                        className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-full transition-colors"
                        title="New Session"
                    >
                        <Plus className="w-5 h-5" />
                    </button>
                    <button
                        onClick={fetchHistory}
                        className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-full transition-colors"
                        title="Refresh History"
                    >
                        <RefreshCw className="w-5 h-5" />
                    </button>
                    <button
                        onClick={handleClear}
                        className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-full transition-colors"
                        title="Clear Chat"
                    >
                        <Trash2 className="w-5 h-5" />
                    </button>
                </div>
            </div>

            {/* Messages Area */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-gray-50/50">
                {errorMessage && (
                    <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded-md text-sm">
                        {errorMessage}
                    </div>
                )}
                {loading ? (
                    <div className="flex items-center justify-center h-full text-gray-400">
                        <Loader2 className="w-8 h-8 animate-spin" />
                    </div>
                ) : messages.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full text-gray-400">
                        <Bot className="w-16 h-16 mb-4 opacity-20" />
                        <p>No messages yet. Start the conversation!</p>
                    </div>
                ) : (
                    messages.map((msg, index) => (
                        <div
                            key={index}
                            className={`flex gap-3 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                        >
                            {msg.role === 'assistant' && (
                                <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 flex-shrink-0 mt-1">
                                    <Bot className="w-5 h-5" />
                                </div>
                            )}
                            {msg.role === 'error' && (
                                <div className="w-8 h-8 rounded-full bg-red-100 flex items-center justify-center text-red-600 flex-shrink-0 mt-1">
                                    <Bot className="w-5 h-5" />
                                </div>
                            )}

                            <div
                                className={`max-w-[70%] p-3 rounded-lg shadow-sm text-sm ${msg.role === 'user'
                                    ? 'bg-blue-600 text-white rounded-tr-none whitespace-pre-wrap'
                                    : msg.role === 'error'
                                        ? 'bg-red-50 text-red-700 border border-red-200 rounded-tl-none'
                                        : 'bg-white text-gray-800 border border-gray-100 rounded-tl-none'
                                    }`}
                            >
                                {msg.role === 'assistant' ? (
                                    <ReactMarkdown
                                        remarkPlugins={[remarkGfm]}
                                        components={{
                                            h1: ({ children }) => <h1 className="text-lg font-bold mb-2 mt-1">{children}</h1>,
                                            h2: ({ children }) => <h2 className="text-base font-bold mb-2 mt-1">{children}</h2>,
                                            h3: ({ children }) => <h3 className="text-sm font-bold mb-1 mt-1">{children}</h3>,
                                            p: ({ children }) => <p className="mb-2 last:mb-0 leading-relaxed">{children}</p>,
                                            ul: ({ children }) => <ul className="list-disc ml-4 mb-2 space-y-1">{children}</ul>,
                                            ol: ({ children }) => <ol className="list-decimal ml-4 mb-2 space-y-1">{children}</ol>,
                                            li: ({ children }) => <li className="leading-relaxed">{children}</li>,
                                            strong: ({ children }) => <strong className="font-bold">{children}</strong>,
                                            em: ({ children }) => <em className="italic">{children}</em>,
                                            code: ({ inline, className, children }) => inline
                                                ? <code className="bg-gray-100 text-red-600 px-1.5 py-0.5 rounded text-xs font-mono">{children}</code>
                                                : <code className="block bg-gray-900 text-green-400 p-3 rounded-lg text-xs font-mono overflow-x-auto my-2 whitespace-pre">{children}</code>,
                                            pre: ({ children }) => <pre className="my-2">{children}</pre>,
                                            a: ({ href, children }) => <a href={href} target="_blank" rel="noopener noreferrer" className="text-blue-600 underline hover:text-blue-800">{children}</a>,
                                            blockquote: ({ children }) => <blockquote className="border-l-4 border-blue-300 pl-3 my-2 italic text-gray-600">{children}</blockquote>,
                                            table: ({ children }) => <div className="overflow-x-auto my-2"><table className="min-w-full border border-gray-200 text-xs">{children}</table></div>,
                                            th: ({ children }) => <th className="border border-gray-200 px-2 py-1 bg-gray-50 font-bold text-left">{children}</th>,
                                            td: ({ children }) => <td className="border border-gray-200 px-2 py-1">{children}</td>,
                                        }}
                                    >
                                        {msg.content}
                                    </ReactMarkdown>
                                ) : (
                                    msg.content
                                )}
                            </div>

                            {msg.role === 'user' && (
                                <div className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center text-gray-600 flex-shrink-0 mt-1">
                                    <User className="w-5 h-5" />
                                </div>
                            )}
                        </div>
                    ))
                )}
                {sending && (
                    <div className="flex justify-start gap-3">
                        <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 flex-shrink-0 mt-1">
                            <Bot className="w-5 h-5" />
                        </div>
                        <div className="bg-white p-3 rounded-lg rounded-tl-none border border-gray-100 shadow-sm flex items-center gap-1">
                            <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"></span>
                            <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce delay-75"></span>
                            <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce delay-150"></span>
                        </div>
                    </div>
                )}
                <div ref={messagesEndRef} />
            </div>

            {/* Input Area */}
            <form onSubmit={handleSend} className="p-4 bg-white border-t border-gray-100">
                <div className="flex gap-2">
                    <input
                        type="text"
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        placeholder="Type your message..."
                        className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
                        disabled={sending}
                    />
                    <button
                        type="submit"
                        disabled={!input.trim() || sending}
                        className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
                    >
                        <Send className="w-4 h-4" />
                        <span className="hidden sm:inline">Send</span>
                    </button>
                </div>
            </form>
        </div>
    );
};

export default Chat;
