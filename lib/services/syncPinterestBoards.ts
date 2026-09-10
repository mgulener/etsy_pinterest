import { getAllActiveListings, getShopSections } from "@/lib/etsy/client";
import { normalizeEtsyListing } from "@/lib/etsy/listings";
import type { EtsyShopSection, NormalizedEtsyListing } from "@/lib/etsy/types";
import {
  createPinterestBoard,
  listPinterestBoards,
  type PinterestBoard
} from "@/lib/pinterest/client";
import {
  createPinterestBoardMappingsRepository,
  type PinterestBoardMappingInput,
  type PinterestBoardMappingsRepository
} from "@/lib/repositories/pinterestBoardMappingsRepository";
import { createListingsRepository } from "@/lib/repositories/listingsRepository";
import { createPinQueueRepository } from "@/lib/repositories/pinQueueRepository";
import {
  getSettingsForUser,
  savePinterestBoardIdForUser
} from "@/lib/repositories/userSettingsRepository";
import { buildScheduledAt, getNextScheduleStart, sortListingsForQueue } from "@/lib/queue/scheduling";

const FALLBACK_BOARD_NAME = "All Products";

function normalizedName(value: string) {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
}

export type PinterestBoardSyncResult = {
  sections: number;
  createdBoards: number;
  matchedBoards: number;
  retainedMappings: number;
};

export async function syncPinterestBoardsWithDependencies(input: {
  userId: string;
  sections: EtsyShopSection[];
  boards: PinterestBoard[];
  mappingsRepository: PinterestBoardMappingsRepository;
  createBoard: (name: string, description: string) => Promise<PinterestBoard>;
}): Promise<PinterestBoardSyncResult> {
  const mappings = await input.mappingsRepository.listForUser(input.userId);
  const boards = [...input.boards];
  let createdBoards = 0;
  let matchedBoards = 0;
  let retainedMappings = 0;

  for (const section of input.sections) {
    const existingMapping = mappings.find(
      (mapping) => mapping.etsy_shop_section_id === section.shop_section_id
    );
    let board = existingMapping
      ? boards.find((item) => item.id === existingMapping.pinterest_board_id)
      : undefined;

    if (board) {
      retainedMappings += 1;
    } else {
      board = boards.find((item) => normalizedName(item.name) === normalizedName(section.title));

      if (board) {
        matchedBoards += 1;
      } else {
        board = await input.createBoard(
          section.title,
          `Products from the ${section.title} section of the connected Etsy shop.`
        );
        boards.push(board);
        createdBoards += 1;
      }
    }

    const mapping: PinterestBoardMappingInput = {
      userId: input.userId,
      etsyShopSectionId: section.shop_section_id,
      etsySectionTitle: section.title,
      pinterestBoardId: board.id,
      pinterestBoardName: board.name
    };
    await input.mappingsRepository.upsert(mapping);
  }

  return {
    sections: input.sections.length,
    createdBoards,
    matchedBoards,
    retainedMappings
  };
}

export function resolvePinterestBoardId(
  listing: Pick<NormalizedEtsyListing, "etsyShopSectionId">,
  boardBySectionId: ReadonlyMap<number, string>,
  fallbackBoardId?: string | null
) {
  if (listing.etsyShopSectionId != null) {
    const mappedBoardId = boardBySectionId.get(listing.etsyShopSectionId);
    if (mappedBoardId) {
      return mappedBoardId;
    }
  }

  return fallbackBoardId ?? undefined;
}

export async function preparePinterestPublishingForUser(userId: string) {
  const settings = await getSettingsForUser(userId);

  if (!settings.pinterestEnabled || !settings.pinterestAccessToken) {
    throw new Error("Connect and enable Pinterest before syncing boards.");
  }

  const sections = await getShopSections(userId);
  const initialBoards = await listPinterestBoards(userId);
  const mappingsRepository = createPinterestBoardMappingsRepository();
  const boardSync = await syncPinterestBoardsWithDependencies({
    userId,
    sections,
    boards: initialBoards,
    mappingsRepository,
    createBoard: (name, description) => createPinterestBoard({ name, description }, userId)
  });

  const boards = await listPinterestBoards(userId);
  let fallbackBoardId = settings.pinterestBoardId;

  if (!fallbackBoardId || !boards.some((board) => board.id === fallbackBoardId)) {
    let fallbackBoard = boards.find(
      (board) => normalizedName(board.name) === normalizedName(FALLBACK_BOARD_NAME)
    );

    if (!fallbackBoard) {
      fallbackBoard = await createPinterestBoard({
        name: FALLBACK_BOARD_NAME,
        description: "Products without an Etsy shop section."
      }, userId);
      boardSync.createdBoards += 1;
    }

    fallbackBoardId = fallbackBoard.id;
    await savePinterestBoardIdForUser(userId, fallbackBoardId);
  }

  const etsyListings = await getAllActiveListings(userId);
  const normalizedListings = etsyListings.map(normalizeEtsyListing);
  await createListingsRepository().upsertKnownListings(normalizedListings);

  const mappings = await mappingsRepository.listForUser(userId);
  const boardBySectionId = new Map(
    mappings.map((mapping) => [mapping.etsy_shop_section_id, mapping.pinterest_board_id])
  );
  const sortedListings = sortListingsForQueue(normalizedListings);
  const scheduleStart = getNextScheduleStart();
  const queueRepository = createPinQueueRepository();
  const queued = await queueRepository.enqueueListings(
    sortedListings.map((listing, index) => ({
      listing,
      boardId: resolvePinterestBoardId(listing, boardBySectionId, fallbackBoardId)!,
      scheduledAt: buildScheduledAt(index, undefined, scheduleStart)
    }))
  );

  if (queued > 0) {
    await queueRepository.rebuildPendingSchedule();
  }

  return {
    ...boardSync,
    listings: normalizedListings.length,
    queued
  };
}
