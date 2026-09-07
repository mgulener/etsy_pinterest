export type QueuePartition = "all" | "unpublished" | "published";

export async function paginateQueue<T>(input: {
  page: number;
  pageSize: number;
  filtered: boolean;
  read: (partition: QueuePartition, offset: number, limit: number) => Promise<{ rows: T[]; total: number }>;
}) {
  const offset = (input.page - 1) * input.pageSize;
  if (input.filtered) return input.read("all", offset, input.pageSize);

  // Count each partition before slicing so published rows stay last across pages.
  const unpublished = await input.read("unpublished", 0, 0);
  const published = await input.read("published", 0, 0);
  const rows: T[] = [];
  if (offset < unpublished.total) {
    const limit = Math.min(input.pageSize, unpublished.total - offset);
    rows.push(...(await input.read("unpublished", offset, limit)).rows);
  }
  const publishedOffset = Math.max(0, offset - unpublished.total);
  if (rows.length < input.pageSize && publishedOffset < published.total) {
    rows.push(...(await input.read("published", publishedOffset, input.pageSize - rows.length)).rows);
  }
  return { rows, total: unpublished.total + published.total };
}
