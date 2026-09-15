import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { syncEtsyListingsWithDependencies } from "../lib/services/syncEtsyListings";
import type { NormalizedEtsyListing } from "../lib/etsy/types";

const postgresBin = process.env.POSTGRES_BIN ?? "/opt/homebrew/opt/postgresql@14/bin";

test("Etsy checkpoint migration is repeatable and preserves existing listings", {
  skip: !existsSync(join(postgresBin, "initdb")), timeout: 60_000
}, t => {
  const root = mkdtempSync(join(tmpdir(), "etsy-checkpoint-test-"));
  const data = join(root, "data"); const socket = join(root, "socket");
  mkdirSync(socket);
  let started = false;
  t.after(() => {
    if (started) execFileSync(join(postgresBin, "pg_ctl"), ["-D", data, "-m", "immediate", "-w", "stop"], { stdio: "ignore" });
    rmSync(root, { recursive: true, force: true });
  });
  execFileSync(join(postgresBin, "initdb"), ["-D", data, "-U", "postgres", "-A", "trust", "--no-locale", "--encoding=UTF8"], { stdio: "ignore" });
  execFileSync(join(postgresBin, "pg_ctl"), ["-D", data, "-l", join(root, "postgres.log"), "-o", `-F -h '' -k ${socket} -p 55485`, "-w", "start"], { stdio: "ignore" });
  started = true;
  const env = { ...process.env, PGHOST: socket, PGPORT: "55485", PGUSER: "postgres", PGDATABASE: "postgres" };
  const sql = (statement: string) => execFileSync(join(postgresBin, "psql"), ["-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-c", statement], { env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  sql("create table public.etsy_listings(etsy_listing_id bigint primary key); insert into public.etsy_listings values(42)");
  const migration = readFileSync(new URL("../supabase/migrations/0025_etsy_sync_checkpoint.sql", import.meta.url), "utf8");
  sql(migration); sql(migration);
  assert.equal(sql("select social_sync_pending from etsy_listings where etsy_listing_id=42"), "f");
  sql("insert into etsy_listings(etsy_listing_id,social_sync_pending) values(43,true)");
  assert.equal(sql("select etsy_listing_id from etsy_listings where social_sync_pending=false"), "42");
  sql("update etsy_listings set social_sync_pending=false where etsy_listing_id=43");
  assert.equal(sql("select count(*) from etsy_listings where social_sync_pending=false"), "2");
});

test("new listings exist before FK queue inserts and incomplete imports resume without duplicating queues", async () => {
  const parents = new Map<number, { listing: NormalizedEtsyListing; pending: boolean }>();
  const pins = new Set<number>();
  const instagram = new Set<number>();
  let failInstagram = true;
  let failAI = true;
  const order: string[] = [];
  const input: Parameters<typeof syncEtsyListingsWithDependencies>[0] = {
    etsy: { getAllActiveListings: async () => [{ listing_id: 42, title: "Halloween Shirt", state: "active" }] },
    settingsRepository: { isInitialSyncCompleted: async () => true, setInitialSyncCompleted: async () => {} },
    listingsRepository: {
      getExistingEtsyListingIds: async ids => new Set(ids.filter(id => parents.has(id) && !parents.get(id)!.pending)),
      savePendingListing: async listing => { order.push("parent"); parents.set(listing.etsyListingId, { listing, pending: true }); },
      upsertKnownListing: async listing => { order.push("complete"); parents.get(listing.etsyListingId)!.pending = false; },
      upsertKnownListings: async () => {}, updateLastSeen: async () => {}
    },
    boardId: "halloween",
    instagramCaptionGenerator: async () => {
      order.push("ai");
      if (failAI) throw new Error("AI unavailable");
      return "Product-specific AI caption";
    },
    queueRepository: { enqueueListing: async listing => {
      assert.ok(parents.has(listing.etsyListingId), "pin_queue FK requires parent first");
      if (pins.has(listing.etsyListingId)) return "duplicate";
      pins.add(listing.etsyListingId); return "created";
    } },
    instagramQueueRepository: { enqueueListing: async (listing, options) => {
      assert.ok(parents.has(listing.etsyListingId), "instagram_queue FK requires parent first");
      assert.equal(options?.captionSource, "ai");
      if (failInstagram) throw new Error("Instagram queue unavailable");
      if (instagram.has(listing.etsyListingId)) return "duplicate";
      instagram.add(listing.etsyListingId); return "created";
    } }
  };
  const aiFailure = await syncEtsyListingsWithDependencies(input);
  assert.equal(aiFailure.created, 0);
  assert.equal(parents.size, 0);
  failAI = false;
  const partial = await syncEtsyListingsWithDependencies(input);
  assert.equal(partial.queued, 1);
  assert.equal(partial.created, 0);
  assert.equal(parents.get(42)?.pending, true);
  failInstagram = false;
  const retried = await syncEtsyListingsWithDependencies(input);
  assert.equal(retried.queued, 0);
  assert.equal(retried.instagramQueued, 1);
  assert.equal(retried.created, 1);
  assert.equal(parents.get(42)?.pending, false);
  assert.equal(pins.size, 1);
  assert.equal(instagram.size, 1);
  assert.deepEqual(order, ["ai", "ai", "parent", "ai", "parent", "complete"]);
  const noChange = await syncEtsyListingsWithDependencies(input);
  assert.equal(noChange.known, 1);
  assert.equal(noChange.created, 0);
});
