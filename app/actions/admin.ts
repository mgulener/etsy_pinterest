"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdminSession } from "@/lib/auth/session";
import { bootstrapExistingListings } from "@/lib/services/bootstrap";
import { publishInstagramPosts } from "@/lib/services/publishInstagramPosts";
import { publishPinterestPins } from "@/lib/services/publishPinterestPins";
import { syncEtsyListings } from "@/lib/services/syncEtsyListings";
import { createInstagramQueueRepository } from "@/lib/repositories/instagramQueueRepository";
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
    `/dashboard?action=sync&fetched=${result.fetched}&known=${result.known}&queued=${result.queued}&instagramQueued=${result.instagramQueued}&errors=${result.errors.length}`
  );
}

export async function publishNowAction() {
  await requireAdminSession();
  const result = await publishPinterestPins();
  revalidatePath("/");
  redirect(
    `/dashboard?action=publish&selected=${result.selected}&published=${result.published}&failed=${result.failed}&retried=${result.retried}&dryRun=${result.dryRun}`
  );
}

export async function publishInstagramNowAction() {
  await requireAdminSession();
  const result = await publishInstagramPosts();
  revalidatePath("/");
  redirect(
    `/dashboard?action=publish-instagram&selected=${result.selected}&published=${result.published}&failed=${result.failed}&retried=${result.retried}&dryRun=${result.dryRun}`
  );
}

export async function retryQueueItemAction(formData: FormData) {
  await requireAdminSession();
  const id = String(formData.get("id") ?? "");

  if (id) {
    await createPinQueueRepository().retry(id);
  }

  revalidatePath("/pinterest/queue");
}

export async function retryInstagramQueueItemAction(formData: FormData) {
  await requireAdminSession();
  const id = String(formData.get("id") ?? "");

  if (id) {
    await createInstagramQueueRepository().retry(id);
  }

  revalidatePath("/instagram/queue");
}

export async function retryAllFailedInstagramAction() {
  await requireAdminSession();
  await createInstagramQueueRepository().retryAllFailed();
  revalidatePath("/instagram/queue");
}

export async function cancelInstagramQueueItemAction(formData: FormData) {
  await requireAdminSession();
  const id = String(formData.get("id") ?? "");

  if (id) {
    await createInstagramQueueRepository().cancel(id);
  }

  revalidatePath("/instagram/queue");
}

export async function retryAllFailedAction() {
  await requireAdminSession();
  await createPinQueueRepository().retryAllFailed();
  revalidatePath("/pinterest/queue");
}

export async function cancelQueueItemAction(formData: FormData) {
  await requireAdminSession();
  const id = String(formData.get("id") ?? "");

  if (id) {
    await createPinQueueRepository().cancel(id);
  }

  revalidatePath("/pinterest/queue");
}
