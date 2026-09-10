import { createPin } from "@/lib/pinterest/client";
import { createPinQueueRepository } from "@/lib/repositories/pinQueueRepository";
import { getSettingsForUser } from "@/lib/repositories/userSettingsRepository";

export async function testPinterestSandboxPinForUser(userId: string) {
  const settings = await getSettingsForUser(userId);

  if (settings.pinterestEnvironment !== "sandbox") {
    throw new Error("Switch Pinterest to Sandbox in Settings before creating a test Pin.");
  }
  if (!settings.pinterestSandboxAccessToken) {
    throw new Error("Add a Pinterest Sandbox access token in Settings first.");
  }
  if (!settings.pinterestSandboxBoardId) {
    throw new Error("Select or enter a Pinterest Sandbox board ID first.");
  }

  const { rows } = await createPinQueueRepository().list({
    page: 1,
    pageSize: 1,
    status: "pending"
  });
  const item = rows[0];

  if (!item) {
    throw new Error("No pending Pinterest queue item is available for a Sandbox test.");
  }
  if (!item.image_url || !item.destination_url) {
    throw new Error("The selected queue item is missing its image or destination URL.");
  }

  const pin = await createPin({
    boardId: settings.pinterestSandboxBoardId,
    imageUrl: item.image_url,
    title: item.title,
    description: item.description || item.title,
    destinationUrl: item.destination_url
  }, userId);

  return {
    etsyListingId: item.etsy_listing_id,
    pinterestPinId: pin.id
  };
}
