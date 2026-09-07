import assert from "node:assert/strict";
import test from "node:test";
import { paginateQueue, type QueuePartition } from "../lib/queue/pagination";

const records = [
  { id: "published-old", status: "published", date: 1, title: "Fall" },
  { id: "pending-first", status: "pending", date: 2, title: "Fall" },
  { id: "failed", status: "failed", date: 3, title: "Winter" },
  { id: "pending-next", status: "pending", date: 4, title: "Fall" },
  { id: "published-next", status: "published", date: 5, title: "Winter" }
];

function page(number: number, size: number, status?: string, search?: string, source = records) {
  return paginateQueue({
    page: number, pageSize: size, filtered: Boolean(status),
    async read(partition: QueuePartition, offset: number, limit: number) {
      const matching = source.filter(row =>
        (!status || row.status === status) && (!search || row.title.includes(search)) &&
        (partition === "all" || (partition === "published" ? row.status === "published" : row.status !== "published"))
      ).sort((a, b) => a.date - b.date);
      return { rows: limit ? matching.slice(offset, offset + limit) : [], total: matching.length };
    }
  });
}

test("queue pages put all unpublished rows before older published rows", async () => {
  const first = await page(1, 2);
  const boundary = await page(2, 2);
  const last = await page(3, 2);
  assert.deepEqual(first.rows.map(r => r.id), ["pending-first", "failed"]);
  assert.deepEqual(boundary.rows.map(r => r.id), ["pending-next", "published-old"]);
  assert.deepEqual(last.rows.map(r => r.id), ["published-next"]);
  assert.equal(first.total, 5);
  assert.equal(boundary.total, 5);
});

test("queue search is applied before partition counts and paging", async () => {
  const result = await page(2, 2, undefined, "Fall");
  assert.deepEqual(result.rows.map(r => r.id), ["published-old"]);
  assert.equal(result.total, 3);
});

test("explicit published filter retains chronological paging", async () => {
  const result = await page(2, 1, "published");
  assert.deepEqual(result.rows.map(r => r.id), ["published-next"]);
  assert.equal(result.total, 2);
});

test("empty and out of range queue pages are empty with correct counts", async () => {
  assert.deepEqual(await page(1, 10, undefined, undefined, []), { rows: [], total: 0 });
  assert.deepEqual(await page(5, 10), { rows: [], total: 5 });
});

test("all-published queues start at the first published row", async () => {
  const result = await page(1, 1, undefined, undefined, records.filter(r => r.status === "published"));
  assert.equal(result.rows[0].id, "published-old");
  assert.equal(result.total, 2);
});
