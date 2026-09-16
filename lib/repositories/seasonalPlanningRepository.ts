import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { getEtsyAutomationUserId, getSettingsForUser } from "./userSettingsRepository";
import { CLASSIFIER_VERSION, eventInputHash, parseEventClassification, type EventClassification, type EventProduct, type SavedEventClassification } from "@/lib/queue/eventClassification";
import { DEFAULT_SEASONAL_POLICY, planSeasonalQueue, validateSeasonalPolicy, type SeasonalPolicy, type SeasonalQueueItem } from "@/lib/queue/seasonalPlanning";
import { classifyListingEvents } from "@/lib/services/classifyListingEvents";
import { classifyEventsWithAI } from "@/lib/queue/aiEventClassification";

export function createSeasonalPlanningRepository(userId: string, db = getSupabaseAdmin()) {
  return {
    async policy(): Promise<SeasonalPolicy> {
      const { data, error } = await db.from("seasonal_planning_settings").select("*").eq("user_id", userId).maybeSingle();
      if (error) throw new Error("Could not read seasonal planning settings. Apply migration 0026 before deploying.");
      const policy = data ? { enabled: data.enabled, leadTimeDays: data.lead_time_days, lookaheadDays: data.lookahead_days } : { ...DEFAULT_SEASONAL_POLICY };
      validateSeasonalPolicy(policy);
      return policy;
    },
    async savePolicy(policy: SeasonalPolicy) {
      validateSeasonalPolicy(policy);
      if (await getEtsyAutomationUserId() !== userId) throw new Error("Only the Etsy automation owner can configure seasonal scheduling.");
      const { error } = await db.from("seasonal_planning_settings").upsert({ user_id: userId, enabled: policy.enabled, lead_time_days: policy.leadTimeDays, lookahead_days: policy.lookaheadDays });
      if (error) throw new Error("Could not save seasonal planning settings.");
    },
    async cached(products: EventProduct[]) {
      const saved = new Map<number, SavedEventClassification>();
      for (let from = 0; from < products.length; from += 300) {
        const batch = products.slice(from, from + 300);
        const { data, error } = await db.from("listing_event_classifications").select("*").eq("user_id", userId).in("etsy_listing_id", batch.map(p => p.etsyListingId));
        if (error) throw new Error("Could not read event classifications.");
        for (const row of data ?? []) {
          const product = batch.find(p => p.etsyListingId === row.etsy_listing_id)!;
          if (row.input_hash !== eventInputHash(product) || row.classifier_version !== CLASSIFIER_VERSION) continue;
          saved.set(product.etsyListingId, { inputHash: row.input_hash, version: row.classifier_version, model: row.model,
            classification: parseEventClassification(row.classification, product) });
        }
      }
      return saved;
    },
    async save(product: EventProduct, value: SavedEventClassification) {
      const { error } = await db.from("listing_event_classifications").upsert({
        user_id: userId, etsy_listing_id: product.etsyListingId, input_hash: value.inputHash,
        classifier_version: value.version, model: value.model, classification: value.classification,
        classified_at: new Date().toISOString()
      });
      if (error) throw new Error("Could not save event classification.");
    }
  };
}

export async function refreshSeasonalClassifications(userId: string, products: EventProduct[], onProgress?: (generated: number, remaining: number) => Promise<void> | void) {
  if (await getEtsyAutomationUserId() !== userId) throw new Error("Only the connected Etsy shop owner can classify these products.");
  const repo = createSeasonalPlanningRepository(userId);
  if (!(await repo.policy()).enabled) return { generated: 0, remaining: 0 };
  const settings = await getSettingsForUser(userId);
  if (!settings.aiCaptionsEnabled || !settings.openaiApiKey || !settings.openaiModel) throw new Error("Enable AI in Settings for seasonal classification.");
  const cached = await repo.cached(products);
  const deadline = Date.now() + 60_000;
  return classifyListingEvents({ products, cached, model: settings.openaiModel,
    // Bounded daily catch-up; completed classifications are cached across sync runs.
    limit: 50, mayStartBatch: () => Date.now() <= deadline - 30_000,
    generate: batch => classifyEventsWithAI({ products: batch, apiKey: settings.openaiApiKey!, model: settings.openaiModel!, timeoutMs: 30_000 }),
    save: repo.save, onProgress });
}

export async function loadSeasonalPlan<T extends SeasonalQueueItem>(rows: T[], intervalMinutes: number, requestedUserId?: string) {
  const owner = await getEtsyAutomationUserId();
  if (!owner || (requestedUserId && requestedUserId !== owner)) throw new Error("Seasonal planning requires the connected Etsy shop owner.");
  const repo = createSeasonalPlanningRepository(owner);
  const policy = await repo.policy();
  if (!policy.enabled) return null;
  const products: EventProduct[] = [];
  const ids = [...new Set(rows.map(row => row.etsy_listing_id))];
  for (let from = 0; from < ids.length; from += 300) {
    const { data, error } = await getSupabaseAdmin().from("etsy_listings").select("etsy_listing_id,title,description,tags").in("etsy_listing_id", ids.slice(from, from + 300));
    if (error) throw new Error("Could not read products for seasonal planning.");
    products.push(...(data ?? []).map(row => ({ etsyListingId: row.etsy_listing_id, title: row.title, description: row.description, tags: row.tags })));
  }
  const cached = await repo.cached(products);
  const settings = await getSettingsForUser(owner);
  const classifications = new Map<number, EventClassification>([...cached].filter(([, value]) => value.model === settings.openaiModel).map(([id, value]) => [id, value.classification]));
  return planSeasonalQueue({ rows, intervalMinutes, classifications, policy });
}
