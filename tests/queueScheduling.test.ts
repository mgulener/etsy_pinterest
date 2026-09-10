import assert from "node:assert/strict";
import test from "node:test";
import {
  buildScheduledAt,
  DEFAULT_QUEUE_INTERVAL_MINUTES,
  getNextScheduleStart,
  getSeasonalQueuePriority,
  sortQueueRowsForPublishing
} from "../lib/queue/scheduling";

function priority(title: string) {
  return getSeasonalQueuePriority({
    title,
    description: null,
    originalCreationTimestamp: null
  });
}

test("seasonal queue priority puts Halloween first", () => {
  assert.equal(priority("Halloween pumpkin shirt"), 10);
  assert.equal(priority("Pumpkin Spice Football shirt"), 15);
  assert.equal(priority("Fall leaves graphic tee"), 15);
  assert.equal(priority("Thanksgiving autumn turkey shirt"), 20);
  assert.equal(priority("Christmas winter ornament"), 30);
  assert.equal(priority("New Year celebration shirt"), 40);
  assert.equal(priority("Winter mountain shirt"), 45);
  assert.equal(priority("Patriot Day remembrance shirt"), 50);
  assert.equal(priority("Back to School teacher shirt"), 60);
  assert.equal(priority("100 Days of School shirt"), 70);
  assert.equal(priority("Everyday floral shirt"), 100);
});

test("specific events take precedence over broad seasonal words", () => {
  assert.equal(priority("Fall Thanksgiving family shirt"), 20);
  assert.equal(priority("Autumn Halloween pumpkin shirt"), 10);
  assert.equal(priority("Thanksgiving turkey trot with pumpkin accents"), 20);
  assert.equal(priority("Teacher Halloween costume shirt"), 10);
  assert.equal(priority("Winter New Year celebration shirt"), 40);
  assert.equal(priority("Teacher 100th Day of School shirt"), 70);
});

test("incidental marketing copy does not misclassify the product month", () => {
  assert.equal(getSeasonalQueuePriority({
    title: "Military Child April Awareness Shirt",
    description: "Comfortable for school events and teachers.",
    originalCreationTimestamp: null
  }), 100);
});

test("queue rows are ordered by current seasonal relevance and then creation date", () => {
  const rows = sortQueueRowsForPublishing([
    { title: "Everyday shirt", description: null, created_at: "2026-01-01T00:00:00Z" },
    { title: "Christmas shirt", description: null, created_at: "2026-01-01T00:00:00Z" },
    { title: "Halloween shirt", description: null, created_at: "2026-01-01T00:00:00Z" },
    { title: "September teacher shirt newer", description: null, created_at: "2026-02-01T00:00:00Z" },
    { title: "100 Days of School shirt", description: null, created_at: "2026-01-01T00:00:00Z" },
    { title: "Thanksgiving shirt", description: null, created_at: "2026-01-01T00:00:00Z" }
  ]);

  assert.deepEqual(rows.map((row) => row.title), [
    "Halloween shirt",
    "Thanksgiving shirt",
    "Christmas shirt",
    "September teacher shirt newer",
    "100 Days of School shirt",
    "Everyday shirt"
  ]);
});

test("default schedule interval is fifteen minutes", () => {
  const start = new Date("2026-09-09T09:00:00+03:00");

  assert.equal(DEFAULT_QUEUE_INTERVAL_MINUTES, 15);
  assert.equal(buildScheduledAt(3, undefined, start), "2026-09-09T06:45:00.000Z");
});

test("new schedules start on the next clean interval boundary", () => {
  assert.equal(
    getNextScheduleStart(5, new Date("2026-09-09T09:02:41+03:00")).toISOString(),
    "2026-09-09T06:05:00.000Z"
  );
  assert.equal(
    getNextScheduleStart(5, new Date("2026-09-09T09:05:00+03:00")).toISOString(),
    "2026-09-09T06:05:00.000Z"
  );
});
