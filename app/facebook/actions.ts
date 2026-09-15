"use server";

import { revalidatePath } from "next/cache";
import { requireAdminSession } from "@/lib/auth/session";
import { getEtsyAutomationUserId } from "@/lib/repositories/userSettingsRepository";
import { createFacebookRepository, getFacebookSettings } from "@/lib/repositories/facebookRepository";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { verifyFacebookPage } from "@/lib/facebook/client";
import { FacebookError, type FacebookActionState } from "@/lib/facebook/types";
import { queueExistingFacebookListings } from "@/lib/services/queueFacebookListings";
import { publishFacebookForUser } from "@/lib/services/publishFacebookPosts";
import { isValidFacebookInterval } from "@/lib/facebook/settings";

async function owner() {
  const session = await requireAdminSession();
  if (await getEtsyAutomationUserId() !== session.userId) throw new Error("Only the connected Etsy shop owner can manage Facebook publishing.");
  return session.userId;
}

function refresh() {
  for (const path of ["/settings", "/facebook/queue", "/facebook/posts", "/dashboard", "/etsy/listings"]) revalidatePath(path);
}

export async function saveFacebookSettingsAction(_state: FacebookActionState, form: FormData): Promise<FacebookActionState> {
  const userId = await owner();
  try {
    const { available, settings: current } = await getFacebookSettings(userId);
    if (!available) return { ok: false, message: "Apply database migration 0023 first." };
    if (String(form.get("updatedAt") ?? "") !== (current?.updated_at ?? "")) {
      return { ok: false, message: "Facebook settings changed. Refresh before saving." };
    }
    const tokenInput = String(form.get("pageAccessToken") ?? "").trim();
    const pageId = String(form.get("pageId") ?? "").trim();
    const apiVersion = String(form.get("apiVersion") ?? "").trim();
    const interval = Number(form.get("intervalMinutes"));
    if (!isValidFacebookInterval(interval)) return { ok: false, message: "Choose an interval between 5 and 1440 minutes." };
    const enabled = form.get("enabled") === "on";
    const credentials = { page_id: pageId, api_version: apiVersion, page_access_token: tokenInput || (current?.page_id === pageId ? current.page_access_token : "") };
    const needsVerification = enabled || !current || tokenInput || pageId !== current.page_id || apiVersion !== current.api_version;
    const page = needsVerification ? await verifyFacebookPage(credentials) : { name: current!.page_name };
    const values = { ...credentials, page_name: page.name, enabled,
      automatic_enabled: enabled && form.get("automaticEnabled") === "on", interval_minutes: interval,
      verified_at: needsVerification ? new Date().toISOString() : current!.verified_at };
    const db = getSupabaseAdmin();
    const result = current
      ? await db.from("facebook_settings").update(values).eq("user_id", userId).eq("updated_at", current.updated_at).select("user_id")
      : await db.from("facebook_settings").insert({ ...values, user_id: userId }).select("user_id");
    if (result.error || !result.data?.length) return { ok: false, message: "Facebook settings could not be saved or changed during verification. Refresh and try again." };
    refresh();
    return { ok: true, message: `Saved: ${page.name}. Facebook ${enabled ? "enabled" : "disabled"}.` };
  } catch (error) {
    return { ok: false, message: error instanceof FacebookError ? error.message : "Facebook settings could not be saved. Check database availability." };
  }
}

export async function facebookQueueAction(_state: FacebookActionState, form: FormData): Promise<FacebookActionState> {
  const userId = await owner();
  try {
    const { settings } = await getFacebookSettings(userId);
    if (!settings) return { ok: false, message: "Connect Facebook in Settings first." };
    const command = String(form.get("command") ?? "");
    if (command === "publish") {
      const result = await publishFacebookForUser(userId);
      refresh();
      const messages = {
        disabled: "Facebook publishing is disabled.",
        waiting: "No publication started: no due item, minimum interval not reached, or a previous publication needs review.",
        dry_run: "Dry run finished. No Facebook post was sent.",
        published: "One Facebook post was published.",
        failed: "Facebook rejected the publication.",
        needs_review: "The publication needs review. Automatic publishing is paused."
      };
      return { ok: !["failed", "needs_review"].includes(result.status), message: ("message" in result ? result.message : undefined) ?? messages[result.status] };
    }
    if (command === "build") {
      const result = await queueExistingFacebookListings(userId);
      refresh(); return { ok: true, message: `Added ${result.created} products; skipped ${result.skipped} without an image or link. No posts were published.` };
    }
    if (command === "add") {
      const listingId = Number(form.get("listingId"));
      if (!Number.isSafeInteger(listingId) || listingId <= 0) return { ok: false, message: "Invalid listing." };
      const result = await queueExistingFacebookListings(userId, listingId);
      refresh(); return { ok: true, message: result.created ? "Added to Facebook queue." : "No item added: already queued/published or not an active listing with an image and link." };
    }
    const id = String(form.get("id") ?? "");
    const version = String(form.get("updatedAt") ?? "");
    if (!/^[0-9a-f-]{36}$/i.test(id) || !Number.isFinite(Date.parse(version))) return { ok: false, message: "Invalid item or version. Refresh the queue." };
    const repository = createFacebookRepository(userId, settings.page_id);
    if (command === "save") {
      const message = String(form.get("message") ?? "");
      if (!message.trim() || message.trim().length > 2000) return { ok: false, message: "Message must contain 1-2000 characters." };
      const scheduledAt = String(form.get("scheduledAt") ?? "");
      if (!Number.isFinite(Date.parse(scheduledAt))) return { ok: false, message: "Enter a valid publication date." };
      await repository.saveDraft(id, message, scheduledAt, version);
    } else if (command === "cancel") await repository.cancel(id, version);
    else if (command === "retry") await repository.retry(id, version);
    else return { ok: false, message: "Unknown Facebook action." };
    refresh(); return { ok: true, message: command === "cancel" ? "Removed from the active queue." : "Facebook queue updated." };
  } catch {
    return { ok: false, message: "The action could not be confirmed. Refresh to check its state before trying again; the item may have changed or publishing may have started." };
  }
}
