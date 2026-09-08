import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const sql = readFileSync(new URL("../supabase/migrations/0016_instagram_cron.sql", import.meta.url), "utf8");
test("cron setup starts inactive and reads its credential only from Vault", () => {
  assert.match(sql, /vault\.decrypted_secrets/);
  assert.match(sql, /active := false/);
  assert.match(sql, /security invoker/);
  assert.match(sql, /revoke all on function/);
  assert.doesNotMatch(sql, /Bearer [A-Za-z0-9_-]{10}/);
});
test("cron setup gates requests and retains HTTP request IDs for verification", () => {
  for (const guard of ["pg_try_advisory_xact_lock", "needs_review", "processing", "15 minutes", "max_instagram_posts_per_run", "dry_run", "Previous HTTP result missing or failed"]) assert.ok(sql.includes(guard));
  assert.match(sql, /timeout_milliseconds := 300000/);
  assert.match(sql, /insert into public\.instagram_cron_requests/);
  assert.match(sql, /scheduled_at <= now\(\)/);
});
