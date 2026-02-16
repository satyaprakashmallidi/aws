import React, { useState } from 'react';

const OpenClawDashboard = () => {
    const [isLoading, setIsLoading] = useState(true);

    const handleIframeLoad = () => {
        setIsLoading(false);
    };

    return (
        <div className="openclaw-container w-full max-w-7xl mx-auto p-4 sm:p-6 lg:p-8">
            {/* Header */}
            <div className="mb-6">
                <h1 className="text-3xl font-bold text-gray-900 mb-2">
                    OpenClaw Automation
                </h1>
                <p className="text-gray-600">
                    Access your browser automation workflows securely via Cloudflare Tunnel
                </p>
            </div>

            {/* Iframe Container */}
            <div className="relative bg-white rounded-lg shadow-xl overflow-hidden border border-gray-200" style={{ minHeight: '800px' }}>
                {/* Loading Overlay */}
                {isLoading && (
                    <div className="absolute inset-0 flex items-center justify-center bg-gray-50 z-10">
                        <div className="text-center">
                            <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mb-4"></div>
                            <p className="text-gray-600 font-medium">Connecting to OpenClaw Gateway...</p>
                        </div>
                    </div>
                )}

                {/* Iframe */}
                <iframe
                    src="https://automation.magicteams.ai"
                    title="OpenClaw Dashboard"
                    onLoad={handleIframeLoad}
                    className="w-full h-full absolute inset-0 border-none"
                    allow="clipboard-read; clipboard-write; camera; microphone"
                    sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-downloads allow-modals"
                />
            </div>

            {/* Footer Info */}
            <div className="mt-4 flex justify-between items-center text-sm text-gray-500">
                <div>
                    🔒 Connection Secured via Cloudflare Tunnel
                </div>
                <div>
                    Gateway: <a href="https://automation.magicteams.ai" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">automation.magicteams.ai</a>
                </div>
            </div>
        </div>
    );
};

export default OpenClawDashboard;
