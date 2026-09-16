import assert from "node:assert/strict";
import test from "node:test";
import { calendarDate, eventOccurrence, marketDay } from "../lib/queue/seasonalCalendar";
import { CLASSIFIER_VERSION, eventInputHash, parseEventClassification, type EventClassification, type EventProduct, type SavedEventClassification } from "../lib/queue/eventClassification";
import { classifyEventsWithAI, parseEventBatch } from "../lib/queue/aiEventClassification";
import { DEFAULT_SEASONAL_POLICY, planSeasonalQueue, rankSeasonalProduct, type SeasonalQueueItem } from "../lib/queue/seasonalPlanning";
import { classifyListingEvents } from "../lib/services/classifyListingEvents";
import { syncEtsyListingsWithDependencies } from "../lib/services/syncEtsyListings";

const policy = { ...DEFAULT_SEASONAL_POLICY, enabled: true };
const now = new Date("2026-09-16T12:00:00+03:00");
const product = { etsyListingId: 42, title: "Halloween shirt", description: "A haunted house design", tags: ["spooky", "october"] };
const event = (id: EventClassification["events"][number]): EventClassification => ({ kind: "event", events: [id], confidence: "high", evidence: ["Halloween"], reason: "Explicit design theme", targetYear: null });
const evergreen: EventClassification = { ...event("halloween"), kind: "evergreen", events: [], evidence: [] };

test("US recurring dates change with year; holidays are not substituted with office closure dates", () => {
  assert.equal(calendarDate(eventOccurrence("thanksgiving", 2026).start), "2026-11-26");
  assert.equal(calendarDate(eventOccurrence("thanksgiving", 2027).start), "2027-11-25");
  assert.equal(calendarDate(eventOccurrence("labor_day", 2026).start), "2026-09-07");
  assert.equal(calendarDate(eventOccurrence("memorial_day", 2027).start), "2027-05-31");
  assert.equal(calendarDate(eventOccurrence("independence_day", 2026).start), "2026-07-04");
  assert.equal(calendarDate(eventOccurrence("grandparents_day", 2026).start), "2026-09-13");
  assert.equal(calendarDate(eventOccurrence("winter", 2027).end), "2028-02-29");
});

test("US calendar date is stable across Istanbul midnight and DST", () => {
  assert.equal(calendarDate(marketDay(new Date("2026-10-01T01:00:00+03:00"))), "2026-09-30");
  assert.equal(calendarDate(marketDay(new Date("2026-03-08T07:01:00Z"))), "2026-03-08");
  assert.throws(() => marketDay(new Date("invalid")), /Invalid/);
});

test("approaching events outrank evergreen; past events roll to a future season", () => {
  const halloween = rankSeasonalProduct(event("halloween"), policy, now);
  const thanksgiving = rankSeasonalProduct(event("thanksgiving"), policy, now);
  assert.equal(halloween.tier, 0);
  assert.equal(halloween.deadline, "2026-10-17");
  assert.ok(halloween.urgency < thanksgiving.urgency);
  assert.equal(rankSeasonalProduct(event("patriot_day"), policy, now).tier, 2);
  assert.equal(rankSeasonalProduct(evergreen, policy, now).tier, 1);
  assert.equal(rankSeasonalProduct(undefined, policy, now).tier, 3);
  assert.equal(rankSeasonalProduct(event("christmas"), policy, now).tier, 2);
  assert.equal(rankSeasonalProduct(event("christmas"), policy, new Date("2026-10-01T12:00:00Z")).tier, 0);
});

test("delivery cutoff is inclusive and adjusts to configured lead time", () => {
  assert.equal(rankSeasonalProduct(event("halloween"), policy, new Date("2026-10-17T12:00:00Z")).tier, 0);
  assert.equal(rankSeasonalProduct(event("halloween"), policy, new Date("2026-10-18T12:00:00Z")).tier, 2);
  assert.equal(rankSeasonalProduct(event("halloween"), { ...policy, leadTimeDays: 7 }, new Date("2026-10-18T12:00:00Z")).tier, 0);
  assert.throws(() => rankSeasonalProduct(event("halloween"), { ...policy, leadTimeDays: -1 }, now), /Invalid/);
});

test("cross-year seasons, explicitly dated products and multiple occasions use the correct window", () => {
  assert.equal(rankSeasonalProduct(event("winter"), policy, new Date("2027-01-15T12:00:00Z")).deadline, "2027-02-14");
  assert.equal(rankSeasonalProduct({ ...event("halloween"), targetYear: 2025 }, policy, now).tier, 4);
  const multi = { ...event("halloween"), events: ["christmas", "halloween"] } as EventClassification;
  assert.equal(rankSeasonalProduct(multi, policy, now).event, "halloween");
  assert.equal(rankSeasonalProduct(multi, policy, new Date("2026-11-01T12:00:00Z")).event, "christmas");
});

test("parser rejects invented event IDs and demotes unsupported evidence or uncertain output", () => {
  assert.equal(parseEventClassification(event("halloween"), product).kind, "event");
  assert.equal(parseEventClassification({ ...event("halloween"), evidence: ['"Halloween"'] }, product).kind, "event");
  assert.equal(parseEventClassification({ ...event("halloween"), evidence: ['\u201cHalloween\u201d'] }, product).kind, "event");
  assert.throws(() => parseEventClassification({ ...event("halloween"), events: ["invented_holiday"] }, product), /Invalid/);
  assert.equal(parseEventClassification({ ...event("halloween"), evidence: ["Not in the input"] }, product).kind, "review");
  assert.equal(parseEventClassification({ ...event("halloween"), confidence: "medium" }, product).kind, "review");
  const reviewed = parseEventClassification({ ...event("halloween"), confidence: "medium" }, product);
  assert.deepEqual(parseEventClassification(reviewed, product), reviewed);
  assert.equal(parseEventClassification({ ...event("halloween"), targetYear: 2030 }, product).kind, "review");
  assert.equal(parseEventClassification({ ...event("halloween"), events: [] }, product).kind, "review");
  assert.equal(parseEventClassification({ ...event("halloween"), kind: "evergreen" }, product).kind, "review");
  assert.throws(() => parseEventBatch({ classifications: { "999": event("halloween") } }, [product]), /unknown/);
});

test("semantic safeguards separate Lunar New Year, anniversary editions and generic seasonal gift copy", () => {
  const classify = (title: string, value: EventClassification) => parseEventClassification({ ...value, evidence: [title] }, { ...product, title });
  assert.equal(classify("2026 Lunar New Year shirt", { ...event("new_year"), targetYear: 2026 }).kind, "review");
  assert.equal(classify("25th Anniversary September 11 Shirt", event("patriot_day")).kind, "review");
  assert.equal(classify("Rustic Autumn Vibes shirt", evergreen).kind, "review");
  assert.deepEqual(classify("Halloween Autumn Shirt", { ...event("halloween"), events: ["halloween", "autumn"] }).events, ["halloween"]);
  assert.deepEqual(classify("Winter Snowflake Shirt", { ...event("winter"), events: ["winter", "christmas"] }).events, ["winter"]);
  assert.equal(classify("Valentine Holiday Shirt", event("christmas")).kind, "review");
});

test("AI request uses strict catalog schema, treats product text as data and never leaks provider errors", async () => {
  let calls = 0;
  const result = await classifyEventsWithAI({ products: [product], apiKey: "secret", model: "configured-model",
    fetchImpl: (async (_url, init) => {
      calls++;
      const body = JSON.parse(String(init?.body));
      assert.equal(body.store, false);
      assert.equal(body.text.format.strict, true);
      assert.match(body.input[0].content, /untrusted/);
      assert.equal(body.text.format.schema.properties.classifications.properties["42"].properties.events.items.enum.includes("halloween"), true);
      return Response.json({ status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify({ classifications: { "42": event("halloween") } }) }] }] });
    }) as typeof fetch });
  assert.equal(result.get(42)?.kind, "event");
  assert.equal(calls, 1);
  await assert.rejects(classifyEventsWithAI({ products: [product], apiKey: "secret", model: "configured-model",
    fetchImpl: (async () => new Response("sensitive provider response", { status: 429 })) as typeof fetch }), /failed \(429\)/);
  await assert.rejects(classifyEventsWithAI({ products: [product], apiKey: "secret", model: "configured-model",
    fetchImpl: (async () => Response.json({ status: "incomplete", output: [] })) as typeof fetch }), /not completed/);
});

test("AI diagnostics distinguish throttling from quota without echoing secrets or arbitrary codes", async () => {
  for (const code of ["rate_limit_exceeded", "insufficient_quota", "secret-key"]) {
    await assert.rejects(classifyEventsWithAI({ products: [product], apiKey: "secret", model: "configured-model",
      fetchImpl: (async () => Response.json({ error: { code, message: "secret-key and private product" } },
        { status: 429, headers: { "retry-after": "60" } })) as typeof fetch }), error => {
      assert.ok(error instanceof Error);
      assert.match(error.message, code === "secret-key" ? /unknown/ : new RegExp(code));
      assert.match(error.message, /Retry after 60 seconds/);
      assert.doesNotMatch(error.message, /secret-key|private product/);
      return true;
    });
  }
});

test("classification cache avoids repeat calls, invalidates changes and resumes after partial failure", async () => {
  const cached = new Map<number, SavedEventClassification>();
  let calls = 0;
  let saved = 0;
  const input = { products: [product], cached, model: "model", generate: async () => { calls++; return new Map([[42, event("halloween")]]); },
    save: async () => { saved++; } };
  assert.equal((await classifyListingEvents(input)).generated, 1);
  assert.equal((await classifyListingEvents(input)).cached, 1);
  assert.equal(calls, 1);
  assert.equal(saved, 1);
  assert.equal((await classifyListingEvents({ ...input, products: [{ ...product, title: "Halloween 2027 shirt" }] })).generated, 1);
  assert.equal((await classifyListingEvents({ ...input, model: "model2" })).generated, 1);
  assert.equal(eventInputHash(product), eventInputHash({ ...product, tags: [...product.tags].reverse() }));
  assert.notEqual(eventInputHash(product), eventInputHash({ ...product, tags: ["different"] }));
  cached.set(42, { ...cached.get(42)!, version: CLASSIFIER_VERSION + "old" });
  await assert.rejects(classifyListingEvents({ ...input, save: async () => { throw new Error("DB unavailable"); } }), /DB unavailable/);
  assert.notEqual(cached.get(42)?.version, CLASSIFIER_VERSION);
  assert.equal((await classifyListingEvents(input)).generated, 1);
});

test("daily classification stops between batches at its budget and resumes without repeating saved work", async () => {
  const products = Array.from({ length: 21 }, (_, i) => ({ ...product, etsyListingId: i + 1 }));
  const cached = new Map<number, SavedEventClassification>();
  let calls = 0;
  const input = { products, cached, model: "model", limit: 50,
    generate: async (batch: EventProduct[]) => { calls++; return new Map(batch.map(p => [p.etsyListingId, event("halloween")])); },
    save: async () => {} };
  assert.deepEqual(await classifyListingEvents({ ...input, mayStartBatch: () => calls < 1 }), { generated: 10, cached: 0, remaining: 11 });
  assert.deepEqual(await classifyListingEvents(input), { generated: 11, cached: 10, remaining: 0 });
  assert.equal(calls, 3);
});

test("bulk classification has at most three workers, unique batches and checkpoints before DB writes", async () => {
  const products = Array.from({ length: 35 }, (_, i) => ({ ...product, etsyListingId: i + 1 }));
  const checkpointed = new Set<number>();
  const requested: number[] = [];
  let active = 0;
  let maximum = 0;
  const result = await classifyListingEvents({ products, cached: new Map(), model: "model", concurrency: 3,
    generate: async batch => {
      active++; maximum = Math.max(maximum, active);
      requested.push(...batch.map(p => p.etsyListingId));
      await new Promise<void>(resolve => setImmediate(resolve));
      active--;
      return new Map(batch.map(p => [p.etsyListingId, event("halloween")]));
    }, checkpoint: async entries => { for (const entry of entries) checkpointed.add(entry.product.etsyListingId); },
    save: async p => { assert.ok(checkpointed.has(p.etsyListingId)); }
  });
  assert.equal(result.generated, 35);
  assert.equal(maximum, 3);
  assert.equal(new Set(requested).size, 35);
  assert.equal(requested.length, 35);
});

test("a bulk failure stops new batches but waits for in-flight saves, leaving checkpoints intact", async () => {
  const products = Array.from({ length: 35 }, (_, i) => ({ ...product, etsyListingId: i + 1 }));
  const checkpoints = new Map<number, SavedEventClassification>();
  let calls = 0;
  let saved = 0;
  await assert.rejects(classifyListingEvents({ products, cached: new Map(), model: "model", concurrency: 2,
    generate: async batch => {
      calls++;
      await new Promise<void>(resolve => setImmediate(resolve));
      return new Map(batch.map(p => [p.etsyListingId, event("halloween")]));
    }, checkpoint: async entries => { for (const entry of entries) checkpoints.set(entry.product.etsyListingId, entry.value); },
    save: async p => { if (p.etsyListingId === 1) throw new Error("DB unavailable"); saved++; }
  }), /DB unavailable/);
  assert.equal(calls, 2);
  assert.equal(saved, 10);
  assert.equal(checkpoints.size, 20);
  assert.ok(checkpoints.has(1));
});

function row(id: number, extra: Partial<SeasonalQueueItem> = {}): SeasonalQueueItem {
  return { id: String(id), etsy_listing_id: id, status: "pending", schedule_locked: false,
    scheduled_at: "2026-08-01T00:00:00Z", created_at: "2026-08-01T00:00:00Z", updated_at: "2026-08-01T00:00:00Z", ...extra };
}

test("new seasonal products precede older evergreen products; old dates become future slots", () => {
  const planned = planSeasonalQueue({ rows: [row(1), row(2, { created_at: "2026-09-16T00:00:00Z" })],
    classifications: new Map([[1, evergreen], [2, event("halloween")]]), policy, intervalMinutes: 15, now });
  assert.deepEqual(planned.map(item => item.id), ["2", "1"]);
  assert.ok(planned.every(item => Date.parse(item.scheduled_at) >= now.getTime()));
  assert.equal(Date.parse(planned[1].scheduled_at) - Date.parse(planned[0].scheduled_at), 15 * 60_000);
});

test("planner never moves manual/published/processing/failed rows and reserves occupied slots", () => {
  const manual = row(10, { schedule_locked: true, scheduled_at: now.toISOString() });
  const processing = row(11, { status: "processing", scheduled_at: new Date(now.getTime() + 15 * 60_000).toISOString() });
  const rows = [row(1), row(2), manual, processing, row(12, { status: "published" }), row(13, { status: "failed" }), row(14, { status: "cancelled" })];
  const original = JSON.stringify(rows);
  const planned = planSeasonalQueue({ rows, classifications: new Map(), policy, intervalMinutes: 15, now });
  assert.deepEqual(planned.map(item => item.id), ["1", "2"]);
  assert.equal(Date.parse(planned[0].scheduled_at) - now.getTime(), 30 * 60_000);
  assert.equal(JSON.stringify(rows), original);
  assert.throws(() => planSeasonalQueue({ rows, classifications: new Map(), policy, intervalMinutes: 0, now }), /interval/);
});

test("a long queue crossing the delivery cutoff recalculates priority at the actual publication slot", () => {
  const beforeCutoff = new Date("2026-10-17T23:45:00-04:00");
  const planned = planSeasonalQueue({ rows: [row(1), row(2), row(3)], classifications: new Map([
    [1, event("halloween")], [2, event("halloween")], [3, evergreen]
  ]), policy, intervalMinutes: 15, now: beforeCutoff });
  assert.deepEqual(planned.map(item => item.id), ["1", "3", "2"]);
  assert.equal(planned[2].seasonalRank.tier, 2);
});

test("daily sync refreshes all channel schedules even with no new products", async () => {
  const calls: string[] = [];
  const result = await syncEtsyListingsWithDependencies({
    etsy: { getAllActiveListings: async () => [{ listing_id: 42, title: "Halloween shirt", state: "active" }] },
    settingsRepository: { isInitialSyncCompleted: async () => true, setInitialSyncCompleted: async () => {} },
    listingsRepository: { getExistingEtsyListingIds: async () => new Set([42]), savePendingListing: async () => {},
      upsertKnownListing: async () => {}, upsertKnownListings: async () => { calls.push("products"); }, updateLastSeen: async () => {} },
    refreshSeasonalPriority: async products => { assert.equal(products.length, 1); calls.push("classify"); return true; },
    queueRepository: { enqueueListing: async () => "duplicate", rebuildPendingSchedule: async () => { calls.push("pinterest"); return 1; } },
    instagramQueueRepository: { enqueueListing: async () => "duplicate", rebuildPendingSchedule: async () => { calls.push("instagram"); return 1; } },
    facebookQueueRepository: { enqueueListing: async () => "duplicate", rebuildPendingSchedule: async () => { calls.push("facebook"); return 1; } }
  });
  assert.equal(result.created, 0);
  assert.deepEqual(calls, ["products", "classify", "pinterest", "instagram", "facebook"]);
});
