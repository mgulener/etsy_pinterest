import { getCurrentUserSettings } from "@/lib/repositories/userSettingsRepository";
import type { NormalizedEtsyListing } from "@/lib/etsy/types";
import type { InstagramPostMode } from "./types";

export const INSTAGRAM_DEFAULT_MEDIA_COUNT = 5;
export const INSTAGRAM_MAX_MEDIA_COUNT = 10;

export async function getInstagramPostMode(): Promise<InstagramPostMode> {
  const settings = await getCurrentUserSettings();
  return settings.instagramPostMode;
}

export function resolveInstagramMediaUrls(
  listing: NormalizedEtsyListing,
  postMode: InstagramPostMode
) {
  const sourceUrls = listing.imageUrls.length > 0
    ? listing.imageUrls
    : listing.imageUrl
      ? [listing.imageUrl]
      : [];
  return sourceUrls.slice(0, postMode === "carousel" ? INSTAGRAM_DEFAULT_MEDIA_COUNT : 1);
}

export function resolveAvailableInstagramMediaUrls(listing: NormalizedEtsyListing) {
  const sourceUrls = listing.imageUrls.length > 0
    ? listing.imageUrls
    : listing.imageUrl
      ? [listing.imageUrl]
      : [];

  return sourceUrls.slice(0, INSTAGRAM_MAX_MEDIA_COUNT);
}

export function selectInstagramMediaUrls(
  availableMediaUrls: string[],
  postMode: InstagramPostMode,
  mediaCount = INSTAGRAM_DEFAULT_MEDIA_COUNT
) {
  const normalizedCount = Math.max(1, Math.min(INSTAGRAM_MAX_MEDIA_COUNT, Math.floor(mediaCount)));

  return postMode === "carousel"
    ? availableMediaUrls.slice(0, normalizedCount)
    : availableMediaUrls.slice(0, 1);
}
