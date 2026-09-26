import assert from "node:assert/strict";
import test from "node:test";
import { getDailySyncWindowStart, scheduledEtsySync } from "../lib/services/scheduledEtsySync";
import type { SyncJobRow } from "../lib/supabase/types";

function fixture(status: SyncJobRow["status"] = "succeeded") {
  const job = { id: "job-1", user_id: "owner-1", status: "queued", type: "etsy_sync" } as SyncJobRow;
  const calls: string[] = [];
  const input = {
    resolveUserId: async (): Promise<string | null> => "owner-1",
    jobs: {
      getActiveForUser: async (): Promise<SyncJobRow | null> => null,
      create: async ({ userId }: { userId: string }) => {
        assert.equal(userId, "owner-1"); calls.push("create"); return job;
      },
      getLatestForUser: async () => ({ ...job, status, result: { created: 2 }, error: status === "failed" ? "Etsy unavailable" : null }) as SyncJobRow
    },
    run: async (id: string, userId: string) => {
      assert.equal(id, "job-1"); assert.equal(userId, "owner-1"); calls.push("run");
    },
    now: undefined as (() => Date) | undefined
  };
  return { input, calls, job };
}

test("scheduled Etsy sync uses explicit owner without browser session and persists result", async () => {
  const { input, calls } = fixture();
  const response = await scheduledEtsySync(input);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).result.created, 2);
  assert.deepEqual(calls, ["create", "run"]);
});

test("missing Etsy connection does not start a sync", async () => {
  const { input, calls } = fixture(); input.resolveUserId = async () => null;
  assert.equal((await scheduledEtsySync(input)).status, 409);
  assert.deepEqual(calls, []);
});

test("running sync is not started again", async () => {
  const { input, calls, job } = fixture();
  input.jobs.getActiveForUser = async () => ({ ...job, status: "running" });
  assert.equal((await scheduledEtsySync(input)).status, 202);
  assert.deepEqual(calls, []);
});

test("queued sync is resumed without creating another job", async () => {
  const { input, calls, job } = fixture(); input.jobs.getActiveForUser = async () => job;
  assert.equal((await scheduledEtsySync(input)).status, 200);
  assert.deepEqual(calls, ["run"]);
});

test("failed sync returns HTTP failure instead of reporting success to cron", async () => {
  const { input } = fixture("failed");
  const response = await scheduledEtsySync(input);
  assert.equal(response.status, 500);
  assert.equal((await response.json()).error, "Etsy unavailable");
});

test("daily cron skips a second successful Etsy sync in the same daily window", async () => {
  const { input, calls, job } = fixture();
  input.now = () => new Date("2026-09-26T03:05:00.000Z");
  const latest = { ...job, status: "succeeded", completed_at: "2026-09-26T03:01:00.000Z" } as SyncJobRow;
  input.jobs.getLatestForUser = async () => latest;
  const response = await scheduledEtsySync(input);
  assert.equal(response.status, 200);
  assert.deepEqual(calls, []);
  assert.equal((await response.json()).skipped, true);
});

test("daily cron runs after the next window even when the previous success is less than twenty hours old", async () => {
  const { input, calls, job } = fixture();
  input.now = () => new Date("2026-09-26T03:00:00.000Z");
  const previous = { ...job, status: "succeeded", completed_at: "2026-09-25T10:19:00.000Z" } as SyncJobRow;
  let reads = 0;
  input.jobs.getLatestForUser = async () => reads++ === 0 ? previous : { ...job, status: "succeeded", result: { created: 20 } } as SyncJobRow;
  const response = await scheduledEtsySync(input);
  assert.equal(response.status, 200);
  assert.deepEqual(calls, ["create", "run"]);
});

test("daily sync window rolls back to the previous day before 03:00 UTC", () => {
  assert.equal(
    getDailySyncWindowStart(new Date("2026-09-26T02:59:59.000Z")).toISOString(),
    "2026-09-25T03:00:00.000Z"
  );
  assert.equal(
    getDailySyncWindowStart(new Date("2026-09-26T03:00:00.000Z")).toISOString(),
    "2026-09-26T03:00:00.000Z"
  );
});
