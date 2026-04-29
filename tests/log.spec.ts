import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { log } from "../src/lib/log.js";

describe("log", () => {
  let stderrSpy: any;
  beforeEach(() => {
    stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation((() => true) as any);
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
    const levels = stderrSpy.mock.calls.map((c: unknown[]) => JSON.parse(String(c[0])).level);
    expect(levels).toEqual(["warn", "error"]);
  });
});
