/**
 * Device Cryptographic Authentication for OpenClaw Gateway
 * Uses Ed25519 signatures as required by the gateway
 */
import * as ed25519 from '@noble/ed25519';

const DEVICE_KEY_STORAGE = 'openclaw_device_credentials';

/**
 * Generate a new Ed25519 device key pair and store in localStorage
 * @returns {Promise<{deviceId: string, publicKey: string, privateKey: Uint8Array}>}
 */
export async function generateDeviceCredentials() {
    // Generate Ed25519 key pair (32 random bytes for private key)
    const privateKey = crypto.getRandomValues(new Uint8Array(32));  // Use Web Crypto API
    const publicKey = await ed25519.getPublicKeyAsync(privateKey);  // Use async version

    // Calculate deviceId as SHA-256 hash of public key (hex)
    const deviceId = await sha256Hex(publicKey);

    // Convert to base64url for storage and transmission
    const publicKeyB64 = bytesToBase64url(publicKey);
    const privateKeyB64 = bytesToBase64url(privateKey);

    // Store credentials in localStorage
    const credentials = {
        deviceId,
        publicKeyB64,
        privateKeyB64,
        deviceToken: null,  // Will be set after approval
        createdAt: Date.now()
    };

    localStorage.setItem(DEVICE_KEY_STORAGE, JSON.stringify(credentials));



    return {
        deviceId,
        publicKey: publicKeyB64,  // base64url string of raw 32 bytes
        privateKey  // Uint8Array
    };
}

/**
 * Load existing device credentials from localStorage
 * @returns {Promise<{deviceId: string, publicKey: string, privateKey: Uint8Array} | null>}
 */
export async function loadDeviceCredentials() {
    const stored = localStorage.getItem(DEVICE_KEY_STORAGE);
    if (!stored) {
        return null;
    }

    try {
        const credentials = JSON.parse(stored);

        // Convert from base64url back to Uint8Array
        const privateKey = base64urlToBytes(credentials.privateKeyB64);

        return {
            deviceId: credentials.deviceId,
            publicKey: credentials.publicKeyB64,  // Already base64url string
            privateKey,  // Uint8Array
            deviceToken: credentials.deviceToken || null
        };
    } catch (err) {
        console.error('Failed to load device credentials:', err);
        return null;
    }
}

/**
 * Get or create device credentials
 * @returns {Promise<{deviceId: string, publicKey: string, privateKey: Uint8Array}>}
 */
export async function getOrCreateDeviceCredentials() {
    const existing = await loadDeviceCredentials();
    if (existing) {
        return existing;
    }


    return await generateDeviceCredentials();
}

/**
 * Sign a message with Ed25519 private key
 * @param {Uint8Array} privateKey 
 * @param {string} message 
 * @returns {Promise<string>} Base64url-encoded signature
 */
export async function signMessage(privateKey, message) {
    const messageBytes = new TextEncoder().encode(message);
    const signature = await ed25519.signAsync(messageBytes, privateKey);  // Use async version
    return bytesToBase64url(signature);
}

/**
 * Calculate SHA-256 hash and return as hex string
 * @param {Uint8Array} data 
 * @returns {Promise<string>}
 */
async function sha256Hex(data) {
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Convert Uint8Array to base64url string
 * @param {Uint8Array} bytes 
 * @returns {string}
 */
function bytesToBase64url(bytes) {
    const base64 = btoa(String.fromCharCode(...bytes));
    // Convert base64 to base64url
    return base64
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=/g, '');
}

/**
 * Convert base64url string to Uint8Array
 * @param {string} base64url 
 * @returns {Uint8Array}
 */
function base64urlToBytes(base64url) {
    // Convert base64url to base64
    let base64 = base64url
        .replace(/-/g, '+')
        .replace(/_/g, '/');

    // Add padding if needed
    while (base64.length % 4) {
        base64 += '=';
    }

    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
}

/**
 * Clear device credentials (for logout/reset)
 */
export function clearDeviceCredentials() {
    localStorage.removeItem(DEVICE_KEY_STORAGE);

}

/**
 * Save deviceToken after successful authentication
 * @param {string} deviceToken 
 */
export async function saveDeviceToken(deviceToken) {
    const stored = localStorage.getItem(DEVICE_KEY_STORAGE);
    if (!stored) {
        console.error('Cannot save deviceToken: No device credentials found');
        return;
    }

    try {
        const credentials = JSON.parse(stored);
        credentials.deviceToken = deviceToken;
        credentials.lastAuthenticated = Date.now();
        localStorage.setItem(DEVICE_KEY_STORAGE, JSON.stringify(credentials));
        console.log('✅ DeviceToken saved successfully');
    } catch (error) {
        console.error('Failed to save deviceToken:', error);
    }
}
