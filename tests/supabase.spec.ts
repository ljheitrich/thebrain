import { describe, it, expect, afterEach } from "vitest";
import {
  getSupabaseClient,
  setSupabaseClient,
  resetSupabaseClient,
} from "../src/lib/supabase.js";

describe("supabase singleton", () => {
  const orig = {
    url: process.env.SUPABASE_URL,
    key: process.env.SUPABASE_SERVICE_ROLE_KEY,
  };

  afterEach(() => {
    resetSupabaseClient();
    if (orig.url === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = orig.url;
    if (orig.key === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = orig.key;
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
