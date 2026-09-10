export type EtsyImage = {
  listing_image_id?: number;
  url_75x75?: string;
  url_170x135?: string;
  url_570xN?: string;
  url_fullxfull?: string;
  alt_text?: string;
};

export type EtsyListing = {
  listing_id: number;
  shop_section_id?: number | null;
  title: string;
  description?: string;
  url?: string;
  state: string;
  original_creation_timestamp?: number;
  created_timestamp?: number;
  creation_timestamp?: number;
  Images?: EtsyImage[];
  images?: EtsyImage[];
};

export type EtsyShopSection = {
  shop_section_id: number;
  title: string;
  rank?: number;
  active_listing_count?: number;
};

export type EtsyShopSectionsResponse = {
  count: number;
  results: EtsyShopSection[];
};

export type EtsyListingsResponse = {
  count: number;
  results: EtsyListing[];
};

export type NormalizedEtsyListing = {
  etsyListingId: number;
  etsyShopSectionId: number | null;
  etsyImageId: number | null;
  imageUrl: string | null;
  imageUrls: string[];
  title: string;
  description: string | null;
  destinationUrl: string | null;
  state: string;
  originalCreationTimestamp: number | null;
};
