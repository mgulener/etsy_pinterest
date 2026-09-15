import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { getSupabaseAdmin } from "../lib/supabase/admin";
import { getEtsyAutomationUserId, getSettingsForUser } from "../lib/repositories/userSettingsRepository";
import { getFacebookSettings } from "../lib/repositories/facebookRepository";
import { publishFacebookForUser } from "../lib/services/publishFacebookPosts";
import { verifyFacebookPage } from "../lib/facebook/client";
import { isValidFacebookInterval } from "../lib/facebook/settings";
import { FacebookTokenError } from "../lib/facebook/types";

export const FACEBOOK_PAGE_ID = "1332088883317238";
export function getFacebookQueueBlockState(rows: Array<{ status: string; request_started_at: string | null }>, now = Date.now()) {
  // At five minutes, a claim is well beyond the 90-second Meta timeout and needs review.
  const needsReview = rows.some(row => row.status === "needs_review" || (row.status === "processing" &&
    (!row.request_started_at || !Number.isFinite(Date.parse(row.request_started_at)) || now - Date.parse(row.request_started_at) >= 5 * 60_000)));
  return { needsReview, busy: rows.some(row => row.status === "processing") };
}

type Result = { status: string; postId?: string };

export async function triggerFacebook(args: string[], deps: {
  inspect(): Promise<{ enabled: boolean; automaticEnabled: boolean; dryRun: boolean; busy: boolean; needsReview: boolean }>;
  verifyPage(): Promise<void>;
  publish(): Promise<Result>;
  verifyReceipt(postId: string): Promise<boolean>;
  pause(): Promise<void>;
}) {
  if (args.length > 1 || (args.length === 1 && args[0] !== "--run")) throw new Error("Invalid arguments");
  const run = args[0] === "--run";
  try {
    const state = await deps.inspect();
    if (!run) return { status: "read_only", ...state };
    if (!state.enabled || !state.automaticEnabled) return { status: "disabled" };
    if (state.dryRun) return { status: "dry_run" };
    if (state.needsReview) { await deps.pause(); return { status: "needs_review" }; }
    if (state.busy) return { status: "busy" };
    await deps.verifyPage();
    const result = await deps.publish();
    if (result.status === "published") {
      if (!result.postId || !await deps.verifyReceipt(result.postId)) throw new Error("Receipt not confirmed");
      return { status: "published", postId: result.postId, receiptVerified: true };
    }
    if (["disabled", "dry_run", "waiting"].includes(result.status)) return { status: result.status };
    await deps.pause();
    return { status: result.status === "failed" ? "failed" : "needs_review" };
  } catch (error) {
    if (run) await deps.pause();
    if (error instanceof FacebookTokenError) throw error;
    throw new Error("Facebook check failed; inspect configuration and queue before retrying.");
  }
}

export async function main(args = process.argv.slice(2)) {
  const db = getSupabaseAdmin();
  let userId: string | undefined;
  const pause = async () => {
    // Never resume, rebuild the queue or alter another Page from this command.
    let query = db.from("facebook_settings").update({ automatic_enabled: false }).eq("page_id", FACEBOOK_PAGE_ID);
    if (userId) query = query.eq("user_id", userId);
    const result = await query.select("page_id");
    if (result.error) throw new Error("Facebook pause could not be confirmed; manual review required.");
  };
  const result = await triggerFacebook(args, {
    async inspect() {
      const owners = await db.from("user_settings").select("user_id").not("etsy_access_token", "is", null).limit(2);
      if (owners.error || owners.data?.length !== 1) throw new Error("No unique connected Etsy owner");
      userId = owners.data[0].user_id;
      if (await getEtsyAutomationUserId() !== userId) throw new Error("Owner configuration mismatch");
      const { settings } = await getFacebookSettings(userId);
      if (!settings || settings.page_id !== FACEBOOK_PAGE_ID || !isValidFacebookInterval(settings.interval_minutes)) throw new Error("Page configuration mismatch");
      const shared = await getSettingsForUser(userId);
      const blocked = await db.from("facebook_queue").select("status,request_started_at")
        .eq("page_id", FACEBOOK_PAGE_ID).in("status", ["processing", "needs_review"]);
      if (blocked.error) throw new Error("Queue unavailable");
      return { enabled: settings.enabled, automaticEnabled: settings.automatic_enabled, dryRun: shared.dryRun, ...getFacebookQueueBlockState(blocked.data ?? []) };
    },
    async verifyPage() {
      const { settings } = await getFacebookSettings(userId!);
      if (!settings || settings.page_id !== FACEBOOK_PAGE_ID) throw new Error("Page changed");
      await verifyFacebookPage(settings);
    },
    publish: () => publishFacebookForUser(userId!, true, FACEBOOK_PAGE_ID),
    async verifyReceipt(postId) {
      const result = await db.from("facebook_queue").select("id")
        .eq("user_id", userId!).eq("page_id", FACEBOOK_PAGE_ID).eq("status", "published")
        .eq("facebook_post_id", postId).not("published_at", "is", null).maybeSingle();
      return !result.error && Boolean(result.data);
    },
    pause
  });
  console.log(JSON.stringify(result));
  if (["failed", "needs_review"].includes(result.status)) process.exitCode = 1;
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  main().catch(error => {
    console.error(JSON.stringify({ status: "error", message: error instanceof FacebookTokenError ? error.message
      : "Facebook operation could not be confirmed. Inspect settings and queue; do not retry automatically." }));
    process.exitCode = 1;
  });
}
