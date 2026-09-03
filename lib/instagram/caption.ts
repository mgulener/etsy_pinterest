import type { NormalizedEtsyListing } from "@/lib/etsy/types";

const MAX_CAPTION_LENGTH = 2200;
const MAX_PRODUCT_HASHTAGS = 9;
const FALLBACK_HASHTAGS = ["etsyfinds", "giftideas", "handmade"];
const BRAND_HASHTAGS = ["etsyshop", "smallbusiness"];

const STOP_WORDS = new Set([
  "and",
  "are",
  "art",
  "best",
  "buy",
  "can",
  "custom",
  "decor",
  "digital",
  "download",
  "for",
  "from",
  "gift",
  "handmade",
  "home",
  "instant",
  "listing",
  "new",
  "now",
  "our",
  "personalized",
  "printable",
  "sale",
  "set",
  "shop",
  "the",
  "this",
  "with",
  "you",
  "your"
]);

const CATEGORY_TAGS: Array<{ pattern: RegExp; tags: string[] }> = [
  { pattern: /\b(christmas|xmas|holiday|ornament)\b/i, tags: ["christmasdecor", "holidaydecor", "ornament"] },
  { pattern: /\b(wedding|bride|bridal|groom|engagement)\b/i, tags: ["weddinggift", "bridal", "engagementgift"] },
  { pattern: /\b(baby|newborn|nursery|kids?|children)\b/i, tags: ["babygift", "nurserydecor", "kidsgift"] },
  { pattern: /\b(mug|cup|tumbler)\b/i, tags: ["muglover", "coffeegift", "custommug"] },
  { pattern: /\b(shirt|tshirt|tee|sweatshirt|hoodie)\b/i, tags: ["customshirt", "graphictee", "outfitideas"] },
  { pattern: /\b(candle|scent|aroma)\b/i, tags: ["candlegift", "homedecor", "cozyhome"] },
  { pattern: /\b(sticker|label|decal)\b/i, tags: ["stickershop", "plannerstickers", "customsticker"] },
  { pattern: /\b(poster|print|wall|canvas)\b/i, tags: ["wallart", "printableart", "homedecor"] },
  { pattern: /\b(jewelry|necklace|bracelet|earrings?|ring)\b/i, tags: ["jewelrygift", "handmadejewelry", "accessories"] },
  { pattern: /\b(wood|wooden|cedar)\b/i, tags: ["wooddecor", "rusticdecor", "naturalhome"] }
];

function normalizeHashtag(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "")
    .slice(0, 40);
}

function tokenize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 3)
    .filter((token) => !/^\d+$/.test(token))
    .filter((token) => !STOP_WORDS.has(token));
}

function addUnique(tags: string[], seen: Set<string>, tag: string) {
  const normalized = normalizeHashtag(tag);

  if (!normalized || seen.has(normalized)) {
    return;
  }

  seen.add(normalized);
  tags.push(normalized);
}

export function buildInstagramHashtags(
  listing: Pick<NormalizedEtsyListing, "title" | "description">
) {
  const text = `${listing.title} ${listing.description ?? ""}`;
  const tags: string[] = [];
  const seen = new Set<string>();

  CATEGORY_TAGS.forEach(({ pattern, tags: categoryTags }) => {
    if (pattern.test(text)) {
      categoryTags.forEach((tag) => addUnique(tags, seen, tag));
    }
  });

  const weightedTokens = [
    ...tokenize(listing.title),
    ...tokenize(listing.title),
    ...tokenize(listing.description ?? "")
  ];
  const scores = new Map<string, number>();

  weightedTokens.forEach((token) => {
    const tag = normalizeHashtag(token);

    if (tag) {
      scores.set(tag, (scores.get(tag) ?? 0) + 1);
    }
  });

  [...scores.entries()]
    .sort((first, second) => second[1] - first[1] || first[0].localeCompare(second[0]))
    .map(([tag]) => tag)
    .slice(0, MAX_PRODUCT_HASHTAGS)
    .forEach((tag) => addUnique(tags, seen, tag));

  const fallbackTags = tags.length > 0 ? BRAND_HASHTAGS : FALLBACK_HASHTAGS;
  fallbackTags.forEach((tag) => addUnique(tags, seen, tag));

  return tags.slice(0, 12).map((tag) => `#${tag}`);
}

export function buildInstagramCaption(listing: NormalizedEtsyListing) {
  const hashtags = buildInstagramHashtags(listing);
  const caption = [
    listing.title,
    "Available now in our Etsy shop.",
    "Link in bio.",
    hashtags.join(" ")
  ].join("\n\n");

  return caption.slice(0, MAX_CAPTION_LENGTH);
}
