import { Pagination } from "@/app/components/Pagination";
import { requireAdminSession } from "@/lib/auth/session";
import { createListingsRepository } from "@/lib/repositories/listingsRepository";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function getParam(params: Record<string, string | string[] | undefined>, key: string) {
  const value = params[key];
  return Array.isArray(value) ? value[0] : value;
}

function formatDate(value: string | null) {
  return value ? new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "-";
}

export default async function ListingsPage({ searchParams }: PageProps) {
  await requireAdminSession();
  const params = (await searchParams) ?? {};
  const search = getParam(params, "search") ?? "";
  const page = Math.max(Number(getParam(params, "page") ?? "1"), 1);
  const pageSize = 25;
  const result = await createListingsRepository().list({
    page,
    pageSize,
    search: search.trim() || undefined
  });
  const totalPages = Math.max(Math.ceil(result.total / pageSize), 1);

  return (
    <main className="page">
      <div className="page-heading">
        <div>
          <h1>Listings</h1>
          <p>{result.total} known Etsy listings.</p>
        </div>
      </div>

      <div className="toolbar">
        <form>
          <input name="search" placeholder="Search title or listing ID" defaultValue={search} />
          <button type="submit">Search</button>
        </form>
      </div>

      <div className="table-shell">
        <table>
          <thead>
            <tr>
              <th>Listing</th>
              <th>State</th>
              <th>First Seen</th>
              <th>Last Seen</th>
              <th>Pinterest Status</th>
            </tr>
          </thead>
          <tbody>
            {result.rows.map((listing) => (
              <tr key={listing.id}>
                <td>
                  <div className="listing-cell">
                    {listing.image_url ? (
                      <img className="thumb" src={listing.image_url} alt="" />
                    ) : (
                      <div className="thumb" />
                    )}
                    <div>
                      <a href={listing.url ?? undefined} target="_blank" rel="noreferrer">
                        {listing.title}
                      </a>
                      <div className="muted">{listing.etsy_listing_id}</div>
                    </div>
                  </div>
                </td>
                <td>{listing.state}</td>
                <td>{formatDate(listing.first_seen_at)}</td>
                <td>{formatDate(listing.last_seen_at)}</td>
                <td>
                  <span className={`badge ${listing.pinterest_status}`}>
                    {listing.pinterest_status}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Pagination
        currentPage={page}
        totalPages={totalPages}
        getHref={(targetPage) =>
          `/etsy/listings?search=${encodeURIComponent(search)}&page=${targetPage}`
        }
      />
    </main>
  );
}
