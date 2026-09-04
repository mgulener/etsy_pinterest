import { Pagination } from "@/app/components/Pagination";
import { requireAdminSession } from "@/lib/auth/session";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { createPinterestPostsRepository } from "@/lib/repositories/pinterestPostsRepository";

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

export default async function PinsPage({ searchParams }: PageProps) {
  await requireAdminSession();
  const params = (await searchParams) ?? {};
  const page = Math.max(Number(getParam(params, "page") ?? "1"), 1);
  const pageSize = 25;
  const result = await createPinterestPostsRepository().list({ page, pageSize });
  const totalPages = Math.max(Math.ceil(result.total / pageSize), 1);
  const supabase = getSupabaseAdmin();
  const listingIds = result.rows.map((row) => row.etsy_listing_id);
  const listingDetails = new Map<
    number,
    { imageUrl: string | null; title: string; url: string | null }
  >();

  if (listingIds.length > 0) {
    const { data } = await supabase
      .from("etsy_listings")
      .select("etsy_listing_id,image_url,title,url")
      .in("etsy_listing_id", listingIds);

    data?.forEach((listing) => {
      listingDetails.set(listing.etsy_listing_id, {
        imageUrl: listing.image_url,
        title: listing.title,
        url: listing.url
      });
    });
  }

  return (
    <main className="page">
      <div className="page-heading">
        <div>
          <h1>Pinterest Posts</h1>
          <p>{result.total} published Pinterest pins.</p>
        </div>
      </div>

      <div className="table-shell">
        <table className="table table-hover align-middle mb-0">
          <thead>
            <tr>
              <th>Etsy Listing</th>
              <th>Pinterest Pin ID</th>
              <th>Board</th>
              <th>Published Date</th>
            </tr>
          </thead>
          <tbody>
            {result.rows.map((post) => {
              const listing = listingDetails.get(post.etsy_listing_id);
              const pinUrl = `https://www.pinterest.com/pin/${post.pinterest_pin_id}/`;

              return (
                <tr key={post.id}>
                  <td>
                    <div className="listing-cell">
                      {listing?.imageUrl ? (
                        <span className="thumb-wrap">
                          <img className="thumb" src={listing.imageUrl} alt="" />
                          <img className="thumb-preview" src={listing.imageUrl} alt="" />
                        </span>
                      ) : (
                        <div className="thumb" />
                      )}
                      <div>
                        {listing?.url ? (
                          <a href={listing.url} target="_blank" rel="noreferrer">
                            {listing.title}
                          </a>
                        ) : (
                          listing?.title ?? `Etsy listing ${post.etsy_listing_id}`
                        )}
                        <div className="muted">{post.etsy_listing_id}</div>
                      </div>
                    </div>
                  </td>
                  <td>
                    <a href={pinUrl} target="_blank" rel="noreferrer">
                      {post.pinterest_pin_id}
                    </a>
                  </td>
                  <td>{post.pinterest_board_id}</td>
                  <td>{formatDate(post.published_at)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <Pagination
        currentPage={page}
        totalPages={totalPages}
        getHref={(targetPage) => `/pinterest/posts?page=${targetPage}`}
      />
    </main>
  );
}
