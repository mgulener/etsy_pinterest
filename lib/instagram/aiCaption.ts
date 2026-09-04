import type { NormalizedEtsyListing } from "@/lib/etsy/types";

const MAX_CAPTION_LENGTH = 2200;
const MAX_AI_HASHTAGS = 12;
const DEFAULT_MODEL = "gpt-5.4-mini";

type GenerateAiCaptionInput = {
  listing: Pick<NormalizedEtsyListing, "title" | "description" | "destinationUrl">;
  apiKey: string | null;
  model?: string | null;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

type OpenAIResponse = {
  output_text?: string;
  output?: Array<{
    content?: Array<{
      type?: string;
      text?: string;
    }>;
  }>;
};

type AiCaptionPayload = {
  caption: string;
  hashtags: string[];
};

function getResponseText(response: OpenAIResponse) {
  if (response.output_text) {
    return response.output_text;
  }

  return response.output
    ?.flatMap((item) => item.content ?? [])
    .map((content) => content.text ?? "")
    .join("")
    .trim() ?? "";
}

function normalizeGeneratedHashtag(value: string) {
  const normalized = value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/^#+/, "")
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "")
    .slice(0, 40);

  return normalized ? `#${normalized}` : null;
}

function cleanPayload(value: AiCaptionPayload) {
  const caption = value.caption
    .replace(/#[a-z0-9_]+/gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  const seen = new Set<string>();
  const hashtags = value.hashtags
    .map(normalizeGeneratedHashtag)
    .filter((tag): tag is string => Boolean(tag))
    .filter((tag) => {
      if (seen.has(tag)) {
        return false;
      }

      seen.add(tag);
      return true;
    })
    .slice(0, MAX_AI_HASHTAGS);
  const finalCaption = [caption, "Link in bio.", hashtags.join(" ")]
    .filter(Boolean)
    .join("\n\n");

  return finalCaption.slice(0, MAX_CAPTION_LENGTH);
}

export async function generateInstagramCaptionWithAI({
  listing,
  apiKey,
  model,
  fetchImpl = fetch,
  timeoutMs = 45_000
}: GenerateAiCaptionInput) {
  if (!apiKey) {
    throw new Error("OpenAI API key is missing. Add it in Settings before generating AI captions.");
  }

  const productDescription = (listing.description ?? "")
    .replace(/\s+/g, " ")
    .slice(0, 1400);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;

  try {
    response = await fetchImpl("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    signal: controller.signal,
    body: JSON.stringify({
      model: model || DEFAULT_MODEL,
      input: [
        {
          role: "system",
          content: "You write concise Instagram captions for Etsy product listings. Prefer specific, product-relevant hashtags over generic marketplace hashtags. Never invent materials, dates, brands, or occasions that are not supported by the listing text."
        },
        {
          role: "user",
          content: [
            "Create one Instagram caption and 8 to 12 highly relevant hashtags for this Etsy listing.",
            "Keep the caption friendly and sales-safe, under 450 characters before hashtags.",
            "Do not include hashtags inside the caption field; return them only in hashtags.",
            `Title: ${listing.title}`,
            `Description: ${productDescription || "No description provided."}`,
            `Listing URL: ${listing.destinationUrl ?? "Not provided"}`
          ].join("\n")
        }
      ],
      max_output_tokens: 500,
      text: {
        format: {
          type: "json_schema",
          name: "instagram_caption",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              caption: { type: "string" },
              hashtags: {
                type: "array",
                minItems: 8,
                maxItems: 12,
                items: { type: "string" }
              }
            },
            required: ["caption", "hashtags"]
          }
        }
      }
    })
  });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`OpenAI caption request timed out after ${Math.round(timeoutMs / 1000)} seconds.`);
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`OpenAI caption request failed: ${response.status} ${message.slice(0, 240)}`);
  }

  const text = getResponseText(await response.json() as OpenAIResponse);
  const payload = JSON.parse(text) as AiCaptionPayload;

  if (!payload.caption || !Array.isArray(payload.hashtags)) {
    throw new Error("OpenAI caption response was incomplete.");
  }

  return cleanPayload(payload);
}
