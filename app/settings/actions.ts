"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdminSession } from "@/lib/auth/session";
import {
  getSettingsForUser,
  saveUserSettings
} from "@/lib/repositories/userSettingsRepository";
import {
  preparePinterestPublishingForUser,
  redistributeFallbackPinterestQueueForUser
} from "@/lib/services/syncPinterestBoards";
import { testPinterestSandboxPinForUser } from "@/lib/services/testPinterestSandboxPin";

function parsePositiveInteger(value: FormDataEntryValue | null, fallback: number) {
  const numberValue = Number(value ?? fallback);

  return Number.isFinite(numberValue) && numberValue > 0 ? Math.floor(numberValue) : fallback;
}

export async function saveSettingsAction(formData: FormData) {
  const session = await requireAdminSession();
  const currentSettings = await getSettingsForUser(session.userId);
  const sandboxTokenInput = String(formData.get("pinterestSandboxAccessToken") ?? "").trim();
  const clearSandboxToken = formData.get("clearPinterestSandboxAccessToken") === "on";

  await saveUserSettings(session.userId, {
    etsyApiKey: String(formData.get("etsyApiKey") ?? ""),
    etsyRedirectUri: String(formData.get("etsyRedirectUri") ?? ""),
    etsyShopId: String(formData.get("etsyShopId") ?? ""),
    pinterestEnabled: formData.get("pinterestEnabled") === "on",
    pinterestEnvironment: formData.get("pinterestEnvironment") === "sandbox"
      ? "sandbox"
      : "production",
    pinterestAppId: String(formData.get("pinterestAppId") ?? ""),
    pinterestAppSecret: String(formData.get("pinterestAppSecret") ?? ""),
    pinterestRedirectUri: String(formData.get("pinterestRedirectUri") ?? ""),
    pinterestBoardId: String(formData.get("pinterestBoardId") ?? ""),
    pinterestSandboxAccessToken: clearSandboxToken
      ? null
      : sandboxTokenInput || currentSettings.pinterestSandboxAccessToken,
    pinterestSandboxBoardId: String(formData.get("pinterestSandboxBoardId") ?? ""),
    instagramEnabled: formData.get("instagramEnabled") === "on",
    instagramAccessToken: String(formData.get("instagramAccessToken") ?? ""),
    instagramAccountId: String(formData.get("instagramAccountId") ?? ""),
    instagramUserId: String(formData.get("instagramUserId") ?? ""),
    instagramPostMode: "single",
    metaApiVersion: String(formData.get("metaApiVersion") ?? ""),
    aiCaptionsEnabled: formData.get("aiCaptionsEnabled") === "on",
    openaiApiKey: String(formData.get("openaiApiKey") ?? ""),
    openaiModel: String(formData.get("openaiModel") ?? ""),
    dryRun: formData.get("dryRun") === "on",
    maxPinsPerRun: parsePositiveInteger(formData.get("maxPinsPerRun"), 10),
    maxPinRetries: parsePositiveInteger(formData.get("maxPinRetries"), 3),
    maxInstagramPostsPerRun: parsePositiveInteger(formData.get("maxInstagramPostsPerRun"), 1),
    maxInstagramRetries: parsePositiveInteger(formData.get("maxInstagramRetries"), 3)
  });

  revalidatePath("/settings");
  redirect("/settings?saved=1");
}

export async function syncPinterestBoardsAction() {
  const session = await requireAdminSession();
  let destination: string;

  try {
    const result = await preparePinterestPublishingForUser(session.userId);
    const params = new URLSearchParams({
      pinterestSetup: "ready",
      sections: String(result.sections),
      createdBoards: String(result.createdBoards),
      queued: String(result.queued)
    });
    destination = `/settings?${params.toString()}`;
  } catch (error) {
    console.error("[PINTEREST_BOARD_SYNC] Setup failed", error);
    destination = "/settings?pinterestSetup=error";
  }

  revalidatePath("/settings");
  revalidatePath("/pinterest/queue");
  revalidatePath("/etsy/listings");
  redirect(destination);
}

export async function redistributePinterestQueueAction() {
  const session = await requireAdminSession();
  let destination: string;

  try {
    const result = await redistributeFallbackPinterestQueueForUser(session.userId);
    const params = new URLSearchParams({
      pinterestRedistribution: "ready",
      reviewed: String(result.reviewed),
      moved: String(result.moved),
      fallback: String(result.keptInFallback)
    });
    destination = `/settings?${params.toString()}`;
  } catch (error) {
    console.error("[PINTEREST_BOARD_CLASSIFICATION] Redistribution failed", error);
    destination = "/settings?pinterestRedistribution=error";
  }

  revalidatePath("/settings");
  revalidatePath("/pinterest/queue");
  redirect(destination);
}

export async function testPinterestSandboxPinAction() {
  const session = await requireAdminSession();
  let destination: string;

  try {
    const result = await testPinterestSandboxPinForUser(session.userId);
    const params = new URLSearchParams({
      pinterestSandboxTest: "ready",
      listing: String(result.etsyListingId),
      pin: result.pinterestPinId
    });
    destination = `/settings?${params.toString()}`;
  } catch (error) {
    console.error("[PINTEREST_SANDBOX] Test Pin failed", error);
    destination = "/settings?pinterestSandboxTest=error";
  }

  revalidatePath("/settings");
  redirect(destination);
}
