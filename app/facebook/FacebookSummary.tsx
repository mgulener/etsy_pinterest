import Link from "next/link";
import { createFacebookRepository, getFacebookSettings } from "@/lib/repositories/facebookRepository";

async function readSummary(userId: string) {
  try {
    const { settings } = await getFacebookSettings(userId);
    const repository = settings ? createFacebookRepository(userId, settings.page_id) : null;
    const counts = [];
    for (const status of ["pending", "published", "failed", "needs_review"] as const) {
      counts.push(repository ? (await repository.list({ page: 1, pageSize: 1, status })).total : 0);
    }
    return { settings, counts };
  } catch {
    return null;
  }
}

export async function FacebookSummary({ userId }: { userId: string }) {
  const data = await readSummary(userId);
  if (!data) return <article className="channel-card h-100"><h2>Facebook</h2><p>Temporarily unavailable</p><Link href="/facebook/queue">Open queue</Link></article>;
  const { settings, counts } = data;
  return <article className="channel-card h-100">
      <div className="channel-card-header"><span className="channel-logo bg-primary text-white" aria-hidden="true">f</span>
        <div><span className="channel-label">Facebook</span><h2>Post Queue</h2></div></div>
      <div className="metric-list">
        <div className="metric-row warning"><span>Pending</span><strong>{counts[0]}</strong></div>
        <div className="metric-row success"><span>Published</span><strong>{counts[1]}</strong></div>
        <div className="metric-row danger"><span>Failed / Review</span><strong>{counts[2] + counts[3]}</strong></div>
      </div>
      <Link className="channel-link" href={settings ? "/facebook/queue" : "/settings#facebook"}>{settings?.enabled ? "Open queue" : "Facebook disabled"}</Link>
    </article>;
}
