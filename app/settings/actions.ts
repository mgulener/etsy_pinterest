"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdminSession } from "@/lib/auth/session";
import { saveUserSettings } from "@/lib/repositories/userSettingsRepository";

function parsePositiveInteger(value: FormDataEntryValue | null, fallback: number) {
  const numberValue = Number(value ?? fallback);

  return Number.isFinite(numberValue) && numberValue > 0 ? Math.floor(numberValue) : fallback;
}

export async function saveSettingsAction(formData: FormData) {
  const session = await requireAdminSession();

  await saveUserSettings(session.userId, {
    etsyApiKey: String(formData.get("etsyApiKey") ?? ""),
    etsyRedirectUri: String(formData.get("etsyRedirectUri") ?? ""),
    etsyShopId: String(formData.get("etsyShopId") ?? ""),
    pinterestEnabled: formData.get("pinterestEnabled") === "on",
    pinterestAccessToken: String(formData.get("pinterestAccessToken") ?? ""),
    pinterestBoardId: String(formData.get("pinterestBoardId") ?? ""),
    instagramEnabled: formData.get("instagramEnabled") === "on",
    instagramAccessToken: String(formData.get("instagramAccessToken") ?? ""),
    instagramAccountId: String(formData.get("instagramAccountId") ?? ""),
    instagramUserId: String(formData.get("instagramUserId") ?? ""),
    instagramPostMode: formData.get("instagramPostMode") === "carousel" ? "carousel" : "single",
    metaApiVersion: String(formData.get("metaApiVersion") ?? ""),
    aiCaptionsEnabled: formData.get("aiCaptionsEnabled") === "on",
    openaiApiKey: String(formData.get("openaiApiKey") ?? ""),
    openaiModel: String(formData.get("openaiModel") ?? ""),
    dryRun: formData.get("dryRun") === "on",
    maxPinsPerRun: parsePositiveInteger(formData.get("maxPinsPerRun"), 10),
    maxPinRetries: parsePositiveInteger(formData.get("maxPinRetries"), 3),
    maxInstagramPostsPerRun: parsePositiveInteger(formData.get("maxInstagramPostsPerRun"), 5),
    maxInstagramRetries: parsePositiveInteger(formData.get("maxInstagramRetries"), 3)
  });

  revalidatePath("/settings");
  redirect("/settings?saved=1");
}
