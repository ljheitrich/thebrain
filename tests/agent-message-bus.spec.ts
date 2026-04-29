import { describe, it, expect, beforeEach, vi } from "vitest";
import { setSupabaseClient, resetSupabaseClient } from "../src/lib/supabase.js";
import {
  sendAgentMessage,
  pollAgentMessages,
  markProcessed,
  canSendMessage,
  expireStale,
} from "../src/lib/agent-message-bus.js";

function makeFakeClient() {
  const calls: any[] = [];
  const insertResp = {
    data: {
      id: "msg-1",
      sender_agent: "a",
      target_agent: "b",
      message_type: "request",
      payload: {},
      status: "pending",
      priority: 5,
      created_at: "2026-04-28T00:00:00Z",
      expires_at: "2026-04-28T01:00:00Z",
      org_id: "aip",
    },
    error: null,
  };
  const selectPendingResp = {
    data: [{ id: "msg-1", target_agent: "b", status: "pending", payload: {} }],
    error: null,
  };
  const updateResp = { data: null, error: null };
  const countResp = { count: 12, error: null };
  const rpcResp = { data: 7, error: null };

  const client = {
    from: vi.fn((table: string) => {
      calls.push({ from: table });
      return {
        insert: vi.fn((row: any) => {
          calls.push({ insert: row });
          return { select: () => ({ single: async () => insertResp }) };
        }),
        select: vi.fn((cols: string, opts?: any) => {
          calls.push({ select: cols, opts });
          if (opts?.head) {
            return {
              eq: () => ({ gte: async () => countResp }),
            };
          }
          // Polling chain: .eq(target).eq(status)[.eq(message_type)?].order().order().limit()
          const orderable = {
            order: () => ({
              order: () => ({ limit: async () => selectPendingResp }),
            }),
          };
          const second = {
            eq: () => orderable, // optional message_type filter
            order: orderable.order,
          };
          return {
            eq: () => ({
              eq: () => second,
            }),
          };
        }),
        update: vi.fn((patch: any) => {
          calls.push({ update: patch });
          return { eq: async () => updateResp };
        }),
      };
    }),
    rpc: vi.fn(async (name: string) => {
      calls.push({ rpc: name });
      return rpcResp;
    }),
  };
  return { client: client as any, calls };
}

beforeEach(() => resetSupabaseClient());

describe("sendAgentMessage", () => {
  it("inserts with computed expires_at and returns row", async () => {
    const { client, calls } = makeFakeClient();
    setSupabaseClient(client);
    const out = await sendAgentMessage({
      sender_agent: "a",
      target_agent: "b",
      message_type: "request",
      payload: { hi: 1 },
      ttl_minutes: 30,
    });
    expect(out.id).toBe("msg-1");
    const insert = calls.find((c) => "insert" in c)!.insert;
    expect(insert.sender_agent).toBe("a");
    expect(insert.priority).toBe(5);
    const ttlMs = new Date(insert.expires_at).getTime() - Date.now();
    expect(ttlMs).toBeGreaterThan(29 * 60_000);
    expect(ttlMs).toBeLessThan(31 * 60_000);
  });

  it("clamps ttl to 1440 minutes", async () => {
    const { client, calls } = makeFakeClient();
    setSupabaseClient(client);
    await sendAgentMessage({
      sender_agent: "a",
      target_agent: "*",
      message_type: "broadcast",
      payload: {},
      ttl_minutes: 99999,
    });
    const insert = calls.find((c) => "insert" in c)!.insert;
    const ttlMs = new Date(insert.expires_at).getTime() - Date.now();
    expect(ttlMs).toBeLessThanOrEqual(1440 * 60_000 + 5_000);
  });
});

describe("pollAgentMessages", () => {
  it("returns pending messages for an agent", async () => {
    const { client } = makeFakeClient();
    setSupabaseClient(client);
    const msgs = await pollAgentMessages("b");
    expect(msgs.length).toBe(1);
    expect(msgs[0].id).toBe("msg-1");
  });

  it("filters by message_type when provided", async () => {
    const { client } = makeFakeClient();
    setSupabaseClient(client);
    const msgs = await pollAgentMessages("b", "broadcast");
    expect(msgs.length).toBe(1);
  });
});

describe("markProcessed", () => {
  it("issues an update with processed status", async () => {
    const { client, calls } = makeFakeClient();
    setSupabaseClient(client);
    await markProcessed("msg-1");
    const upd = calls.find((c) => "update" in c)!.update;
    expect(upd.status).toBe("processed");
    expect(typeof upd.processed_at).toBe("string");
  });
});

describe("canSendMessage", () => {
  it("returns true when under 50/hr", async () => {
    const { client } = makeFakeClient();
    setSupabaseClient(client);
    expect(await canSendMessage("a")).toBe(true);
  });
});

describe("expireStale", () => {
  it("calls the SQL helper RPC", async () => {
    const { client, calls } = makeFakeClient();
    setSupabaseClient(client);
    const n = await expireStale();
    expect(n).toBe(7);
    expect(calls.find((c) => c.rpc === "expire_stale_agent_messages")).toBeTruthy();
  });
});
