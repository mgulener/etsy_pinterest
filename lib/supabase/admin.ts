import { createClient } from "@supabase/supabase-js";
import { getServerEnv } from "@/lib/config/env";
import type { Database } from "./types";

let adminClient: ReturnType<typeof createClient<Database>> | null = null;

export function getSupabaseAdmin() {
  if (!adminClient) {
    const env = getServerEnv();

    adminClient = createClient<Database>(
      env.supabaseUrl,
      env.supabaseServiceRoleKey,
      {
        auth: {
          persistSession: false,
          autoRefreshToken: false
        }
      }
    );
  }

  return adminClient;
}
