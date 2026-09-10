import { getPinterestAccessToken } from "@/lib/pinterest/auth";
import type { CreatePinInput, CreatePinResult } from "./types";

const PINTEREST_API_URL = "https://api.pinterest.com/v5";

export type PinterestBoard = {
  id: string;
  name: string;
  privacy: string;
};

export async function pinterestRequest<T>(path: string, init: RequestInit = {}, userId?: string | null) {
  const response = await fetch(`${PINTEREST_API_URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${await getPinterestAccessToken(userId)}`,
      "Content-Type": "application/json",
      ...init.headers
    },
    cache: "no-store"
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Pinterest API request failed: ${response.status} ${body}`);
  }

  return (await response.json()) as T;
}

export async function createPin(input: CreatePinInput, userId?: string | null): Promise<CreatePinResult> {
  const response = await pinterestRequest<{ id: string }>("/pins", {
    method: "POST",
    body: JSON.stringify({
      board_id: input.boardId,
      title: input.title.slice(0, 100),
      description: input.description.slice(0, 800),
      link: input.destinationUrl,
      media_source: {
        source_type: "image_url",
        url: input.imageUrl
      }
    })
  }, userId);

  return { id: response.id };
}

export async function listPinterestBoards(userId?: string | null) {
  const response = await pinterestRequest<{ items?: PinterestBoard[] }>(
    "/boards?page_size=100",
    {},
    userId
  );

  return response.items ?? [];
}
