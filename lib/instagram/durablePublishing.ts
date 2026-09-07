import type { CreateInstagramPostInput, CreateInstagramPostResult, InstagramContainerStatus } from "./types";

export type PublishAttempt = {
  id: string;
  etsy_listing_id: number;
  account_id: string;
  state: "preparing" | "ready" | "publishing" | "published" | "failed" | "retired";
  container_id: string | null;
  media_id: string | null;
  media_type: "IMAGE" | "CAROUSEL";
  caption: string;
  created_at: string;
};

export type PublishAttemptStore = {
  acquire(listingId: number, accountId: string, input: CreateInstagramPostInput): Promise<{ attempt: PublishAttempt; created: boolean }>;
  findActive(listingId: number, accountId: string): Promise<PublishAttempt | null>;
  ready(id: string, containerId: string): Promise<void>;
  beginPublish(id: string): Promise<boolean>;
  published(id: string, mediaId: string): Promise<void>;
  failPreparation(id: string): Promise<boolean>;
};

export class InstagramVerificationRequired extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InstagramVerificationRequired";
  }
}

export type DurableInstagramApi = {
  prepare(input: CreateInstagramPostInput): Promise<string>;
  wait(containerId: string): Promise<void>;
  publish(containerId: string): Promise<{ id: string }>;
  status(containerId: string): Promise<{ status_code?: InstagramContainerStatus }>;
  media(mediaId: string): Promise<{ permalink?: string }>;
};

export function createDurableInstagramPublisher(store: PublishAttemptStore, api: DurableInstagramApi, accountId: string) {
  async function result(attempt: PublishAttempt): Promise<CreateInstagramPostResult> {
    if (!attempt.media_id) throw new InstagramVerificationRequired("Published media ID is missing; manual verification required.");
    let permalink: string | undefined;
    try { permalink = (await api.media(attempt.media_id)).permalink; } catch { /* The saved publish response already confirms success. */ }
    return { id: attempt.media_id, creationId: attempt.container_id ?? undefined, mediaType: attempt.media_type, caption: attempt.caption, permalink };
  }

  async function verify(attempt: PublishAttempt): Promise<CreateInstagramPostResult> {
    if (attempt.state === "published") return result(attempt);
    let status = "unknown";
    if (attempt.container_id) {
      try { status = (await api.status(attempt.container_id)).status_code ?? "unknown"; } catch { /* Never retry a publish because its status lookup failed. */ }
    }
    throw new InstagramVerificationRequired(
      "Publish outcome requires verification. Container " + (attempt.container_id ?? "not saved") + ": " + status + ". No additional publish request was sent."
    );
  }

  return {
    async reconcile(listingId: number) {
      const attempt = await store.findActive(listingId, accountId);
      if (!attempt) throw new InstagramVerificationRequired("No saved publish attempt. Review the Instagram account manually.");
      return verify(attempt);
    },
    async create(listingId: number, input: CreateInstagramPostInput) {
      const { attempt, created } = await store.acquire(listingId, accountId, input);
      if (!created && attempt.state !== "ready") return verify(attempt);
      let boundaryStarted = false;
      try {
        let containerId = attempt.container_id;
        if (created) {
          containerId = await api.prepare(input);
          await store.ready(attempt.id, containerId);
        }
        if (!containerId) throw new Error("Saved container ID is missing");
        await api.wait(containerId);
        // Persist the irreversible boundary before sending media_publish, even across process crashes.
        boundaryStarted = true;
        if (!await store.beginPublish(attempt.id)) {
          throw new InstagramVerificationRequired("Another worker owns this publish attempt. Verification required.");
        }
        const media = await api.publish(containerId);
        if (!media.id) throw new Error("Meta returned no media ID");
        await store.published(attempt.id, media.id);
        return result({ ...attempt, container_id: containerId, state: "published", media_id: media.id });
      } catch (error) {
        if (error instanceof InstagramVerificationRequired) throw error;
        if (!boundaryStarted && await store.failPreparation(attempt.id)) {
          throw error;
        }
        throw new InstagramVerificationRequired(
          "Publish may have completed; automatic retry blocked. " + (error instanceof Error ? error.message : "Unknown error")
        );
      }
    }
  };
}
