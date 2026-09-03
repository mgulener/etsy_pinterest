import Link from "next/link";

type PaginationProps = {
  currentPage: number;
  totalPages: number;
  getHref: (page: number) => string;
};

function getVisiblePages(currentPage: number, totalPages: number) {
  const pages = new Set<number>([1, totalPages]);
  const start = Math.max(currentPage - 2, 1);
  const end = Math.min(currentPage + 2, totalPages);

  for (let page = start; page <= end; page += 1) {
    pages.add(page);
  }

  return [...pages].sort((a, b) => a - b);
}

export function Pagination({ currentPage, totalPages, getHref }: PaginationProps) {
  if (totalPages <= 1) {
    return null;
  }

  const pages = getVisiblePages(currentPage, totalPages);
  const items = pages.flatMap((page, index) => {
    const previousPage = pages[index - 1];
    const shouldShowGap = previousPage !== undefined && page - previousPage > 1;

    return shouldShowGap
      ? [
          { type: "gap" as const, key: `gap-${previousPage}-${page}` },
          { type: "page" as const, key: String(page), page }
        ]
      : [{ type: "page" as const, key: String(page), page }];
  });

  return (
    <nav className="pagination" aria-label="Pagination">
      {items.map((item) =>
        item.type === "gap" ? (
          <span className="pagination-gap" key={item.key}>
            ...
          </span>
        ) : item.page === currentPage ? (
          <span className="page-button active" aria-current="page" key={item.key}>
            {item.page}
          </span>
        ) : (
          <Link className="page-button" href={getHref(item.page)} key={item.key}>
            {item.page}
          </Link>
        )
      )}
    </nav>
  );
}
