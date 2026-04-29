-- =========================================================================
-- The Brain — baseline schema for skill-driven agent infrastructure
-- Project: cmtkljxuxljwfvvxfowp
-- Date:    2026-04-28
--
-- Tables created:
--   1. agent_messages          (agent-message-bus skill — CANONICAL schema)
--   2. llm_provider_cooldowns  (model-failover-chain skill — CANONICAL schema)
--   3. agent_logs              (tool-loop-detector skill — INFERRED, review fields)
--   4. support_tickets         (tool-loop-detector skill — INFERRED, review fields)
--   5. agent_memories          (agent-memory-systems skill — STARTER, design TBD)
--
-- Apply via either:
--   A) Supabase Studio → SQL Editor → paste this file → Run
--   B) supabase CLI:  supabase link --project-ref cmtkljxuxljwfvvxfowp
--                     supabase db push
--   C) psql:          psql "$SUPABASE_DB_URL" -f 20260428_001_brain_skills_baseline.sql
--
-- RLS is enabled on every table. Only the service_role key has access.
-- The anon key cannot read or write — agents must use SUPABASE_SERVICE_ROLE_KEY.
-- =========================================================================

-- ---------- Extensions ----------
CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS vector;     -- pgvector for agent_memories embeddings


-- =========================================================================
-- 1. agent_messages — schema is verbatim from agent-message-bus skill
-- =========================================================================
CREATE TABLE IF NOT EXISTS agent_messages (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  sender_agent  TEXT NOT NULL,
  target_agent  TEXT NOT NULL,
  message_type  TEXT NOT NULL CHECK (message_type IN ('request', 'response', 'broadcast')),
  in_reply_to   UUID REFERENCES agent_messages(id) ON DELETE SET NULL,
  payload       JSONB NOT NULL DEFAULT '{}'::jsonb,
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processed', 'expired')),
  priority      INT NOT NULL DEFAULT 5 CHECK (priority BETWEEN 1 AND 10),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at    TIMESTAMPTZ NOT NULL,
  processed_at  TIMESTAMPTZ,
  org_id        TEXT NOT NULL DEFAULT 'aip'
);

CREATE INDEX IF NOT EXISTS idx_agent_messages_target_status
  ON agent_messages (target_agent, status)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_agent_messages_expires
  ON agent_messages (expires_at)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_agent_messages_sender_created
  ON agent_messages (sender_agent, created_at DESC);


-- =========================================================================
-- 2. llm_provider_cooldowns — schema is verbatim from model-failover-chain
-- Optional per the skill ("only add when cross-agent collisions are observed"),
-- but creating now so the persistence path exists when it's needed.
-- =========================================================================
CREATE TABLE IF NOT EXISTS llm_provider_cooldowns (
  provider        TEXT PRIMARY KEY,
  cooldown_until  TIMESTAMPTZ NOT NULL,
  reason          TEXT NOT NULL,
  fail_count      INT NOT NULL DEFAULT 1,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);


-- =========================================================================
-- 3. agent_logs — INFERRED from tool-loop-detector references
-- The skill references `agent_logs` table with level='warn', event='loop_detected'.
-- Columns chosen to support structured JSON logging used elsewhere in skills.
-- =========================================================================
CREATE TABLE IF NOT EXISTS agent_logs (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  ts          TIMESTAMPTZ NOT NULL DEFAULT now(),
  agent_name  TEXT NOT NULL,
  level       TEXT NOT NULL CHECK (level IN ('debug', 'info', 'warn', 'error')),
  event       TEXT,
  message     TEXT,
  metadata    JSONB NOT NULL DEFAULT '{}'::jsonb,
  org_id      TEXT NOT NULL DEFAULT 'aip'
);

CREATE INDEX IF NOT EXISTS idx_agent_logs_agent_ts ON agent_logs (agent_name, ts DESC);
CREATE INDEX IF NOT EXISTS idx_agent_logs_event_ts ON agent_logs (event, ts DESC) WHERE event IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_agent_logs_level_ts ON agent_logs (level, ts DESC);


-- =========================================================================
-- 4. support_tickets — INFERRED from tool-loop-detector escalation insert
-- Column list mirrors the INSERT shown in the skill (title, description,
-- error_message, file_path, function_name, tool, status, priority, created_at).
-- =========================================================================
CREATE TABLE IF NOT EXISTS support_tickets (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  title           TEXT NOT NULL,
  description     TEXT,
  error_message   TEXT,
  file_path       TEXT,
  function_name   TEXT,
  tool            TEXT,
  status          TEXT NOT NULL DEFAULT 'open'
                    CHECK (status IN ('open', 'in_progress', 'resolved', 'closed')),
  priority        TEXT NOT NULL DEFAULT 'medium'
                    CHECK (priority IN ('low', 'medium', 'high', 'critical')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at     TIMESTAMPTZ,
  resolved_by     TEXT,
  org_id          TEXT NOT NULL DEFAULT 'aip'
);

CREATE INDEX IF NOT EXISTS idx_support_tickets_status_created ON support_tickets (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_support_tickets_priority ON support_tickets (priority, created_at DESC);


-- =========================================================================
-- 5. agent_memories — STARTER schema for agent-memory-systems
-- The skill itself is abstract (patterns, not a fixed schema). This is a
-- reasonable starting point that supports episodic/semantic/procedural/working
-- memory with embedding-based retrieval. Embedding dim = 1536 (OpenAI ada-002 /
-- text-embedding-3-small). Change if you use a different model.
-- =========================================================================
CREATE TABLE IF NOT EXISTS agent_memories (
  id                UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  agent_name        TEXT NOT NULL,
  memory_type       TEXT NOT NULL CHECK (memory_type IN ('episodic', 'semantic', 'procedural', 'working')),
  content           TEXT NOT NULL,
  embedding         vector(1536),
  metadata          JSONB NOT NULL DEFAULT '{}'::jsonb,
  importance        INT NOT NULL DEFAULT 5 CHECK (importance BETWEEN 1 AND 10),
  access_count      INT NOT NULL DEFAULT 0,
  last_accessed_at  TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at        TIMESTAMPTZ,
  org_id            TEXT NOT NULL DEFAULT 'aip'
);

CREATE INDEX IF NOT EXISTS idx_agent_memories_agent_type
  ON agent_memories (agent_name, memory_type);

CREATE INDEX IF NOT EXISTS idx_agent_memories_importance_created
  ON agent_memories (agent_name, importance DESC, created_at DESC);

-- IVFFlat index for vector similarity search.
-- Build it AFTER you've ingested some data (lists=100 is a reasonable default
-- for up to ~1M rows; tune `lists` ~= sqrt(rowcount) once stable).
CREATE INDEX IF NOT EXISTS idx_agent_memories_embedding
  ON agent_memories USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);


-- =========================================================================
-- Row Level Security
-- =========================================================================
ALTER TABLE agent_messages           ENABLE ROW LEVEL SECURITY;
ALTER TABLE llm_provider_cooldowns   ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_logs               ENABLE ROW LEVEL SECURITY;
ALTER TABLE support_tickets          ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_memories           ENABLE ROW LEVEL SECURITY;

-- Service role full access on every table.
-- (anon and authenticated have NO policies → cannot read or write — by design.)
DO $$
DECLARE t TEXT;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'agent_messages',
    'llm_provider_cooldowns',
    'agent_logs',
    'support_tickets',
    'agent_memories'
  ]) LOOP
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR ALL TO service_role USING (true) WITH CHECK (true);',
      'service_role_all_' || t, t
    );
  END LOOP;
END $$;


-- =========================================================================
-- Maintenance helper functions
-- =========================================================================

-- Expire old pending agent messages (call from cron every 15 min).
CREATE OR REPLACE FUNCTION expire_stale_agent_messages()
RETURNS INTEGER LANGUAGE plpgsql AS $$
DECLARE expired_count INTEGER;
BEGIN
  WITH expired AS (
    UPDATE agent_messages
    SET status = 'expired'
    WHERE status = 'pending' AND expires_at < now()
    RETURNING id
  )
  SELECT count(*) INTO expired_count FROM expired;

  DELETE FROM agent_messages
  WHERE created_at < now() - INTERVAL '7 days';

  RETURN expired_count;
END $$;

COMMENT ON FUNCTION expire_stale_agent_messages IS
  'Marks expired pending messages as expired and hard-deletes anything older than 7 days. Run from pg_cron.';

-- Clear an LLM provider cooldown that has elapsed (defensive — providers
-- already auto-recover via in-memory expiry).
CREATE OR REPLACE FUNCTION clear_expired_llm_cooldowns()
RETURNS INTEGER LANGUAGE plpgsql AS $$
DECLARE removed INTEGER;
BEGIN
  WITH gone AS (
    DELETE FROM llm_provider_cooldowns
    WHERE cooldown_until < now()
    RETURNING provider
  )
  SELECT count(*) INTO removed FROM gone;
  RETURN removed;
END $$;
