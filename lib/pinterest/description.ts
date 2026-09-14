import type { PinQueueRow, PinQueueStatus } from "@/lib/supabase/types";

// An editorial limit for our short descriptions, not Pinterest's API limit.
export const PIN_DESCRIPTION_MAX_LENGTH = 500;
export const EDITABLE_PIN_STATUSES: PinQueueStatus[] = ["pending", "failed", "cancelled"];

export function canEditPinDescription(status: PinQueueStatus) {
  return EDITABLE_PIN_STATUSES.includes(status);
}

export function validatePinDescription(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("Enter a Pinterest description.");
  }
  const description = value.trim();
  if (description.length > PIN_DESCRIPTION_MAX_LENGTH) {
    throw new Error(`Keep the description within ${PIN_DESCRIPTION_MAX_LENGTH} characters.`);
  }
  return description;
}

export function getPinDescription(
  item: Pick<PinQueueRow, "title" | "description" | "pin_description">
) {
  if (item.pin_description != null) {
    return validatePinDescription(item.pin_description);
  }

  // Existing queue rows keep working without sending a paragraph cut mid-sentence.
  const text = (item.description ?? "").replace(/\s+/g, " ").trim();
  if (text && text.length <= PIN_DESCRIPTION_MAX_LENGTH) return text;
  const sentences = Array.from(new Intl.Segmenter("en", { granularity: "sentence" }).segment(text));
  let summary = "";
  for (const { segment } of sentences) {
    const next = (summary + segment).trimEnd();
    if (next.length > PIN_DESCRIPTION_MAX_LENGTH) break;
    summary += segment;
    if (summary.trim().length >= 200) break;
  }
  if (summary.trim()) return summary.trim();
  const title = item.title.trim();
  if (title.length <= PIN_DESCRIPTION_MAX_LENGTH) return title;
  return title.slice(0, PIN_DESCRIPTION_MAX_LENGTH - 3).replace(/\s+\S*$/, "") + "...";
}
