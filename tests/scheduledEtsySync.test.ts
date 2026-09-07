import assert from "node:assert/strict";
import test from "node:test";
import { scheduledEtsySync } from "../lib/services/scheduledEtsySync";
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
    }
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
