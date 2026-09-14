import { getCurrentSession } from "@/lib/auth/session";
import { generatePinterestDescriptionWithAI } from "@/lib/pinterest/aiDescription";
import { createPinQueueRepository } from "@/lib/repositories/pinQueueRepository";
import { getEtsyAutomationUserId, getSettingsForUser } from "@/lib/repositories/userSettingsRepository";
import { handlePinterestDescription, PinterestDescriptionError } from "@/lib/services/pinterestDescription";

export const runtime = "nodejs";
export const maxDuration = 60;

async function handle(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return handlePinterestDescription(request, id, {
    getUserId: async () => (await getCurrentSession())?.userId ?? null,
    getOwnerId: getEtsyAutomationUserId,
    findItem: (itemId) => createPinQueueRepository().findById(itemId),
    save: (itemId, description, version) => createPinQueueRepository().saveDescription(itemId, description, version),
    generate: async (item, userId, signal) => {
      const settings = await getSettingsForUser(userId);
      if (!settings.aiCaptionsEnabled || !settings.openaiApiKey) {
        throw new PinterestDescriptionError("Enable AI captions and add your OpenAI API key in Settings first.", 400);
      }
      try {
        return await generatePinterestDescriptionWithAI({
          title: item.title,
          description: item.description,
          apiKey: settings.openaiApiKey,
          model: settings.openaiModel || "gpt-5.4-mini",
          signal
        });
      } catch {
        throw new PinterestDescriptionError("AI could not generate a description. Check your AI settings or try again; your draft is unchanged.", 502);
      }
    }
  });
}

export const POST = handle;
export const PATCH = handle;
