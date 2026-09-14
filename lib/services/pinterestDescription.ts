import { canEditPinDescription, validatePinDescription } from "@/lib/pinterest/description";
import type { PinQueueRow } from "@/lib/supabase/types";

export class PinterestDescriptionError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
  }
}

export type PinterestDescriptionDependencies = {
  getUserId(): Promise<string | null>;
  getOwnerId(): Promise<string | null>;
  findItem(id: string): Promise<PinQueueRow | null>;
  save(id: string, description: string, expectedUpdatedAt: string): Promise<PinQueueRow | null>;
  generate(item: PinQueueRow, userId: string, signal: AbortSignal): Promise<string>;
};

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function handlePinterestDescription(
  request: Request, id: string, deps: PinterestDescriptionDependencies
) {
  try {
    if (request.method !== "POST" && request.method !== "PATCH") return json({ error: "Method not allowed." }, 405);
    const userId = await deps.getUserId();
    if (!userId) return json({ error: "Sign in to edit Pinterest descriptions." }, 401);
    const requestUrl = new URL(request.url);
    const origin = request.headers.get("origin");
    let sameOrigin = false;
    try {
      const originUrl = new URL(origin ?? "");
      sameOrigin = originUrl.origin === origin &&
        originUrl.host === (request.headers.get("host") ?? requestUrl.host) &&
        originUrl.protocol === requestUrl.protocol;
    } catch { /* Invalid origins fail closed. */ }
    if (!sameOrigin) {
      return json({ error: "Invalid request origin." }, 403);
    }
    if (!/^application\/json(?:;|$)/i.test(request.headers.get("content-type") ?? "")) {
      return json({ error: "Expected a JSON request." }, 415);
    }
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
      return json({ error: "Invalid queue item." }, 400);
    }
    let body;
    try {
      const text = await request.text();
      if (text.length > 8192) return json({ error: "Request is too large." }, 413);
      body = JSON.parse(text);
    } catch {
      return json({ error: "Invalid JSON request." }, 400);
    }
    if (!body || typeof body.expectedUpdatedAt !== "string" || !Number.isFinite(Date.parse(body.expectedUpdatedAt))) {
      return json({ error: "Missing queue item version. Refresh the page." }, 400);
    }
    // The legacy queue is shop-wide, not user-scoped. Only its unique Etsy owner may edit it.
    if (await deps.getOwnerId() !== userId) {
      return json({ error: "Only the connected shop owner can edit these descriptions." }, 403);
    }
    const item = await deps.findItem(id);
    if (!item) return json({ error: "Queue item not found." }, 404);
    if (!canEditPinDescription(item.status) || item.updated_at !== body.expectedUpdatedAt) {
      return json({ error: "This item changed or publishing has started. Refresh the page before editing." }, 409);
    }
    if (!("pin_description" in item)) {
      return json({ error: "Pinterest description storage is not ready. Apply database migration 0021 first." }, 503);
    }
    if (request.method === "POST") {
      const description = await deps.generate(item, userId, request.signal);
      return json({ description: validatePinDescription(description) });
    }
    let description;
    try {
      description = validatePinDescription(body.description);
    } catch (error) {
      return json({ error: (error as Error).message }, 400);
    }
    const saved = await deps.save(id, description, body.expectedUpdatedAt);
    if (!saved) return json({ error: "This item changed or publishing has started. Your draft was not saved." }, 409);
    return json({ description: saved.pin_description, updatedAt: saved.updated_at });
  } catch (error) {
    if (error instanceof PinterestDescriptionError) return json({ error: error.message }, error.status);
    return json({ error: "The description could not be processed. Refresh the page to check its saved state before trying again." }, 500);
  }
}
