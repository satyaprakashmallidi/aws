// Simple test endpoint with ZERO dependencies
export default function handler(req, res) {
    console.log('✅ Test endpoint called!');
    return res.status(200).json({
        success: true,
        message: 'API is working!',
        timestamp: new Date().toISOString()
    });
}
