export type CreateInstagramPostInput = {
  imageUrl: string;
  caption: string;
};

export type CreateInstagramPostResult = {
  id: string;
  permalink?: string;
};
