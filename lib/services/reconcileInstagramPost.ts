import { getSettingsForUser } from "@/lib/repositories/userSettingsRepository";
import { createInstagramPublishAttemptsRepository } from "@/lib/repositories/instagramPublishAttemptsRepository";
import { createInstagramPostsRepository } from "@/lib/repositories/instagramPostsRepository";
import { createInstagramQueueRepository } from "@/lib/repositories/instagramQueueRepository";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { findOwnedInstagramMedia } from "@/lib/instagram/publishing";
import { getDurableInstagramPublisher } from "./publishInstagramPosts";

export async function reconcileInstagramPost(queueId: string, userId: string, mediaId?: string) {
  const db = getSupabaseAdmin();
  const { data: item, error } = await db.from("instagram_queue").select("*").eq("id", queueId).eq("status", "needs_review").maybeSingle();
  if (error) throw new Error(error.message);
  if (!item) throw new Error("Item is not awaiting verification.");
  const settings = await getSettingsForUser(userId);
  const accountId = settings.instagramAccountId || settings.instagramUserId;
  if (!accountId) throw new Error("Connect Instagram first.");
  const attempts = createInstagramPublishAttemptsRepository();
  const attempt = await attempts.findActive(item.etsy_listing_id, accountId);
  if (!attempt) throw new Error("No saved attempt for this Instagram account; manual investigation required.");
  if (mediaId) {
    if (attempt.state !== "publishing" && attempt.media_id !== mediaId) throw new Error("This attempt cannot be linked to that media ID.");
    const media = await findOwnedInstagramMedia(mediaId, userId);
    if (media.caption !== attempt.caption.slice(0, 2200) || media.media_type !== (attempt.media_type === "CAROUSEL" ? "CAROUSEL_ALBUM" : "IMAGE") ||
        new Date(media.timestamp).getTime() < new Date(attempt.created_at).getTime() - 60_000) {
      throw new Error("The selected post does not match this publishing attempt.");
    }
    if (attempt.state === "publishing") await attempts.published(attempt.id, mediaId);
  }
  const post = await getDurableInstagramPublisher(settings, userId).reconcile(item.etsy_listing_id);
  await createInstagramPostsRepository().createPost({
    etsyListingId: item.etsy_listing_id, etsyImageId: item.etsy_image_id,
    instagramMediaId: post.id, instagramCreationId: post.creationId,
    mediaType: post.mediaType, caption: post.caption ?? item.caption, instagramPermalink: post.permalink
  });
  await createInstagramQueueRepository().markPublished(item.id);
}
