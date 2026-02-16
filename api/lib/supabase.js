let supabaseModule = null;
let supabaseClient = null;
let supabaseAdminClient = null;

async function getSupabaseModule() {
    if (!supabaseModule) {
        try {
            supabaseModule = await import('@supabase/supabase-js');
        } catch (error) {
            throw new Error('Supabase package not found. Run: npm install @supabase/supabase-js');
        }
    }
    return supabaseModule;
}

// Client for browser (public operations)
export async function getSupabase() {
    if (!supabaseClient) {
        const { createClient } = await getSupabaseModule();
        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL;
        const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;

        if (!supabaseUrl || !supabaseAnonKey) {
            throw new Error('Missing Supabase URL or Anon Key in environment variables');
        }

        supabaseClient = createClient(supabaseUrl, supabaseAnonKey);
    }
    return supabaseClient;
}

// Client for server (admin operations)
export async function getSupabaseAdmin() {
    if (!supabaseAdminClient) {
        const { createClient } = await getSupabaseModule();
        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL;
        const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

        if (!supabaseUrl || !supabaseServiceKey) {
            throw new Error('Missing Supabase URL or Service Role Key in environment variables');
        }

        supabaseAdminClient = createClient(supabaseUrl, supabaseServiceKey);
    }
    return supabaseAdminClient;
}

// Helper to get user from request
export async function getUserFromRequest(req) {
    const token = req.headers.authorization?.replace('Bearer ', '');

    if (!token) {
        return { user: null, error: 'No authorization token' };
    }

    const supabase = await getSupabase();
    const { data: { user }, error } = await supabase.auth.getUser(token);

    return { user, error };
}

// Legacy exports for backward compatibility
export const supabase = {
    get: getSupabase
};

export const supabaseAdmin = {
    get: getSupabaseAdmin
};
