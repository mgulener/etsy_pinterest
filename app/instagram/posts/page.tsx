import { Pagination } from "@/app/components/Pagination";
import { queueInstagramPostAgainAction } from "@/app/actions/admin";
import { SubmitButton } from "@/app/components/SubmitButton";
import { requireAdminSession } from "@/lib/auth/session";
import { createInstagramPostsRepository } from "@/lib/repositories/instagramPostsRepository";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function getParam(params: Record<string, string | string[] | undefined>, key: string) {
  const value = params[key];
  return Array.isArray(value) ? value[0] : value;
}

function formatDate(value: string | null) {
  return value
    ? new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value))
    : "-";
}

export default async function InstagramPostsPage({ searchParams }: PageProps) {
  await requireAdminSession();
  const params = (await searchParams) ?? {};
  const page = Math.max(Number(getParam(params, "page") ?? "1"), 1);
  const pageSize = 25;
  const result = await createInstagramPostsRepository().list({ page, pageSize });
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
          <h1>Instagram Posts</h1>
          <p>{result.total} published Instagram posts.</p>
        </div>
      </div>

      <div className="table-shell">
        <table className="table table-hover align-middle mb-0">
          <thead>
            <tr>
              <th>Etsy Listing</th>
              <th>Instagram Media ID</th>
              <th>Media Type</th>
              <th>Permalink</th>
              <th>Published Date</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {result.rows.map((post) => {
              const listing = listingDetails.get(post.etsy_listing_id);

              return (
                <tr key={post.id}>
                  <td>
                    <div className="listing-cell">
                      {listing?.imageUrl ? (
                        <img className="thumb" src={listing.imageUrl} alt="" />
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
                  <td>{post.instagram_media_id}</td>
                  <td>{post.media_type}</td>
                  <td>
                    {post.instagram_permalink ? (
                      <a href={post.instagram_permalink} target="_blank" rel="noreferrer">
                        Open post
                      </a>
                    ) : (
                      "-"
                    )}
                  </td>
                  <td>{formatDate(post.published_at)}</td>
                  <td>
                    <form action={queueInstagramPostAgainAction}>
                      <input type="hidden" name="id" value={post.id} />
                      <SubmitButton className="ghost-button" pendingText="Queueing...">
                        Queue Again
                      </SubmitButton>
                    </form>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <Pagination
        currentPage={page}
        totalPages={totalPages}
        getHref={(targetPage) => `/instagram/posts?page=${targetPage}`}
      />
    </main>
  );
}
