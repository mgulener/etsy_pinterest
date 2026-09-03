import { getRequiredEnv } from "@/lib/config/env";
import type { CreateInstagramPostInput, CreateInstagramPostResult } from "./types";

const INSTAGRAM_API_URL = "https://graph.instagram.com";
const DEFAULT_INSTAGRAM_API_VERSION = "v25.0";

type InstagramContainerResponse = {
  id: string;
};

type InstagramPublishResponse = {
  id: string;
};

type InstagramMediaResponse = {
  permalink?: string;
};

function getApiVersion() {
  return process.env.INSTAGRAM_API_VERSION || DEFAULT_INSTAGRAM_API_VERSION;
}

async function instagramPost<T>(path: string, params: URLSearchParams) {
  const response = await fetch(`${INSTAGRAM_API_URL}/${getApiVersion()}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: params.toString(),
    cache: "no-store"
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Instagram API request failed: ${response.status} ${body}`);
  }

  return (await response.json()) as T;
}

async function instagramGet<T>(path: string, params: URLSearchParams) {
  const response = await fetch(
    `${INSTAGRAM_API_URL}/${getApiVersion()}${path}?${params.toString()}`,
    { cache: "no-store" }
  );

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Instagram API request failed: ${response.status} ${body}`);
  }

  return (await response.json()) as T;
}

export async function createInstagramPost(
  input: CreateInstagramPostInput
): Promise<CreateInstagramPostResult> {
  const accessToken = getRequiredEnv("INSTAGRAM_ACCESS_TOKEN");
  const instagramUserId = getRequiredEnv("INSTAGRAM_USER_ID");
  const containerParams = new URLSearchParams({
    access_token: accessToken,
    image_url: input.imageUrl,
    caption: input.caption.slice(0, 2200)
  });

  const container = await instagramPost<InstagramContainerResponse>(
    `/${instagramUserId}/media`,
    containerParams
  );
  const publishParams = new URLSearchParams({
    access_token: accessToken,
    creation_id: container.id
  });
  const published = await instagramPost<InstagramPublishResponse>(
    `/${instagramUserId}/media_publish`,
    publishParams
  );

  try {
    const media = await instagramGet<InstagramMediaResponse>(
      `/${published.id}`,
      new URLSearchParams({
        access_token: accessToken,
        fields: "permalink"
      })
    );

    return {
      id: published.id,
      permalink: media.permalink
    };
  } catch {
    return { id: published.id };
  }
}
