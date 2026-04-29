import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  putOnCooldown,
  isOnCooldown,
  clearCooldown,
  _resetCooldownsForTest,
  classifyError,
  callWithFailover,
  type ProviderFn,
  alertAdmin,
  logFailoverEvent,
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
    const p2: ProviderFn = vi.fn(async () => {
      throw new Error("nope");
    });
    const r = await callWithFailover(
      { chain: ["p1", "p2"], providers: { p1, p2 } },
      { prompt: "x" },
    );
    expect(r.text).toBe("ok");
    expect(p1).toHaveBeenCalled();
    expect(p2).not.toHaveBeenCalled();
  });

  it("falls over on transient failure", async () => {
    const p1: ProviderFn = vi.fn(async () => {
      const e: any = new Error("rl");
      e.status = 429;
      throw e;
    });
    const p2: ProviderFn = vi.fn(async () => ({ text: "from-p2", source: "p2" }));
    const r = await callWithFailover(
      { chain: ["p1", "p2"], providers: { p1, p2 } },
      { prompt: "x" },
    );
    expect(r.text).toBe("from-p2");
    expect(isOnCooldown("p1")).toBe(true);
  });

  it("skips providers on cooldown", async () => {
    putOnCooldown("p1", "429");
    const p1: ProviderFn = vi.fn(async () => ({ text: "x", source: "p1" }));
    const p2: ProviderFn = vi.fn(async () => ({ text: "y", source: "p2" }));
    const r = await callWithFailover(
      { chain: ["p1", "p2"], providers: { p1, p2 } },
      { prompt: "x" },
    );
    expect(r.text).toBe("y");
    expect(p1).not.toHaveBeenCalled();
  });

  it("throws when chain exhausted", async () => {
    const p1: ProviderFn = vi.fn(async () => {
      throw new Error("a");
    });
    const p2: ProviderFn = vi.fn(async () => {
      throw new Error("b");
    });
    await expect(
      callWithFailover({ chain: ["p1", "p2"], providers: { p1, p2 } }, { prompt: "x" }),
    ).rejects.toThrow(/exhausted/);
  });
});

describe("alertAdmin / logFailoverEvent", () => {
  it("does not throw on alertAdmin stub", async () => {
    const spy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    await expect(alertAdmin("p1", new Error("x"))).resolves.toBeUndefined();
    spy.mockRestore();
  });
  it("logFailoverEvent emits a warn line", () => {
    const spy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    logFailoverEvent("p1", ["p1", "p2"], {
      category: "transient",
      status: 429,
      shouldRetry: true,
      shouldFailover: true,
      shouldAlert: false,
      cooldownReason: "429",
    });
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
