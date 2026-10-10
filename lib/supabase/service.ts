import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";
import type { Database } from "@/lib/supabase/user";

export interface ServiceSupabaseClientOptions {
  fetch?: typeof fetch;
}

/**
 * Creates a server-only service-role Supabase client using SUPABASE_SERVICE_ROLE_KEY.
 * Used exclusively for reading/writing the shared `foods` cache and `ai_usage`.
 */
export function createServiceSupabaseClient(
  options?: ServiceSupabaseClientOptions
): SupabaseClient<Database> {
  return createClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.SUPABASE_SERVICE_ROLE_KEY,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
      global: options?.fetch ? { fetch: options.fetch } : undefined,
    }
  );
}

