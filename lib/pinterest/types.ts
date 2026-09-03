export type CreatePinInput = {
  boardId: string;
  imageUrl: string;
  title: string;
  description: string;
  destinationUrl: string;
};

export type CreatePinResult = {
  id: string;
};
