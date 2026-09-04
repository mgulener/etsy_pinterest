import type { EtsyListing, NormalizedEtsyListing } from "./types";

const namedEntities: Record<string, string> = {
  amp: "&",
  apos: "'",
  gt: ">",
  lt: "<",
  nbsp: " ",
  quot: '"'
};

export function decodeHtmlEntities(value: string): string {
  return value.replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (entity, token: string) => {
    const normalizedToken = token.toLowerCase();

    if (normalizedToken.startsWith("#x")) {
      const codePoint = Number.parseInt(normalizedToken.slice(2), 16);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : entity;
    }

    if (normalizedToken.startsWith("#")) {
      const codePoint = Number.parseInt(normalizedToken.slice(1), 10);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : entity;
    }

    return namedEntities[normalizedToken] ?? entity;
  });
}

export function normalizeEtsyListing(listing: EtsyListing): NormalizedEtsyListing {
  const images = listing.Images ?? listing.images ?? [];
  const primaryImage = images[0];
  const imageUrls = images
    .map((image) => image.url_fullxfull ?? image.url_570xN)
    .filter((url): url is string => Boolean(url));
  const title = decodeHtmlEntities(listing.title);
  const description = decodeHtmlEntities(listing.description ?? listing.title);

  return {
    etsyListingId: listing.listing_id,
    etsyImageId: primaryImage?.listing_image_id ?? null,
    imageUrl: primaryImage?.url_fullxfull ?? primaryImage?.url_570xN ?? null,
    imageUrls,
    title,
    description,
    destinationUrl: listing.url ?? null,
    state: listing.state,
    originalCreationTimestamp:
      listing.original_creation_timestamp ??
      listing.created_timestamp ??
      listing.creation_timestamp ??
      null
  };
}
