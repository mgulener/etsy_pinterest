import type { NormalizedEtsyListing } from "@/lib/etsy/types";
import { getPinDescription } from "@/lib/pinterest/description";
import { createFacebookRepository, getFacebookSettings } from "@/lib/repositories/facebookRepository";
import { getEtsyAutomationUserId } from "@/lib/repositories/userSettingsRepository";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export async function getFacebookSyncQueue(userId: string) {
  const { settings } = await getFacebookSettings(userId);
  if (!settings?.enabled) return undefined;
  if (await getEtsyAutomationUserId() !== userId) throw new Error("Only the connected Etsy shop owner can queue these listings.");
  const repository = createFacebookRepository(userId, settings.page_id);
  return {
    enqueueListings: repository.enqueueListings,
    async enqueueListing(listing: NormalizedEtsyListing, options?: { scheduledAt?: string }) {
      const { data, error } = await getSupabaseAdmin().from("pin_queue").select("pin_description")
        .eq("etsy_listing_id", listing.etsyListingId).maybeSingle();
      if (error) throw new Error("Could not read the saved product description for Facebook.");
      const description = getPinDescription({ title: listing.title, description: listing.description, pin_description: data?.pin_description ?? null });
      return repository.enqueueListing(listing, { ...options, description });
    },
    rebuildPendingSchedule: () => repository.rebuildPendingSchedule(settings.interval_minutes)
  };
}

export async function queueExistingFacebookListings(userId: string, listingId?: number) {
  const queue = await getFacebookSyncQueue(userId);
  if (!queue) throw new Error("Connect and enable Facebook in Settings first.");
  let created = 0;
  let skipped = 0;
  for (let from = 0; ; from += 100) {
    let query = getSupabaseAdmin().from("etsy_listings").select("*").eq("state", "active").order("etsy_listing_id").range(from, from + 99);
    if (listingId) query = query.eq("etsy_listing_id", listingId);
    const { data, error } = await query;
    if (error) throw new Error("Could not read Etsy listings for the Facebook queue.");
    const ids = (data ?? []).map(listing => listing.etsy_listing_id);
    const descriptions = new Map<number, string | null>();
    if (ids.length) {
      const { data: pins, error: pinError } = await getSupabaseAdmin().from("pin_queue").select("etsy_listing_id,pin_description").in("etsy_listing_id", ids);
      if (pinError) throw new Error("Could not read saved product descriptions for Facebook.");
      for (const pin of pins ?? []) descriptions.set(pin.etsy_listing_id, pin.pin_description);
    }
    const batch: Array<{ listing: NormalizedEtsyListing; description: string }> = [];
    for (const listing of data ?? []) {
      if (!listing.image_url || !listing.url) { skipped++; continue; }
      batch.push({ listing: {
        etsyListingId: listing.etsy_listing_id, etsyShopSectionId: listing.etsy_shop_section_id,
        etsyImageId: listing.etsy_image_id, title: listing.title, description: listing.description,
        imageUrl: listing.image_url, imageUrls: [], destinationUrl: listing.url, state: listing.state,
        originalCreationTimestamp: listing.original_creation_timestamp
      }, description: getPinDescription({ title: listing.title, description: listing.description, pin_description: descriptions.get(listing.etsy_listing_id) ?? null }) });
    }
    created += await queue.enqueueListings(batch);
    if (listingId || (data?.length ?? 0) < 100) break;
  }
  if (created) await queue.rebuildPendingSchedule();
  return { created, skipped };
}
