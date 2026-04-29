# The Brain — Skill Client Library Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the TypeScript runtime layer for four skill contracts (agent-message-bus, model-failover-chain, tool-loop-detector, agent-memory-systems) so the skills have code to call.

**Architecture:** Five focused lib files under `src/lib/`, each one responsibility. A DI-seam Supabase singleton is shared across them. Tests are Vitest unit specs (mocked DB) plus one integration spec gated on `SUPABASE_SERVICE_ROLE_KEY`. One additive Postgres migration adds an RPC for vector search; everything else maps onto the existing baseline schema.

**Tech Stack:** Node 20+, TypeScript ESM, strict mode, target es2022. `@supabase/supabase-js` v2. Vitest. No Telegram SDK, no LLM SDKs (YAGNI).

---

## File Structure

```
package.json                                                  Task 0
tsconfig.json                                                 Task 0
vitest.config.ts                                              Task 0
.env.example                                                  Task 0
.gitignore                                                    Task 0 (verify .env)
src/lib/log.ts                                                Task 1
src/lib/supabase.ts                                           Task 2
src/lib/agent-message-bus.ts                                  Task 3
src/lib/llm-failover.ts                                       Task 4
src/lib/loop-detector.ts                                      Task 5
supabase/migrations/20260428_002_agent_memories_match_rpc.sql Task 6
src/lib/agent-memory.ts                                       Task 7
tests/log.spec.ts                                             Task 1
tests/supabase.spec.ts                                        Task 2
tests/agent-message-bus.spec.ts                               Task 3
tests/llm-failover.spec.ts                                    Task 4
tests/loop-detector.spec.ts                                   Task 5
tests/agent-memory.spec.ts                                    Task 7
tests/integration/agent-message-bus.integration.spec.ts       Task 8
```

Each lib file has one clear job. Tests live in `tests/` parallel-named. The integration test is the only one that hits the live DB; everything else uses an injected fake client via `setSupabaseClient()`.

---

## Task 0: Bootstrap config

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `.env.example`
- Verify: `.gitignore` contains `.env`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "the-brain",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=20" },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@supabase/supabase-js": "^2.45.0"
  },
  "devDependencies": {
    "@types/node": "^20.14.0",
    "typescript": "^5.5.0",
    "vitest": "^2.0.0"
  }
}
```

- [ ] **Step 2: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "es2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "declaration": true,
    "outDir": "dist",
    "rootDir": ".",
    "noEmitOnError": true,
    "forceConsistentCasingInFileNames": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": false,
    "types": ["node", "vitest/globals"]
  },
  "include": ["src/**/*", "tests/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 3: Create vitest.config.ts**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.spec.ts"],
    coverage: { reporter: ["text", "lcov"] },
  },
});
```

- [ ] **Step 4: Create .env.example**

```
SUPABASE_URL=https://cmtkljxuxljwfvvxfowp.supabase.co
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
```

- [ ] **Step 5: Verify .gitignore excludes .env**

Run: `grep -E '^\\.env$|^\\.env\\b' .gitignore`. If absent, append `.env` on its own line. Never modify the existing `.gitignore` if `.env` is already present in any form.

- [ ] **Step 6: Install deps and run typecheck on empty src**

```bash
npm install
echo "export {};" > src/.placeholder.ts
npm run typecheck
rm src/.placeholder.ts
```

Expected: clean exit (no errors). If npm install fails on Windows, retry once; if it still fails, stop and report.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json tsconfig.json vitest.config.ts .env.example .gitignore
git commit -m "chore: bootstrap TypeScript+Vitest project config"
```

---

## Task 1: Logger shim (`src/lib/log.ts`)

A 30-line structured-JSON logger. Every other lib depends on it, so it goes first.

**Files:**
- Create: `src/lib/log.ts`
- Test: `tests/log.spec.ts`

- [ ] **Step 1: Write the failing test**

`tests/log.spec.ts`:
```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { log } from "../src/lib/log.js";

describe("log", () => {
  let stderrSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  });
  afterEach(() => stderrSpy.mockRestore());

  it("emits a JSON line at info level", () => {
    log.info({ k: "v" }, "hello");
    const written = String(stderrSpy.mock.calls[0]?.[0] ?? "");
    const parsed = JSON.parse(written);
    expect(parsed.level).toBe("info");
    expect(parsed.k).toBe("v");
    expect(parsed.msg).toBe("hello");
    expect(typeof parsed.ts).toBe("string");
  });

  it("supports warn and error levels", () => {
    log.warn({}, "w");
    log.error({}, "e");
    const levels = stderrSpy.mock.calls.map(c => JSON.parse(String(c[0])).level);
    expect(levels).toEqual(["warn", "error"]);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
npx vitest run tests/log.spec.ts
```
Expected: failures because `src/lib/log.ts` doesn't exist.

- [ ] **Step 3: Implement `src/lib/log.ts`**

```ts
type Level = "debug" | "info" | "warn" | "error";

function emit(level: Level, fields: Record<string, unknown>, msg: string): void {
  const line = JSON.stringify({ ts: new Date().toISOString(), level, msg, ...fields });
  process.stderr.write(line + "\n");
}

export const log = {
  debug: (fields: Record<string, unknown>, msg: string) => emit("debug", fields, msg),
  info:  (fields: Record<string, unknown>, msg: string) => emit("info",  fields, msg),
  warn:  (fields: Record<string, unknown>, msg: string) => emit("warn",  fields, msg),
  error: (fields: Record<string, unknown>, msg: string) => emit("error", fields, msg),
};
```

- [ ] **Step 4: Run — expect PASS**

```bash
npx vitest run tests/log.spec.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/lib/log.ts tests/log.spec.ts
git commit -m "feat(lib): add structured JSON logger shim"
```

---

## Task 2: Supabase client (`src/lib/supabase.ts`)

DI-seam singleton. Defaults to a lazy-built service-role client; tests inject fakes.

**Files:**
- Create: `src/lib/supabase.ts`
- Test: `tests/supabase.spec.ts`

- [ ] **Step 1: Write the failing test**

`tests/supabase.spec.ts`:
```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  getSupabaseClient,
  setSupabaseClient,
  resetSupabaseClient,
} from "../src/lib/supabase.js";

describe("supabase singleton", () => {
  const orig = { url: process.env.SUPABASE_URL, key: process.env.SUPABASE_SERVICE_ROLE_KEY };

  afterEach(() => {
    resetSupabaseClient();
    process.env.SUPABASE_URL = orig.url;
    process.env.SUPABASE_SERVICE_ROLE_KEY = orig.key;
  });

  it("throws if env vars are missing", () => {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    resetSupabaseClient();
    expect(() => getSupabaseClient()).toThrow(/SUPABASE_URL/);
  });

  it("returns the injected client when set", () => {
    const fake = { from: () => ({}) } as any;
    setSupabaseClient(fake);
    expect(getSupabaseClient()).toBe(fake);
  });

  it("memoizes a real client when env vars present and no override", () => {
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "stub-key";
    resetSupabaseClient();
    const a = getSupabaseClient();
    const b = getSupabaseClient();
    expect(a).toBe(b);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
npx vitest run tests/supabase.spec.ts
```

- [ ] **Step 3: Implement `src/lib/supabase.ts`**

```ts
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let override: SupabaseClient | null = null;
let cached: SupabaseClient | null = null;

export function setSupabaseClient(client: SupabaseClient): void {
  override = client;
  cached = null;
}

export function resetSupabaseClient(): void {
  override = null;
  cached = null;
}

export function getSupabaseClient(): SupabaseClient {
  if (override) return override;
  if (cached) return cached;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url) throw new Error("SUPABASE_URL is not set");
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set");

  cached = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cached;
}
```

- [ ] **Step 4: Run — expect PASS**

```bash
npx vitest run tests/supabase.spec.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/lib/supabase.ts tests/supabase.spec.ts
git commit -m "feat(lib): add Supabase service-role singleton with DI seam"
```

---

## Task 3: Agent message bus (`src/lib/agent-message-bus.ts`)

**Files:**
- Create: `src/lib/agent-message-bus.ts`
- Test: `tests/agent-message-bus.spec.ts`

Public surface (matches SKILL.md):
- `sendAgentMessage(opts: SendMessageOptions): Promise<AgentMessage>`
- `pollAgentMessages(agent: string, messageType?): Promise<AgentMessage[]>`
- `markProcessed(id: string): Promise<void>`
- `canSendMessage(senderAgent: string): Promise<boolean>` (50/hr cap)
- `expireStale(): Promise<number>` (calls `expire_stale_agent_messages` RPC)

Defaults: `priority=5`, `ttl_minutes=60` (clamped to 1440).

- [ ] **Step 1: Write the failing test**

`tests/agent-message-bus.spec.ts`:
```ts
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
  const insertResp = { data: { id: "msg-1", sender_agent: "a", target_agent: "b", message_type: "request", payload: {}, status: "pending", priority: 5, created_at: "2026-04-28T00:00:00Z", expires_at: "2026-04-28T01:00:00Z", org_id: "aip" }, error: null };
  const selectPendingResp = { data: [{ id: "msg-1", target_agent: "b", status: "pending" }], error: null };
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
          return {
            eq: () => ({
              eq: () => ({ order: () => ({ limit: async () => selectPendingResp }) }),
              order: () => ({ limit: async () => selectPendingResp }),
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
      sender_agent: "a", target_agent: "b", message_type: "request",
      payload: { hi: 1 }, ttl_minutes: 30,
    });
    expect(out.id).toBe("msg-1");
    const insert = calls.find(c => "insert" in c)!.insert;
    expect(insert.sender_agent).toBe("a");
    expect(insert.priority).toBe(5);
    expect(new Date(insert.expires_at).getTime() - new Date(insert.created_at ?? Date.now()).getTime() >= 0).toBe(true);
  });

  it("clamps ttl to 1440 minutes", async () => {
    const { client, calls } = makeFakeClient();
    setSupabaseClient(client);
    await sendAgentMessage({
      sender_agent: "a", target_agent: "*", message_type: "broadcast",
      payload: {}, ttl_minutes: 99999,
    });
    const insert = calls.find(c => "insert" in c)!.insert;
    const ttlMs = new Date(insert.expires_at).getTime() - Date.now();
    expect(ttlMs).toBeLessThanOrEqual(1440 * 60 * 1000 + 5_000);
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
});

describe("markProcessed", () => {
  it("issues an update with processed status", async () => {
    const { client, calls } = makeFakeClient();
    setSupabaseClient(client);
    await markProcessed("msg-1");
    const upd = calls.find(c => "update" in c)!.update;
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
    expect(calls.find(c => c.rpc === "expire_stale_agent_messages")).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
npx vitest run tests/agent-message-bus.spec.ts
```

- [ ] **Step 3: Implement `src/lib/agent-message-bus.ts`**

```ts
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
```

- [ ] **Step 4: Run — expect PASS**

```bash
npx vitest run tests/agent-message-bus.spec.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/lib/agent-message-bus.ts tests/agent-message-bus.spec.ts
git commit -m "feat(lib): add agent-message-bus client (send/poll/markProcessed/canSendMessage/expireStale)"
```

---

## Task 4: LLM failover (`src/lib/llm-failover.ts`)

In-memory cooldown Map, error classification, callWithFailover orchestrator, alert stub.

**Files:**
- Create: `src/lib/llm-failover.ts`
- Test: `tests/llm-failover.spec.ts`

- [ ] **Step 1: Write the failing test**

`tests/llm-failover.spec.ts`:
```ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  putOnCooldown, isOnCooldown, clearCooldown, _resetCooldownsForTest,
  classifyError, callWithFailover, type ProviderFn, alertAdmin, logFailoverEvent,
} from "../src/lib/llm-failover.js";

beforeEach(() => _resetCooldownsForTest());

describe("cooldowns", () => {
  it("puts and detects cooldown", () => {
    putOnCooldown("p1", "429");
    expect(isOnCooldown("p1")).toBe(true);
  });
  it("clears cooldown", () => {
    putOnCooldown("p1", "429");
    clearCooldown("p1");
    expect(isOnCooldown("p1")).toBe(false);
  });
  it("escalates duration on consecutive failures", () => {
    putOnCooldown("p1", "default");
    putOnCooldown("p1", "default");
    expect(isOnCooldown("p1")).toBe(true);
  });
});

describe("classifyError", () => {
  it("classifies 429 as transient with cooldownReason", () => {
    const c = classifyError({ status: 429, message: "Too Many" });
    expect(c.category).toBe("transient");
    expect(c.shouldRetry).toBe(true);
    expect(c.cooldownReason).toBe("429");
  });
  it("classifies 401 as permanent and alerts", () => {
    const c = classifyError({ status: 401, message: "bad key" });
    expect(c.category).toBe("permanent");
    expect(c.shouldAlert).toBe(true);
    expect(c.shouldRetry).toBe(false);
  });
  it("classifies empty response as content_filter", () => {
    const c = classifyError({ isEmptyResponse: true });
    expect(c.category).toBe("content_filter");
    expect(c.cooldownReason).toBe("empty_response");
  });
});

describe("callWithFailover", () => {
  it("returns first provider success", async () => {
    const p1: ProviderFn = vi.fn(async () => ({ text: "ok", source: "p1" }));
    const p2: ProviderFn = vi.fn(async () => { throw new Error("nope"); });
    const r = await callWithFailover({ chain: ["p1", "p2"], providers: { p1, p2 } }, { prompt: "x" });
    expect(r.text).toBe("ok");
    expect(p1).toHaveBeenCalled();
    expect(p2).not.toHaveBeenCalled();
  });

  it("falls over on transient failure", async () => {
    const p1: ProviderFn = vi.fn(async () => { const e: any = new Error("rl"); e.status = 429; throw e; });
    const p2: ProviderFn = vi.fn(async () => ({ text: "from-p2", source: "p2" }));
    const r = await callWithFailover({ chain: ["p1", "p2"], providers: { p1, p2 } }, { prompt: "x" });
    expect(r.text).toBe("from-p2");
    expect(isOnCooldown("p1")).toBe(true);
  });

  it("skips providers on cooldown", async () => {
    putOnCooldown("p1", "429");
    const p1: ProviderFn = vi.fn(async () => ({ text: "x", source: "p1" }));
    const p2: ProviderFn = vi.fn(async () => ({ text: "y", source: "p2" }));
    const r = await callWithFailover({ chain: ["p1", "p2"], providers: { p1, p2 } }, { prompt: "x" });
    expect(r.text).toBe("y");
    expect(p1).not.toHaveBeenCalled();
  });

  it("throws when chain exhausted", async () => {
    const p1: ProviderFn = vi.fn(async () => { throw new Error("a"); });
    const p2: ProviderFn = vi.fn(async () => { throw new Error("b"); });
    await expect(
      callWithFailover({ chain: ["p1", "p2"], providers: { p1, p2 } }, { prompt: "x" }),
    ).rejects.toThrow(/exhausted/);
  });
});

describe("alertAdmin / logFailoverEvent", () => {
  it("does not throw on alertAdmin stub", async () => {
    await expect(alertAdmin("p1", new Error("x"))).resolves.toBeUndefined();
  });
  it("logFailoverEvent emits a warn line", () => {
    const spy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    logFailoverEvent("p1", ["p1", "p2"], { category: "transient", status: 429, shouldRetry: true, shouldFailover: true, shouldAlert: false, cooldownReason: "429" });
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
npx vitest run tests/llm-failover.spec.ts
```

- [ ] **Step 3: Implement `src/lib/llm-failover.ts`**

```ts
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
  "429":            5 * 60_000,
  "503":            2 * 60_000,
  empty_response:   3 * 60_000,
  safety_block:    10 * 60_000,
  default:          2 * 60_000,
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
      category: "content_filter", status,
      shouldRetry: false, shouldFailover: true, shouldAlert: false,
      cooldownReason: isEmpty ? "empty_response" : "safety_block",
    };
  }
  if ([401, 403].includes(status) || message.includes("invalid api key")) {
    return { category: "permanent", status, shouldRetry: false, shouldFailover: true, shouldAlert: true };
  }
  if ([429, 500, 502, 503, 529].includes(status) || message.includes("timeout")) {
    return {
      category: "transient", status,
      shouldRetry: true, shouldFailover: true, shouldAlert: false,
      cooldownReason: String(status || "timeout"),
    };
  }
  return { category: "transient", status, shouldRetry: true, shouldFailover: true, shouldAlert: true };
}

export function logFailoverEvent(failedProvider: string, chain: string[], classified: ClassifiedError): void {
  const idx = chain.indexOf(failedProvider);
  const next = chain[idx + 1] ?? "none";
  log.warn(
    { event: "llm_failover", failedProvider, nextProvider: next, category: classified.category, status: classified.status },
    `LLM failover: ${failedProvider} -> ${next}`,
  );
}

export async function alertAdmin(provider: string, error: any): Promise<void> {
  // TODO: wire Telegram bot. For now, structured warn is the alert channel.
  log.warn(
    { event: "admin_alert", provider, status: error?.status, message: String(error?.message ?? "").slice(0, 200) },
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
```

- [ ] **Step 4: Run — expect PASS**

```bash
npx vitest run tests/llm-failover.spec.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/lib/llm-failover.ts tests/llm-failover.spec.ts
git commit -m "feat(lib): add LLM failover orchestrator with cooldowns and error classification"
```

---

## Task 5: Tool loop detector (`src/lib/loop-detector.ts`)

**Files:**
- Create: `src/lib/loop-detector.ts`
- Test: `tests/loop-detector.spec.ts`

Public surface:
- `class ToolLoopDetector` — `recordCall(tool, args, error?)`, `isLooping(tool, args)`, `isErrorLooping(error)`, `reset()`
- Top-level `escalateToSupportTicket({ tool, error, attempts, filePath?, functionName?, priority? })` → `{ id }`
- Top-level helpers `hashArgs`, `normalizeError` (exported for testing/reuse)

- [ ] **Step 1: Write the failing test**

`tests/loop-detector.spec.ts`:
```ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  ToolLoopDetector, hashArgs, normalizeError, escalateToSupportTicket,
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
    const a = normalizeError("Failed at 2026-04-28T12:34:56.789Z id=550e8400-e29b-41d4-a716-446655440000 retry 12345");
    const b = normalizeError("Failed at 2026-04-29T00:00:00Z id=550e8400-e29b-41d4-a716-446655440001 retry 99999");
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
          return { select: () => ({ single: async () => ({ data: { id: "tkt-1" }, error: null }) }) };
        },
      }),
    };
    setSupabaseClient(fake);
    const r = await escalateToSupportTicket({
      tool: "supabase.from", error: "ECONNREFUSED",
      attempts: [{ strategy: "retry", result: "fail" }, { strategy: "alt-host", result: "fail" }],
      filePath: "src/x.ts", functionName: "foo",
    });
    expect(r.id).toBe("tkt-1");
    expect(inserted[0].table).toBe("support_tickets");
    expect(inserted[0].row.tool).toBe("supabase.from");
    expect(inserted[0].row.priority).toBe("high");
    expect(inserted[0].row.description).toContain("retry");
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
npx vitest run tests/loop-detector.spec.ts
```

- [ ] **Step 3: Implement `src/lib/loop-detector.ts`**

```ts
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
    const recent = this.callHistory.slice(-this.window).filter(c => c.tool === tool && c.argsHash === h);
    return recent.length >= this.threshold;
  }

  isErrorLooping(error: string): boolean {
    const norm = normalizeError(error);
    const recent = this.callHistory
      .slice(-this.window)
      .filter(c => c.error && normalizeError(c.error) === norm);
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
```

- [ ] **Step 4: Run — expect PASS**

```bash
npx vitest run tests/loop-detector.spec.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/lib/loop-detector.ts tests/loop-detector.spec.ts
git commit -m "feat(lib): add ToolLoopDetector with support-ticket escalation"
```

---

## Task 6: Migration — `match_agent_memories` RPC

Adds a server-side function for vector similarity search over `agent_memories`. The library calls this via `supabase.rpc()`.

**Files:**
- Create: `supabase/migrations/20260428_002_agent_memories_match_rpc.sql`

- [ ] **Step 1: Write the migration file**

```sql
-- =========================================================================
-- match_agent_memories — pgvector similarity search RPC for agent_memories
-- Returns the top-K most similar rows (cosine distance) for a given agent +
-- memory_type, plus a similarity score (1 - distance).
-- =========================================================================
CREATE OR REPLACE FUNCTION match_agent_memories(
  p_agent_name   TEXT,
  p_memory_type  TEXT,
  p_embedding    vector(1536),
  p_k            INT DEFAULT 5
)
RETURNS TABLE (
  id            UUID,
  agent_name    TEXT,
  memory_type   TEXT,
  content       TEXT,
  metadata      JSONB,
  importance    INT,
  similarity    REAL,
  created_at    TIMESTAMPTZ,
  last_accessed_at TIMESTAMPTZ
)
LANGUAGE sql STABLE AS $$
  SELECT
    m.id, m.agent_name, m.memory_type, m.content, m.metadata, m.importance,
    (1 - (m.embedding <=> p_embedding))::real AS similarity,
    m.created_at, m.last_accessed_at
  FROM agent_memories m
  WHERE m.agent_name = p_agent_name
    AND m.memory_type = p_memory_type
    AND m.embedding IS NOT NULL
  ORDER BY m.embedding <=> p_embedding
  LIMIT p_k;
$$;

COMMENT ON FUNCTION match_agent_memories IS
  'Top-K cosine-similarity search over agent_memories. Bypasses RLS via SECURITY INVOKER (default); only callable by service_role since base table has no public policies.';
```

- [ ] **Step 2: Verify the SQL parses (do NOT apply yet — user will apply in Studio)**

Run: `node -e "console.log(require('fs').readFileSync('supabase/migrations/20260428_002_agent_memories_match_rpc.sql','utf8').length)"`
Expected: prints a number > 500. (No syntax check available offline — we'll trust the user to paste it into Studio after this commit.)

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260428_002_agent_memories_match_rpc.sql
git commit -m "feat(db): add match_agent_memories pgvector similarity RPC"
```

NOTE: this migration must be applied in Studio before integration tests for memory retrieval will pass. Unit tests for `agent-memory.ts` mock the RPC call so they pass without it.

---

## Task 7: Agent memory (`src/lib/agent-memory.ts`)

**Files:**
- Create: `src/lib/agent-memory.ts`
- Test: `tests/agent-memory.spec.ts`

Public surface:
- `insertMemory(agent, type, content, embedding, metadata)` → row
- `queryMemoryByEmbedding(agent, type, queryEmbedding, k)` → ranked rows with `similarity`
- `decayMemory(threshold)` → number of rows deleted

Decay rule: delete rows where `importance < threshold` AND (`last_accessed_at < now()-30d` OR `last_accessed_at IS NULL AND created_at < now()-30d`).

- [ ] **Step 1: Write the failing test**

`tests/agent-memory.spec.ts`:
```ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { setSupabaseClient, resetSupabaseClient } from "../src/lib/supabase.js";
import { insertMemory, queryMemoryByEmbedding, decayMemory } from "../src/lib/agent-memory.js";

beforeEach(() => resetSupabaseClient());

function fake() {
  const calls: any[] = [];
  const client: any = {
    from: vi.fn((table: string) => {
      calls.push({ from: table });
      return {
        insert: (row: any) => {
          calls.push({ insert: row });
          return { select: () => ({ single: async () => ({ data: { id: "mem-1", ...row }, error: null }) }) };
        },
        delete: () => {
          calls.push({ delete: true });
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
    const emb = Array(1536).fill(0).map((_, i) => i / 1536);
    const row = await insertMemory("ceo", "semantic", "fact", emb, { source: "test" });
    expect(row.id).toBe("mem-1");
    const ins = calls.find(c => "insert" in c)!.insert;
    expect(ins.agent_name).toBe("ceo");
    expect(ins.memory_type).toBe("semantic");
    expect(ins.content).toBe("fact");
    expect(ins.metadata).toEqual({ source: "test" });
    expect(Array.isArray(ins.embedding) || typeof ins.embedding === "string").toBe(true);
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
    const rpcCall = calls.find(c => c.rpc === "match_agent_memories");
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
    expect(calls.find(c => c.delete)).toBeTruthy();
    expect(calls.find(c => c.where?.col === "importance")?.where.val).toBe(4);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
npx vitest run tests/agent-memory.spec.ts
```

- [ ] **Step 3: Implement `src/lib/agent-memory.ts`**

```ts
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
```

- [ ] **Step 4: Run — expect PASS**

```bash
npx vitest run tests/agent-memory.spec.ts
```

NOTE: the test fake returns `{ count: 4 }` from the chained `.or(...)` — see the fake. Adjust `decayMemory`'s `.delete({ count: "exact" })` chain in the fake if the Supabase JS chain order differs. If the unit test has trouble matching the chain, simplify the fake and assert only the inputs (table, where col/val), not the full chain shape.

- [ ] **Step 5: Commit**

```bash
git add src/lib/agent-memory.ts tests/agent-memory.spec.ts
git commit -m "feat(lib): add agent-memory client (insert/query/decay)"
```

---

## PAUSE POINT 1 — Request env keys

Before running integration tests, ask the user:

> "Ready for the integration test. Please put `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` into `C:\\The Brain\\.env` (don't paste them in chat). Reply when done."

Wait for confirmation. Verify `.env` exists and `SUPABASE_SERVICE_ROLE_KEY` has a non-empty value (use `node -e "require('dotenv').config(); console.log(!!process.env.SUPABASE_SERVICE_ROLE_KEY)"` — but `dotenv` isn't installed; instead use Node 20's built-in `--env-file=.env` flag).

---

## Task 8: Integration test — agent-message-bus round-trip

**Files:**
- Create: `tests/integration/agent-message-bus.integration.spec.ts`

Round-trip: insert → poll → markProcessed → expire-stale RPC. Gated on `process.env.SUPABASE_SERVICE_ROLE_KEY`. Cleans up after itself.

- [ ] **Step 1: Write the integration test**

`tests/integration/agent-message-bus.integration.spec.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { sendAgentMessage, pollAgentMessages, markProcessed, expireStale } from "../../src/lib/agent-message-bus.js";
import { getSupabaseClient, resetSupabaseClient } from "../../src/lib/supabase.js";

const RUN = !!process.env.SUPABASE_SERVICE_ROLE_KEY;
const d = RUN ? describe : describe.skip;

const SENDER = `it-sender-${Date.now()}`;
const TARGET = `it-target-${Date.now()}`;

d("agent-message-bus integration", () => {
  beforeAll(() => resetSupabaseClient());

  afterAll(async () => {
    // Hard-clean the test rows
    await getSupabaseClient().from("agent_messages").delete().eq("sender_agent", SENDER);
    await getSupabaseClient().from("agent_messages").delete().eq("target_agent", TARGET);
  });

  it("round-trips send → poll → markProcessed", async () => {
    const sent = await sendAgentMessage({
      sender_agent: SENDER, target_agent: TARGET,
      message_type: "request", payload: { hello: "world" }, ttl_minutes: 5,
    });
    expect(sent.id).toBeTruthy();

    const pending = await pollAgentMessages(TARGET);
    const found = pending.find(m => m.id === sent.id);
    expect(found?.payload).toEqual({ hello: "world" });

    await markProcessed(sent.id);
    const stillPending = await pollAgentMessages(TARGET);
    expect(stillPending.find(m => m.id === sent.id)).toBeUndefined();
  });

  it("expireStale RPC executes and returns a count", async () => {
    // Insert a message with 0-min TTL via raw insert so it's already expired
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
```

- [ ] **Step 2: Run — expect PASS (after env keys present)**

```bash
node --env-file=.env node_modules/vitest/vitest.mjs run tests/integration
```

If Node's `--env-file` flag chokes on the file (older Node, unusual encoding), fall back to:
```bash
set -a; source .env; set +a; npx vitest run tests/integration
```
On Windows bash this works. On PowerShell use:
```powershell
Get-Content .env | ForEach-Object { if ($_ -match '^([^=]+)=(.*)$') { [Environment]::SetEnvironmentVariable($matches[1], $matches[2]) } }; npx vitest run tests/integration
```

- [ ] **Step 3: Commit**

```bash
git add tests/integration/agent-message-bus.integration.spec.ts
git commit -m "test(integration): add agent-message-bus round-trip against live Supabase"
```

---

## Task 9: Final verification

- [ ] **Step 1: Full typecheck**

```bash
npm run typecheck
```
Expected: no errors. Paste output to user.

- [ ] **Step 2: Full unit test pass**

```bash
npx vitest run tests --exclude tests/integration
```
Expected: all green. Paste summary line to user.

- [ ] **Step 3: Integration test (with env loaded)**

```bash
node --env-file=.env node_modules/vitest/vitest.mjs run tests/integration
```
Expected: 2 passed. Paste summary line.

- [ ] **Step 4: Report status to user**

Summarize:
- Files committed (lib + tests)
- Migration file written (NOT applied — needs Studio paste)
- Tests: N passed / N total
- STOP. Do NOT proceed to MCP setup, dap, python.

---

## PAUSE POINT 2 — git push

> "All deliverables green. May I push to origin/main?"

Wait for user. If yes:
```bash
git push origin main
```
If no, leave commits local and stop.
