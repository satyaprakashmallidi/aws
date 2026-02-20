import React, { useEffect, useRef, useState } from 'react';
import { apiUrl } from '../lib/apiBase';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Send, Bot, User, Loader2, RefreshCw, ChevronDown, Plus, Wrench } from 'lucide-react';

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

const createSessionKey = (agentId) => {
    const uuid = (typeof crypto !== 'undefined' && crypto.randomUUID)
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    return `agent:${agentId}:${uuid}`;
};

const normalizeContent = (content) => {
    if (content === undefined || content === null) return '';
    if (Array.isArray(content)) {
        return content.map((part) => {
            if (typeof part === 'string') return part;
            if (part?.text) return part.text;
            if (part?.content) return part.content;
            return '';
        }).join('');
    }
    if (typeof content === 'object') return JSON.stringify(content, null, 2);
    return String(content);
};

const asJsonCodeBlock = (value) => {
    if (value === undefined || value === null) return '';
    if (typeof value === 'string') return value;
    return `\n\n\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\`\n`;
};

const extractToolCalls = (msg) => {
    const raw = msg?.tool_calls || msg?.toolCalls || msg?.toolCallsV1 || [];
    if (!Array.isArray(raw) || raw.length === 0) return '';

    return raw.map((call) => {
        const fn = call?.function || call?.fn || {};
        const name = fn?.name || call?.name || call?.tool || call?.id || 'tool';
        const args = fn?.arguments ?? call?.arguments;
        const argsPretty = (() => {
            if (args === undefined || args === null || args === '') return '';
            if (typeof args === 'string') return args;
            return JSON.stringify(args, null, 2);
        })();
        return `**Tool call:** ${name}${argsPretty ? `\n\n\`\`\`json\n${argsPretty}\n\`\`\`` : ''}`;
    }).join('\n\n');
};

const toFriendlyChatError = (raw) => {
    const text = (raw ?? '').toString();
    const lower = text.toLowerCase();

    if (
        lower.includes('context_length_exceeded')
        || lower.includes('maximum context')
        || lower.includes('context length')
        || lower.includes('too many tokens')
        || lower.includes('token limit')
        || lower.includes('request too large')
    ) {
        return 'Token/context limit exceeded. Start a new session or reduce the amount of history/context.';
    }

    if (lower.includes('rate limit') || lower.includes('too many requests') || lower.includes('429')) {
        return 'Rate limit hit. Please wait a moment and try again.';
    }

    if (lower.includes('insufficient_quota') || lower.includes('quota')) {
        return 'Quota exceeded for this provider/model.';
    }

    return text || 'Request failed. Please try again.';
};

const getSessionKeyValue = (session) => session?.sessionKey || session?.key || session?.id || '';

const shortenSessionKey = (key) => {
    if (!key) return '';
    const parts = String(key).split(':');
    if (parts.length >= 3) {
        const suffix = parts[2].slice(0, 8);
        return `${parts[0]}:${parts[1]}:${suffix}`;
    }
    return String(key).slice(0, 20);
};

const formatSessionLabel = (session) => {
    const key = getSessionKeyValue(session);
    const shortKey = shortenSessionKey(key) || 'session';
    const kind = session?.kind ? `${session.kind} · ` : '';
    const model = session?.model ? ` · ${session.model}` : '';
    return `${kind}${shortKey}${model}`;
};

const Chat = () => {
    const agentId = 'main';
    const [sessionKey, setSessionKey] = useState('');
    const [sessions, setSessions] = useState([]);
    const [sessionsLoading, setSessionsLoading] = useState(false);
    const [messages, setMessages] = useState([]);
    const [input, setInput] = useState('');
    const [loading, setLoading] = useState(true);
    const [sending, setSending] = useState(false);
    const [errorMessage, setErrorMessage] = useState('');
    const messagesEndRef = useRef(null);

    const fetchSessions = async () => {
        setSessionsLoading(true);
        try {
            const response = await fetch(apiUrl('/api/chat?action=sessions'));
            if (!response.ok) throw new Error('Failed to load sessions');
            const data = await response.json();
            const list = Array.isArray(data.sessions) ? data.sessions : [];
            setSessions(list);
        } catch (error) {
            console.error('Failed to fetch sessions:', error);
        } finally {
            setSessionsLoading(false);
        }
    };

    const fetchHistory = async (targetKey) => {
        if (!targetKey) return;
        setLoading(true);
        setErrorMessage('');
        try {
            const url = apiUrl(`/api/chat?action=history&sessionKey=${encodeURIComponent(targetKey)}&limit=100&includeTools=true`);
            const response = await fetch(url);
            if (!response.ok) throw new Error('Failed to load chat history');
            const data = await response.json();
            const list = Array.isArray(data.messages) ? data.messages : [];

            const normalized = list.map((msg) => {
                const role = msg?.role || 'assistant';
                const timestamp = msg?.timestamp || msg?.createdAt || new Date().toISOString();

                if (role === 'tool') {
                    const name = msg?.name || msg?.tool?.name || msg?.toolName || 'tool';
                    const body = msg?.content ?? msg?.output ?? msg?.result ?? '';
                    const content = `**Tool:** ${name}${asJsonCodeBlock(body) || `\n\n${normalizeContent(body)}`}`.trim();
                    return { role: 'tool', content, timestamp };
                }

                const contentText = normalizeContent(msg?.content);
                const toolCallsText = extractToolCalls(msg);

                // OpenAI-style tool calling: assistant message may have empty content but tool_calls populated.
                if (!contentText && toolCallsText) {
                    return { role: 'tool', content: toolCallsText, timestamp };
                }

                if (!contentText) {
                    return { role: role === 'user' ? 'user' : 'assistant', content: '(empty message)', timestamp };
                }

                return {
                    role: role === 'user' ? 'user' : 'assistant',
                    content: contentText,
                    timestamp
                };
            });
            setMessages(normalized);
        } catch (error) {
            console.error('Failed to fetch history:', error);
            setErrorMessage(error.message || 'Failed to fetch history');
            setMessages([]);
        } finally {
            setLoading(false);
        }
    };

    const setSessionKeyPersisted = (nextKey) => {
        if (!nextKey || nextKey === sessionKey) return;
        localStorage.setItem(`openclaw.session.${agentId}`, nextKey);
        setSessionKey(nextKey);
        setMessages([]);
        fetchHistory(nextKey);
    };

    const createNewSession = () => {
        const nextKey = createSessionKey(agentId);
        localStorage.setItem(`openclaw.session.${agentId}`, nextKey);
        setSessionKey(nextKey);
        setMessages([]);
        setErrorMessage('');
        fetchSessions();
    };

    const currentSessionLabel = () => {
        const match = sessions.find(s => getSessionKeyValue(s) === sessionKey);
        if (match) return formatSessionLabel(match);
        return shortenSessionKey(sessionKey) || 'Current session';
    };

    const getAllSessionOptions = () => {
        const options = sessions
            .map(session => ({
                value: getSessionKeyValue(session),
                label: formatSessionLabel(session)
            }))
            .filter(option => option.value);

        const hasCurrent = options.some(option => option.value === sessionKey);
        if (!hasCurrent && sessionKey) {
            options.unshift({ value: sessionKey, label: shortenSessionKey(sessionKey) || 'Current session' });
        }
        return options;
    };

    const handleSend = async (e) => {
        e.preventDefault();
        const text = input.trim();
        if (!text || sending) return;

        setSending(true);
        setErrorMessage('');

        setMessages(prev => ([
            ...prev,
            { role: 'user', content: text, timestamp: new Date().toISOString() }
        ]));
        setInput('');

        try {
            const response = await fetch(apiUrl('/api/chat'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    message: text,
                    agentId,
                    sessionId: sessionKey,
                    stream: true
                })
            });

            if (!response.ok) {
                const errorText = await response.text();
                let parsed = errorText;
                try {
                    if (errorText && errorText.trim().startsWith('{')) {
                        parsed = JSON.parse(errorText);
                    }
                } catch {
                    // ignore
                }
                const rawMessage = parsed?.error?.message || parsed?.message || errorText || `Request failed with status ${response.status}`;
                throw new Error(toFriendlyChatError(rawMessage));
            }

            const reader = response.body?.getReader();
            if (!reader) {
                const data = await response.json();
                const choice = data.choices?.[0];
                const content = choice?.message?.content;
                const finishReason = choice?.finish_reason;
                if (content) {
                    const botMessage = {
                        role: 'assistant',
                        content: normalizeContent(content),
                        timestamp: new Date().toISOString()
                    };
                    setMessages(prev => {
                        const next = [...prev, botMessage];
                        return next;
                    });
                } else {
                    const hint = finishReason === 'length'
                        ? 'Token/context limit exceeded. Start a new session or reduce the amount of history/context.'
                        : 'No response content received.';
                    setErrorMessage(hint);
                    setMessages(prev => ([...prev, { role: 'error', content: hint, timestamp: new Date().toISOString() }]));
                }
                return;
            }

            let assistantIndex = null;
            let assistantText = '';
            let finishReason = null;
            const decoder = new TextDecoder('utf-8');
            let buffer = '';

            const ensureAssistantMessage = () => {
                if (assistantIndex !== null) return;
                setMessages(prev => {
                    const next = [...prev, { role: 'assistant', content: '', timestamp: new Date().toISOString() }];
                    assistantIndex = next.length - 1;
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
                        if (payload?.error) {
                            const raw = payload.error?.message || JSON.stringify(payload.error);
                            throw new Error(toFriendlyChatError(raw));
                        }
                        const fr = payload?.choices?.[0]?.finish_reason;
                        if (fr) finishReason = fr;
                        const delta = payload?.choices?.[0]?.delta?.content
                            ?? payload?.choices?.[0]?.message?.content
                            ?? '';
                        if (!delta) continue;

                        ensureAssistantMessage();
                        assistantText += normalizeContent(delta);
                        setMessages(prev => {
                            const next = [...prev];
                            const current = next[assistantIndex];
                            next[assistantIndex] = {
                                ...current,
                                content: (current?.content || '') + normalizeContent(delta)
                            };
                            return next;
                        });
                    } catch (e) {
                        // Ignore non-JSON SSE lines
                    }
                }
            }

            if (!assistantText.trim()) {
                const hint = finishReason === 'length'
                    ? 'Token/context limit exceeded. Start a new session or reduce the amount of history/context.'
                    : 'No response content received.';
                setErrorMessage(hint);
                setMessages(prev => ([...prev, { role: 'error', content: hint, timestamp: new Date().toISOString() }]));
            }
        } catch (error) {
            console.error('Failed to send message:', error);
            const message = toFriendlyChatError(error?.message);
            setErrorMessage(message);
            setMessages(prev => {
                const next = [...prev, { role: 'error', content: message, timestamp: new Date().toISOString() }];
                return next;
            });
        } finally {
            setSending(false);
        }
    };

    useEffect(() => {
        const key = getOrCreateSessionKey(agentId);
        setSessionKey(key);
        fetchSessions();
        fetchHistory(key);
    }, [agentId]);

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages, sending]);

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
                            {getAllSessionOptions().map((option) => {
                                if (option.value === sessionKey) return null;
                                return (
                                    <option key={option.value} value={option.value}>
                                        {option.label}
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
                        onClick={() => fetchHistory(sessionKey)}
                        className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-full transition-colors"
                        title="Refresh History"
                    >
                        <RefreshCw className="w-5 h-5" />
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
                            {msg.role === 'tool' && (
                                <div className="w-8 h-8 rounded-full bg-slate-200 flex items-center justify-center text-slate-700 flex-shrink-0 mt-1">
                                    <Wrench className="w-5 h-5" />
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
                                        : msg.role === 'tool'
                                            ? 'bg-slate-100 text-slate-800 border border-slate-200 rounded-tl-none'
                                            : 'bg-white text-gray-800 border border-gray-100 rounded-tl-none'
                                    }`}
                            >
                                {msg.role === 'assistant' || msg.role === 'tool' ? (
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
