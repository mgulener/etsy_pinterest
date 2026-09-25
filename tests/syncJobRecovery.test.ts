import assert from "node:assert/strict";
import test from "node:test";
import { createClient } from "@supabase/supabase-js";
import { createSyncJobsRepository } from "../lib/repositories/syncJobsRepository";
import { scheduledEtsySync } from "../lib/services/scheduledEtsySync";
import type { Database, SyncJobRow } from "../lib/supabase/types";

function fixture() {
  const old = new Date(Date.now() - 2 * 24 * 60 * 60_000).toISOString();
  const rows: SyncJobRow[] = [{
    id: "stale-job", user_id: "owner", type: "etsy_sync", status: "running",
    progress_current: 0, progress_total: 100, sync_limit: null, message: "Starting job",
    error: null, result: null, created_at: old, started_at: old, updated_at: old, completed_at: null
  }];
  const patches: URL[] = [];
  let beforePatch = () => {};
  let failRecovery = false;
  const client = createClient<Database>("https://sync-db.test", "test-key", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async (input, init) => {
      const url = new URL(String(input));
      assert.equal(url.origin, "https://sync-db.test");
      assert.equal(url.pathname, "/rest/v1/sync_jobs");
      if (init?.method === "POST") {
        const row = { ...rows[0], ...JSON.parse(String(init.body)), id: "new-job", status: "queued", created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
        rows.push(row);
        return Response.json(row);
      }
      if (init?.method === "PATCH") {
        patches.push(url);
        beforePatch();
        if (failRecovery) return Response.json({ message: "DB unavailable" }, { status: 503 });
      }
      const matched = rows.filter(row => [...url.searchParams].every(([key, value]) => {
        if (key === "select" || key === "order" || key === "limit") return true;
        const actual = String(row[key as keyof SyncJobRow]);
        if (value.startsWith("eq.")) return actual === value.slice(3);
        if (value.startsWith("in.(")) return value.slice(4, -1).split(",").includes(actual);
        throw new Error(`Unexpected query filter: ${key}`);
      }));
      if (init?.method === "PATCH") {
        matched.forEach(row => Object.assign(row, JSON.parse(String(init.body))));
        return new Response(null, { status: 204 });
      }
      return Response.json(matched.sort((a, b) => b.created_at.localeCompare(a.created_at))[0] ?? null);
    } }
  });
  return { rows, patches, jobs: createSyncJobsRepository(client),
    heartbeatDuringRecovery() { beforePatch = () => { rows[0].updated_at = new Date().toISOString(); }; },
    failRecovery() { failRecovery = true; }
  };
}

test("manual sync lookup releases only this owner's stale Etsy worker", async () => {
  const { jobs, rows, patches } = fixture();
  rows.push({ ...rows[0], id: "other-owner", user_id: "someone-else" });
  assert.equal(await jobs.getActiveForUser("owner", "etsy_sync"), null);
  assert.equal(rows[0].status, "failed");
  assert.equal(rows[1].status, "running");
  assert.match(rows[0].error!, /No progress for 20 minutes/);
  assert.equal(patches[0].searchParams.get("updated_at"), `eq.${rows[0].updated_at}`);
  assert.equal(patches[0].searchParams.get("type"), "eq.etsy_sync");
});

test("status polling reports interrupted work instead of remaining at 0 percent forever", async () => {
  const { jobs } = fixture();
  const latest = await jobs.getLatestForUser("owner", "etsy_sync");
  assert.equal(latest?.status, "failed");
  assert.match(latest!.message, /Start Sync Etsy again/);
});

test("healthy workers, queued jobs and Instagram jobs are not expired", async () => {
  for (const variant of ["fresh", "queued", "instagram_publish", "instagram_ai_captions"] as const) {
    const { jobs, rows, patches } = fixture();
    if (variant === "fresh") rows[0].updated_at = new Date().toISOString();
    else if (variant === "queued") rows[0].status = variant;
    else rows[0].type = variant;
    assert.equal((await jobs.getActiveForUser("owner", rows[0].type))?.id, "stale-job");
    assert.equal(patches.length, 0);
  }
});

test("a heartbeat racing recovery keeps the worker active", async () => {
  const { jobs, heartbeatDuringRecovery } = fixture();
  heartbeatDuringRecovery();
  assert.equal((await jobs.getActiveForUser("owner", "etsy_sync"))?.status, "running");
});

test("a failed recovery does not allow a second sync to start", async () => {
  const f = fixture(); f.failRecovery();
  await assert.rejects(f.jobs.getActiveForUser("owner", "etsy_sync"), /Failed to recover/);
  assert.equal(f.rows[0].status, "running");
});

test("late progress or completion cannot resurrect an interrupted worker", async () => {
  const { jobs, rows } = fixture();
  await jobs.getActiveForUser("owner", "etsy_sync");
  const interrupted = structuredClone(rows[0]);
  await jobs.updateProgress("stale-job", { current: 99, message: "Late progress" });
  await jobs.complete("stale-job", {}, "Late completion");
  await jobs.fail("stale-job", "Late failure");
  assert.deepEqual(rows[0], interrupted);
});

test("daily cron replaces an interrupted sync and records the new result", async () => {
  const { jobs, rows } = fixture();
  let runs = 0;
  const response = await scheduledEtsySync({
    resolveUserId: async () => "owner", jobs,
    run: async (id, userId) => {
      assert.equal(id, "new-job"); assert.equal(userId, "owner");
      runs++;
      rows[1].status = "running";
      await jobs.complete(id, { created: 2 }, "Finished");
    }
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).result.created, 2);
  assert.equal(runs, 1);
  assert.equal(rows[0].status, "failed");
});

test("partial sync failure preserves counters and is not reported as success", async () => {
  const { jobs, rows } = fixture();
  const result = { created: 2, errors: [{ etsyListingId: 42, message: "Queue unavailable" }] };
  await jobs.complete("stale-job", result, "Sync finished with errors", "Retry incomplete products");
  assert.equal(rows[0].status, "failed");
  assert.deepEqual(rows[0].result, result);
  assert.equal(rows[0].error, "Retry incomplete products");
});
