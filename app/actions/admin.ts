"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdminSession } from "@/lib/auth/session";
import { bootstrapExistingListings } from "@/lib/services/bootstrap";
import { publishPins } from "@/lib/services/publishPins";
import { syncEtsyListings } from "@/lib/services/syncEtsyListings";
import { createPinQueueRepository } from "@/lib/repositories/pinQueueRepository";

export async function bootstrapAction() {
  await requireAdminSession();
  const result = await bootstrapExistingListings();
  revalidatePath("/");
  redirect(
    `/dashboard?action=bootstrap&saved=${result.saved}&fetched=${result.fetched}&errors=${result.errors.length}`
  );
}

export async function syncNowAction() {
  await requireAdminSession();
  const result = await syncEtsyListings();
  revalidatePath("/");
  redirect(
    `/dashboard?action=sync&fetched=${result.fetched}&known=${result.known}&queued=${result.queued}&errors=${result.errors.length}`
  );
}

export async function publishNowAction() {
  await requireAdminSession();
  const result = await publishPins();
  revalidatePath("/");
  redirect(
    `/dashboard?action=publish&selected=${result.selected}&published=${result.published}&failed=${result.failed}&retried=${result.retried}&dryRun=${result.dryRun}`
  );
}

export async function retryQueueItemAction(formData: FormData) {
  await requireAdminSession();
  const id = String(formData.get("id") ?? "");

  if (id) {
    await createPinQueueRepository().retry(id);
  }

  revalidatePath("/queue");
}

export async function retryAllFailedAction() {
  await requireAdminSession();
  await createPinQueueRepository().retryAllFailed();
  revalidatePath("/queue");
}

export async function cancelQueueItemAction(formData: FormData) {
  await requireAdminSession();
  const id = String(formData.get("id") ?? "");

  if (id) {
    await createPinQueueRepository().cancel(id);
  }

  revalidatePath("/queue");
}
