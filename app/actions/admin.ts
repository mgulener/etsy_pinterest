"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdminSession } from "@/lib/auth/session";
import { bootstrapExistingListings } from "@/lib/services/bootstrap";
import { publishInstagramPosts } from "@/lib/services/publishInstagramPosts";
import { publishPinterestPins } from "@/lib/services/publishPinterestPins";
import { syncEtsyListings } from "@/lib/services/syncEtsyListings";
import { createInstagramQueueRepository } from "@/lib/repositories/instagramQueueRepository";
import { createInstagramPostsRepository } from "@/lib/repositories/instagramPostsRepository";
import { createPinQueueRepository } from "@/lib/repositories/pinQueueRepository";
import { getCurrentUserSettings, requireSetting } from "@/lib/repositories/userSettingsRepository";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { buildInstagramCaption } from "@/lib/instagram/caption";
import type { NormalizedEtsyListing } from "@/lib/etsy/types";
import type { InstagramPostMode } from "@/lib/instagram/types";


function normalizeListingRow(listing: {
  etsy_listing_id: number;
  etsy_image_id: number | null;
  image_url: string | null;
  title: string;
  description: string | null;
  url: string | null;
  state: string;
  original_creation_timestamp: number | null;
}): NormalizedEtsyListing {
  return {
    etsyListingId: listing.etsy_listing_id,
    etsyImageId: listing.etsy_image_id,
    imageUrl: listing.image_url,
    imageUrls: listing.image_url ? [listing.image_url] : [],
    title: listing.title,
    description: listing.description,
    destinationUrl: listing.url,
    state: listing.state,
    originalCreationTimestamp: listing.original_creation_timestamp
  };
}

function toActionErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown action error";
}

async function getListingForManualQueue(formData: FormData): Promise<NormalizedEtsyListing | null> {
  const rawId = Number(formData.get("etsyListingId") ?? "");

  if (!Number.isFinite(rawId)) {
    return null;
  }

  const { data, error } = await getSupabaseAdmin()
    .from("etsy_listings")
    .select("*")
    .eq("etsy_listing_id", rawId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to find Etsy listing ${rawId}: ${error.message}`);
  }

  return data ? normalizeListingRow(data) : null;
}

export async function bootstrapAction() {
  await requireAdminSession();
  const result = await bootstrapExistingListings();
  revalidatePath("/");
  redirect(
    `/dashboard?action=bootstrap&saved=${result.saved}&fetched=${result.fetched}&errors=${result.errors.length}`
  );
}

export async function syncNowAction() {
  await requireAdminSession();

  let destination: string;

  try {
    const result = await syncEtsyListings();
    revalidatePath("/");
    destination = `/dashboard?action=sync&fetched=${result.fetched}&known=${result.known}&queued=${result.queued}&instagramQueued=${result.instagramQueued}&errors=${result.errors.length}`;
  } catch (error) {
    destination = `/dashboard?action=sync-error&message=${encodeURIComponent(toActionErrorMessage(error))}`;
  }

  redirect(destination);
}

export async function publishNowAction() {
  await requireAdminSession();
  const result = await publishPinterestPins();
  revalidatePath("/");
  redirect(
    `/pinterest/queue?action=publish&selected=${result.selected}&published=${result.published}&failed=${result.failed}&retried=${result.retried}&dryRun=${result.dryRun}`
  );
}

export async function publishInstagramNowAction() {
  await requireAdminSession();
  const result = await publishInstagramPosts();
  revalidatePath("/");
  redirect(
    `/instagram/queue?action=publish-instagram&selected=${result.selected}&published=${result.published}&failed=${result.failed}&retried=${result.retried}&dryRun=${result.dryRun}`
  );
}


export async function queuePinterestListingAction(formData: FormData) {
  await requireAdminSession();
  const listing = await getListingForManualQueue(formData);

  if (listing) {
    const settings = await getCurrentUserSettings();

    if (settings.pinterestEnabled) {
      await createPinQueueRepository().enqueueListing(
        listing,
        requireSetting(settings.pinterestBoardId, "Pinterest board ID")
      );
    }
  }

  revalidatePath("/etsy/listings");
  revalidatePath("/pinterest/queue");
}

export async function queueInstagramListingAction(formData: FormData) {
  await requireAdminSession();
  const listing = await getListingForManualQueue(formData);

  if (listing) {
    const settings = await getCurrentUserSettings();

    if (settings.instagramEnabled) {
      await createInstagramQueueRepository().enqueueListing(listing);
    }
  }

  revalidatePath("/etsy/listings");
  revalidatePath("/instagram/queue");
}

export async function retryQueueItemAction(formData: FormData) {
  await requireAdminSession();
  const id = String(formData.get("id") ?? "");

  if (id) {
    await createPinQueueRepository().retry(id);
  }

  revalidatePath("/pinterest/queue");
}

export async function retryInstagramQueueItemAction(formData: FormData) {
  await requireAdminSession();
  const id = String(formData.get("id") ?? "");

  if (id) {
    await createInstagramQueueRepository().retry(id);
  }

  revalidatePath("/instagram/queue");
}

export async function updateInstagramQueueItemAction(formData: FormData) {
  await requireAdminSession();
  const id = String(formData.get("id") ?? "");
  const caption = String(formData.get("caption") ?? "").trim();
  const rawPostMode = String(formData.get("postMode") ?? "single");
  const postMode: InstagramPostMode = rawPostMode === "carousel" ? "carousel" : "single";

  if (id && caption) {
    await createInstagramQueueRepository().updateDetails({ id, caption, postMode });
  }

  revalidatePath("/instagram/queue");
}

export async function queueInstagramPostAgainAction(formData: FormData) {
  await requireAdminSession();
  const id = String(formData.get("id") ?? "");

  if (!id) {
    revalidatePath("/instagram/posts");
    return;
  }

  const postsRepository = createInstagramPostsRepository();
  const post = await postsRepository.findById(id);

  if (!post) {
    revalidatePath("/instagram/posts");
    return;
  }

  const supabase = getSupabaseAdmin();
  const { data: listing, error } = await supabase
    .from("etsy_listings")
    .select("*")
    .eq("etsy_listing_id", post.etsy_listing_id)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to find Etsy listing for Instagram republish: ${error.message}`);
  }

  await postsRepository.deleteById(id);

  const fallbackListing: NormalizedEtsyListing = {
    etsyListingId: post.etsy_listing_id,
    etsyImageId: post.etsy_image_id,
    imageUrl: null,
    imageUrls: [],
    title: `Etsy listing ${post.etsy_listing_id}`,
    description: null,
    destinationUrl: null,
    state: "active",
    originalCreationTimestamp: null
  };
  const normalizedListing: NormalizedEtsyListing = listing
    ? {
        etsyListingId: listing.etsy_listing_id,
        etsyImageId: listing.etsy_image_id,
        imageUrl: listing.image_url,
        imageUrls: listing.image_url ? [listing.image_url] : [],
        title: listing.title,
        description: listing.description,
        destinationUrl: listing.url,
        state: listing.state,
        originalCreationTimestamp: listing.original_creation_timestamp
      }
    : fallbackListing;
  const caption = post.caption ?? buildInstagramCaption(normalizedListing);

  const { error: upsertError } = await supabase.from("instagram_queue").upsert(
    {
      etsy_listing_id: normalizedListing.etsyListingId,
      etsy_image_id: normalizedListing.etsyImageId,
      image_url: normalizedListing.imageUrl,
      title: normalizedListing.title,
      description: normalizedListing.description,
      destination_url: normalizedListing.destinationUrl,
      caption,
      status: "pending",
      attempt_count: 0,
      last_error: null,
      scheduled_at: new Date().toISOString(),
      processing_started_at: null,
      processed_at: null
    },
    { onConflict: "etsy_listing_id" }
  );

  if (upsertError) {
    throw new Error(`Failed to requeue Instagram post ${id}: ${upsertError.message}`);
  }

  revalidatePath("/instagram/posts");
  revalidatePath("/instagram/queue");
  redirect("/instagram/queue");
}

export async function deleteInstagramQueueItemAction(formData: FormData) {
  await requireAdminSession();
  const id = String(formData.get("id") ?? "");

  if (id) {
    await createInstagramQueueRepository().delete(id);
  }

  revalidatePath("/instagram/queue");
}

export async function retryAllFailedInstagramAction() {
  await requireAdminSession();
  await createInstagramQueueRepository().retryAllFailed();
  revalidatePath("/instagram/queue");
}

export async function cancelInstagramQueueItemAction(formData: FormData) {
  await requireAdminSession();
  const id = String(formData.get("id") ?? "");

  if (id) {
    await createInstagramQueueRepository().cancel(id);
  }

  revalidatePath("/instagram/queue");
}

export async function deleteQueueItemAction(formData: FormData) {
  await requireAdminSession();
  const id = String(formData.get("id") ?? "");

  if (id) {
    await createPinQueueRepository().delete(id);
  }

  revalidatePath("/pinterest/queue");
}

export async function retryAllFailedAction() {
  await requireAdminSession();
  await createPinQueueRepository().retryAllFailed();
  revalidatePath("/pinterest/queue");
}

export async function cancelQueueItemAction(formData: FormData) {
  await requireAdminSession();
  const id = String(formData.get("id") ?? "");

  if (id) {
    await createPinQueueRepository().cancel(id);
  }

  revalidatePath("/pinterest/queue");
}
