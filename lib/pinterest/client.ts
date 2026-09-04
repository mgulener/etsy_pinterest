import {
  getCurrentUserSettings,
  requireSetting
} from "@/lib/repositories/userSettingsRepository";
import type { CreatePinInput, CreatePinResult } from "./types";

const PINTEREST_API_URL = "https://api.pinterest.com/v5";

export async function pinterestRequest<T>(path: string, init: RequestInit = {}) {
  const settings = await getCurrentUserSettings();
  const response = await fetch(`${PINTEREST_API_URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${requireSetting(settings.pinterestAccessToken, "Pinterest access token")}`,
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

export async function createPin(input: CreatePinInput): Promise<CreatePinResult> {
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
  });

  return { id: response.id };
}
