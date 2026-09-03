import type { EtsyListing, NormalizedEtsyListing } from "./types";

export function normalizeEtsyListing(listing: EtsyListing): NormalizedEtsyListing {
  const primaryImage = listing.Images?.[0] ?? listing.images?.[0];

  return {
    etsyListingId: listing.listing_id,
    etsyImageId: primaryImage?.listing_image_id ?? null,
    imageUrl: primaryImage?.url_fullxfull ?? primaryImage?.url_570xN ?? null,
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
