import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { PublishAttempt, PublishAttemptStore } from "@/lib/instagram/durablePublishing";

export function createInstagramPublishAttemptsRepository(): PublishAttemptStore {
  const db = getSupabaseAdmin();
  async function findActive(listingId: number, accountId: string) {
    const { data, error } = await db.from("instagram_publish_attempts").select("*")
      .eq("etsy_listing_id", listingId).eq("account_id", accountId).not("state", "in", "(failed,retired)").maybeSingle();
    if (error) throw new Error("Failed to read publish attempt: " + error.message);
    return data as PublishAttempt | null;
  }
  async function transition(id: string, from: PublishAttempt["state"][], update: Partial<PublishAttempt>) {
    const { data, error } = await db.from("instagram_publish_attempts").update(update)
      .eq("id", id).in("state", from).select("id").maybeSingle();
    if (error) throw new Error("Failed to save publish attempt: " + error.message);
    return Boolean(data);
  }
  return {
    findActive,
    async acquire(listingId, accountId, input) {
      const existing = await findActive(listingId, accountId);
      if (existing) return { attempt: existing, created: false };
      const { data, error } = await db.from("instagram_publish_attempts").insert({
        etsy_listing_id: listingId, account_id: accountId, caption: input.caption,
        media_type: "IMAGE"
      }).select("*").single();
      if (error?.code === "23505") {
        const winner = await findActive(listingId, accountId);
        if (winner) return { attempt: winner, created: false };
      }
      if (error || !data) throw new Error("Cannot persist publish attempt: " + (error?.message ?? "missing record"));
      return { attempt: data as PublishAttempt, created: true };
    },
    async ready(id, containerId) {
      if (!await transition(id, ["preparing"], { state: "ready", container_id: containerId })) throw new Error("Publish attempt no longer owns preparation");
    },
    beginPublish: (id) => transition(id, ["ready"], { state: "publishing" }),
    async published(id, mediaId) {
      if (!await transition(id, ["publishing"], { state: "published", media_id: mediaId })) throw new Error("Publish receipt could not be saved");
    },
    failPreparation: (id) => transition(id, ["preparing", "ready"], { state: "failed" })
  };
}
