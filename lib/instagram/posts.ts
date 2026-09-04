import {
  publishInstagramCarousel,
  publishInstagramImage
} from "./publishing";
import type { CreateInstagramPostInput, CreateInstagramPostResult } from "./types";

export async function createInstagramPost(
  input: CreateInstagramPostInput
): Promise<CreateInstagramPostResult> {
  if (input.mode === "carousel" && input.imageUrls && input.imageUrls.length > 1) {
    return publishInstagramCarousel({
      imageUrls: input.imageUrls,
      caption: input.caption,
      userId: input.userId
    });
  }

  return publishInstagramImage({
    imageUrl: input.imageUrl,
    caption: input.caption,
    userId: input.userId
  });
}
