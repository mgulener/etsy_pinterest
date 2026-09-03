import {
  bootstrapAction,
  syncNowAction
} from "@/app/actions/admin";
import { SubmitButton } from "@/app/components/SubmitButton";
import { requireAdminSession } from "@/lib/auth/session";
import { createAppSettingsRepository } from "@/lib/repositories/appSettingsRepository";
import { createInstagramPostsRepository } from "@/lib/repositories/instagramPostsRepository";
import { createInstagramQueueRepository } from "@/lib/repositories/instagramQueueRepository";
import { createListingsRepository } from "@/lib/repositories/listingsRepository";
import { createPinQueueRepository } from "@/lib/repositories/pinQueueRepository";
import { createPinterestPostsRepository } from "@/lib/repositories/pinterestPostsRepository";

export const dynamic = "force-dynamic";

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

  if (action === "sync") {
    return `Etsy sync finished. Fetched ${getParam(params, "fetched") ?? 0}, known ${getParam(params, "known") ?? 0}, Pinterest queued ${getParam(params, "queued") ?? 0}, Instagram queued ${getParam(params, "instagramQueued") ?? 0}, errors ${getParam(params, "errors") ?? 0}.`;
  }

  if (getParam(params, "etsy") === "connected") {
    return "Etsy connected successfully.";
  }

  return null;
}

export default async function DashboardPage({ searchParams }: PageProps) {
  await requireAdminSession();
  const params = (await searchParams) ?? {};
  const actionMessage = buildActionMessage(params);

  const settingsRepository = createAppSettingsRepository();
  const instagramQueueRepository = createInstagramQueueRepository();
  const instagramPostsRepository = createInstagramPostsRepository();
  const listingsRepository = createListingsRepository();
  const queueRepository = createPinQueueRepository();
  const postsRepository = createPinterestPostsRepository();

  const [
    initialSyncCompleted,
    listingsCount,
    pendingCount,
    publishedCount,
    failedCount,
    instagramPendingCount,
    instagramPublishedCount,
    instagramFailedCount
  ] = await Promise.all([
    settingsRepository.isInitialSyncCompleted(),
    listingsRepository.count(),
    queueRepository.countByStatus("pending"),
    postsRepository.count(),
    queueRepository.countByStatus("failed"),
    instagramQueueRepository.countByStatus("pending"),
    instagramPostsRepository.count(),
    instagramQueueRepository.countByStatus("failed")
  ]);

  return (
    <main className="page">
      <div className="page-heading">
        <div>
          <h1>Pinterest Automation</h1>
          <p>Etsy catalog sync, queue health, and Pinterest publishing.</p>
        </div>
        <div className="actions">
          <a className="button ghost-button" href="/api/auth/etsy/start">
            Connect Etsy
          </a>
          <form action={syncNowAction}>
            <SubmitButton pendingText="Syncing Etsy...">Sync Etsy Now</SubmitButton>
          </form>
        </div>
      </div>

      {actionMessage ? <section className="status-banner">{actionMessage}</section> : null}

      {!initialSyncCompleted ? (
        <section className="notice">
          <div>
            <h2>Initial Etsy Sync Required</h2>
            <p>Bootstrap saves current Etsy listings as known without creating Pinterest queue items.</p>
          </div>
          <form action={bootstrapAction}>
            <SubmitButton pendingText="Bootstrapping...">
              Bootstrap Existing Listings
            </SubmitButton>
          </form>
        </section>
      ) : null}

      <section className="stats-grid">
        <div className="stat-card">
          <span>Known Etsy Listings</span>
          <strong>{listingsCount}</strong>
        </div>
        <div className="stat-card">
          <span>Pending Pins</span>
          <strong>{pendingCount}</strong>
        </div>
        <div className="stat-card">
          <span>Published Pins</span>
          <strong>{publishedCount}</strong>
        </div>
        <div className="stat-card">
          <span>Failed Pins</span>
          <strong>{failedCount}</strong>
        </div>
        <div className="stat-card">
          <span>Pending Instagram</span>
          <strong>{instagramPendingCount}</strong>
        </div>
        <div className="stat-card">
          <span>Published Instagram</span>
          <strong>{instagramPublishedCount}</strong>
        </div>
        <div className="stat-card">
          <span>Failed Instagram</span>
          <strong>{instagramFailedCount}</strong>
        </div>
      </section>
    </main>
  );
}
