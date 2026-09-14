import { generatePinterestDescriptionsWithAI, type PinterestDescriptionProduct } from "./aiDescription";
import type { UserSettings } from "@/lib/repositories/userSettingsRepository";

export function createAutomaticPinterestDescriptionGenerator(settings: Pick<UserSettings,
  "aiCaptionsEnabled" | "openaiApiKey" | "openaiModel"
>) {
  if (!settings.aiCaptionsEnabled) return undefined;
  return (products: PinterestDescriptionProduct[]) => {
    if (!settings.openaiApiKey || !settings.openaiModel) throw new Error("Configure the OpenAI key and model in Settings before queuing Pinterest products.");
    return generatePinterestDescriptionsWithAI({ products, apiKey: settings.openaiApiKey, model: settings.openaiModel });
  };
}
