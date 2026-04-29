import { getSupabaseClient } from "./supabase.js";
import { log } from "./log.js";

export function hashArgs(args: Record<string, unknown>): string {
  const sorted = Object.entries(args).sort(([a], [b]) => a.localeCompare(b));
  return JSON.stringify(sorted);
}

export function normalizeError(error: string): string {
  return error
    .replace(/\d{4}-\d{2}-\d{2}T[\d:.]+Z?/g, "[TIMESTAMP]")
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "[UUID]")
    .replace(/\d{5,}/g, "[NUM]")
    .trim();
}

interface CallRecord {
  tool: string;
  argsHash: string;
  error?: string;
  timestamp: number;
}

export class ToolLoopDetector {
  private callHistory: CallRecord[] = [];
  private readonly threshold: number;
  private readonly window: number;

  constructor(threshold = 3, window = 10) {
    this.threshold = threshold;
    this.window = window;
  }

  recordCall(tool: string, args: Record<string, unknown>, error?: string): void {
    this.callHistory.push({ tool, argsHash: hashArgs(args), error, timestamp: Date.now() });
  }

  isLooping(tool: string, args: Record<string, unknown>): boolean {
    const h = hashArgs(args);
    const recent = this.callHistory
      .slice(-this.window)
      .filter((c) => c.tool === tool && c.argsHash === h);
    return recent.length >= this.threshold;
  }

  isErrorLooping(error: string): boolean {
    const norm = normalizeError(error);
    const recent = this.callHistory
      .slice(-this.window)
      .filter((c) => c.error && normalizeError(c.error) === norm);
    return recent.length >= this.threshold;
  }

  reset(): void {
    this.callHistory = [];
  }
}

export interface EscalateOptions {
  tool: string;
  error: string;
  attempts: Array<{ strategy: string; result: string }>;
  filePath?: string;
  functionName?: string;
  priority?: "low" | "medium" | "high" | "critical";
  agentName?: string;
}

export async function escalateToSupportTicket(opts: EscalateOptions): Promise<{ id: string }> {
  const description =
    `Tried ${opts.attempts.length} approaches:\n` +
    opts.attempts.map((a, i) => `${i + 1}. ${a.strategy}: ${a.result}`).join("\n");
  const row = {
    title: `Loop detected: ${opts.tool} failing`,
    description,
    error_message: opts.error,
    file_path: opts.filePath ?? null,
    function_name: opts.functionName ?? null,
    tool: opts.tool,
    status: "open",
    priority: opts.priority ?? "high",
  };

  const { data, error } = await getSupabaseClient()
    .from("support_tickets")
    .insert(row)
    .select()
    .single();
  if (error) {
    log.error({ err: error.message, tool: opts.tool }, "escalateToSupportTicket failed");
    throw new Error(`escalateToSupportTicket: ${error.message}`);
  }

  // Best-effort log to agent_logs (don't fail the escalation if logging breaks).
  try {
    await getSupabaseClient().from("agent_logs").insert({
      agent_name: opts.agentName ?? "unknown",
      level: "warn",
      event: "loop_detected",
      message: row.title,
      metadata: { ticket_id: (data as any).id, attempts: opts.attempts.length },
    });
  } catch (e) {
    log.warn({ err: String(e) }, "agent_logs write skipped");
  }

  return { id: (data as any).id as string };
}
