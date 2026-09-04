import { ConfirmDeleteButton } from "@/app/components/ConfirmDeleteButton";
import { Pagination } from "@/app/components/Pagination";
import { ScheduleButton } from "@/app/components/ScheduleButton";
import { SyncJobProgress } from "@/app/components/SyncJobProgress";
import { CaptionModalEditor } from "./CaptionModalEditor";
import {
  cancelInstagramQueueItemAction,
  deleteInstagramQueueItemAction,
  generateInstagramCaptionsAction,
  publishInstagramNowAction,
  rebuildInstagramScheduleAction,
  retryAllFailedInstagramAction,
  retryInstagramQueueItemAction,
  updateInstagramScheduleAction
} from "@/app/actions/admin";
import { SubmitButton } from "@/app/components/SubmitButton";
import { requireAdminSession } from "@/lib/auth/session";
import { createInstagramQueueRepository } from "@/lib/repositories/instagramQueueRepository";
import { createSyncJobsRepository } from "@/lib/repositories/syncJobsRepository";
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
    ? new Intl.DateTimeFormat("tr-TR", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "Europe/Istanbul"
    }).format(new Date(value))
    : "-";
}

function buildActionMessage(params: Record<string, string | string[] | undefined>) {
  const action = getParam(params, "action");

  if (action === "publish-instagram-started") {
    return {
      tone: "info" as const,
      text: "Instagram publish started. You can leave or refresh this page; progress will keep updating here."
    };
  }

  if (action === "publish-instagram") {
    const isError = getParam(params, "status") === "error";
    return {
      tone: isError ? "danger" as const : "success" as const,
      text: isError
        ? `Instagram publish failed: ${getParam(params, "message") ?? "Unknown error"}`
        : `Instagram publish run finished. Selected ${getParam(params, "selected") ?? 0}, published ${getParam(params, "published") ?? 0}, failed ${getParam(params, "failed") ?? 0}, retried ${getParam(params, "retried") ?? 0}, dry run ${getParam(params, "dryRun") ?? "false"}.`
    };
  }

  if (action === "ai-caption") {
    const isError = getParam(params, "status") === "error";
    return {
      tone: isError ? "danger" as const : "success" as const,
      text: isError
        ? `AI caption failed: ${getParam(params, "message") ?? "Unknown error"}`
        : "AI caption generated. Review it before publishing."
    };
  }

  if (action === "ai-caption-job-started") {
    return {
      tone: "info" as const,
      text: "AI caption generation started. You can leave or refresh this page; progress will keep updating here."
    };
  }

  if (action === "rebuild-schedule") {
    return {
      tone: "success" as const,
      text: `Instagram schedule rebuilt. Updated ${getParam(params, "updated") ?? 0} unlocked pending items.`
    };
  }

  return null;
}

function getMediaCount(value: unknown) {
  return Array.isArray(value) ? value.length : 0;
}

function CancelIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  );
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
  return `/instagram/queue?${params.toString()}`;
}

export default async function InstagramQueuePage({ searchParams }: PageProps) {
  const session = await requireAdminSession();
  const params = (await searchParams) ?? {};
  const rawStatus = getParam(params, "status");
  const status = statuses.includes(rawStatus as PinQueueStatus)
    ? (rawStatus as PinQueueStatus)
    : undefined;
  const search = getParam(params, "search") ?? "";
  const page = Math.max(Number(getParam(params, "page") ?? "1"), 1);
  const pageSize = 25;
  const instagramQueueRepository = createInstagramQueueRepository();
  const syncJobsRepository = createSyncJobsRepository();
  const [result, latestAiCaptionJob, latestInstagramPublishJob] = await Promise.all([
    instagramQueueRepository.list({
      page,
      pageSize,
      status,
      search: search.trim() || undefined
    }),
    syncJobsRepository.getLatestForUser(session.userId, "instagram_ai_captions"),
    syncJobsRepository.getLatestForUser(session.userId, "instagram_publish")
  ]);
  const totalPages = Math.max(Math.ceil(result.total / pageSize), 1);
  const actionMessage = buildActionMessage(params);

  return (
    <main className="page">
      <div className="page-heading">
        <div>
          <h1>Instagram Queue</h1>
          <p>{result.total} queue items.</p>
        </div>
        <div className="actions">
          <form action={generateInstagramCaptionsAction}>
            <SubmitButton className="btn ai-button" pendingText="Starting AI captions...">
              Generate AI Captions
            </SubmitButton>
          </form>
          {/* <form action={generateInstagramCaptionsAction}>
            <input type="hidden" name="limit" value="25" />
            <SubmitButton className="btn ai-button ai-button-subtle" pendingText="Starting test...">
              Test AI 25
            </SubmitButton>
          </form> */}
          <form action={publishInstagramNowAction}>
            <SubmitButton pendingText="Publishing Instagram...">
              Publish Instagram Now
            </SubmitButton>
          </form>
          <form action={rebuildInstagramScheduleAction}>
            <SubmitButton className="btn btn-outline-primary" pendingText="Rebuilding...">
              Rebuild Schedule
            </SubmitButton>
          </form>
          <form action={retryAllFailedInstagramAction}>
            <SubmitButton className="ghost-button" pendingText="Retrying...">Retry Failed</SubmitButton>
          </form>
        </div>
      </div>

      {actionMessage ? <section className={`alert alert-${actionMessage.tone}`} role="alert">{actionMessage.text}</section> : null}

      <SyncJobProgress
        initialJob={latestInstagramPublishJob}
        title="Instagram Publish"
        latestPath="/api/jobs/instagram-publish/latest"
        runPath="/api/jobs/instagram-publish/run"
        storageKey="dismissedInstagramPublishJobId"
      />

      <SyncJobProgress
        initialJob={latestAiCaptionJob}
        title="Instagram AI Captions"
        latestPath="/api/jobs/instagram-ai-captions/latest"
        runPath="/api/jobs/instagram-ai-captions/run"
        storageKey="dismissedInstagramAiCaptionJobId"
      />

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
          {search || status ? (
            <a className="btn btn-outline-secondary" href="/instagram/queue">Clear</a>
          ) : null}
        </form>
      </div>

      <div className="table-shell">
        <table className="table table-hover align-middle mb-0">
          <thead>
            <tr>
              <th>Listing</th>
              <th>Status</th>
              <th>Attempts</th>
              <th>Mode</th>
              <th>Media</th>
              <th>Scheduled At</th>
              <th>Caption</th>
              <th>Last Error</th>
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
                <td>{item.post_mode}</td>
                <td>{getMediaCount(item.media_urls)}</td>
                <td>
                  <div>{formatDate(item.scheduled_at)}</div>
                  {item.schedule_locked ? <span className="badge text-bg-secondary">Manual</span> : null}
                </td>
                <td className="caption-cell">
                  <div className="d-flex align-items-center gap-2 mb-1">
                    <span className={`badge ${item.caption_source === "ai" ? "text-bg-info" : item.caption_source === "manual" ? "text-bg-secondary" : "text-bg-light text-dark"}`}>
                      {item.caption_source}
                    </span>
                  </div>
                  <div className="muted caption-snippet">{item.caption}</div>
                </td>
                <td className="muted">{item.last_error ?? "-"}</td>
                <td>
                  <div className="d-flex justify-content-end align-items-center gap-2">
                    {item.status === "pending" || item.status === "failed" || item.status === "cancelled" ? (
                      <CaptionModalEditor
                        id={item.id}
                        caption={item.caption}
                        postMode={item.post_mode}
                        mediaUrls={item.media_urls}
                        availableMediaUrls={item.available_media_urls}
                      />
                    ) : null}
                    {item.status === "pending" || item.status === "failed" || item.status === "cancelled" ? (
                      <ScheduleButton
                        id={item.id}
                        title={item.title}
                        scheduledAt={item.scheduled_at}
                        action={updateInstagramScheduleAction}
                      />
                    ) : null}
                    {item.status === "failed" ? (
                      <form action={retryInstagramQueueItemAction} title="Retry">
                        <input type="hidden" name="id" value={item.id} />
                        <SubmitButton className="btn btn-warning btn-sm d-inline-flex align-items-center justify-content-center p-2" pendingText="...">
                          <span aria-hidden="true">R</span>
                          <span className="sr-only">Retry</span>
                        </SubmitButton>
                      </form>
                    ) : null}
                    {item.status === "pending" || item.status === "failed" ? (
                      <form action={cancelInstagramQueueItemAction} title="Cancel">
                        <input type="hidden" name="id" value={item.id} />
                        <SubmitButton className="btn btn-warning btn-sm d-inline-flex align-items-center justify-content-center p-2" pendingText="...">
                          <CancelIcon />
                          <span className="sr-only">Cancel</span>
                        </SubmitButton>
                      </form>
                    ) : null}
                    <ConfirmDeleteButton
                      id={item.id}
                      title={item.title}
                      action={deleteInstagramQueueItemAction}
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
