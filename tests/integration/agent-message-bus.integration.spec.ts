import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  sendAgentMessage,
  pollAgentMessages,
  markProcessed,
  expireStale,
} from "../../src/lib/agent-message-bus.js";
import { getSupabaseClient, resetSupabaseClient } from "../../src/lib/supabase.js";

const RUN = !!process.env.SUPABASE_SERVICE_ROLE_KEY;
const d = RUN ? describe : describe.skip;

const SENDER = `it-sender-${Date.now()}`;
const TARGET = `it-target-${Date.now()}`;

d("agent-message-bus integration", () => {
  beforeAll(() => resetSupabaseClient());

  afterAll(async () => {
    await getSupabaseClient().from("agent_messages").delete().eq("sender_agent", SENDER);
    await getSupabaseClient().from("agent_messages").delete().eq("target_agent", TARGET);
  });

  it("round-trips send → poll → markProcessed", async () => {
    const sent = await sendAgentMessage({
      sender_agent: SENDER,
      target_agent: TARGET,
      message_type: "request",
      payload: { hello: "world" },
      ttl_minutes: 5,
    });
    expect(sent.id).toBeTruthy();

    const pending = await pollAgentMessages(TARGET);
    const found = pending.find((m) => m.id === sent.id);
    expect(found?.payload).toEqual({ hello: "world" });

    await markProcessed(sent.id);
    const stillPending = await pollAgentMessages(TARGET);
    expect(stillPending.find((m) => m.id === sent.id)).toBeUndefined();
  });

  it("expireStale RPC executes and returns a count", async () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    const { data: row, error } = await getSupabaseClient()
      .from("agent_messages")
      .insert({
        sender_agent: SENDER,
        target_agent: TARGET,
        message_type: "request",
        payload: {},
        priority: 5,
        expires_at: past,
      })
      .select()
      .single();
    expect(error).toBeNull();
    expect(row?.id).toBeTruthy();

    const expired = await expireStale();
    expect(expired).toBeGreaterThanOrEqual(1);
  });
});
