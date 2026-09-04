import type { NormalizedEtsyListing } from "@/lib/etsy/types";

export type InstagramPostMode = "single" | "carousel";

export type CreateInstagramPostInput = {
  imageUrl: string;
  imageUrls?: string[];
  caption: string;
  mode?: InstagramPostMode;
  userId?: string | null;
};

export type CreateInstagramPostResult = {
  id: string;
  creationId?: string;
  mediaType: "IMAGE" | "CAROUSEL";
  permalink?: string;
};

export type InstagramContainerStatus =
  | "EXPIRED"
  | "ERROR"
  | "FINISHED"
  | "IN_PROGRESS"
  | "PUBLISHED";

export type InstagramErrorType =
  | "auth_error"
  | "rate_limit"
  | "invalid_media"
  | "temporary_error"
  | "publish_error";

export class InstagramApiError extends Error {
  constructor(
    message: string,
    readonly type: InstagramErrorType,
    readonly retryable: boolean
  ) {
    super(message);
    this.name = "InstagramApiError";
  }
}

export type PublishInstagramImageInput = {
  imageUrl: string;
  caption: string;
  userId?: string | null;
};

export type PublishInstagramCarouselInput = {
  imageUrls: string[];
  caption: string;
  userId?: string | null;
};

export type InstagramMediaUrlInput = Pick<
  NormalizedEtsyListing,
  "imageUrl" | "imageUrls"
>;
