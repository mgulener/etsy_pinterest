import { getOptionalNumber } from "@/lib/config/env";
import { getCurrentUserSettings, requireSetting } from "@/lib/repositories/userSettingsRepository";
import type {
  CreateInstagramPostResult,
  InstagramContainerStatus,
  PublishInstagramCarouselInput,
  PublishInstagramImageInput
} from "./types";
import { InstagramApiError } from "./types";

const INSTAGRAM_API_URL = "https://graph.instagram.com";
const DEFAULT_META_API_VERSION = "v25.0";

type InstagramContainerResponse = {
  id: string;
};

type InstagramPublishResponse = {
  id: string;
};

type InstagramMediaResponse = {
  permalink?: string;
};

type InstagramContainerStatusResponse = {
  status_code?: InstagramContainerStatus;
  status?: string;
};

async function getInstagramApiSettings() {
  const settings = await getCurrentUserSettings();

  return {
    apiVersion: settings.metaApiVersion || DEFAULT_META_API_VERSION,
    accessToken: requireSetting(settings.instagramAccessToken, "Instagram access token"),
    accountId: requireSetting(
      settings.instagramAccountId || settings.instagramUserId,
      "Instagram account ID"
    )
  };
}

function classifyInstagramError(
  status: number,
  body: string,
  operation: "container" | "publish" | "status" | "media"
) {
  const lowerBody = body.toLowerCase();

  if (
    status === 401 ||
    status === 403 ||
    lowerBody.includes("oauthexception") ||
    lowerBody.includes("invalid oauth")
  ) {
    return new InstagramApiError(
      `Instagram authentication failed while calling ${operation}: ${status} ${body}`,
      "auth_error",
      false
    );
  }

  if (status === 429 || lowerBody.includes("rate limit")) {
    return new InstagramApiError(
      `Instagram rate limit hit while calling ${operation}: ${status} ${body}`,
      "rate_limit",
      true
    );
  }

  if (
    lowerBody.includes("image_url") ||
    lowerBody.includes("media") ||
    lowerBody.includes("unsupported") ||
    lowerBody.includes("not accessible")
  ) {
    return new InstagramApiError(
      `Instagram rejected the media while calling ${operation}: ${status} ${body}`,
      "invalid_media",
      false
    );
  }

  const type = operation === "publish" ? "publish_error" : "temporary_error";
  return new InstagramApiError(
    `Instagram API request failed while calling ${operation}: ${status} ${body}`,
    type,
    true
  );
}

async function instagramPost<T>(
  path: string,
  params: URLSearchParams,
  operation: "container" | "publish"
) {
  const settings = await getInstagramApiSettings();
  const response = await fetch(`${INSTAGRAM_API_URL}/${settings.apiVersion}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: params.toString(),
    cache: "no-store"
  });

  if (!response.ok) {
    throw classifyInstagramError(response.status, await response.text(), operation);
  }

  return (await response.json()) as T;
}

async function instagramGet<T>(
  path: string,
  params: URLSearchParams,
  operation: "status" | "media"
) {
  const settings = await getInstagramApiSettings();
  const response = await fetch(
    `${INSTAGRAM_API_URL}/${settings.apiVersion}${path}?${params.toString()}`,
    { cache: "no-store" }
  );

  if (!response.ok) {
    throw classifyInstagramError(response.status, await response.text(), operation);
  }

  return (await response.json()) as T;
}

async function buildTokenParams(extra?: Record<string, string>) {
  const settings = await getInstagramApiSettings();

  return new URLSearchParams({
    access_token: settings.accessToken,
    ...extra
  });
}

export async function createImageContainer(input: PublishInstagramImageInput) {
  return instagramPost<InstagramContainerResponse>(
    `/${(await getInstagramApiSettings()).accountId}/media`,
    await buildTokenParams({
      image_url: input.imageUrl,
      caption: input.caption.slice(0, 2200)
    }),
    "container"
  );
}

export async function createCarouselItem(imageUrl: string) {
  return instagramPost<InstagramContainerResponse>(
    `/${(await getInstagramApiSettings()).accountId}/media`,
    await buildTokenParams({
      image_url: imageUrl,
      is_carousel_item: "true"
    }),
    "container"
  );
}

export async function createCarouselContainer(input: {
  creationIds: string[];
  caption: string;
}) {
  return instagramPost<InstagramContainerResponse>(
    `/${(await getInstagramApiSettings()).accountId}/media`,
    await buildTokenParams({
      media_type: "CAROUSEL",
      children: input.creationIds.join(","),
      caption: input.caption.slice(0, 2200)
    }),
    "container"
  );
}

export async function getContainerStatus(creationId: string) {
  return instagramGet<InstagramContainerStatusResponse>(
    `/${creationId}`,
    await buildTokenParams({ fields: "status_code,status" }),
    "status"
  );
}

export async function waitForContainer(creationId: string) {
  const maxPolls = getOptionalNumber("INSTAGRAM_CONTAINER_MAX_POLLS", 6);
  const pollIntervalMs = getOptionalNumber("INSTAGRAM_CONTAINER_POLL_INTERVAL_MS", 1000);

  for (let attempt = 0; attempt < maxPolls; attempt += 1) {
    const status = await getContainerStatus(creationId);

    if (!status.status_code || status.status_code === "FINISHED") {
      return;
    }

    if (status.status_code === "ERROR" || status.status_code === "EXPIRED") {
      throw new InstagramApiError(
        `Instagram container ${creationId} status is ${status.status_code}: ${status.status ?? ""}`,
        "invalid_media",
        false
      );
    }

    if (status.status_code === "PUBLISHED") {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  throw new InstagramApiError(
    `Instagram container ${creationId} did not finish processing in time`,
    "temporary_error",
    true
  );
}

export async function publishMedia(creationId: string) {
  return instagramPost<InstagramPublishResponse>(
    `/${(await getInstagramApiSettings()).accountId}/media_publish`,
    await buildTokenParams({ creation_id: creationId }),
    "publish"
  );
}

export async function getMedia(mediaId: string) {
  return instagramGet<InstagramMediaResponse>(
    `/${mediaId}`,
    await buildTokenParams({ fields: "permalink" }),
    "media"
  );
}

export async function publishInstagramImage(
  input: PublishInstagramImageInput
): Promise<CreateInstagramPostResult> {
  const container = await createImageContainer(input);
  await waitForContainer(container.id);
  const published = await publishMedia(container.id);

  try {
    const media = await getMedia(published.id);
    return {
      id: published.id,
      creationId: container.id,
      mediaType: "IMAGE",
      permalink: media.permalink
    };
  } catch {
    return {
      id: published.id,
      creationId: container.id,
      mediaType: "IMAGE"
    };
  }
}

export async function publishInstagramCarousel(
  input: PublishInstagramCarouselInput
): Promise<CreateInstagramPostResult> {
  if (input.imageUrls.length < 2) {
    return publishInstagramImage({
      imageUrl: input.imageUrls[0] ?? "",
      caption: input.caption
    });
  }

  const childContainers: string[] = [];

  for (const imageUrl of input.imageUrls) {
    const child = await createCarouselItem(imageUrl);
    await waitForContainer(child.id);
    childContainers.push(child.id);
  }

  const carouselContainer = await createCarouselContainer({
    creationIds: childContainers,
    caption: input.caption
  });
  await waitForContainer(carouselContainer.id);
  const published = await publishMedia(carouselContainer.id);

  try {
    const media = await getMedia(published.id);
    return {
      id: published.id,
      creationId: carouselContainer.id,
      mediaType: "CAROUSEL",
      permalink: media.permalink
    };
  } catch {
    return {
      id: published.id,
      creationId: carouselContainer.id,
      mediaType: "CAROUSEL"
    };
  }
}
