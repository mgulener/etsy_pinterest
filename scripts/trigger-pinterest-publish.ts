import { appendFile, mkdir, open, stat, unlink } from "node:fs/promises";
import { resolve } from "node:path";
import { getSupabaseAdmin } from "../lib/supabase/admin";
import { getEtsyAutomationUserId, getSettingsForUser } from "../lib/repositories/userSettingsRepository";
import { createPinQueueRepository } from "../lib/repositories/pinQueueRepository";
import { createPinterestPostsRepository } from "../lib/repositories/pinterestPostsRepository";
import { publishPinterestPinsWithDependencies } from "../lib/services/publishPinterestPins";
import { createPin } from "../lib/pinterest/client";

export type TriggerState = {
  enabled: boolean;
  environment: string;
  dryRun: boolean;
  maxPins: number;
  blocked: boolean;
  latestPublishedAt: string | null;
  publishedLastDay: number;
  dueListingId: number | null;
};

export function getPinterestTriggerDecision(state: TriggerState, now = Date.now()) {
  if (!state.enabled) return "disabled";
  if (state.environment !== "production" || state.dryRun || state.maxPins !== 1 || state.blocked) return "pause";
  if (!Number.isInteger(state.publishedLastDay) || state.publishedLastDay < 0) return "pause";
  if (state.latestPublishedAt && !Number.isFinite(Date.parse(state.latestPublishedAt))) return "pause";
  if (state.publishedLastDay >= 144) return "daily_limit";
  if (state.latestPublishedAt && now - Date.parse(state.latestPublishedAt) < 10 * 60_000) return "too_soon";
  return state.dueListingId ? "publish" : "empty";
}

export function isSuccessfulSinglePinRun(value: unknown): value is {
  published: number; selected: number; claimed: number; skippedDuplicates: number;
} {
  if (!value || typeof value !== "object") return false;
  const result = value as Record<string, unknown>;
  const counters = ["selected", "claimed", "published", "skippedDuplicates"];
  if (counters.some(key => result[key] !== 0 && result[key] !== 1)) return false;
  return result.mode === "publish" && result.dryRun === false && !result.pausedReason &&
    result.failed === 0 && result.retried === 0 && Array.isArray(result.errors) && result.errors.length === 0 &&
    Number(result.claimed) <= Number(result.selected) &&
    Number(result.published) + Number(result.skippedDuplicates) === Number(result.claimed);
}

export async function sendOnePinterestRun(input: {
  send(): Promise<unknown>;
  verify(): Promise<boolean>;
  pause(): Promise<void>;
}) {
  try {
    const result = await input.send();
    if (!isSuccessfulSinglePinRun(result)) throw new Error("Pinterest returned an error or an uncertain result.");
    if (result.published === 1 && !await input.verify()) throw new Error("Pinterest publication receipt could not be verified.");
    return result;
  } catch (error) {
    await input.pause();
    throw error;
  }
}

export async function publishPinWithReceipt(input: {
  send(): Promise<{ id: string }>;
  saveReceipt(pin: { id: string }): Promise<void>;
}) {
  const pin = await input.send();
  if (!pin.id || typeof pin.id !== "string") throw new Error("Pinterest returned no Pin ID; review required.");
  await input.saveReceipt(pin);
  return pin;
}

async function main() {
  const db = getSupabaseAdmin();
  const userId = await getEtsyAutomationUserId();
  if (!userId) throw new Error("No unique automation owner configured.");
  const pause = async () => {
    const result = await db.from("user_settings").update({ pinterest_enabled: false })
      .eq("user_id", userId).select("user_id");
    if (result.error || result.data.length !== 1) throw new Error("Could not pause Pinterest; manual intervention required.");
  };
  const directory = resolve(".local");
  const lockPath = resolve(directory, "pinterest-publish.lock");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  let lock;
  try {
    lock = await open(lockPath, "wx", 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const age = Date.now() - (await stat(lockPath)).mtimeMs;
    if (age > 6 * 60_000) {
      await pause();
      throw new Error("An unfinished Pinterest run requires review; publishing paused. Do not delete the lock or retry.");
    }
    console.log(JSON.stringify({ status: "busy" }));
    return;
  }
  let release = false;
  try {
    const settings = await getSettingsForUser(userId);
    const now = new Date();
    const latest = await db.from("pinterest_posts").select("published_at").order("published_at", { ascending: false }).limit(1);
    const daily = await db.from("pinterest_posts").select("id", { count: "exact", head: true })
      .gte("published_at", new Date(now.getTime() - 24 * 60 * 60_000).toISOString());
    const blocked = await db.from("pin_queue").select("id", { count: "exact", head: true })
      .or("status.in.(processing,needs_review,failed),and(status.eq.pending,last_error.not.is.null)");
    const due = await db.from("pin_queue").select("id,etsy_listing_id").eq("status", "pending")
      .lte("scheduled_at", now.toISOString()).order("scheduled_at").order("created_at").limit(1);
    if (latest.error || daily.error || blocked.error || due.error || daily.count === null || blocked.count === null) {
      throw new Error("Could not verify the Pinterest queue; no request sent.");
    }
    const decision = getPinterestTriggerDecision({
      enabled: settings.pinterestEnabled, environment: settings.pinterestEnvironment,
      dryRun: settings.dryRun, maxPins: settings.maxPinsPerRun,
      blocked: blocked.count > 0, latestPublishedAt: latest.data[0]?.published_at ?? null,
      publishedLastDay: daily.count, dueListingId: due.data[0]?.etsy_listing_id ?? null
    }, now.getTime());
    if (decision === "pause") {
      await pause();
      throw new Error("Pinterest settings or an unresolved queue item require review; publishing paused.");
    }
    if (decision !== "publish") {
      release = true;
      console.log(JSON.stringify({ status: decision }));
      return;
    }
    const intent = { startedAt: now.toISOString(), listingId: due.data[0].etsy_listing_id };
    // Keep this durable marker on any ambiguous outcome, including process termination.
    await lock.writeFile(JSON.stringify(intent));
    await lock.sync();
    const queue = createPinQueueRepository();
    const result = await sendOnePinterestRun({
      send: () => publishPinterestPinsWithDependencies({
        queueRepository: {
          ...queue,
          listPending: async () => {
            const row = await queue.findById(due.data[0].id);
            return row?.status === "pending" ? [row] : [];
          }
        },
        postsRepository: createPinterestPostsRepository(),
        pinterest: { createPin: input => publishPinWithReceipt({
          send: () => createPin(input, userId, AbortSignal.timeout(90_000)),
          saveReceipt: async pin => {
            const receipt = await open(resolve(directory, `pinterest-receipt-${now.getTime()}.json`), "wx", 0o600);
            try {
              await receipt.writeFile(JSON.stringify({ ...intent, pinId: pin.id, receivedAt: new Date().toISOString() }));
              await receipt.sync();
            } finally {
              await receipt.close();
            }
          }
        }) },
        maxPinsPerRun: 1, maxRetries: 1, dryRun: false
      }),
      verify: async () => {
        const receipt = await db.from("pinterest_posts").select("pinterest_pin_id")
          .eq("etsy_listing_id", intent.listingId).gte("published_at", intent.startedAt).maybeSingle();
        return !receipt.error && Boolean(receipt.data?.pinterest_pin_id);
      },
      pause
    });
    await appendFile(resolve(directory, "pinterest-publish-runs.jsonl"), JSON.stringify({ ...intent,
      finishedAt: new Date().toISOString(), published: result.published, selected: result.selected,
      claimed: result.claimed, skippedDuplicates: result.skippedDuplicates }) + "\n", { mode: 0o600 });
    release = true;
    console.log(JSON.stringify({ status: result.published === 1 ? "published" : "empty", listingId: intent.listingId }));
  } catch (error) {
    await pause();
    throw error;
  } finally {
    await lock.close();
    if (release) await unlink(lockPath);
  }
}

if (process.argv.includes("--run")) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
