import { Pagination } from "@/app/components/Pagination";
import {
  cancelInstagramQueueItemAction,
  retryAllFailedInstagramAction,
  retryInstagramQueueItemAction
} from "@/app/actions/admin";
import { SubmitButton } from "@/app/components/SubmitButton";
import { requireAdminSession } from "@/lib/auth/session";
import { createInstagramQueueRepository } from "@/lib/repositories/instagramQueueRepository";
import type { PinQueueStatus } from "@/lib/supabase/types";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

const statuses: PinQueueStatus[] = ["pending", "processing", "published", "failed", "cancelled"];

function getParam(params: Record<string, string | string[] | undefined>, key: string) {
  const value = params[key];
  return Array.isArray(value) ? value[0] : value;
}

function formatDate(value: string | null) {
  return value
    ? new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value))
    : "-";
}

export default async function InstagramQueuePage({ searchParams }: PageProps) {
  await requireAdminSession();
  const params = (await searchParams) ?? {};
  const rawStatus = getParam(params, "status");
  const status = statuses.includes(rawStatus as PinQueueStatus)
    ? (rawStatus as PinQueueStatus)
    : undefined;
  const page = Math.max(Number(getParam(params, "page") ?? "1"), 1);
  const pageSize = 25;
  const result = await createInstagramQueueRepository().list({ page, pageSize, status });
  const totalPages = Math.max(Math.ceil(result.total / pageSize), 1);
  const statusQuery = status ? `status=${status}&` : "";

  return (
    <main className="page">
      <div className="page-heading">
        <div>
          <h1>Instagram Queue</h1>
          <p>{result.total} queue items.</p>
        </div>
        <form action={retryAllFailedInstagramAction}>
          <SubmitButton pendingText="Retrying...">Retry Failed</SubmitButton>
        </form>
      </div>

      <div className="toolbar">
        <form>
          <select name="status" defaultValue={status ?? ""}>
            <option value="">All statuses</option>
            {statuses.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
          <button type="submit">Filter</button>
        </form>
      </div>

      <div className="table-shell">
        <table>
          <thead>
            <tr>
              <th>Listing</th>
              <th>Status</th>
              <th>Attempts</th>
              <th>Scheduled At</th>
              <th>Caption</th>
              <th>Last Error</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {result.rows.map((item) => (
              <tr key={item.id}>
                <td>
                  <div className="listing-cell">
                    {item.image_url ? <img className="thumb" src={item.image_url} alt="" /> : <div className="thumb" />}
                    <div>
                      <a href={item.destination_url ?? undefined} target="_blank" rel="noreferrer">
                        {item.title}
                      </a>
                      <div className="muted">{item.etsy_listing_id}</div>
                    </div>
                  </div>
                </td>
                <td>
                  <span className={`badge ${item.status}`}>{item.status}</span>
                </td>
                <td>{item.attempt_count}</td>
                <td>{formatDate(item.scheduled_at)}</td>
                <td className="muted caption-cell">{item.caption}</td>
                <td className="muted">{item.last_error ?? "-"}</td>
                <td>
                  <div className="inline-form">
                    {item.status === "failed" ? (
                      <form action={retryInstagramQueueItemAction}>
                        <input type="hidden" name="id" value={item.id} />
                        <SubmitButton className="ghost-button" pendingText="Retrying...">
                          Retry
                        </SubmitButton>
                      </form>
                    ) : null}
                    {item.status === "pending" || item.status === "failed" ? (
                      <form action={cancelInstagramQueueItemAction}>
                        <input type="hidden" name="id" value={item.id} />
                        <SubmitButton className="danger-button" pendingText="Cancelling...">
                          Cancel
                        </SubmitButton>
                      </form>
                    ) : null}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Pagination
        currentPage={page}
        totalPages={totalPages}
        getHref={(targetPage) => `/instagram-queue?${statusQuery}page=${targetPage}`}
      />
    </main>
  );
}
