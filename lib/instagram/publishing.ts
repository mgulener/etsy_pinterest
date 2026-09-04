import { getOptionalNumber } from "@/lib/config/env";
import { getCurrentUserSettings, getSettingsForUser, requireSetting } from "@/lib/repositories/userSettingsRepository";
import type {
  CreateInstagramPostResult,
  InstagramContainerStatus,
  PublishInstagramCarouselInput,
  PublishInstagramImageInput
} from "./types";
import { InstagramApiError } from "./types";

const INSTAGRAM_API_URL = "https://graph.instagram.com";
const DEFAULT_META_API_VERSION = "v25.0";
const DEFAULT_INSTAGRAM_FETCH_TIMEOUT_MS = 60_000;

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

async function getInstagramApiSettings(userId?: string | null) {
  const settings = userId ? await getSettingsForUser(userId) : await getCurrentUserSettings();

  return {
    apiVersion: settings.metaApiVersion || DEFAULT_META_API_VERSION,
    accessToken: requireSetting(settings.instagramAccessToken, "Instagram access token"),
    accountId: requireSetting(
      settings.instagramAccountId || settings.instagramUserId,
      "Instagram account ID"
    )
  };
}

function createTimeoutSignal() {
  const timeoutMs = getOptionalNumber(
    "INSTAGRAM_FETCH_TIMEOUT_MS",
    DEFAULT_INSTAGRAM_FETCH_TIMEOUT_MS
  );
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  return { signal: controller.signal, cleanup: () => clearTimeout(timeout) };
}

function isAbortError(error: unknown) {
  return error instanceof Error && error.name === "AbortError";
}

function classifyInstagramError(
  status: number,
  body: string,
  operation: "container" | "publish" | "status" | "media"
) {
  const lowerBody = body.toLowerCase();

  if (
    status === 429 ||
    lowerBody.includes("rate limit") ||
    lowerBody.includes("application request limit") ||
    lowerBody.includes("action is blocked") ||
    lowerBody.includes("\"code\":4")
  ) {
    return new InstagramApiError(
      `Instagram rate limit hit while calling ${operation}: ${status} ${body}`,
      "rate_limit",
      true
    );
  }

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
  operation: "container" | "publish",
  userId?: string | null
) {
  const settings = await getInstagramApiSettings(userId);
  const { signal, cleanup } = createTimeoutSignal();

  try {
    const response = await fetch(`${INSTAGRAM_API_URL}/${settings.apiVersion}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: params.toString(),
      cache: "no-store",
      signal
    });

    if (!response.ok) {
      throw classifyInstagramError(response.status, await response.text(), operation);
    }

    return (await response.json()) as T;
  } catch (error) {
    if (isAbortError(error)) {
      throw new InstagramApiError(
        `Instagram API request timed out while calling ${operation}`,
        "temporary_error",
        true
      );
    }

    throw error;
  } finally {
    cleanup();
  }
}

async function instagramGet<T>(
  path: string,
  params: URLSearchParams,
  operation: "status" | "media",
  userId?: string | null
) {
  const settings = await getInstagramApiSettings(userId);
  const { signal, cleanup } = createTimeoutSignal();

  try {
    const response = await fetch(
      `${INSTAGRAM_API_URL}/${settings.apiVersion}${path}?${params.toString()}`,
      { cache: "no-store", signal }
    );

    if (!response.ok) {
      throw classifyInstagramError(response.status, await response.text(), operation);
    }

    return (await response.json()) as T;
  } catch (error) {
    if (isAbortError(error)) {
      throw new InstagramApiError(
        `Instagram API request timed out while calling ${operation}`,
        "temporary_error",
        true
      );
    }

    throw error;
  } finally {
    cleanup();
  }
}

async function buildTokenParams(extra?: Record<string, string>, userId?: string | null) {
  const settings = await getInstagramApiSettings(userId);

  return new URLSearchParams({
    access_token: settings.accessToken,
    ...extra
  });
}

export async function createImageContainer(input: PublishInstagramImageInput) {
  return instagramPost<InstagramContainerResponse>(
    `/${(await getInstagramApiSettings(input.userId)).accountId}/media`,
    await buildTokenParams({
      image_url: input.imageUrl,
      caption: input.caption.slice(0, 2200)
    }, input.userId),
    "container",
    input.userId
  );
}

export async function createCarouselItem(imageUrl: string, userId?: string | null) {
  return instagramPost<InstagramContainerResponse>(
    `/${(await getInstagramApiSettings(userId)).accountId}/media`,
    await buildTokenParams({
      image_url: imageUrl,
      is_carousel_item: "true"
    }, userId),
    "container",
    userId
  );
}

export async function createCarouselContainer(input: {
  creationIds: string[];
  caption: string;
  userId?: string | null;
}) {
  return instagramPost<InstagramContainerResponse>(
    `/${(await getInstagramApiSettings(input.userId)).accountId}/media`,
    await buildTokenParams({
      media_type: "CAROUSEL",
      children: input.creationIds.join(","),
      caption: input.caption.slice(0, 2200)
    }, input.userId),
    "container",
    input.userId
  );
}

export async function getContainerStatus(creationId: string, userId?: string | null) {
  return instagramGet<InstagramContainerStatusResponse>(
    `/${creationId}`,
    await buildTokenParams({ fields: "status_code,status" }, userId),
    "status",
    userId
  );
}

export async function waitForContainer(creationId: string, userId?: string | null) {
  const maxPolls = getOptionalNumber("INSTAGRAM_CONTAINER_MAX_POLLS", 6);
  const pollIntervalMs = getOptionalNumber("INSTAGRAM_CONTAINER_POLL_INTERVAL_MS", 1000);

  for (let attempt = 0; attempt < maxPolls; attempt += 1) {
    const status = await getContainerStatus(creationId, userId);

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

export async function publishMedia(creationId: string, userId?: string | null) {
  return instagramPost<InstagramPublishResponse>(
    `/${(await getInstagramApiSettings(userId)).accountId}/media_publish`,
    await buildTokenParams({ creation_id: creationId }, userId),
    "publish",
    userId
  );
}

export async function getMedia(mediaId: string, userId?: string | null) {
  return instagramGet<InstagramMediaResponse>(
    `/${mediaId}`,
    await buildTokenParams({ fields: "permalink" }, userId),
    "media",
    userId
  );
}

export async function publishInstagramImage(
  input: PublishInstagramImageInput
): Promise<CreateInstagramPostResult> {
  const container = await createImageContainer(input);
  await waitForContainer(container.id, input.userId);
  const published = await publishMedia(container.id, input.userId);

  try {
    const media = await getMedia(published.id, input.userId);
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
      caption: input.caption,
      userId: input.userId
    });
  }

  const childContainers: string[] = [];

  for (const imageUrl of input.imageUrls) {
    const child = await createCarouselItem(imageUrl, input.userId);
    await waitForContainer(child.id, input.userId);
    childContainers.push(child.id);
  }

  const carouselContainer = await createCarouselContainer({
    creationIds: childContainers,
    caption: input.caption,
    userId: input.userId
  });
  await waitForContainer(carouselContainer.id, input.userId);
  const published = await publishMedia(carouselContainer.id, input.userId);

  try {
    const media = await getMedia(published.id, input.userId);
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
