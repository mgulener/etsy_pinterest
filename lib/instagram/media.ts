import type { NormalizedEtsyListing } from "@/lib/etsy/types";
export const INSTAGRAM_MAX_MEDIA_COUNT = 10;

export function resolveInstagramMediaUrls(
  listing: NormalizedEtsyListing
) {
  const sourceUrls = listing.imageUrls.length > 0
    ? listing.imageUrls
    : listing.imageUrl
      ? [listing.imageUrl]
      : [];
  return sourceUrls.slice(0, 1);
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
  availableMediaUrls: string[]
) {
  return availableMediaUrls.slice(0, 1);
}
