import { getOptionalNumber } from "@/lib/config/env";
import type {
  InstagramMediaUrlInput,
  InstagramPostMode
} from "@/lib/instagram/types";

export function getInstagramPostMode(): InstagramPostMode {
  return process.env.INSTAGRAM_POST_MODE === "carousel" ? "carousel" : "single";
}

export function resolveInstagramMediaUrls(
  listing: InstagramMediaUrlInput,
  mode = getInstagramPostMode()
) {
  const urls = listing.imageUrls.length > 0
    ? listing.imageUrls
    : listing.imageUrl
      ? [listing.imageUrl]
      : [];

  if (mode === "single") {
    return urls.slice(0, 1);
  }

  const maxCarouselItems = getOptionalNumber("INSTAGRAM_CAROUSEL_MAX_ITEMS", 10);
  return urls.slice(0, maxCarouselItems);
}
