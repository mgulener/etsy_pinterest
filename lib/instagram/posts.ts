import { publishInstagramImage } from "./publishing";
import type { CreateInstagramPostInput, CreateInstagramPostResult } from "./types";

export async function createInstagramPost(
  input: CreateInstagramPostInput
): Promise<CreateInstagramPostResult> {
  return publishInstagramImage({
    imageUrl: input.imageUrls?.[0] ?? input.imageUrl,
    caption: input.caption,
    userId: input.userId
  });
}
