import {
  bootstrapAction,
  syncNowAction
} from "@/app/actions/admin";
import { SubmitButton } from "@/app/components/SubmitButton";
import { SyncJobProgress } from "@/app/components/SyncJobProgress";
import { requireAdminSession } from "@/lib/auth/session";
import { createAppSettingsRepository } from "@/lib/repositories/appSettingsRepository";
import { createInstagramPostsRepository } from "@/lib/repositories/instagramPostsRepository";
import { createInstagramQueueRepository } from "@/lib/repositories/instagramQueueRepository";
import { createListingsRepository } from "@/lib/repositories/listingsRepository";
import { createPinQueueRepository } from "@/lib/repositories/pinQueueRepository";
import { createPinterestPostsRepository } from "@/lib/repositories/pinterestPostsRepository";
import { createSyncJobsRepository } from "@/lib/repositories/syncJobsRepository";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

type PageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function getParam(params: Record<string, string | string[] | undefined>, key: string) {
  const value = params[key];
  return Array.isArray(value) ? value[0] : value;
}

function buildActionMessage(params: Record<string, string | string[] | undefined>) {
  const action = getParam(params, "action");

  if (action === "bootstrap") {
    return `Bootstrap finished. Fetched ${getParam(params, "fetched") ?? 0}, saved ${getParam(params, "saved") ?? 0}, errors ${getParam(params, "errors") ?? 0}.`;
  }

  if (action === "sync-started") {
    return "Etsy sync started. You can leave or refresh this page; progress will keep updating here.";
  }

  if (action === "sync-error") {
    return getParam(params, "message") ?? "Etsy sync failed.";
  }

  if (getParam(params, "etsy") === "connected") {
    return "Etsy connected successfully.";
  }

  return null;
}

function MetricRow({ label, value, tone }: { label: string; value: number; tone?: "success" | "warning" | "danger" }) {
  return (
    <div className={`metric-row ${tone ?? ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

export default async function DashboardPage({ searchParams }: PageProps) {
  const session = await requireAdminSession();
  const params = (await searchParams) ?? {};
  const actionMessage = buildActionMessage(params);

  const settingsRepository = createAppSettingsRepository();
  const instagramQueueRepository = createInstagramQueueRepository();
  const instagramPostsRepository = createInstagramPostsRepository();
  const listingsRepository = createListingsRepository();
  const queueRepository = createPinQueueRepository();
  const postsRepository = createPinterestPostsRepository();
  const syncJobsRepository = createSyncJobsRepository();

  const [
    initialSyncCompleted,
    listingsCount,
    pendingCount,
    publishedCount,
    failedCount,
    instagramPendingCount,
    instagramPublishedCount,
    instagramFailedCount,
    latestSyncJob,
    dismissedProgressJobIds
  ] = await Promise.all([
    settingsRepository.isInitialSyncCompleted(),
    listingsRepository.count(),
    queueRepository.countByStatus("pending"),
    postsRepository.count(),
    queueRepository.countByStatus("failed"),
    instagramQueueRepository.countByStatus("pending"),
    instagramPostsRepository.count(),
    instagramQueueRepository.countByStatus("failed"),
    syncJobsRepository.getLatestForUser(session.userId, "etsy_sync"),
    settingsRepository.getDismissedProgressJobIds(session.userId)
  ]);

  return (
    <main className="page">
      <div className="page-heading dashboard-hero">
        <div>
          <p className="eyebrow">Automation Control</p>
          <h1>Pinterest Automation</h1>
          <p>Etsy catalog sync, Pinterest queue, and Instagram publishing in one place.</p>
        </div>
        <div className="actions">
          <a className="button ghost-button" href="/settings">
            Settings
          </a>
          <form action={syncNowAction}>
            <SubmitButton pendingText="Syncing Etsy...">Sync Etsy Now</SubmitButton>
          </form>
          <form action={syncNowAction}>
            <input type="hidden" name="limit" value="100" />
            <SubmitButton className="ghost-button" pendingText="Starting test sync...">
              Test Sync 100
            </SubmitButton>
          </form>
        </div>
      </div>

      {actionMessage ? (
        <section
          className={`alert ${getParam(params, "action") === "sync-error" ? "alert-danger" : "alert-success"}`}
          role="alert"
        >
          {actionMessage}
        </section>
      ) : null}

      <SyncJobProgress initialJob={latestSyncJob} initialDismissedJobIds={dismissedProgressJobIds} />

      {!initialSyncCompleted ? (
        <section className="notice">
          <div>
            <h2>Initial Etsy Sync Required</h2>
            <p>Bootstrap saves current Etsy listings as known without creating queue items.</p>
          </div>
          <form action={bootstrapAction}>
            <SubmitButton pendingText="Bootstrapping...">
              Bootstrap Existing Listings
            </SubmitButton>
          </form>
        </section>
      ) : null}

      <section className="dashboard-channel-grid" aria-label="Automation summary">
        <article className="channel-card listings-card">
          <div className="channel-card-header">
            <span className="channel-logo etsy-logo" aria-hidden="true">E</span>
            <div>
              <span className="channel-label">All Listings</span>
              <h2>Etsy Catalog</h2>
            </div>
          </div>
          <div className="channel-primary-metric">
            <strong>{listingsCount}</strong>
            <span>Total listings</span>
          </div>
          <a className="channel-link" href="/etsy/listings">View listings</a>
        </article>

        <article className="channel-card pinterest-card">
          <div className="channel-card-header">
            <span className="channel-logo pinterest-logo" aria-hidden="true">P</span>
            <div>
              <span className="channel-label">Pinterest</span>
              <h2>Pin Queue</h2>
            </div>
          </div>
          <div className="metric-list">
            <MetricRow label="Pending" value={pendingCount} tone="warning" />
            <MetricRow label="Published" value={publishedCount} tone="success" />
            <MetricRow label="Failed" value={failedCount} tone="danger" />
          </div>
          <a className="channel-link" href="/pinterest/queue">Open queue</a>
        </article>

        <article className="channel-card instagram-card">
          <div className="channel-card-header">
            <span className="channel-logo instagram-logo" aria-hidden="true">IG</span>
            <div>
              <span className="channel-label">Instagram</span>
              <h2>Post Queue</h2>
            </div>
          </div>
          <div className="metric-list">
            <MetricRow label="Pending" value={instagramPendingCount} tone="warning" />
            <MetricRow label="Published" value={instagramPublishedCount} tone="success" />
            <MetricRow label="Failed" value={instagramFailedCount} tone="danger" />
          </div>
          <a className="channel-link" href="/instagram/queue">Open queue</a>
        </article>
      </section>
    </main>
  );
}
