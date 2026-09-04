import { getCurrentUserSettings } from "@/lib/repositories/userSettingsRepository";
import { getOptionalNumber } from "@/lib/config/env";
import type { NormalizedEtsyListing } from "@/lib/etsy/types";
import type { InstagramPostMode } from "./types";

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
  const maxCarouselItems = getOptionalNumber("INSTAGRAM_CAROUSEL_MAX_ITEMS", 10);

  return postMode === "carousel"
    ? sourceUrls.slice(0, maxCarouselItems)
    : sourceUrls.slice(0, 1);
}
