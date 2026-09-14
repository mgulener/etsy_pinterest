import { PINTEREST_AI_BATCH_SIZE, type PinterestDescriptionProduct } from "@/lib/pinterest/aiDescription";
import { canEditPinDescription, validatePinDescription } from "@/lib/pinterest/description";
import type { PinQueueRow } from "@/lib/supabase/types";

export type DescriptionTarget = Pick<PinQueueRow,
  "id" | "title" | "description" | "pin_description" | "status" | "updated_at"
>;
export type DescriptionDraft = { id: string; description: string; expectedUpdatedAt: string };

export async function generateMissingPinterestDescriptions(input: {
  items: DescriptionTarget[];
  generate: (products: PinterestDescriptionProduct[]) => Promise<Map<string, string>>;
  save: (draft: DescriptionDraft) => Promise<boolean>;
  checkpoint: (drafts: DescriptionDraft[]) => Promise<void>;
  drafts?: Map<string, DescriptionDraft>;
  concurrency?: number;
  onProgress?: (progress: { selected: number; saved: number; skipped: number }) => void;
}) {
  const items = input.items.filter(item => canEditPinDescription(item.status) && !item.pin_description);
  const progress = { selected: items.length, saved: 0, skipped: 0 };
  let cursor = 0;
  let failure: unknown;
  const worker = async () => {
    while (cursor < items.length && !failure) {
      const batch = items.slice(cursor, cursor += PINTEREST_AI_BATCH_SIZE);
      try {
        const missing = batch.filter(item => input.drafts?.get(item.id)?.expectedUpdatedAt !== item.updated_at);
        const generated = missing.length ? await input.generate(missing) : new Map<string, string>();
        const drafts = batch.map(item => {
          const cached = input.drafts?.get(item.id);
          return {
            id: item.id,
            expectedUpdatedAt: item.updated_at,
            description: validatePinDescription(cached?.expectedUpdatedAt === item.updated_at ? cached.description : generated.get(item.id))
          };
        });
        // Persist generated text before DB writes so an interrupted save needs no new AI call.
        await input.checkpoint(drafts);
        for (const draft of drafts) {
          if (await input.save(draft)) progress.saved++;
          else progress.skipped++;
        }
        input.onProgress?.({ ...progress });
      } catch (error) {
        failure = error;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(3, input.concurrency ?? 1)) }, worker));
  if (failure) throw failure;
  return progress;
}
