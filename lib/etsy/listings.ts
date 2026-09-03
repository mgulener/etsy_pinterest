import type { EtsyListing, NormalizedEtsyListing } from "./types";

export function normalizeEtsyListing(listing: EtsyListing): NormalizedEtsyListing {
  const images = listing.Images ?? listing.images ?? [];
  const primaryImage = images[0];
  const imageUrls = images
    .map((image) => image.url_fullxfull ?? image.url_570xN)
    .filter((url): url is string => Boolean(url));

  return {
    etsyListingId: listing.listing_id,
    etsyImageId: primaryImage?.listing_image_id ?? null,
    imageUrl: primaryImage?.url_fullxfull ?? primaryImage?.url_570xN ?? null,
    imageUrls,
    title: listing.title,
    description: listing.description ?? listing.title,
    destinationUrl: listing.url ?? null,
    state: listing.state,
    originalCreationTimestamp:
      listing.original_creation_timestamp ??
      listing.created_timestamp ??
      listing.creation_timestamp ??
      null
  };
}
