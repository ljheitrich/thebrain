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
