/**
 * OpenClaw WebSocket Client
 * Handles connection, authentication, and request/response correlation.
 */
import { getOrCreateDeviceCredentials, signMessage, saveDeviceToken } from './deviceCrypto.js';

export class OpenClawClient {
    constructor(url, token) {
        this.url = url;
        this.token = token;
        this.ws = null;
        this.requestId = 1;
        this.pendingRequests = new Map();
        this.eventListeners = new Set();
        this.isConnected = false;
        this.connectNonce = null;
        this.deviceCredentials = null;
    }

    async sendConnectRequest(nonce = null) {
        // Ensure we have device credentials
        if (!this.deviceCredentials) {
            this.deviceCredentials = await getOrCreateDeviceCredentials();
        }

        const connectRequest = {
            type: 'req',
            id: 'connect-' + Date.now(),
            method: 'connect',
            params: {
                minProtocol: 3,
                maxProtocol: 3,
                client: {
                    id: 'webchat-ui',
                    version: '1.0.0',
                    platform: navigator.platform || 'web',
                    mode: 'webchat'
                },
                role: 'operator',
                scopes: ['operator.admin'],
                auth: {
                    token: this.token
                },
                caps: [],
                userAgent: navigator.userAgent
            }
        };

        // Only send device object if we have a nonce (after challenge)
        // Gateway schema requires signature and signedAt if device object exists
        if (nonce) {
            const signedAt = Date.now();

            // Build signature payload
            const signaturePayload = [
                'v2',
                this.deviceCredentials.deviceId,
                'webchat-ui',
                'webchat',
                'operator',
                'operator.admin',
                String(signedAt),
                this.token || '',
                nonce
            ].join('|');

            // Sign with Ed25519
            const signature = await signMessage(this.deviceCredentials.privateKey, signaturePayload);

            // Add complete device object with all required fields
            connectRequest.params.device = {
                id: this.deviceCredentials.deviceId,
                publicKey: this.deviceCredentials.publicKey,
                signature: signature,
                signedAt: signedAt,
                nonce: nonce,
                // Include deviceToken if we have one (proves device is already approved)
                token: this.deviceCredentials.deviceToken || undefined
            };
        }

        this.ws.send(JSON.stringify(connectRequest));
    }

    connect() {
        if (this.ws && (this.ws.readyState === WebSocket.CONNECTING || this.ws.readyState === WebSocket.OPEN)) {
            return Promise.resolve(this);
        }

        return new Promise((resolve, reject) => {
            this.ws = new WebSocket(this.url);

            this.ws.onopen = () => {
                console.log('🔌 WebSocket opened - waiting for challenge...');
                // DO NOT send connect request here!
                // Wait for the server to send us a challenge first
            };

            this.ws.onmessage = (event) => {
                const msg = JSON.parse(event.data);
                this.handleMessage(msg, resolve); // Pass resolve to helper
            };

            this.ws.onerror = (err) => {
                console.error('OpenClaw: Connection Error', err);
                if (!this.isConnected) reject(err);
            };

            this.ws.onclose = (event) => {
                this.isConnected = false;
                this.ws = null;
            };
        });
    }

    async handleMessage(msg, connectResolve) {
        console.log('📨 Received message:', msg);

        // 1. Handle RPC Responses (type: "res")
        if (msg.type === 'res') {
            if (msg.id && msg.id.startsWith('connect-')) {
                if (msg.ok) {
                    console.log('✅ Connect successful!');
                    this.isConnected = true;

                    // Save deviceToken if provided (proves this device is approved)
                    if (msg.payload?.deviceToken) {
                        await saveDeviceToken(msg.payload.deviceToken);
                        // Update local credentials
                        if (this.deviceCredentials) {
                            this.deviceCredentials.deviceToken = msg.payload.deviceToken;
                        }
                    }

                    // Resolve the initial connect() promise here
                    if (connectResolve) connectResolve(this);
                } else {
                    console.error('❌ Connect RPC failed:', msg.error);
                }
                return;
            }
            // Handle other RPC responses
            if (msg.id && this.pendingRequests.has(msg.id)) {
                console.log('📥 RPC Response for:', msg.id, '→', msg);
                const { resolve, reject } = this.pendingRequests.get(msg.id);
                if (msg.error) {
                    reject(msg.error);
                } else {
                    // OpenClaw uses 'payload' field, not 'result'
                    resolve(msg.payload);
                }
                this.pendingRequests.delete(msg.id);
                return;
            }
        }

        // 2. Handle Authentication Challenge - respond with signed connect request
        if (msg.type === 'event' && msg.event === 'connect.challenge') {
            console.log('🔐 Challenge received with nonce:', msg.payload.nonce);
            // Save nonce and send connect request WITH Ed25519 signature
            this.connectNonce = msg.payload.nonce;
            this.sendConnectRequest(this.connectNonce);
            // Don't resolve here yet - waiting for result of the connect request
            return;
        }

        // 3. Handle Auth Success Event
        if (msg.type === 'event' && msg.event === 'connect.success') {
            this.isConnected = true;
            if (connectResolve) connectResolve(this);
            return;
        }

        // 4. Handle auth errors
        if (msg.type === 'event' && msg.event === 'connect.error') {
            console.error('❌ Auth Error:', msg);
            if (connectResolve) connectResolve(this);
            return;
        }

        // 5. Handle Events
        if (msg.type === 'event') {
            this.eventListeners.forEach(listener => listener(msg));
        }
    }

    // Send RPC request
    async send(method, params = {}) {
        return new Promise((resolve, reject) => {
            const id = `${method}-${this.requestId++}`;

            const request = {
                type: 'req',
                id,
                method,
                params
            };

            this.pendingRequests.set(id, { resolve, reject });


            this.ws.send(JSON.stringify(request));

            // Timeout after 30 seconds
            setTimeout(() => {
                if (this.pendingRequests.has(id)) {
                    this.pendingRequests.delete(id);
                    reject(new Error('Request timeout'));
                }
            }, 30000);
        });
    }

    // Subscribe to events
    on(callback) {
        this.eventListeners.add(callback);
        return () => this.eventListeners.delete(callback);
    }

    disconnect() {
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
    }
}
