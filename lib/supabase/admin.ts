import { createClient } from "@supabase/supabase-js";
import { getRequiredEnv } from "@/lib/config/env";
import type { Database } from "./types";
import { createReadRetryFetch } from "./readRetry";

let adminClient: ReturnType<typeof createClient<Database>> | null = null;

export function getSupabaseAdmin() {
  if (!adminClient) {
    adminClient = createClient<Database>(
      getRequiredEnv("NEXT_PUBLIC_SUPABASE_URL"),
      getRequiredEnv("SUPABASE_SERVICE_ROLE_KEY"),
      {
        global: { fetch: createReadRetryFetch() },
        auth: {
          persistSession: false,
          autoRefreshToken: false
        }
      }
    );
  }

  return adminClient;
}
