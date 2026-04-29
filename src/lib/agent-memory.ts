import { getSupabaseClient } from "./supabase.js";
import { log } from "./log.js";

export type MemoryType = "episodic" | "semantic" | "procedural" | "working";

export interface AgentMemoryRow {
  id: string;
  agent_name: string;
  memory_type: MemoryType;
  content: string;
  metadata: Record<string, unknown>;
  importance: number;
  created_at: string;
  last_accessed_at: string | null;
}

export interface AgentMemoryHit extends AgentMemoryRow {
  similarity: number;
}

const TABLE = "agent_memories";
const EMBEDDING_DIM = 1536;
const DECAY_AGE_DAYS = 30;

function assertEmbedding(embedding: number[]): void {
  if (!Array.isArray(embedding) || embedding.length !== EMBEDDING_DIM) {
    throw new Error(`embedding must be a number[] of length ${EMBEDDING_DIM}`);
  }
}

export async function insertMemory(
  agent: string,
  type: MemoryType,
  content: string,
  embedding: number[],
  metadata: Record<string, unknown> = {},
  importance = 5,
): Promise<AgentMemoryRow> {
  assertEmbedding(embedding);
  const row = {
    agent_name: agent,
    memory_type: type,
    content,
    embedding,
    metadata,
    importance,
  };
  const { data, error } = await getSupabaseClient()
    .from(TABLE)
    .insert(row)
    .select()
    .single();
  if (error) {
    log.error({ err: error.message, agent, type }, "insertMemory failed");
    throw new Error(`insertMemory: ${error.message}`);
  }
  return data as AgentMemoryRow;
}

export async function queryMemoryByEmbedding(
  agent: string,
  type: MemoryType,
  queryEmbedding: number[],
  k = 5,
): Promise<AgentMemoryHit[]> {
  assertEmbedding(queryEmbedding);
  const { data, error } = await getSupabaseClient().rpc("match_agent_memories", {
    p_agent_name: agent,
    p_memory_type: type,
    p_embedding: queryEmbedding,
    p_k: k,
  });
  if (error) {
    log.error({ err: error.message, agent, type }, "queryMemoryByEmbedding failed");
    return [];
  }
  return (data ?? []) as AgentMemoryHit[];
}

export async function decayMemory(threshold: number): Promise<number> {
  const cutoffIso = new Date(Date.now() - DECAY_AGE_DAYS * 24 * 60 * 60_000).toISOString();
  const { count, error } = await getSupabaseClient()
    .from(TABLE)
    .delete({ count: "exact" })
    .lt("importance", threshold)
    .or(
      `last_accessed_at.lt.${cutoffIso},and(last_accessed_at.is.null,created_at.lt.${cutoffIso})`,
    );
  if (error) {
    log.error({ err: error.message, threshold }, "decayMemory failed");
    return 0;
  }
  return count ?? 0;
}
