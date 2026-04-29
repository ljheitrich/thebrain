import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  ToolLoopDetector,
  hashArgs,
  normalizeError,
  escalateToSupportTicket,
} from "../src/lib/loop-detector.js";
import { setSupabaseClient, resetSupabaseClient } from "../src/lib/supabase.js";

beforeEach(() => resetSupabaseClient());

describe("hashArgs", () => {
  it("is order-insensitive", () => {
    expect(hashArgs({ a: 1, b: 2 })).toBe(hashArgs({ b: 2, a: 1 }));
  });
});

describe("normalizeError", () => {
  it("strips ISO timestamps, UUIDs, and large numbers", () => {
    const a = normalizeError(
      "Failed at 2026-04-28T12:34:56.789Z id=550e8400-e29b-41d4-a716-446655440000 retry 12345",
    );
    const b = normalizeError(
      "Failed at 2026-04-29T00:00:00Z id=550e8400-e29b-41d4-a716-446655440001 retry 99999",
    );
    expect(a).toBe(b);
  });
});

describe("ToolLoopDetector", () => {
  it("isLooping fires after 3 same-args calls", () => {
    const d = new ToolLoopDetector();
    const args = { x: 1 };
    expect(d.isLooping("t", args)).toBe(false);
    d.recordCall("t", args);
    d.recordCall("t", args);
    expect(d.isLooping("t", args)).toBe(false);
    d.recordCall("t", args);
    expect(d.isLooping("t", args)).toBe(true);
  });
  it("isErrorLooping uses normalized error text", () => {
    const d = new ToolLoopDetector();
    d.recordCall("t", {}, "ECONNREFUSED at 2026-04-28T00:00:00Z");
    d.recordCall("t", {}, "ECONNREFUSED at 2026-04-28T00:00:01Z");
    d.recordCall("t", {}, "ECONNREFUSED at 2026-04-28T00:00:02Z");
    expect(d.isErrorLooping("ECONNREFUSED at 2026-04-28T00:00:03Z")).toBe(true);
  });
  it("reset clears history", () => {
    const d = new ToolLoopDetector();
    d.recordCall("t", { x: 1 });
    d.reset();
    expect(d.isLooping("t", { x: 1 })).toBe(false);
  });
});

describe("escalateToSupportTicket", () => {
  it("inserts a ticket and returns its id", async () => {
    const inserted: any[] = [];
    const fake: any = {
      from: (table: string) => ({
        insert: (row: any) => {
          inserted.push({ table, row });
          if (table === "support_tickets") {
            return { select: () => ({ single: async () => ({ data: { id: "tkt-1" }, error: null }) }) };
          }
          // agent_logs insert returns a thenable result directly
          return Promise.resolve({ data: null, error: null });
        },
      }),
    };
    setSupabaseClient(fake);
    const r = await escalateToSupportTicket({
      tool: "supabase.from",
      error: "ECONNREFUSED",
      attempts: [
        { strategy: "retry", result: "fail" },
        { strategy: "alt-host", result: "fail" },
      ],
      filePath: "src/x.ts",
      functionName: "foo",
    });
    expect(r.id).toBe("tkt-1");
    const ticket = inserted.find((i) => i.table === "support_tickets");
    expect(ticket).toBeTruthy();
    expect(ticket.row.tool).toBe("supabase.from");
    expect(ticket.row.priority).toBe("high");
    expect(ticket.row.description).toContain("retry");
  });
});
