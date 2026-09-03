import {
  bootstrapAction,
  publishNowAction,
  syncNowAction
} from "@/app/actions/admin";
import { requireAdminSession } from "@/lib/auth/session";
import { createAppSettingsRepository } from "@/lib/repositories/appSettingsRepository";
import { createListingsRepository } from "@/lib/repositories/listingsRepository";
import { createPinQueueRepository } from "@/lib/repositories/pinQueueRepository";
import { createPinterestPostsRepository } from "@/lib/repositories/pinterestPostsRepository";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  await requireAdminSession();

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
            <button type="submit">Sync Etsy Now</button>
          </form>
          <form action={publishNowAction}>
            <button type="submit">Publish Queue Now</button>
          </form>
        </div>
      </div>

      {!initialSyncCompleted ? (
        <section className="notice">
          <div>
            <h2>Initial Etsy Sync Required</h2>
            <p>Bootstrap saves current Etsy listings as known without creating Pinterest queue items.</p>
          </div>
          <form action={bootstrapAction}>
            <button type="submit">Bootstrap Existing Listings</button>
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
