import { CLASSIFIER_VERSION, eventInputHash, type EventClassification, type EventProduct, type SavedEventClassification } from "@/lib/queue/eventClassification";
import { EVENT_BATCH_SIZE } from "@/lib/queue/aiEventClassification";

export async function classifyListingEvents(input: {
  products: EventProduct[];
  cached: Map<number, SavedEventClassification>;
  model: string;
  generate: (products: EventProduct[]) => Promise<Map<number, EventClassification>>;
  save: (product: EventProduct, value: SavedEventClassification) => Promise<void>;
  limit?: number;
  concurrency?: number;
  checkpoint?: (entries: Array<{ product: EventProduct; value: SavedEventClassification }>) => Promise<void>;
  mayStartBatch?: () => boolean;
  onProgress?: (generated: number, remaining: number) => Promise<void> | void;
}) {
  const concurrency = input.concurrency ?? 1;
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 3) throw new Error("Event classification concurrency must be between 1 and 3.");
  if (new Set(input.products.map(product => product.etsyListingId)).size !== input.products.length) throw new Error("Duplicate product IDs in classification input.");
  const pending = input.products.filter(product => {
    const cached = input.cached.get(product.etsyListingId);
    return !cached || cached.inputHash !== eventInputHash(product) || cached.version !== CLASSIFIER_VERSION || cached.model !== input.model;
  });
  const selected = pending.slice(0, input.limit ?? pending.length);
  let generated = 0;
  let cursor = 0;
  let failure: unknown;
  const worker = async () => {
    while (cursor < selected.length && !failure) {
      if (input.mayStartBatch && !input.mayStartBatch()) break;
      const batch = selected.slice(cursor, cursor += EVENT_BATCH_SIZE);
      try {
        const results = await input.generate(batch);
        if (results.size !== batch.length || batch.some(product => !results.has(product.etsyListingId))) {
          throw new Error("Incomplete event classification batch.");
        }
        const entries = batch.map(product => ({ product, value: {
          inputHash: eventInputHash(product), version: CLASSIFIER_VERSION,
          model: input.model, classification: results.get(product.etsyListingId)!
        } }));
        // Checkpoint the complete response first so interrupted DB writes need no new AI call.
        await input.checkpoint?.(entries);
        for (const { product, value } of entries) {
          await input.save(product, value);
          input.cached.set(product.etsyListingId, value);
          generated++;
        }
        await input.onProgress?.(generated, pending.length - generated);
      } catch (error) {
        failure ??= error;
      }
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
  if (failure) throw failure;
  return { generated, cached: input.products.length - pending.length, remaining: pending.length - generated };
}
