import Link from "next/link";
import {
  cancelQueueItemAction,
  retryAllFailedAction,
  retryQueueItemAction
} from "@/app/actions/admin";
import { requireAdminSession } from "@/lib/auth/session";
import { createPinQueueRepository } from "@/lib/repositories/pinQueueRepository";
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
  return value ? new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "-";
}

export default async function QueuePage({ searchParams }: PageProps) {
  await requireAdminSession();
  const params = (await searchParams) ?? {};
  const rawStatus = getParam(params, "status");
  const status = statuses.includes(rawStatus as PinQueueStatus)
    ? (rawStatus as PinQueueStatus)
    : undefined;
  const page = Math.max(Number(getParam(params, "page") ?? "1"), 1);
  const pageSize = 25;
  const result = await createPinQueueRepository().list({ page, pageSize, status });
  const totalPages = Math.max(Math.ceil(result.total / pageSize), 1);
  const statusQuery = status ? `status=${status}&` : "";

  return (
    <main className="page">
      <div className="page-heading">
        <div>
          <h1>Queue</h1>
          <p>{result.total} queue items.</p>
        </div>
        <form action={retryAllFailedAction}>
          <button type="submit">Retry Failed</button>
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
              <th>Last Error</th>
              <th>Created</th>
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
                <td className="muted">{item.last_error ?? "-"}</td>
                <td>{formatDate(item.created_at)}</td>
                <td>
                  <div className="inline-form">
                    {item.status === "failed" ? (
                      <form action={retryQueueItemAction}>
                        <input type="hidden" name="id" value={item.id} />
                        <button className="ghost-button" type="submit">Retry</button>
                      </form>
                    ) : null}
                    {item.status === "pending" || item.status === "failed" ? (
                      <form action={cancelQueueItemAction}>
                        <input type="hidden" name="id" value={item.id} />
                        <button className="danger-button" type="submit">Cancel</button>
                      </form>
                    ) : null}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="pagination">
        {page > 1 ? (
          <Link className="button ghost-button" href={`/queue?${statusQuery}page=${page - 1}`}>
            Previous
          </Link>
        ) : null}
        {page < totalPages ? (
          <Link className="button ghost-button" href={`/queue?${statusQuery}page=${page + 1}`}>
            Next
          </Link>
        ) : null}
      </div>
    </main>
  );
}
