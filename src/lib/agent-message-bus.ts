import { getSupabaseClient } from "./supabase.js";
import { log } from "./log.js";

export type AgentMessageType = "request" | "response" | "broadcast";
export type AgentMessageStatus = "pending" | "processed" | "expired";

export interface AgentMessage {
  id: string;
  sender_agent: string;
  target_agent: string;
  message_type: AgentMessageType;
  in_reply_to?: string | null;
  payload: Record<string, unknown>;
  status: AgentMessageStatus;
  priority: number;
  created_at: string;
  expires_at: string;
  processed_at?: string | null;
  org_id: string;
}

export interface SendMessageOptions {
  sender_agent: string;
  target_agent: string;
  message_type: AgentMessageType;
  payload: Record<string, unknown>;
  in_reply_to?: string;
  priority?: number;
  ttl_minutes?: number;
}

const TABLE = "agent_messages";
const DEFAULT_TTL_MIN = 60;
const MAX_TTL_MIN = 1440;
const RATE_LIMIT_PER_HOUR = 50;
const POLL_LIMIT = 100;

export async function sendAgentMessage(opts: SendMessageOptions): Promise<AgentMessage> {
  const ttl = Math.min(opts.ttl_minutes ?? DEFAULT_TTL_MIN, MAX_TTL_MIN);
  const expires_at = new Date(Date.now() + ttl * 60_000).toISOString();
  const row = {
    sender_agent: opts.sender_agent,
    target_agent: opts.target_agent,
    message_type: opts.message_type,
    in_reply_to: opts.in_reply_to ?? null,
    payload: opts.payload,
    priority: opts.priority ?? 5,
    expires_at,
  };
  const { data, error } = await getSupabaseClient()
    .from(TABLE)
    .insert(row)
    .select()
    .single();
  if (error) {
    log.error({ err: error.message, sender: opts.sender_agent }, "sendAgentMessage failed");
    throw new Error(`sendAgentMessage: ${error.message}`);
  }
  return data as AgentMessage;
}

export async function pollAgentMessages(
  agent: string,
  messageType?: AgentMessageType,
): Promise<AgentMessage[]> {
  let q = getSupabaseClient()
    .from(TABLE)
    .select("*")
    .eq("target_agent", agent)
    .eq("status", "pending");
  if (messageType) q = q.eq("message_type", messageType);
  const { data, error } = await q
    .order("priority", { ascending: true })
    .order("created_at", { ascending: true })
    .limit(POLL_LIMIT);
  if (error) {
    log.error({ err: error.message, agent }, "pollAgentMessages failed");
    return [];
  }
  return (data ?? []) as AgentMessage[];
}

export async function markProcessed(id: string): Promise<void> {
  const { error } = await getSupabaseClient()
    .from(TABLE)
    .update({ status: "processed", processed_at: new Date().toISOString() })
    .eq("id", id);
  if (error) {
    log.error({ err: error.message, id }, "markProcessed failed");
    throw new Error(`markProcessed: ${error.message}`);
  }
}

export async function canSendMessage(senderAgent: string): Promise<boolean> {
  const oneHourAgo = new Date(Date.now() - 60 * 60_000).toISOString();
  const { count, error } = await getSupabaseClient()
    .from(TABLE)
    .select("id", { count: "exact", head: true })
    .eq("sender_agent", senderAgent)
    .gte("created_at", oneHourAgo);
  if (error) {
    log.warn({ err: error.message, senderAgent }, "canSendMessage check failed; allowing");
    return true;
  }
  return (count ?? 0) < RATE_LIMIT_PER_HOUR;
}

export async function expireStale(): Promise<number> {
  const { data, error } = await getSupabaseClient().rpc("expire_stale_agent_messages");
  if (error) {
    log.error({ err: error.message }, "expireStale RPC failed");
    return 0;
  }
  return typeof data === "number" ? data : 0;
}
