import { ConfirmDeleteButton } from "@/app/components/ConfirmDeleteButton";
import { Pagination } from "@/app/components/Pagination";
import {
  cancelQueueItemAction,
  deleteQueueItemAction,
  publishNowAction,
  retryAllFailedAction,
  retryQueueItemAction
} from "@/app/actions/admin";
import { SubmitButton } from "@/app/components/SubmitButton";
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

function buildActionMessage(params: Record<string, string | string[] | undefined>) {
  if (getParam(params, "action") !== "publish") {
    return null;
  }

  return `Pinterest publish run finished. Selected ${getParam(params, "selected") ?? 0}, published ${getParam(params, "published") ?? 0}, failed ${getParam(params, "failed") ?? 0}, retried ${getParam(params, "retried") ?? 0}, dry run ${getParam(params, "dryRun") ?? "false"}.`;
}

function buildPageHref(input: { page: number; status?: PinQueueStatus; search: string }) {
  const params = new URLSearchParams();

  if (input.status) {
    params.set("status", input.status);
  }

  if (input.search) {
    params.set("search", input.search);
  }

  params.set("page", String(input.page));
  return `/pinterest/queue?${params.toString()}`;
}

export default async function QueuePage({ searchParams }: PageProps) {
  await requireAdminSession();
  const params = (await searchParams) ?? {};
  const rawStatus = getParam(params, "status");
  const status = statuses.includes(rawStatus as PinQueueStatus)
    ? (rawStatus as PinQueueStatus)
    : undefined;
  const search = getParam(params, "search") ?? "";
  const page = Math.max(Number(getParam(params, "page") ?? "1"), 1);
  const pageSize = 25;
  const result = await createPinQueueRepository().list({
    page,
    pageSize,
    status,
    search: search.trim() || undefined
  });
  const totalPages = Math.max(Math.ceil(result.total / pageSize), 1);
  const actionMessage = buildActionMessage(params);

  return (
    <main className="page">
      <div className="page-heading">
        <div>
          <h1>Pinterest Queue</h1>
          <p>{result.total} queue items.</p>
        </div>
        <div className="actions">
          <form action={publishNowAction}>
            <SubmitButton pendingText="Publishing pins...">Publish Pins Now</SubmitButton>
          </form>
          <form action={retryAllFailedAction}>
            <SubmitButton className="ghost-button" pendingText="Retrying...">Retry Failed</SubmitButton>
          </form>
        </div>
      </div>

      {actionMessage ? <section className="status-banner">{actionMessage}</section> : null}

      <div className="toolbar">
        <form>
          <input name="search" placeholder="Search listing title" defaultValue={search} />
          <select name="status" defaultValue={status ?? ""}>
            <option value="">All statuses</option>
            {statuses.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
          <button type="submit">Search</button>
        </form>
      </div>

      <div className="table-shell">
        <table className="table table-hover align-middle mb-0">
          <thead>
            <tr>
              <th>Listing</th>
              <th>Status</th>
              <th>Attempts</th>
              <th>Scheduled At</th>
              <th>Last Error</th>
              <th>Created</th>
              <th className="actions-column">Actions</th>
            </tr>
          </thead>
          <tbody>
            {result.rows.map((item) => (
              <tr key={item.id}>
                <td>
                  <div className="listing-cell">
                    {item.image_url ? (
                      <span className="thumb-wrap">
                        <img className="thumb" src={item.image_url} alt="" />
                        <img className="thumb-preview" src={item.image_url} alt="" />
                      </span>
                    ) : (
                      <div className="thumb" />
                    )}
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
                  <div className="d-flex justify-content-end align-items-center gap-2">
                    {item.status === "failed" ? (
                      <form action={retryQueueItemAction} title="Retry">
                        <input type="hidden" name="id" value={item.id} />
                        <SubmitButton className="btn btn-warning btn-sm d-inline-flex align-items-center justify-content-center p-2" pendingText="...">
                          <span aria-hidden="true">R</span>
                          <span className="sr-only">Retry</span>
                        </SubmitButton>
                      </form>
                    ) : null}
                    {item.status === "pending" || item.status === "failed" ? (
                      <form action={cancelQueueItemAction} title="Cancel">
                        <input type="hidden" name="id" value={item.id} />
                        <SubmitButton className="btn btn-outline-secondary btn-sm d-inline-flex align-items-center justify-content-center p-2" pendingText="...">
                          <span aria-hidden="true">C</span>
                          <span className="sr-only">Cancel</span>
                        </SubmitButton>
                      </form>
                    ) : null}
                    <ConfirmDeleteButton
                      id={item.id}
                      title={item.title}
                      action={deleteQueueItemAction}
                    />
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
        getHref={(targetPage) => buildPageHref({ page: targetPage, status, search })}
      />
    </main>
  );
}
