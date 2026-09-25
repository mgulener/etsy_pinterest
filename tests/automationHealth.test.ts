import assert from "node:assert/strict";
import test from "node:test";
import { evaluateAutomationHealth, type AutomationHealthSnapshot } from "../lib/services/automationHealth";

const checkedAt = "2026-09-22T06:17:00.000Z";

function snapshot(): AutomationHealthSnapshot {
  const channel = {
    enabled: true,
    pending: 10,
    duePending: 10,
    blocked: 0,
    oldestDueAt: "2026-09-22T05:50:00.000Z",
    lastPublishedAt: "2026-09-22T06:00:00.000Z",
    intervalMinutes: 15
  };
  return {
    checkedAt,
    dryRun: false,
    etsy: { status: "succeeded", completedAt: "2026-09-22T03:30:00.000Z" },
    pinterest: { ...channel },
    instagram: { ...channel },
    facebook: { ...channel }
  };
}

test("automation health accepts recent syncs and active publication streams", () => {
  const report = evaluateAutomationHealth(snapshot());
  assert.equal(report.healthy, true);
  assert.equal(report.jobs.every(job => job.status === "healthy"), true);
});

test("automation health reports stale due work and verification blocks", () => {
  const input = snapshot();
  input.pinterest.oldestDueAt = "2026-09-22T01:00:00.000Z";
  input.pinterest.lastPublishedAt = "2026-09-22T01:00:00.000Z";
  input.instagram.blocked = 2;
  const report = evaluateAutomationHealth(input);
  assert.equal(report.healthy, false);
  assert.equal(report.jobs.find(job => job.job === "pinterest")?.status, "unhealthy");
  assert.equal(report.jobs.find(job => job.job === "instagram")?.detail, "2 queue item(s) require review.");
});

test("disabled channels are healthy while dry-run blocks enabled channels", () => {
  const input = snapshot();
  input.facebook.enabled = false;
  input.facebook.pending = 0;
  input.facebook.duePending = 0;
  input.dryRun = true;
  const report = evaluateAutomationHealth(input);
  assert.equal(report.jobs.find(job => job.job === "facebook")?.status, "disabled");
  assert.equal(report.jobs.find(job => job.job === "pinterest")?.status, "unhealthy");
});

test("disabled channels with overdue work require attention", () => {
  const input = snapshot();
  input.facebook.enabled = false;
  const report = evaluateAutomationHealth(input);
  assert.equal(report.healthy, false);
  assert.equal(report.jobs.find(job => job.job === "facebook")?.status, "unhealthy");
});

test("automation health rejects missing or stale Etsy syncs", () => {
  for (const etsy of [
    { status: "missing" as const, completedAt: null },
    { status: "failed" as const, completedAt: checkedAt },
    { status: "succeeded" as const, completedAt: "2026-09-20T00:00:00.000Z" }
  ]) {
    const input = snapshot();
    input.etsy = etsy;
    assert.equal(evaluateAutomationHealth(input).healthy, false);
  }
});
