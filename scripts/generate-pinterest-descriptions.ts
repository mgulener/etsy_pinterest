import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { getSupabaseAdmin } from "../lib/supabase/admin";
import { getEtsyAutomationUserId, getSettingsForUser } from "../lib/repositories/userSettingsRepository";
import { createPinQueueRepository } from "../lib/repositories/pinQueueRepository";
import { generatePinterestDescriptionsWithAI } from "../lib/pinterest/aiDescription";
import { EDITABLE_PIN_STATUSES } from "../lib/pinterest/description";
import { generateMissingPinterestDescriptions, type DescriptionTarget, type DescriptionDraft } from "../lib/services/generatePinterestDescriptions";

async function main() {
  const args = process.argv.slice(2);
  if (!args.includes("--run")) throw new Error("Explicit --run is required to generate and save descriptions.");
  const userId = await getEtsyAutomationUserId();
  if (!userId) throw new Error("No unique Etsy automation owner configured.");
  const settings = await getSettingsForUser(userId);
  if (!settings.aiCaptionsEnabled || !settings.openaiApiKey || !settings.openaiModel) throw new Error("Configure and enable AI in Settings first.");
  const limitArg = args.find(arg => arg.startsWith("--limit="));
  const limit = limitArg ? Number(limitArg.split("=")[1]) : Infinity;
  if (!(limit > 0) || (limit !== Infinity && !Number.isInteger(limit))) throw new Error("Invalid limit.");
  const file = resolve(".local", `pinterest-descriptions-${userId}.jsonl`);
  await mkdir(dirname(file), { recursive: true });
  const drafts = new Map<string, DescriptionDraft>();
  try {
    for (const line of (await readFile(file, "utf8")).split("\n").filter(Boolean)) {
      const draft = JSON.parse(line) as DescriptionDraft;
      drafts.set(draft.id, draft);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const db = getSupabaseAdmin();
  const items: DescriptionTarget[] = [];
  let afterId: string | undefined;
  while (items.length < limit) {
    let query = db.from("pin_queue")
      .select("id,title,description,pin_description,status,updated_at,pin_description_source,pin_description_generated_at")
      .in("status", EDITABLE_PIN_STATUSES).is("pin_description", null)
      .order("id").limit(Math.min(500, limit - items.length));
    if (afterId) query = query.gt("id", afterId);
    const { data, error } = await query;
    if (error) throw new Error(`Failed to read descriptions: ${error.message}`);
    if (!data?.length) break;
    items.push(...data);
    afterId = data[data.length - 1].id;
  }
  console.log(JSON.stringify({ selected: items.length, model: settings.openaiModel, checkpoint: file }));
  const repo = createPinQueueRepository();
  const result = await generateMissingPinterestDescriptions({
    items, drafts, concurrency: 3,
    generate: products => generatePinterestDescriptionsWithAI({ products, apiKey: settings.openaiApiKey!, model: settings.openaiModel! }),
    save: async draft => Boolean(await repo.saveDescription(draft.id, draft.description, draft.expectedUpdatedAt, "ai")),
    checkpoint: batch => appendFile(file, batch.map(draft => JSON.stringify(draft)).join("\n") + "\n", { mode: 0o600 }),
    onProgress: progress => console.log(JSON.stringify(progress))
  });
  console.log(JSON.stringify({ finished: true, ...result }));
}

main().catch(error => { console.error(error instanceof Error ? error.message : "Description generation failed."); process.exitCode = 1; });
