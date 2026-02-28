-- =============================================
-- OpenClaw UI - Supabase Database Schema
-- =============================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =============================================
-- SESSIONS TABLE
-- =============================================
CREATE TABLE sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    agent_id TEXT NOT NULL DEFAULT 'main',
    session_key TEXT UNIQUE NOT NULL,
    title TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Index for faster queries
CREATE INDEX idx_sessions_user_id ON sessions(user_id);
CREATE INDEX idx_sessions_updated_at ON sessions(updated_at DESC);

-- Row Level Security
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own sessions"
    ON sessions FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own sessions"
    ON sessions FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own sessions"
    ON sessions FOR UPDATE
    USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own sessions"
    ON sessions FOR DELETE
    USING (auth.uid() = user_id);

-- =============================================
-- MESSAGES TABLE
-- =============================================
CREATE TABLE messages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_id UUID REFERENCES sessions(id) ON DELETE CASCADE NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
    content TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Index for faster queries
CREATE INDEX idx_messages_session_id ON messages(session_id);
CREATE INDEX idx_messages_created_at ON messages(created_at);

-- Row Level Security
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view messages from their sessions"
    ON messages FOR SELECT
    USING (
        session_id IN (
            SELECT id FROM sessions WHERE user_id = auth.uid()
        )
    );

CREATE POLICY "Users can insert messages to their sessions"
    ON messages FOR INSERT
    WITH CHECK (
        session_id IN (
            SELECT id FROM sessions WHERE user_id = auth.uid()
        )
    );

-- =============================================
-- FUNCTIONS
-- =============================================

-- Auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_sessions_updated_at
    BEFORE UPDATE ON sessions
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ─────────────────────────────────────────────────────────────────────────
-- Existing tables (sessions, messages, user_profiles) remain unchanged above
-- ─────────────────────────────────────────────────────────────────────────

-- VPS nodes fleet table
create table if not exists public.vps_nodes (
  id            uuid primary key default gen_random_uuid(),
  contabo_id    bigint unique,                      -- Contabo's numeric instanceId (null if manually added)
  ip_address    text not null,
  host_shard    text not null,                      -- e.g. "h1", "h2"
  base_domain   text not null,                      -- e.g. "magicteams.ai"
  ttyd_secret   text not null,                      -- per-VPS HMAC secret for terminal tokens
  capacity_max  integer not null default 6,
  capacity_used integer not null default 0,
  status        text not null default 'provisioning',
  -- status: provisioning | ready | full | decommissioned
  created_at    timestamptz default now(),
  constraint vps_nodes_shard_domain_unique unique (host_shard, base_domain)
) tablespace pg_default;

-- Augment user_profiles for multi-node support
alter table public.user_profiles
  add column if not exists vps_node_id    uuid references public.vps_nodes(id),
  add column if not exists instance_url   text,       -- https://openclaw-<id>.h1.openclaw.<domain>/
  add column if not exists terminal_url   text,       -- .../terminal?token=...
  add column if not exists provisioned_at timestamptz;

-- ─────────────────────────────────────────────────────────────────────────
-- Atomic slot claim using SELECT FOR UPDATE SKIP LOCKED
-- Called by provisioner.js → supabase.rpc('claim_vps_slot')
-- Returns the claimed vps_nodes row, or NULL if no capacity
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.claim_vps_slot()
returns setof public.vps_nodes
language plpgsql
as $$
declare
  _node public.vps_nodes;
begin
  -- Lock the best available node (most used first = fill before opening new)
  select * into _node
  from public.vps_nodes
  where status = 'ready'
    and capacity_used < capacity_max
  order by capacity_used desc
  limit 1
  for update skip locked;

  if not found then
    return;  -- returns empty set → provisioner knows to spin up a new VPS
  end if;

  -- Increment and mark full if at capacity
  update public.vps_nodes
  set
    capacity_used = capacity_used + 1,
    status = case
      when capacity_used + 1 >= capacity_max then 'full'
      else status
    end
  where id = _node.id
  returning * into _node;

  return next _node;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- Release a claimed slot (called on container creation failure or cancellation)
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.release_vps_slot(node_id uuid)
returns void
language plpgsql
as $$
begin
  update public.vps_nodes
  set
    capacity_used = greatest(0, capacity_used - 1),
    status = case
      when status = 'full' then 'ready'
      else status
    end
  where id = node_id;
end;
$$;

-- RLS: vps_nodes is admin-only (service role), users cannot read it
alter table public.vps_nodes enable row level security;

-- No policies = only service_role can access (RLS blocks anon/authenticated by default)

-- =============================================
-- SAMPLE DATA (Optional - for testing)
-- =============================================
-- Uncomment to insert sample data after creating a test user

-- INSERT INTO sessions (user_id, agent_id, session_key, title)
-- VALUES 
--     (auth.uid(), 'main', 'user:test:1', 'Test Session 1'),
--     (auth.uid(), 'main', 'user:test:2', 'Test Session 2');

-- INSERT INTO messages (session_id, role, content)
-- VALUES
--     ((SELECT id FROM sessions WHERE title = 'Test Session 1' LIMIT 1), 'user', 'Hello!'),
--     ((SELECT id FROM sessions WHERE title = 'Test Session 1' LIMIT 1), 'assistant', 'Hi! How can I help?');

-- =============================================
-- USER PROFILES TABLE (Clerk)
-- =============================================

DO $$ BEGIN
    CREATE TYPE user_operation_status AS ENUM ('onboarded', 'paid', 'provisioning', 'ready', 'suspended');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS user_profiles (
    userid TEXT PRIMARY KEY NOT NULL,
    username TEXT NOT NULL,
    docker_volume_name TEXT,
    docker_container_name TEXT,
    port_number INTEGER,
    gateway_name TEXT,
    gateway_token TEXT,
    local_websocket TEXT,
    operation_status user_operation_status NOT NULL DEFAULT 'onboarded'
);

ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;
