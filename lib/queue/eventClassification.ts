import { createHash } from "node:crypto";
import { EVENT_IDS, isEventId, type EventId } from "./seasonalCalendar";

export const CLASSIFIER_VERSION = "listing-events-v3";
export type EventProduct = { etsyListingId: number; title: string; description: string | null; tags?: string[] };
export type EventClassification = {
  kind: "event" | "evergreen" | "review";
  events: EventId[];
  confidence: "high" | "medium" | "low";
  evidence: string[];
  reason: string;
  targetYear: number | null;
};
export type SavedEventClassification = {
  inputHash: string;
  version: string;
  model: string;
  classification: EventClassification;
};

export function eventProductInput(product: EventProduct) {
  return {
    title: product.title.trim().slice(0, 500),
    description: (product.description ?? "").replace(/\s+/g, " ").trim().slice(0, 5000),
    tags: [...new Set(product.tags ?? [])].sort()
  };
}

export function eventInputHash(product: EventProduct) {
  return createHash("sha256").update(JSON.stringify(eventProductInput(product))).digest("hex");
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function parseEventClassification(value: unknown, product: EventProduct): EventClassification {
  if (!record(value) || !["event", "evergreen", "review"].includes(String(value.kind)) ||
      !["high", "medium", "low"].includes(String(value.confidence)) ||
      !Array.isArray(value.events) || value.events.length > 3 || !value.events.every(isEventId) ||
      new Set(value.events).size !== value.events.length ||
      !Array.isArray(value.evidence) || value.evidence.length > 3 ||
      !value.evidence.every(item => typeof item === "string" && item.length > 0 && item.length <= 240) ||
      typeof value.reason !== "string" || !value.reason.trim() || value.reason.length > 500 ||
      !(value.targetYear === null || (Number.isInteger(value.targetYear) && Number(value.targetYear) >= 2000 && Number(value.targetYear) <= 2100))) {
    throw new Error("Invalid event classification response.");
  }
  const result = { ...value, evidence: value.evidence.map(quote => quote.replace(/^[\s"\u201c\u201d]+|[\s"\u201c\u201d]+$/g, "")) } as EventClassification;
  if ((result.kind === "event" && result.events.length === 0) || (result.kind === "evergreen" && result.events.length > 0)) {
    return { ...result, kind: "review", reason: "AI category and event IDs disagree; no automatic seasonal promotion." };
  }
  if (result.kind === "review") return result;
  const input = eventProductInput(product);
  const comparable = (text: string) => text.toLowerCase().replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, '"').replace(/\s+/g, " ").trim();
  const text = comparable([input.title, input.description, ...input.tags].join(" "));
  const missingEvidence = result.kind === "event" && (!result.evidence.length || result.evidence.some(quote => !quote || !text.includes(comparable(quote))));
  const unsupportedYear = result.targetYear !== null && !new RegExp(`\\b${result.targetYear}\\b`).test(input.title);
  if (missingEvidence || unsupportedYear || result.confidence !== "high") {
    const cause = missingEvidence ? "Evidence did not match the product" : unsupportedYear ? "Unverified event year" : "Uncertain classification";
    return { ...result, kind: "review", reason: `${cause}: ${result.reason}`.slice(0, 500) };
  }
  // Guard semantic traps observed in the real pilot, not just JSON structure.
  if (/\b(lunar|chinese) new year\b|\b(easter|hanukkah|chanukah)\b/i.test(input.title)) {
    return { ...result, kind: "review", reason: "The title names an occasion not supported by this calendar." };
  }
  if (result.kind === "event" && /\b\d+(?:st|nd|rd|th)?\s+anniversary\b/i.test(input.title)) {
    return { ...result, kind: "review", reason: "An anniversary edition needs its actual target year checked before annual reuse." };
  }
  const explicit = TITLE_EVENTS.filter(([, pattern]) => pattern.test(input.title)).map(([id]) => id);
  const explicitHolidays = explicit.filter(id => !SEASONS.has(id));
  if (result.kind === "evergreen" && explicit.length) {
    return { ...result, kind: "review", reason: "Evergreen classification conflicts with an explicit seasonal theme in the title." };
  }
  if (result.kind === "event") {
    if (explicitHolidays.length) {
      // A Thanksgiving shirt must not jump ahead as generic autumn merchandise.
      result.events = result.events.filter(id => !SEASONS.has(id));
      if (!explicitHolidays.every(id => result.events.includes(id))) {
        return { ...result, kind: "review", reason: "AI classification conflicts with the named occasion in the title." };
      }
    } else if (explicit.length) {
      // Incidental Christmas gift suggestions do not turn a winter design into Christmas.
      result.events = result.events.filter(id => explicit.includes(id));
    }
    if (!result.events.length) return { ...result, kind: "review", reason: "No verified event remains after checking the product title." };
  }
  return result;
}

const SEASONS = new Set<EventId>(["spring", "summer", "autumn", "winter"]);
const TITLE_EVENTS: Array<[EventId, RegExp]> = [
  ["halloween", /\bhalloween\b/i], ["thanksgiving", /\b(thanksgiving|friendsgiving)\b/i],
  ["christmas", /\b(christmas|xmas)\b/i], ["valentines", /\bvalentine(?:'s|s)?\b/i],
  ["st_patricks", /\bst\.? patrick(?:'s|s)?\b/i], ["breast_cancer_month", /\bbreast cancer\b/i],
  ["patriot_day", /\b(patriot day|september 11|9[/-]11)\b/i],
  ["spring", /\bspring\b/i], ["summer", /\bsummer\b/i],
  ["autumn", /\b(fall|autumn)\b/i], ["winter", /\bwinter\b/i]
];

export const classificationSchema = {
  type: "object", additionalProperties: false,
  properties: {
    kind: { type: "string", enum: ["event", "evergreen", "review"] },
    events: { type: "array", maxItems: 3, items: { type: "string", enum: EVENT_IDS } },
    confidence: { type: "string", enum: ["high", "medium", "low"] },
    evidence: { type: "array", maxItems: 3, items: { type: "string", minLength: 1, maxLength: 240 } },
    reason: { type: "string", minLength: 1, maxLength: 500 },
    targetYear: { type: ["integer", "null"] }
  }, required: ["kind", "events", "confidence", "evidence", "reason", "targetYear"]
};
