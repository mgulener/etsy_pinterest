import type { NormalizedEtsyListing } from "@/lib/etsy/types";

const DEFAULT_MODEL = "gpt-5.4-mini";
const DEFAULT_BATCH_SIZE = 30;

const BOARD_GUIDANCE: Record<string, string> = {
  "All Products": "Fallback only. Use for faith/religion, identity or heritage, activism, non-humorous politics, generic art, and products without a direct match below.",
  "Birthday & Celebration": "Birthdays, birthday ages, parties, anniversaries, and explicit celebrations. Never use for Valentine's Day or other calendar holidays.",
  "Christmas & New Year": "Christmas, Xmas, Santa, reindeer, Christmas trees, ornaments, and New Year only. Do not use for general Christian or faith products.",
  "Coffee & Drinks": "Coffee, tea, beer, wine, cocktails, and other beverages, except explicit Dr Pepper or soda products.",
  "Dad & Grandpa": "Products explicitly for dads, fathers, grandpas, or grandfathers. Do not infer this audience from hobbies alone.",
  "Dr. Pepper & Soda": "Dr Pepper, soda, pop, and soft-drink products when the drink is the central theme.",
  "Fall & Thanksgiving": "Autumn, fall, Thanksgiving, turkey-day, and pumpkin-season products that are not primarily Halloween.",
  "Funny & Sarcastic": "Jokes, sarcasm, satire, memes, and humorous slogans, including humor-forward political products when no more specific theme applies.",
  "Funny Animal Shirts": "Animal-themed products where an animal is the central subject, especially funny, cute, quirky, or illustrated animals.",
  "Halloween & Spooky": "Halloween, ghosts, witches, skeletons, bats, monsters, trick-or-treat, and explicitly spooky products.",
  "Jobs & Professions": "Explicit occupations, trades, careers, and workplace roles. Do not use for cultural identity or generic motivational products.",
  "Mom & Grandma": "Products explicitly for moms, mothers, grandmas, or grandmothers. Do not infer this audience from women's themes or health causes.",
  "Nurse & Healthcare": "Nurses, doctors, medical professions, healthcare, mental-health awareness, cancer awareness, ribbons, and patient-support themes.",
  "Patriotic & USA": "Explicit USA, America, American flag, patriotic, military, veteran, Memorial Day, or Independence Day products. General politics or activism belongs in All Products unless humor-forward.",
  "Personalized & Custom": "Products whose main selling point is a custom name, photo, date, text, family, team, or other buyer-provided personalization.",
  "Seasonal & Holidays": "Valentine's Day, St. Patrick's Day, Easter, Mardi Gras, Cinco de Mayo, Oktoberfest, and other calendar holidays without a dedicated board.",
  "Sports & Game Day": "Sports, teams, athletes, game day, tailgating, and sports-fan products.",
  "Summer & Lake Life": "Summer, beach, lake, boating, fishing, camping, outdoors, road trips, and vacation products.",
  "Teacher & School": "Teachers, educators, students, school staff, classrooms, back-to-school, and graduation products.",
  "Vintage & Retro": "Products whose primary theme is a vintage or retro aesthetic. Use only when no occasion, audience, profession, sport, animal, or lifestyle board is more specific.",
  "Western & Country": "Cowboy, cowgirl, rodeo, ranch, western, country-music, and rural-country themes."
};

const EXPLICIT_BOARD_RULES: Array<{ boardName: string; pattern: RegExp }> = [
  {
    boardName: "Nurse & Healthcare",
    pattern: /\b(nurse|doctor|medical|healthcare|mental health|ptsd|cancer|chemo|pink ribbon|colon cancer|breast cancer)\b/i
  },
  {
    boardName: "Seasonal & Holidays",
    pattern: /\b(valentine(?:'s)?|st\.? patrick(?:'s)?|saint patrick(?:'s)?|st\.? patty(?:'s)?|shamrock|leprechaun|easter|oktoberfest|mardi gras|cinco de mayo)\b/i
  },
  {
    boardName: "Halloween & Spooky",
    pattern: /\b(halloween|spooky|trick(?:-| )or(?:-| )treat|ghost|witch|skeleton|skull|haunted|horror)\b/i
  },
  {
    boardName: "Christmas & New Year",
    pattern: /\b(christmas|xmas|santa|reindeer|new year)\b/i
  },
  {
    boardName: "Fall & Thanksgiving",
    pattern: /\b(thanksgiving|friendsgiving|turkey day|turkey trot|autumn|fall)\b/i
  },
  {
    boardName: "Dr. Pepper & Soda",
    pattern: /\b(dr\.? pepper|soda|soft drink)\b/i
  },
  {
    boardName: "Teacher & School",
    pattern: /\b(teacher|educator|classroom|back(?:-| )to(?:-| )school|school staff|graduation|class of|senior 20\d{2})\b/i
  },
  {
    boardName: "Mom & Grandma",
    pattern: /\b(mom|mama|mother|mommy|grandma|grandmother|nana)\b/i
  },
  {
    boardName: "Dad & Grandpa",
    pattern: /\b(dad|daddy|father|papa|grandpa|grandfather)\b/i
  },
  {
    boardName: "Birthday & Celebration",
    pattern: /\b(birthday|anniversary|birthday party)\b/i
  },
  {
    boardName: "Personalized & Custom",
    pattern: /\b(personalized|custom name|your name|custom photo|custom date)\b/i
  },
  {
    boardName: "Patriotic & USA",
    pattern: /\b(usa|u\.?s\.?a\.?|american flag|patriotic|independence day|fourth of july|4th of july|memorial day|veteran)\b/i
  }
];

const guardedBoardRules = new Map(
  EXPLICIT_BOARD_RULES.map((rule) => [normalizedName(rule.boardName), rule.pattern])
);

export type PinterestBoardChoice = {
  id: string;
  name: string;
};

type ClassificationListing = Pick<
  NormalizedEtsyListing,
  "etsyListingId" | "title" | "description"
>;

type OpenAIResponse = {
  output_text?: string;
  output?: Array<{ content?: Array<{ text?: string }> }>;
};

type ClassificationPayload = {
  assignments: Array<{
    etsyListingId: number;
    boardName: string;
  }>;
};

function getResponseText(response: OpenAIResponse) {
  return response.output_text ?? response.output
    ?.flatMap((item) => item.content ?? [])
    .map((content) => content.text ?? "")
    .join("")
    .trim() ?? "";
}

function normalizedName(value: string) {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
}

function getExplicitBoardId(
  listing: ClassificationListing,
  boardIdByName: ReadonlyMap<string, string>
) {
  for (const rule of EXPLICIT_BOARD_RULES) {
    if (rule.pattern.test(listing.title)) {
      const boardId = boardIdByName.get(normalizedName(rule.boardName));
      if (boardId) {
        return boardId;
      }
    }
  }

  return null;
}

function isAllowedAssignment(listing: ClassificationListing, boardName: string) {
  const guard = guardedBoardRules.get(normalizedName(boardName));
  return !guard || guard.test(listing.title);
}

export async function classifyPinterestListingsWithAI(input: {
  listings: ClassificationListing[];
  boards: PinterestBoardChoice[];
  fallbackBoardId: string;
  apiKey: string | null;
  model?: string | null;
  fetchImpl?: typeof fetch;
  batchSize?: number;
  timeoutMs?: number;
}) {
  if (!input.apiKey) {
    throw new Error("OpenAI API key is missing. Add it in Settings before classifying boards.");
  }

  const fallbackBoard = input.boards.find((board) => board.id === input.fallbackBoardId);
  if (!fallbackBoard) {
    throw new Error("The Pinterest fallback board is not available for classification.");
  }

  const uniqueBoardNames = [...new Set(input.boards.map((board) => board.name))];
  const boardGuidance = Object.fromEntries(
    uniqueBoardNames.map((boardName) => [
      boardName,
      BOARD_GUIDANCE[boardName] ?? "Use only when the product directly and clearly matches this board name."
    ])
  );
  const boardIdByName = new Map(
    input.boards.map((board) => [normalizedName(board.name), board.id])
  );
  const assignments = new Map<number, string>();
  const fetchImpl = input.fetchImpl ?? fetch;
  const batchSize = input.batchSize ?? DEFAULT_BATCH_SIZE;
  const listingsForAI: ClassificationListing[] = [];

  for (const listing of input.listings) {
    const explicitBoardId = getExplicitBoardId(listing, boardIdByName);
    if (explicitBoardId) {
      assignments.set(listing.etsyListingId, explicitBoardId);
    } else {
      listingsForAI.push(listing);
    }
  }

  for (let index = 0; index < listingsForAI.length; index += batchSize) {
    const batch = listingsForAI.slice(index, index + batchSize);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), input.timeoutMs ?? 60_000);
    let response: Response;

    try {
      response = await fetchImpl("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${input.apiKey}`,
          "Content-Type": "application/json"
        },
        signal: controller.signal,
        body: JSON.stringify({
          model: input.model || DEFAULT_MODEL,
          input: [
            {
              role: "system",
              content: [
                "Classify Etsy products into the supplied Pinterest boards.",
                "Choose the most specific board supported by the product title and description.",
                "Do not force a match. Use the fallback board when no board is clearly relevant.",
                "Follow the supplied board guidance as strict inclusion and exclusion rules.",
                "A product can have several themes; choose the board describing its central subject, not a weak secondary word.",
                "Prefer an explicit occasion, audience, profession, sport, or lifestyle over a generic aesthetic.",
                "Return exactly one assignment for every listing ID."
              ].join(" ")
            },
            {
              role: "user",
              content: JSON.stringify({
                fallbackBoard: fallbackBoard.name,
                allowedBoards: uniqueBoardNames,
                boardGuidance,
                listings: batch.map((listing) => ({
                  etsyListingId: listing.etsyListingId,
                  title: listing.title,
                  description: (listing.description ?? "").replace(/\s+/g, " ").slice(0, 500)
                }))
              })
            }
          ],
          max_output_tokens: 2_500,
          text: {
            format: {
              type: "json_schema",
              name: "pinterest_board_assignments",
              strict: true,
              schema: {
                type: "object",
                additionalProperties: false,
                properties: {
                  assignments: {
                    type: "array",
                    items: {
                      type: "object",
                      additionalProperties: false,
                      properties: {
                        etsyListingId: { type: "integer" },
                        boardName: { type: "string", enum: uniqueBoardNames }
                      },
                      required: ["etsyListingId", "boardName"]
                    }
                  }
                },
                required: ["assignments"]
              }
            }
          }
        })
      });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error("Pinterest board classification timed out.");
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      const message = await response.text();
      throw new Error(`OpenAI board classification failed: ${response.status} ${message.slice(0, 240)}`);
    }

    const payload = JSON.parse(
      getResponseText(await response.json() as OpenAIResponse)
    ) as ClassificationPayload;
    const batchIds = new Set(batch.map((listing) => listing.etsyListingId));

    for (const assignment of payload.assignments ?? []) {
      if (!batchIds.has(assignment.etsyListingId)) {
        continue;
      }

      const listing = batch.find((item) => item.etsyListingId === assignment.etsyListingId)!;
      const boardId = boardIdByName.get(normalizedName(assignment.boardName));
      assignments.set(
        assignment.etsyListingId,
        boardId && isAllowedAssignment(listing, assignment.boardName)
          ? boardId
          : input.fallbackBoardId
      );
    }

    for (const listing of batch) {
      if (!assignments.has(listing.etsyListingId)) {
        assignments.set(listing.etsyListingId, input.fallbackBoardId);
      }
    }
  }

  return assignments;
}
