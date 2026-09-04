import {
  queueInstagramListingAction,
  queuePinterestListingAction
} from "@/app/actions/admin";
import { Pagination } from "@/app/components/Pagination";
import { SubmitButton } from "@/app/components/SubmitButton";
import { requireAdminSession } from "@/lib/auth/session";
import { createAppSettingsRepository } from "@/lib/repositories/appSettingsRepository";
import { getCurrentUserSettings } from "@/lib/repositories/userSettingsRepository";
import { createListingsRepository } from "@/lib/repositories/listingsRepository";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function getParam(params: Record<string, string | string[] | undefined>, key: string) {
  const value = params[key];
  return Array.isArray(value) ? value[0] : value;
}

export default async function ListingsPage({ searchParams }: PageProps) {
  await requireAdminSession();
  const params = (await searchParams) ?? {};
  const search = getParam(params, "search") ?? "";
  const page = Math.max(Number(getParam(params, "page") ?? "1"), 1);
  const pageSize = 25;
  const [result, settings] = await Promise.all([
    createListingsRepository().list({
      page,
      pageSize,
      search: search.trim() || undefined
    }),
    getCurrentUserSettings()
  ]);
  const initialSyncCompleted = await createAppSettingsRepository().isInitialSyncCompleted();
  const hasPublishActions = settings.pinterestEnabled || settings.instagramEnabled;
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
        <table className="table table-hover align-middle mb-0 listings-table">
          <thead>
            <tr>
              <th>Listing</th>
              <th>State</th>
              <th>Pinterest</th>
              <th>Instagram</th>
              {hasPublishActions ? <th className="actions-column">Publish</th> : null}
            </tr>
          </thead>
          <tbody>
            {result.rows.map((listing) => (
              <tr key={listing.id}>
                <td>
                  <div className="listing-cell">
                    {listing.image_url ? (
                      <span className="thumb-wrap">
                        <img className="thumb" src={listing.image_url} alt="" />
                        <img className="thumb-preview" src={listing.image_url} alt="" />
                      </span>
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
                <td>
                  <span className={`badge ${listing.pinterest_status}`}>
                    {listing.pinterest_status}
                  </span>
                </td>
                <td>
                  <span className={`badge ${listing.instagram_status}`}>
                    {listing.instagram_status}
                  </span>
                </td>
                {hasPublishActions ? (
                  <td>
                    <div className="platform-actions" aria-label={`Publish actions for ${listing.title}`}>
                      {settings.pinterestEnabled ? (
                        <form action={queuePinterestListingAction} title="Add to Pinterest queue">
                          <input type="hidden" name="etsyListingId" value={listing.etsy_listing_id} />
                          <SubmitButton
                            className="icon-button pinterest-action"
                            pendingText="..."
                            disabled={!initialSyncCompleted}
                          >
                            <span aria-hidden="true">P</span>
                            <span className="sr-only">Add to Pinterest queue</span>
                          </SubmitButton>
                        </form>
                      ) : null}
                      {settings.instagramEnabled ? (
                        <form action={queueInstagramListingAction} title="Add to Instagram queue">
                          <input type="hidden" name="etsyListingId" value={listing.etsy_listing_id} />
                          <SubmitButton
                            className="icon-button instagram-action"
                            pendingText="..."
                            disabled={!initialSyncCompleted}
                          >
                            <span aria-hidden="true">IG</span>
                            <span className="sr-only">Add to Instagram queue</span>
                          </SubmitButton>
                        </form>
                      ) : null}
                    </div>
                  </td>
                ) : null}
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
