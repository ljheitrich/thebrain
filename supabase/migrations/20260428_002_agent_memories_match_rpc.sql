-- =========================================================================
-- match_agent_memories — pgvector similarity search RPC for agent_memories
-- Returns the top-K most similar rows (cosine distance) for a given agent +
-- memory_type, plus a similarity score (1 - distance).
--
-- Apply via Supabase Studio → SQL Editor → paste this file → Run.
-- The unit tests for src/lib/agent-memory.ts mock the RPC, so they pass
-- without this migration. The integration path (and any production usage)
-- requires it to be applied.
-- =========================================================================
CREATE OR REPLACE FUNCTION match_agent_memories(
  p_agent_name   TEXT,
  p_memory_type  TEXT,
  p_embedding    vector(1536),
  p_k            INT DEFAULT 5
)
RETURNS TABLE (
  id                UUID,
  agent_name        TEXT,
  memory_type       TEXT,
  content           TEXT,
  metadata          JSONB,
  importance        INT,
  similarity        REAL,
  created_at        TIMESTAMPTZ,
  last_accessed_at  TIMESTAMPTZ
)
LANGUAGE sql STABLE AS $$
  SELECT
    m.id,
    m.agent_name,
    m.memory_type,
    m.content,
    m.metadata,
    m.importance,
    (1 - (m.embedding <=> p_embedding))::real AS similarity,
    m.created_at,
    m.last_accessed_at
  FROM agent_memories m
  WHERE m.agent_name = p_agent_name
    AND m.memory_type = p_memory_type
    AND m.embedding IS NOT NULL
  ORDER BY m.embedding <=> p_embedding
  LIMIT p_k;
$$;

COMMENT ON FUNCTION match_agent_memories IS
  'Top-K cosine-similarity search over agent_memories for (agent_name, memory_type). Uses the IVFFlat index from migration 001. SECURITY INVOKER (default) — only callable by service_role since the base table has no anon/authenticated policies.';
