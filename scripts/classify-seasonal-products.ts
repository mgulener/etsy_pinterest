import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { getSupabaseAdmin } from "../lib/supabase/admin";
import { getEtsyAutomationUserId, getSettingsForUser } from "../lib/repositories/userSettingsRepository";
import { createSeasonalPlanningRepository } from "../lib/repositories/seasonalPlanningRepository";
import { createPinQueueRepository } from "../lib/repositories/pinQueueRepository";
import { createInstagramQueueRepository } from "../lib/repositories/instagramQueueRepository";
import { getFacebookSyncQueue } from "../lib/services/queueFacebookListings";
import { classifyEventsWithAI } from "../lib/queue/aiEventClassification";
import { CLASSIFIER_VERSION, eventInputHash, parseEventClassification, type EventProduct, type SavedEventClassification } from "../lib/queue/eventClassification";
import { DEFAULT_SEASONAL_POLICY, rankSeasonalProduct, validateSeasonalPolicy } from "../lib/queue/seasonalPlanning";
import { getSeasonalQueuePriority } from "../lib/queue/scheduling";
import { classifyListingEvents } from "../lib/services/classifyListingEvents";

type Product = EventProduct & { url: string | null };
const legacyPriority = (product: EventProduct) => getSeasonalQueuePriority({ ...product, originalCreationTimestamp: null });

function sampleProducts(products: Product[], count: number) {
  const buckets = new Map<number, Product[]>();
  for (const product of products) {
    const key = legacyPriority(product);
    buckets.set(key, [...buckets.get(key) ?? [], product]);
  }
  const sampled: Product[] = [];
  const groups = [...buckets.values()];
  for (let round = 0; sampled.length < count; round++) {
    let added = 0;
    for (const bucket of groups) {
      if (round >= bucket.length || sampled.length >= count) continue;
      // Alternate oldest/newest entries rather than taking only adjacent listings.
      const index = round % 2 === 0 ? Math.floor(round / 2) : bucket.length - 1 - Math.floor(round / 2);
      sampled.push(bucket[index]); added++;
    }
    if (!added) break;
  }
  return sampled;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.some(arg => !/^(--pilot=\d+|--apply|--enable|--lead-days=\d+|--concurrency=[1-3])$/.test(arg))) throw new Error("Unknown option.");
  const apply = args.includes("--apply");
  const enable = args.includes("--enable");
  const concurrencyArg = args.find(arg => arg.startsWith("--concurrency="));
  const concurrency = concurrencyArg ? Number(concurrencyArg.split("=")[1]) : apply ? 3 : 1;
  const pilot = args.find(arg => arg.startsWith("--pilot="));
  if (Boolean(pilot) === apply || (enable && !apply)) throw new Error("Use --pilot=60 OR --apply [--enable --lead-days=N]. Pilot never writes to the database.");
  const sampleCount = pilot ? Number(pilot.split("=")[1]) : 0;
  if (pilot && (sampleCount < 1 || sampleCount > 100)) throw new Error("Pilot must contain 1 to 100 products.");
  const leadArg = args.find(arg => arg.startsWith("--lead-days="));
  if (enable && !leadArg) throw new Error("Confirm production + delivery days with --lead-days before enabling.");
  const policy = { ...DEFAULT_SEASONAL_POLICY, enabled: true, leadTimeDays: leadArg ? Number(leadArg.split("=")[1]) : 14 };
  validateSeasonalPolicy(policy);
  const userId = await getEtsyAutomationUserId();
  if (!userId) throw new Error("No unique Etsy automation owner.");
  const settings = await getSettingsForUser(userId);
  if (!settings.aiCaptionsEnabled || !settings.openaiApiKey || !settings.openaiModel) throw new Error("Enable AI in Settings first.");
  const db = getSupabaseAdmin();
  const products: Product[] = [];
  for (let from = 0; ; from += 500) {
    // select * also allows a read-only pilot before migration 0026 is applied.
    const { data, error } = await db.from("etsy_listings").select("*").eq("state", "active").order("etsy_listing_id").range(from, from + 499);
    if (error) throw new Error("Could not read Etsy products.");
    products.push(...(data ?? []).map(row => ({ etsyListingId: row.etsy_listing_id, title: row.title,
      description: row.description, tags: row.tags ?? [], url: row.url })));
    if ((data?.length ?? 0) < 500) break;
  }
  const selected = pilot ? sampleProducts(products, sampleCount) : products;
  const repo = createSeasonalPlanningRepository(userId);
  const cached = apply ? await repo.cached(selected) : new Map<number, SavedEventClassification>();
  await mkdir(resolve(".local"), { recursive: true });
  const checkpoint = resolve(".local", `seasonal-classifications-${userId}.jsonl`);
  const checkpoints = new Map<number, SavedEventClassification>();
  try {
    for (const line of (await readFile(checkpoint, "utf8")).split("\n").filter(Boolean)) {
      const row = JSON.parse(line) as { id: number; value: SavedEventClassification };
      const product = selected.find(product => product.etsyListingId === row.id);
      if (product && row.value.inputHash === eventInputHash(product) && row.value.version === CLASSIFIER_VERSION && row.value.model === settings.openaiModel) {
        checkpoints.set(row.id, { ...row.value, classification: parseEventClassification(row.value.classification, product) });
      }
    }
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  for (const product of selected) {
    const value = checkpoints.get(product.etsyListingId);
    const existing = cached.get(product.etsyListingId);
    if (value && (!existing || existing.model !== settings.openaiModel)) {
      // A validated pilot result is reusable; persist before marking it cached.
      if (apply) await repo.save(product, value);
      cached.set(product.etsyListingId, value);
    }
  }
  const result = await classifyListingEvents({ products: selected, cached, model: settings.openaiModel, concurrency,
    generate: batch => classifyEventsWithAI({ products: batch, apiKey: settings.openaiApiKey!, model: settings.openaiModel! }),
    save: async (product, value) => {
      if (apply) await repo.save(product, value);
    }, checkpoint: entries => appendFile(checkpoint, entries.map(({ product, value }) => JSON.stringify({ id: product.etsyListingId, value })).join("\n") + "\n", { mode: 0o600 }),
    onProgress: (generated, remaining) => { console.log(JSON.stringify({ generated, remaining })); }
  });
  if (enable) {
    await repo.savePolicy(policy);
    if (settings.pinterestEnabled) await createPinQueueRepository().rebuildPendingSchedule();
    if (settings.instagramEnabled) await createInstagramQueueRepository().rebuildPendingSchedule();
    await (await getFacebookSyncQueue(userId))?.rebuildPendingSchedule();
  }
  const now = new Date();
  const ranked = selected.map(product => ({ product, value: cached.get(product.etsyListingId)!.classification,
    rank: rankSeasonalProduct(cached.get(product.etsyListingId)!.classification, policy, now) }))
    .sort((a, b) => a.rank.tier - b.rank.tier || a.rank.urgency - b.rank.urgency || a.product.etsyListingId - b.product.etsyListingId);
  const escape = (text: string) => text.replace(/\|/g, "\\|").replace(/[\r\n]+/g, " ");
  const review = ranked.filter(item => item.value.kind === "review").length;
  const report = [apply ? "# Seasonal Catalog Classification" : "# Seasonal Planning Pilot", "", `Generated: ${now.toISOString()}`,
    `Mode: ${apply ? "classification cache saved" : "read-only pilot; live queue unchanged"}. Products: ${selected.length}.`,
    `Lead time: ${policy.leadTimeDays} days (production + delivery). Lookahead: ${policy.lookaheadDays} days.`,
    `Review required: ${review}. No measured accuracy claim: this is a comparison, not human-labeled ground truth.`, "",
    "Tiers: 0 seasonal priority, 1 evergreen, 2 future season, 3 review, 4 expired dated product.", "",
    "| Rank | Listing | Title | Old score | AI classification | Tier | Delivery cutoff | Reason / evidence |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |",
    ...ranked.map(({ product, value, rank }, index) => `| ${index + 1} | ${product.etsyListingId} | ${escape(product.title)} | ${legacyPriority(product)} | ${value.kind}${value.events.length ? ` (${value.events.join(", ")})` : ""} | ${rank.tier} | ${rank.deadline ?? "-"} | ${escape(value.reason + " Evidence: " + value.evidence.join("; "))} |`)
  ].join("\n") + "\n";
  const reportPath = resolve(".local", apply ? "seasonal-planning-catalog.md" : "seasonal-planning-pilot.md");
  await writeFile(reportPath, report, { mode: 0o600 });
  console.log(JSON.stringify({ ...result, products: selected.length, review, applied: apply, enabled: enable, report: reportPath }));
}

main().catch(error => { console.error(error instanceof Error ? error.message : "Seasonal classification failed."); process.exitCode = 1; });
