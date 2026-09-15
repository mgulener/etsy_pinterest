import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { requireAdminSession } from "@/lib/auth/session";
import { createFacebookRepository, getFacebookSettings } from "@/lib/repositories/facebookRepository";
import type { FacebookQueueStatus } from "@/lib/facebook/types";
import { facebookPermalink } from "@/lib/facebook/content";
import { Pagination } from "@/app/components/Pagination";
import { FacebookActionButton, FacebookItemActions } from "./QueueControls";

export type FacebookPageProps = { searchParams?: Promise<Record<string, string | string[] | undefined>> };
const statuses: FacebookQueueStatus[] = ["pending", "processing", "published", "failed", "needs_review", "cancelled"];
function date(value: string) {
  return new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Istanbul" }).format(new Date(value));
}

export async function FacebookQueuePage({ searchParams, publishedOnly = false }: FacebookPageProps & { publishedOnly?: boolean }) {
  const session = await requireAdminSession();
  const { available, settings } = await getFacebookSettings(session.userId);
  const params = await searchParams ?? {};
  const param = (key: string) => Array.isArray(params[key]) ? params[key][0] : params[key] ?? "";
  const page = Math.max(1, Math.min(10000, Math.floor(Number(param("page")) || 1)));
  const search = param("search").slice(0, 200);
  const status: FacebookQueueStatus | undefined = publishedOnly ? "published" : statuses.find(item => item === param("status"));
  const result = settings ? await createFacebookRepository(session.userId, settings.page_id).list({ page, pageSize: 25, search, status }) : { rows: [], total: 0 };
  const base = publishedOnly ? "/facebook/posts" : "/facebook/queue";
  return <main className="page">
    <div className="page-heading">
      <div><h1>Facebook {publishedOnly ? "Published Posts" : "Queue"}</h1>
        <p>{settings?.page_name ?? "Not connected"} · {result.total} {publishedOnly ? "published posts" : "queue items"}</p></div>
      {!publishedOnly && settings ? <div className="d-flex gap-2 flex-wrap align-items-start">
        <FacebookActionButton command="build" disabled={!settings.enabled} />
        <FacebookActionButton command="publish" disabled={!settings.enabled} />
      </div> : null}
    </div>
    {!available ? <div className="alert alert-warning">Apply database migration 0023 to enable Facebook storage.</div> : null}
    {!settings?.enabled ? <div className="alert alert-info">Facebook publishing is disabled. <Link href="/settings#facebook">Facebook settings</Link></div> : null}
    {settings ? <div className="d-flex gap-3 mb-3 flex-wrap small text-secondary">
      <span>Minimum interval: {settings.interval_minutes} minutes</span>
      <span>Scheduled publishing: {settings.automatic_enabled && settings.enabled ? "Allowed" : "Off"}</span>
      <span>Timezone: UTC+3 / Istanbul</span>
    </div> : null}
    <form className="d-flex gap-2 flex-wrap mb-3" action={base}>
      <input className="form-control w-auto flex-grow-1" name="search" aria-label="Search listing title" placeholder="Search listing title" defaultValue={search} />
      {!publishedOnly ? <select className="form-select w-auto" name="status" aria-label="Status" defaultValue={status ?? ""}>
        <option value="">All statuses</option>{statuses.map(value => <option key={value}>{value}</option>)}
      </select> : null}
      <button className="btn btn-primary" type="submit">Search</button>
      {search || (!publishedOnly && status) ? <Link className="btn btn-outline-secondary" href={base}>Clear</Link> : null}
    </form>
    <div className="table-shell"><table className="table table-hover align-middle mb-0">
      <thead><tr><th>Listing</th><th>Message</th><th>Status</th><th>{publishedOnly ? "Published at" : "Scheduled at"} (UTC+3)</th><th>Last error</th><th className="actions-column">Actions</th></tr></thead>
      <tbody>{result.rows.map(item => <tr key={item.id}>
        <td><div className="listing-cell">
          <span className="thumb-wrap"><img src={item.image_url} alt="" className="thumb" width={85} height={85} /><img src={item.image_url} alt="" className="thumb-preview" width={200} height={200} /></span>
          <div><a href={item.destination_url} target="_blank" rel="noreferrer">{item.title}</a><div className="small text-secondary">{item.etsy_listing_id}</div></div>
        </div></td>
        <td className="caption-cell"><p className="caption-snippet mb-0">{item.message}</p></td>
        <td><span className={`badge ${item.status === "published" ? "text-bg-success" : ["failed", "needs_review"].includes(item.status) ? "text-bg-danger" : "text-bg-secondary"}`}>{item.status}</span></td>
        <td>{date(publishedOnly && item.published_at ? item.published_at : item.scheduled_at)}{item.schedule_locked ? <div className="small text-secondary">Manual</div> : null}</td>
        <td className="small text-break">{item.last_error ?? (item.status === "processing" ? "Publication started; do not resend while its outcome is unconfirmed." : "-")}</td>
        <td>{item.facebook_post_id && facebookPermalink(item.facebook_post_id)
          ? <a className="btn btn-outline-primary btn-sm" href={facebookPermalink(item.facebook_post_id)!} target="_blank" rel="noreferrer" title="View Facebook post" aria-label="View Facebook post"><ExternalLink size={16} /></a>
          : <FacebookItemActions key={item.updated_at} item={item} />}</td>
      </tr>)}
      {!result.rows.length ? <tr><td colSpan={6} className="text-center text-secondary py-5">No {publishedOnly ? "published posts" : "queue items"} found.</td></tr> : null}</tbody>
    </table></div>
    <Pagination currentPage={page} totalPages={Math.max(1, Math.ceil(result.total / 25))} getHref={target => `${base}?${new URLSearchParams({ page: String(target), search, ...(!publishedOnly && status ? { status } : {}) })}`} />
  </main>;
}
