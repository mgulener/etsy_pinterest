import { decodeHtmlEntities } from "@/lib/etsy/listings";

export const FACEBOOK_MESSAGE_MAX_LENGTH = 2000;

export function validateFacebookMessage(value: unknown) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > FACEBOOK_MESSAGE_MAX_LENGTH) {
    throw new Error(`Message must contain 1-${FACEBOOK_MESSAGE_MAX_LENGTH} characters.`);
  }
  return value.trim();
}

export function validateFacebookMedia(imageUrl: string, destinationUrl: string) {
  const image = new URL(imageUrl);
  const destination = new URL(destinationUrl);
  if (image.protocol !== "https:" || !/(^|\.)etsystatic\.com$/.test(image.hostname) || image.username || image.password) {
    throw new Error("Select an HTTPS Etsy product image.");
  }
  if (destination.protocol !== "https:" || !/(^|\.)etsy\.com$/.test(destination.hostname) || !destination.pathname.startsWith("/listing/") || destination.username || destination.password) {
    throw new Error("A valid Etsy listing link is required.");
  }
}

export function buildFacebookMessage(title: string, description?: string | null) {
  const cleanTitle = decodeHtmlEntities(title).trim();
  const shortDescription = decodeHtmlEntities(description ?? "").replace(/\s+/g, " ").trim();
  return validateFacebookMessage(shortDescription
    ? `${cleanTitle}\n\n${shortDescription.length <= 500 ? shortDescription : shortDescription.slice(0, 497).replace(/\s+\S*$/, "") + "..."}`
    : cleanTitle);
}

export function facebookPermalink(postId: string) {
  return /^\d+_\d+$/.test(postId) ? `https://www.facebook.com/${postId}` : null;
}
