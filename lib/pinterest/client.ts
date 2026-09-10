import {
  getPinterestApiContext,
  type PinterestApiEnvironment
} from "@/lib/pinterest/auth";
import type { CreatePinInput, CreatePinResult } from "./types";

export type PinterestBoard = {
  id: string;
  name: string;
  privacy: string;
};

export type CreatePinterestBoardInput = {
  name: string;
  description?: string;
};

type PinterestApiContext = {
  environment: PinterestApiEnvironment;
  apiBaseUrl: string;
  accessToken: string;
  boardId: string | null;
};

export function resolvePinterestPublishBoardId(
  requestedBoardId: string,
  context: Pick<PinterestApiContext, "environment" | "boardId">
) {
  if (context.environment === "sandbox") {
    if (!context.boardId) {
      throw new Error("Select a Pinterest Sandbox board in Settings before testing a Pin.");
    }
    return context.boardId;
  }

  return requestedBoardId;
}

async function pinterestRequestWithContext<T>(
  path: string,
  init: RequestInit,
  context: PinterestApiContext
) {
  const response = await fetch(`${context.apiBaseUrl}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${context.accessToken}`,
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

export async function pinterestRequest<T>(path: string, init: RequestInit = {}, userId?: string | null) {
  return pinterestRequestWithContext<T>(path, init, await getPinterestApiContext(userId));
}

export async function createPin(input: CreatePinInput, userId?: string | null): Promise<CreatePinResult> {
  const context = await getPinterestApiContext(userId);
  const response = await pinterestRequestWithContext<{ id: string }>("/pins", {
    method: "POST",
    body: JSON.stringify({
      board_id: resolvePinterestPublishBoardId(input.boardId, context),
      title: input.title.slice(0, 100),
      description: input.description.slice(0, 800),
      link: input.destinationUrl,
      media_source: {
        source_type: "image_url",
        url: input.imageUrl
      }
    })
  }, context);

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

export async function createPinterestBoard(
  input: CreatePinterestBoardInput,
  userId?: string | null
) {
  const context = await getPinterestApiContext(userId);
  if (context.environment === "sandbox") {
    throw new Error("Pinterest Sandbox does not support creating boards through this setup.");
  }

  return pinterestRequestWithContext<PinterestBoard>("/boards", {
    method: "POST",
    body: JSON.stringify({
      name: input.name.slice(0, 180),
      description: input.description?.slice(0, 500) ?? ""
    })
  }, context);
}
