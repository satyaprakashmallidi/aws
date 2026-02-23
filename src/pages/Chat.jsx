import React, { useEffect, useRef, useState } from 'react';
import { apiUrl } from '../lib/apiBase';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Send, Bot, User, Loader2, RefreshCw, ChevronDown, Plus, Wrench } from 'lucide-react';

const FOCUS_RING = 'focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2';

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
        return content.map((part) => normalizeContent(part)).join('');
    }
    if (typeof content === 'object') {
        // Common structured content shapes
        if (typeof content.text === 'string' || Array.isArray(content.text)) return normalizeContent(content.text);
        if (typeof content.content === 'string' || Array.isArray(content.content)) return normalizeContent(content.content);
        if (typeof content.value === 'string' || Array.isArray(content.value)) return normalizeContent(content.value);
        if (typeof content.message === 'string' || Array.isArray(content.message)) return normalizeContent(content.message);
        if (typeof content.output === 'string' || Array.isArray(content.output)) return normalizeContent(content.output);
        return JSON.stringify(content, null, 2);
    }
    return String(content);
};

const stripOpenClawTags = (text) => {
    if (!text) return '';
    const s = String(text);
    return s
        .replace(/\uFEFF/g, '')
        .replace(/<\/?(final|analysis|assistant|tool|system)\b[^>]*>/gi, '')
        .trim();
};

const isUntrustedConversationInfo = (text) => {
    const s = (text ?? '').toString().trimStart();
    return s.startsWith('Conversation info (untrusted metadata):');
};

const extractMessageText = (msg) => {
    if (!msg || typeof msg !== 'object') return '';
    return normalizeContent(
        msg.content
        ?? msg.message?.content
        ?? msg.delta?.content
        ?? msg.delta?.text
        ?? msg.text
        ?? msg.output
        ?? msg.result
        ?? msg.payload?.content
        ?? msg.payload?.text
    );
};

const asJsonCodeBlock = (value) => {
    if (value === undefined || value === null) return '';
    if (typeof value === 'string') return value;
    return `\n\n\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\`\n`;
};

const asTextCodeBlock = (value, lang = '') => {
    if (value === undefined || value === null) return '';
    const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
    const safeLang = (lang || '').toString().trim();
    return `\n\n\`\`\`${safeLang}\n${text}\n\`\`\``;
};

const isLikelyJsonText = (text) => {
    const s = (text ?? '').toString().trim();
    return (s.startsWith('{') && s.endsWith('}')) || (s.startsWith('[') && s.endsWith(']'));
};

const coerceIsoTimestamp = (value) => {
    if (!value) return new Date().toISOString();
    if (typeof value === 'string') {
        const d = new Date(value);
        return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
    }
    if (typeof value === 'number') {
        const d = new Date(value);
        return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
    }
    return new Date().toISOString();
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
    const sessionKeyRef = useRef('');
    const [sessions, setSessions] = useState([]);
    const [sessionsLoading, setSessionsLoading] = useState(false);
    const [messages, setMessages] = useState([]);
    const [input, setInput] = useState('');
    const [loading, setLoading] = useState(true);
    const [sending, setSending] = useState(false);
    const [sessionBooting, setSessionBooting] = useState(false);
    const [errorMessage, setErrorMessage] = useState('');
    const messagesEndRef = useRef(null);

    const fetchSessions = async () => {
        setSessionsLoading(true);
        try {
            const response = await fetch(apiUrl('/api/chat?action=sessions&limit=30'));
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

            const normalizeHistoryEntry = (msg) => {
                const role = msg?.role || msg?.message?.role || 'assistant';
                const timestamp = coerceIsoTimestamp(msg?.timestamp || msg?.createdAt || msg?.message?.timestamp);

                const rawContent = msg?.content ?? msg?.message?.content;
                const parts = Array.isArray(rawContent) ? rawContent : (rawContent ? [rawContent] : []);

                // Tool results often come as role=toolResult with toolName/toolCallId.
                if (role === 'tool' || role === 'toolResult' || role === 'tool_result') {
                    const name = msg?.toolName || msg?.name || msg?.tool?.name || 'tool';
                    const body = msg?.content ?? msg?.message?.content ?? msg?.details ?? msg?.output ?? msg?.result ?? '';
                    const bodyText = normalizeContent(body);
                    const block = isLikelyJsonText(bodyText) ? asTextCodeBlock(bodyText, 'json') : asTextCodeBlock(bodyText);
                    const content = stripOpenClawTags(`**Tool result:** ${name}${block}`).trim();
                    if (!content) return [];
                    return [{ role: 'tool', content, timestamp }];
                }

                const textChunks = [];
                const toolCalls = [];

                for (const part of parts) {
                    if (part === undefined || part === null) continue;
                    if (typeof part === 'string') {
                        textChunks.push(part);
                        continue;
                    }
                    if (typeof part !== 'object') {
                        textChunks.push(String(part));
                        continue;
                    }

                    const t = (part.type || '').toString();

                    if (t === 'text' && part.text) {
                        textChunks.push(part.text);
                        continue;
                    }

                    // Common tool-call shapes (OpenClaw / Anthropic-style)
                    if (t === 'toolCall' || t === 'tool_call' || t === 'tool_use' || t === 'toolUse') {
                        toolCalls.push({
                            id: part.id,
                            name: part.name,
                            arguments: part.arguments ?? part.input
                        });
                        continue;
                    }

                    // Hide model thinking by default to match the native dashboard.
                    if (t === 'thinking' || t === 'reasoning') {
                        continue;
                    }

                    if (part.text) {
                        textChunks.push(part.text);
                        continue;
                    }

                    // Fallback: stringify unknown parts.
                    textChunks.push(normalizeContent(part));
                }

                const contentClean = stripOpenClawTags(textChunks.join(''));
                const toolCallsFromMsg = stripOpenClawTags(extractToolCalls(msg));

                if (isUntrustedConversationInfo(contentClean)) return [];

                const out = [];
                if (contentClean) {
                    out.push({ role: role === 'user' ? 'user' : 'assistant', content: contentClean, timestamp });
                } else if (role === 'user') {
                    out.push({ role: 'user', content: '', timestamp });
                }

                const toolCallMdFromParts = toolCalls.length
                    ? toolCalls.map((call) => {
                        const name = call?.name || call?.id || 'tool';
                        const args = call?.arguments;
                        const argsPretty = args === undefined || args === null
                            ? ''
                            : (typeof args === 'string' ? args : JSON.stringify(args, null, 2));
                        return `**Tool call:** ${name}${argsPretty ? `\n\n\`\`\`json\n${argsPretty}\n\`\`\`` : ''}`;
                    }).join('\n\n')
                    : '';

                const toolMd = [toolCallMdFromParts, toolCallsFromMsg].filter(Boolean).join('\n\n');
                if (toolMd) {
                    out.push({ role: 'tool', content: toolMd, timestamp });
                }

                // If the entry would be an empty non-user message, drop it.
                return out.filter((m) => m.role === 'user' || (m.content && m.content.trim()));
            };

            const normalized = list.flatMap(normalizeHistoryEntry);

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
        setSessionBooting(true);
        setTimeout(() => setSessionBooting(false), 5000);
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
        if (!text || sending || sessionBooting) return;

        setSending(true);
        setErrorMessage('');

        setMessages(prev => ([
            ...prev,
            { role: 'user', content: text, timestamp: new Date().toISOString() }
        ]));
        setInput('');

        try {
            const activeSessionKey = sessionKeyRef.current || sessionKey;
            const response = await fetch(apiUrl('/api/chat'), {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'text/event-stream'
                },
                body: JSON.stringify({
                    message: text,
                    agentId,
                    sessionId: activeSessionKey,
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

            const contentType = (response.headers.get('content-type') || '').toLowerCase();
            const isEventStream = contentType.includes('text/event-stream');

            if (!isEventStream) {
                const rawText = await response.text();
                let data = null;
                try {
                    if (rawText && rawText.trim().startsWith('{')) {
                        data = JSON.parse(rawText);
                    }
                } catch {
                    // ignore
                }
                const choice = data?.choices?.[0];
                const finishReason = choice?.finish_reason || data?.finish_reason;
                const content =
                    choice?.message?.content
                    ?? choice?.delta?.content
                    ?? choice?.delta?.text
                    ?? data?.message?.content
                    ?? data?.content;

                if (content) {
                    const botMessage = {
                        role: 'assistant',
                        content: normalizeContent(content),
                        timestamp: new Date().toISOString()
                    };
                    setMessages(prev => ([...prev, botMessage]));
                } else {
                    const hint = finishReason === 'length'
                        ? 'Token/context limit exceeded. Start a new session or reduce the amount of history/context.'
                        : `No response content received. (content-type: ${contentType || 'unknown'})`;
                    setErrorMessage(hint);
                    setMessages(prev => ([...prev, { role: 'error', content: hint, timestamp: new Date().toISOString() }]));
                }
                return;
            }

            const reader = response.body?.getReader();
            if (!reader) {
                const rawText = await response.text();
                const hint = rawText
                    ? `No response stream received. Response started with: ${rawText.slice(0, 120)}`
                    : 'No response stream received.';
                setErrorMessage(hint);
                setMessages(prev => ([...prev, { role: 'error', content: hint, timestamp: new Date().toISOString() }]));
                return;
            }

            let assistantIndex = null;
            let assistantText = '';
            let finishReason = null;
            const decoder = new TextDecoder('utf-8');
            let buffer = '';

            let toolIndex = null;
            const toolCallsByKey = new Map();

            const renderToolCallsMarkdown = () => {
                const calls = Array.from(toolCallsByKey.values());
                if (calls.length === 0) return '';
                return calls.map((call) => {
                    const fn = call?.function || {};
                    const name = fn?.name || call?.name || call?.tool || call?.id || 'tool';
                    const args = fn?.arguments ?? call?.arguments;
                    const argsText = (args === undefined || args === null) ? '' : String(args);
                    const argsBlock = argsText ? `\n\n\`\`\`json\n${argsText}\n\`\`\`` : '';
                    return `**Tool call:** ${name}${argsBlock}`;
                }).join('\n\n');
            };

            const ensureToolMessage = () => {
                if (toolIndex !== null) return;
                setMessages(prev => {
                    const next = [...prev, { role: 'tool', content: '', timestamp: new Date().toISOString() }];
                    toolIndex = next.length - 1;
                    return next;
                });
            };

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
                    if (!trimmed) continue;

                    let dataStr = null;
                    if (trimmed.startsWith('data:')) {
                        dataStr = trimmed.replace(/^data:\s*/, '');
                    } else if (trimmed === '[DONE]') {
                        break;
                    } else if (trimmed.startsWith('{')) {
                        // Some gateways stream JSONL instead of SSE data: lines.
                        dataStr = trimmed;
                    } else {
                        continue;
                    }

                    if (!dataStr) continue;
                    if (dataStr === '[DONE]') break;
                    try {
                        const payload = JSON.parse(dataStr);
                        if (payload?.error) {
                            const raw = payload.error?.message || JSON.stringify(payload.error);
                            throw new Error(toFriendlyChatError(raw));
                        }
                        const fr = payload?.choices?.[0]?.finish_reason;
                        if (fr) finishReason = fr;

                        const toolDelta = payload?.choices?.[0]?.delta?.tool_calls
                            ?? payload?.choices?.[0]?.message?.tool_calls
                            ?? payload?.tool_calls
                            ?? null;

                        if (Array.isArray(toolDelta) && toolDelta.length > 0) {
                            for (const item of toolDelta) {
                                const key = item?.id ?? item?.index ?? JSON.stringify(item);
                                const existing = toolCallsByKey.get(key) || { ...item };

                                const nextFn = item?.function || {};
                                const prevFn = existing.function || {};
                                const nextArgs = nextFn.arguments;
                                const prevArgs = prevFn.arguments;

                                existing.type = item?.type ?? existing.type;
                                existing.id = item?.id ?? existing.id;
                                existing.function = {
                                    ...prevFn,
                                    ...nextFn,
                                    arguments: (prevArgs || '') + (nextArgs || '')
                                };

                                toolCallsByKey.set(key, existing);
                            }

                            ensureToolMessage();
                            const md = renderToolCallsMarkdown();
                            setMessages(prev => {
                                const next = [...prev];
                                if (toolIndex !== null && next[toolIndex]) {
                                    next[toolIndex] = { ...next[toolIndex], content: md };
                                }
                                return next;
                            });
                        }

                        const delta = payload?.choices?.[0]?.delta?.content
                            ?? payload?.choices?.[0]?.delta?.text
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
                                content: stripOpenClawTags((current?.content || '') + normalizeContent(delta))
                            };
                            return next;
                        });
                    } catch (e) {
                        // Ignore non-JSON SSE lines
                    }
                }
            }

            const finalText = stripOpenClawTags(assistantText);
            if (!finalText.trim() && toolCallsByKey.size === 0) {
                const hint = finishReason === 'length'
                    ? 'Token/context limit exceeded. Start a new session or reduce the amount of history/context.'
                    : 'No response content received.';
                setErrorMessage(hint);
                setMessages(prev => ([...prev, { role: 'error', content: hint, timestamp: new Date().toISOString() }]));
            } else if (assistantIndex !== null) {
                setMessages(prev => {
                    const next = [...prev];
                    const current = next[assistantIndex];
                    next[assistantIndex] = { ...current, content: finalText };
                    return next;
                });
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
        sessionKeyRef.current = sessionKey;
    }, [sessionKey]);

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages, sending]);

    return (
        <div className="flex min-h-[calc(100dvh-10rem)] flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            {/* Chat Header */}
            <div className="p-4 border-b border-gray-100 flex justify-between items-center bg-gray-50">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center text-blue-600">
                        <Bot className="w-6 h-6" aria-hidden="true" />
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
                            name="session"
                            aria-label="Session"
                            className={`min-w-[220px] appearance-none rounded-lg border border-gray-200 bg-white px-3 py-2 pr-9 text-sm font-medium text-gray-700 shadow-sm ${FOCUS_RING}`}
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
                        <ChevronDown className="w-4 h-4 text-gray-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" aria-hidden="true" />
                    </div>
                    <button
                        type="button"
                        onClick={createNewSession}
                        disabled={sending || sessionBooting}
                        className={`rounded-full p-2 text-gray-500 transition-colors hover:bg-blue-50 hover:text-blue-700 disabled:opacity-50 ${FOCUS_RING}`}
                        aria-label="New session"
                    >
                        <Plus className="w-5 h-5" aria-hidden="true" />
                    </button>
                    <button
                        type="button"
                        onClick={() => fetchHistory(sessionKey)}
                        disabled={sending || sessionBooting}
                        className={`rounded-full p-2 text-gray-500 transition-colors hover:bg-blue-50 hover:text-blue-700 disabled:opacity-50 ${FOCUS_RING}`}
                        aria-label="Refresh history"
                    >
                        <RefreshCw className="w-5 h-5" aria-hidden="true" />
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
                {sessionBooting && (
                    <div className="bg-blue-50 border border-blue-200 text-blue-800 px-3 py-2 rounded-md text-sm flex items-center gap-2">
                        <Loader2 className="w-4 h-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                        Setting up a new session… please wait a few seconds.
                    </div>
                )}
                {loading ? (
                    <div className="flex items-center justify-center h-full text-gray-400">
                        <Loader2 className="w-8 h-8 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                    </div>
                ) : messages.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full text-gray-400">
                        <Bot className="w-16 h-16 mb-4 opacity-20" aria-hidden="true" />
                        <p>No messages yet. Start the conversation!</p>
                    </div>
                ) : (
                    messages.map((msg, index) => (
                        <div
                            key={index}
                            className={`flex min-w-0 gap-3 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                        >
                            {msg.role === 'assistant' && (
                                <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 flex-shrink-0 mt-1">
                                    <Bot className="w-5 h-5" aria-hidden="true" />
                                </div>
                            )}
                            {msg.role === 'tool' && (
                                <div className="w-8 h-8 rounded-full bg-slate-200 flex items-center justify-center text-slate-700 flex-shrink-0 mt-1">
                                    <Wrench className="w-5 h-5" aria-hidden="true" />
                                </div>
                            )}
                            {msg.role === 'error' && (
                                <div className="w-8 h-8 rounded-full bg-red-100 flex items-center justify-center text-red-600 flex-shrink-0 mt-1">
                                    <Bot className="w-5 h-5" aria-hidden="true" />
                                </div>
                            )}

                            <div
                                className={`min-w-0 max-w-[70%] p-3 rounded-lg shadow-sm text-sm ${msg.role === 'user'
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
                                    <User className="w-5 h-5" aria-hidden="true" />
                                </div>
                            )}
                        </div>
                    ))
                )}
                {sending && (
                    <div className="flex justify-start gap-3">
                        <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 flex-shrink-0 mt-1">
                            <Bot className="w-5 h-5" aria-hidden="true" />
                        </div>
                        <div className="bg-white p-3 rounded-lg rounded-tl-none border border-gray-100 shadow-sm flex items-center gap-1">
                            <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce motion-reduce:animate-none"></span>
                            <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce delay-75 motion-reduce:animate-none"></span>
                            <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce delay-150 motion-reduce:animate-none"></span>
                        </div>
                    </div>
                )}
                <div ref={messagesEndRef} />
            </div>

            {/* Input Area */}
            <form onSubmit={handleSend} className="p-4 bg-white border-t border-gray-100">
                <div className="flex gap-2">
                    <label htmlFor="chat-message" className="sr-only">Message</label>
                    <input
                        id="chat-message"
                        name="message"
                        type="text"
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        autoComplete="off"
                        placeholder="Type your message…"
                        className={`flex-1 rounded-lg border border-gray-300 px-4 py-2 shadow-sm transition-colors ${FOCUS_RING}`}
                        disabled={sending || sessionBooting}
                    />
                    <button
                        type="submit"
                        disabled={!input.trim() || sending || sessionBooting}
                        className={`flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 font-semibold text-white shadow-sm transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS_RING}`}
                    >
                        <Send className="w-4 h-4" aria-hidden="true" />
                        <span className="hidden sm:inline">Send</span>
                    </button>
                </div>
            </form>
        </div>
    );
};

export default Chat;
