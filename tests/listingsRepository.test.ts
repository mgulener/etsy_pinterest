import assert from "node:assert/strict";
import test from "node:test";
import { uniqueListingsById } from "../lib/repositories/listingsRepository";
import type { NormalizedEtsyListing } from "../lib/etsy/types";

function listing(etsyListingId: number, title: string): NormalizedEtsyListing {
  return {
    etsyListingId,
    etsyShopSectionId: null,
    etsyImageId: null,
    imageUrl: null,
    imageUrls: [],
    title,
    description: null,
    destinationUrl: null,
    state: "active",
    originalCreationTimestamp: null
  };
}

test("batch upserts keep one current row for duplicate Etsy listing ids", () => {
  const result = uniqueListingsById([
    listing(101, "Older snapshot"),
    listing(202, "Another listing"),
    listing(101, "Latest snapshot")
  ]);

  assert.deepEqual(result.map((item) => item.etsyListingId), [101, 202]);
  assert.equal(result[0]?.title, "Latest snapshot");
});
