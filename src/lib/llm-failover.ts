import { log } from "./log.js";

export type ErrorCategory = "transient" | "permanent" | "content_filter";

export interface ClassifiedError {
  category: ErrorCategory;
  status: number;
  shouldRetry: boolean;
  shouldFailover: boolean;
  shouldAlert: boolean;
  cooldownReason?: string;
}

export interface ProviderResponse {
  text: string;
  source: string;
  inputTokens?: number;
  outputTokens?: number;
}

export type ProviderFn = (opts: Record<string, unknown>) => Promise<ProviderResponse>;

export interface FailoverConfig {
  chain: string[];
  providers: Record<string, ProviderFn>;
}

interface CooldownEntry {
  until: number;
  reason: string;
  failCount: number;
}

const COOLDOWN_DURATIONS: Record<string, number> = {
  "429": 5 * 60_000,
  "503": 2 * 60_000,
  empty_response: 3 * 60_000,
  safety_block: 10 * 60_000,
  default: 2 * 60_000,
};
const MAX_COOLDOWN_MS = 30 * 60_000;

const cooldowns = new Map<string, CooldownEntry>();

export function putOnCooldown(provider: string, reason: string): void {
  const existing = cooldowns.get(provider);
  const failCount = (existing?.failCount ?? 0) + 1;
  const base = COOLDOWN_DURATIONS[reason] ?? COOLDOWN_DURATIONS.default;
  const escalated = Math.min(base * Math.pow(2, failCount - 1), MAX_COOLDOWN_MS);
  cooldowns.set(provider, { until: Date.now() + escalated, reason, failCount });
}

export function isOnCooldown(provider: string): boolean {
  const e = cooldowns.get(provider);
  if (!e) return false;
  if (Date.now() >= e.until) {
    cooldowns.delete(provider);
    return false;
  }
  return true;
}

export function clearCooldown(provider: string): void {
  cooldowns.delete(provider);
}

export function _resetCooldownsForTest(): void {
  cooldowns.clear();
}

export function classifyError(err: any): ClassifiedError {
  const status = err?.status ?? err?.statusCode ?? 0;
  const isEmpty = err?.isEmptyResponse === true;
  const message = String(err?.message ?? "").toLowerCase();

  if (isEmpty || message.includes("safety") || message.includes("blocked")) {
    return {
      category: "content_filter",
      status,
      shouldRetry: false,
      shouldFailover: true,
      shouldAlert: false,
      cooldownReason: isEmpty ? "empty_response" : "safety_block",
    };
  }
  if ([401, 403].includes(status) || message.includes("invalid api key")) {
    return {
      category: "permanent",
      status,
      shouldRetry: false,
      shouldFailover: true,
      shouldAlert: true,
    };
  }
  if ([429, 500, 502, 503, 529].includes(status) || message.includes("timeout")) {
    return {
      category: "transient",
      status,
      shouldRetry: true,
      shouldFailover: true,
      shouldAlert: false,
      cooldownReason: String(status || "timeout"),
    };
  }
  return {
    category: "transient",
    status,
    shouldRetry: true,
    shouldFailover: true,
    shouldAlert: true,
  };
}

export function logFailoverEvent(
  failedProvider: string,
  chain: string[],
  classified: ClassifiedError,
): void {
  const idx = chain.indexOf(failedProvider);
  const next = chain[idx + 1] ?? "none";
  log.warn(
    {
      event: "llm_failover",
      failedProvider,
      nextProvider: next,
      category: classified.category,
      status: classified.status,
    },
    `LLM failover: ${failedProvider} -> ${next}`,
  );
}

export async function alertAdmin(provider: string, error: any): Promise<void> {
  // TODO: wire Telegram bot. For now, structured warn is the alert channel.
  log.warn(
    {
      event: "admin_alert",
      provider,
      status: error?.status,
      message: String(error?.message ?? "").slice(0, 200),
    },
    "LLM provider alert",
  );
}

export async function callWithFailover(
  cfg: FailoverConfig,
  opts: Record<string, unknown>,
): Promise<ProviderResponse> {
  for (const provider of cfg.chain) {
    if (isOnCooldown(provider)) {
      log.info({ provider }, "Provider on cooldown, skipping");
      continue;
    }
    const fn = cfg.providers[provider];
    if (!fn) {
      log.warn({ provider }, "No provider implementation registered");
      continue;
    }
    try {
      const out = await fn(opts);
      clearCooldown(provider);
      return out;
    } catch (err) {
      const classified = classifyError(err);
      if (classified.cooldownReason) putOnCooldown(provider, classified.cooldownReason);
      if (classified.shouldAlert) await alertAdmin(provider, err);
      logFailoverEvent(provider, cfg.chain, classified);
      continue;
    }
  }
  throw new Error("All LLM providers exhausted — chain fully failed");
}
