import { describe, it, expect, beforeEach, vi } from "vitest";
import { setSupabaseClient, resetSupabaseClient } from "../src/lib/supabase.js";
import {
  insertMemory,
  queryMemoryByEmbedding,
  decayMemory,
} from "../src/lib/agent-memory.js";

beforeEach(() => resetSupabaseClient());

function fake() {
  const calls: any[] = [];
  const client: any = {
    from: vi.fn((table: string) => {
      calls.push({ from: table });
      return {
        insert: (row: any) => {
          calls.push({ insert: row });
          return {
            select: () => ({
              single: async () => ({ data: { id: "mem-1", ...row }, error: null }),
            }),
          };
        },
        delete: (opts?: any) => {
          calls.push({ delete: true, deleteOpts: opts });
          return {
            lt: (col: string, val: any) => {
              calls.push({ where: { col, val } });
              return {
                or: async (clause: string) => {
                  calls.push({ or: clause });
                  return { count: 4, error: null };
                },
              };
            },
          };
        },
      };
    }),
    rpc: vi.fn(async (name: string, params: any) => {
      calls.push({ rpc: name, params });
      return {
        data: [
          { id: "mem-1", similarity: 0.93, content: "alpha" },
          { id: "mem-2", similarity: 0.81, content: "beta" },
        ],
        error: null,
      };
    }),
  };
  return { client, calls };
}

describe("insertMemory", () => {
  it("inserts with provided fields", async () => {
    const { client, calls } = fake();
    setSupabaseClient(client);
    const emb = Array(1536)
      .fill(0)
      .map((_, i) => i / 1536);
    const row = await insertMemory("ceo", "semantic", "fact", emb, { source: "test" });
    expect(row.id).toBe("mem-1");
    const ins = calls.find((c) => "insert" in c)!.insert;
    expect(ins.agent_name).toBe("ceo");
    expect(ins.memory_type).toBe("semantic");
    expect(ins.content).toBe("fact");
    expect(ins.metadata).toEqual({ source: "test" });
    expect(Array.isArray(ins.embedding)).toBe(true);
    expect(ins.embedding.length).toBe(1536);
  });

  it("rejects wrong-length embeddings", async () => {
    const { client } = fake();
    setSupabaseClient(client);
    await expect(insertMemory("ceo", "semantic", "x", [1, 2, 3], {})).rejects.toThrow(
      /1536/,
    );
  });
});

describe("queryMemoryByEmbedding", () => {
  it("calls match_agent_memories RPC and returns ranked rows", async () => {
    const { client, calls } = fake();
    setSupabaseClient(client);
    const emb = Array(1536).fill(0);
    const rows = await queryMemoryByEmbedding("ceo", "semantic", emb, 5);
    expect(rows.length).toBe(2);
    expect(rows[0].similarity).toBeGreaterThan(rows[1].similarity);
    const rpcCall = calls.find((c) => c.rpc === "match_agent_memories");
    expect(rpcCall).toBeTruthy();
    expect(rpcCall.params.p_agent_name).toBe("ceo");
    expect(rpcCall.params.p_memory_type).toBe("semantic");
    expect(rpcCall.params.p_k).toBe(5);
  });
});

describe("decayMemory", () => {
  it("deletes rows below importance threshold and returns a count", async () => {
    const { client, calls } = fake();
    setSupabaseClient(client);
    const n = await decayMemory(4);
    expect(n).toBe(4);
    expect(calls.find((c) => c.delete)).toBeTruthy();
    expect(calls.find((c) => c.where?.col === "importance")?.where.val).toBe(4);
  });
});
