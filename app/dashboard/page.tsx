import {
  bootstrapAction,
  publishNowAction,
  syncNowAction
} from "@/app/actions/admin";
import { SubmitButton } from "@/app/components/SubmitButton";
import { requireAdminSession } from "@/lib/auth/session";
import { createAppSettingsRepository } from "@/lib/repositories/appSettingsRepository";
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
    return `Etsy sync finished. Fetched ${getParam(params, "fetched") ?? 0}, known ${getParam(params, "known") ?? 0}, queued ${getParam(params, "queued") ?? 0}, errors ${getParam(params, "errors") ?? 0}.`;
  }

  if (action === "publish") {
    return `Publish run finished. Selected ${getParam(params, "selected") ?? 0}, published ${getParam(params, "published") ?? 0}, failed ${getParam(params, "failed") ?? 0}, retried ${getParam(params, "retried") ?? 0}, dry run ${getParam(params, "dryRun") ?? "false"}.`;
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
  const listingsRepository = createListingsRepository();
  const queueRepository = createPinQueueRepository();
  const postsRepository = createPinterestPostsRepository();

  const [
    initialSyncCompleted,
    listingsCount,
    pendingCount,
    publishedCount,
    failedCount
  ] = await Promise.all([
    settingsRepository.isInitialSyncCompleted(),
    listingsRepository.count(),
    queueRepository.countByStatus("pending"),
    postsRepository.count(),
    queueRepository.countByStatus("failed")
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
          <form action={publishNowAction}>
            <SubmitButton pendingText="Publishing...">Publish Queue Now</SubmitButton>
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
      </section>
    </main>
  );
}
