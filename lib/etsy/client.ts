import { getServerEnv } from "@/lib/config/env";
import { logger } from "@/lib/utils/logger";
import { getEtsyAccessToken } from "./auth";
import type { EtsyListing, EtsyListingsResponse } from "./types";

const ETSY_API_URL = "https://api.etsy.com/v3/application";
const ETSY_PAGE_LIMIT = 100;

export async function getAllActiveListings(): Promise<EtsyListing[]> {
  const env = getServerEnv();
  const accessToken = await getEtsyAccessToken();
  const listings: EtsyListing[] = [];
  let offset = 0;
  let totalCount: number | null = null;

  do {
    logger.info("ETSY", "Fetching active listings page", {
      offset,
      limit: ETSY_PAGE_LIMIT
    });

    const url = new URL(`${ETSY_API_URL}/shops/${env.etsyShopId}/listings`);
    url.searchParams.set("state", "active");
    url.searchParams.set("limit", String(ETSY_PAGE_LIMIT));
    url.searchParams.set("offset", String(offset));
    url.searchParams.set("includes", "Images");

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "x-api-key": env.etsyApiKey
      },
      cache: "no-store"
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Etsy API request failed: ${response.status} ${body}`);
    }

    const data = (await response.json()) as EtsyListingsResponse;
    listings.push(...data.results);
    totalCount = data.count;

    logger.info("ETSY", "Received listings page", {
      offset,
      received: data.results.length,
      totalCount
    });

    offset += ETSY_PAGE_LIMIT;
  } while (totalCount === null || listings.length < totalCount);

  logger.info("ETSY", "Total active listings fetched", {
    count: listings.length
  });

  return listings;
}
