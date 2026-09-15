import { createFacebookPhoto } from "@/lib/facebook/client";
import { FacebookError, type FacebookQueueRow, type FacebookSettings } from "@/lib/facebook/types";
import { validateFacebookMedia, validateFacebookMessage } from "@/lib/facebook/content";
import { createFacebookRepository, getFacebookSettings } from "@/lib/repositories/facebookRepository";
import { getEtsyAutomationUserId, getSettingsForUser } from "@/lib/repositories/userSettingsRepository";

export type FacebookPublishDependencies = {
  settings: FacebookSettings | null;
  dryRun: boolean;
  automatic: boolean;
  queue: Pick<ReturnType<typeof createFacebookRepository>, "claim" | "preview" | "recordPublished" | "recordFailure" | "pause">;
  publish(item: FacebookQueueRow): Promise<{ postId: string }>;
};

export async function publishFacebookWithDependencies(deps: FacebookPublishDependencies) {
  const config = deps.settings;
  if (!config?.enabled || (deps.automatic && !config.automatic_enabled)) return { status: "disabled" as const };
  if (deps.dryRun) return { status: "dry_run" as const, selected: (await deps.queue.preview()) ? 1 : 0 };
  const item = await deps.queue.claim(deps.automatic);
  if (!item) return { status: "waiting" as const };
  let submitted = false;
  try {
    if (item.user_id !== config.user_id || item.page_id !== config.page_id) {
      throw new FacebookError("Facebook Page changed during the run. Review the pending item.", true, true);
    }
    validateFacebookMedia(item.image_url, item.destination_url);
    validateFacebookMessage(item.message);
    submitted = true;
    const result = await deps.publish(item);
    await deps.queue.recordPublished(item.id, result.postId);
    return { status: "published" as const, postId: result.postId };
  } catch (cause) {
    const ambiguous = cause instanceof FacebookError ? cause.ambiguous : submitted;
    const message = cause instanceof FacebookError ? cause.message : submitted
      ? "Publication may have completed, but its receipt was not confirmed. Review the Page; no automatic retry."
      : "Invalid Facebook draft. Check the image, message and Etsy link.";
    // If persisting the failure also fails, the processing row stays locked, never requeued.
    try { await deps.queue.recordFailure(item.id, message, ambiguous); }
    finally { if (deps.automatic || ambiguous || (cause instanceof FacebookError && cause.pause)) await deps.queue.pause(); }
    return { status: ambiguous ? "needs_review" as const : "failed" as const, message };
  }
}

export async function publishFacebookForUser(userId: string, automatic = false, expectedPageId?: string) {
  if (await getEtsyAutomationUserId() !== userId) throw new Error("Only the connected Etsy shop owner can publish its listings.");
  const { available, settings } = await getFacebookSettings(userId);
  if (!available) throw new Error("Apply Facebook migration 0023 first.");
  if (!settings) return { status: "disabled" as const };
  if (expectedPageId && settings.page_id !== expectedPageId) throw new Error("Facebook Page changed before publication.");
  const shared = await getSettingsForUser(userId);
  return publishFacebookWithDependencies({
    settings, automatic, dryRun: shared.dryRun,
    queue: createFacebookRepository(userId, settings.page_id),
    publish: item => createFacebookPhoto(settings, { message: item.message, imageUrl: item.image_url, destinationUrl: item.destination_url })
  });
}
