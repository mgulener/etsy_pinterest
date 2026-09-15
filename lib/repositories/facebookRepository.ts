import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { paginateQueue } from "@/lib/queue/pagination";
import { buildScheduledAt, getNextScheduleStart, sortQueueRowsForPublishing } from "@/lib/queue/scheduling";
import { buildFacebookMessage, validateFacebookMedia, validateFacebookMessage } from "@/lib/facebook/content";
import type { FacebookQueueRow, FacebookQueueStatus, FacebookSettings } from "@/lib/facebook/types";
import type { NormalizedEtsyListing } from "@/lib/etsy/types";

function check(error: { message: string } | null) {
  if (error) throw new Error("Facebook database operation failed. Check migration 0023 and database availability.");
}

export async function getFacebookSettings(userId: string): Promise<{ available: boolean; settings: FacebookSettings | null }> {
  const { data, error } = await getSupabaseAdmin().from("facebook_settings").select("*").eq("user_id", userId).maybeSingle();
  if (error && ["42P01", "PGRST205"].includes(error.code)) return { available: false, settings: null };
  check(error);
  return { available: true, settings: data };
}

export function createFacebookRepository(userId: string, pageId: string) {
  if (!userId || !/^\d+$/.test(pageId)) throw new Error("Facebook owner and Page are required.");
  const db = getSupabaseAdmin();
  const scoped = () => db.from("facebook_queue").select("*").eq("user_id", userId).eq("page_id", pageId);
  async function update(id: string, values: Partial<Omit<FacebookQueueRow, "id" | "user_id" | "page_id" | "etsy_listing_id" | "created_at">>, statuses: FacebookQueueStatus[], version?: string) {
    let query = db.from("facebook_queue").update(values).eq("user_id", userId).eq("page_id", pageId).eq("id", id).in("status", statuses);
    if (version) query = query.eq("updated_at", version);
    const { data, error } = await query.select("*").maybeSingle();
    check(error);
    if (!data) throw new Error("This Facebook item changed or publishing has started. Refresh before trying again.");
    return data;
  }
  async function enqueueListings(items: Array<{ listing: NormalizedEtsyListing; scheduledAt?: string; description?: string | null }>) {
    let created = 0;
    for (let offset = 0; offset < items.length; offset += 100) {
      const values = items.slice(offset, offset + 100).map(({ listing, scheduledAt, description }) => {
        validateFacebookMedia(listing.imageUrl ?? "", listing.destinationUrl ?? "");
        return {
          user_id: userId, page_id: pageId, etsy_listing_id: listing.etsyListingId,
          title: listing.title, image_url: listing.imageUrl!, destination_url: listing.destinationUrl!,
          message: buildFacebookMessage(listing.title, description),
          scheduled_at: scheduledAt ?? getNextScheduleStart().toISOString()
        };
      });
      const { data, error } = await db.from("facebook_queue").upsert(values,
        { onConflict: "user_id,page_id,etsy_listing_id", ignoreDuplicates: true }).select("id");
      check(error); created += data?.length ?? 0;
    }
    return created;
  }
  return {
    enqueueListings,
    async find(id: string) {
      const { data, error } = await scoped().eq("id", id).maybeSingle();
      check(error); return data;
    },
    async list(params: { page: number; pageSize: number; status?: FacebookQueueStatus; search?: string }) {
      return paginateQueue<FacebookQueueRow>({ ...params, filtered: Boolean(params.status),
        async read(partition, from, limit) {
          let query = db.from("facebook_queue").select("*", { count: "exact", head: limit === 0 })
            .eq("user_id", userId).eq("page_id", pageId)
            .order("scheduled_at").order("created_at").order("id");
          if (params.status) query = query.eq("status", params.status);
          if (partition === "unpublished") query = query.neq("status", "published");
          if (partition === "published") query = query.eq("status", "published");
          if (params.search) query = query.ilike("title", `%${params.search.replace(/[\\%_]/g, "\\$&")}%`);
          if (limit > 0) query = query.range(from, from + limit - 1);
          const { data, count, error } = await query;
          check(error); return { rows: data ?? [], total: count ?? 0 };
        }
      });
    },
    async enqueueListing(listing: NormalizedEtsyListing, options?: { scheduledAt?: string; description?: string | null }) {
      return await enqueueListings([{ listing, ...options }]) ? "created" as const : "duplicate" as const;
    },
    async rebuildPendingSchedule(intervalMinutes: number) {
      const rows: FacebookQueueRow[] = [];
      for (let from = 0; ; from += 500) {
        const { data, error } = await scoped().eq("status", "pending").eq("schedule_locked", false).order("id").range(from, from + 499);
        check(error); rows.push(...(data ?? []));
        if ((data?.length ?? 0) < 500) break;
      }
      const { data: locked, error } = await scoped().eq("status", "pending").eq("schedule_locked", true);
      check(error);
      const occupied = new Set((locked ?? []).map(row => new Date(row.scheduled_at).getTime()));
      const start = getNextScheduleStart(intervalMinutes);
      let slot = 0;
      const updates = [];
      for (const row of sortQueueRowsForPublishing(rows.map(row => ({ ...row, description: row.message })))) {
        let scheduledAt = buildScheduledAt(slot++, intervalMinutes, start);
        while ([...occupied].some(time => Math.abs(time - Date.parse(scheduledAt)) < intervalMinutes * 60_000)) {
          scheduledAt = buildScheduledAt(slot++, intervalMinutes, start);
        }
        updates.push({ id: row.id, scheduled_at: scheduledAt, updated_at: row.updated_at });
      }
      const { data: count, error: updateError } = await db.rpc("schedule_facebook_posts", { p_user_id: userId, p_page_id: pageId, p_updates: updates });
      check(updateError);
      return count ?? 0;
    },
    async claim(automatic: boolean) {
      const { data, error } = await db.rpc("claim_facebook_post", { p_user_id: userId, p_page_id: pageId, p_automatic: automatic });
      check(error); return data?.[0] ?? null;
    },
    async preview() {
      const { data, error } = await scoped().eq("status", "pending").lte("scheduled_at", new Date().toISOString()).order("scheduled_at").order("id").limit(1).maybeSingle();
      check(error); return data;
    },
    saveDraft(id: string, message: string, scheduledAt: string, version: string) {
      if (!Number.isFinite(Date.parse(scheduledAt))) throw new Error("Enter a valid publication date.");
      return update(id, { message: validateFacebookMessage(message), scheduled_at: scheduledAt, schedule_locked: true }, ["pending", "failed"], version);
    },
    cancel(id: string, version: string) { return update(id, { status: "cancelled" }, ["pending", "failed"], version); },
    retry(id: string, version: string) { return update(id, { status: "pending", last_error: null, scheduled_at: getNextScheduleStart().toISOString() }, ["failed"], version); },
    recordPublished(id: string, postId: string) {
      return update(id, { status: "published", facebook_post_id: postId, published_at: new Date().toISOString(), last_error: null }, ["processing"]);
    },
    recordFailure(id: string, message: string, ambiguous: boolean) {
      return update(id, { status: ambiguous ? "needs_review" : "failed", last_error: message }, ["processing"]);
    },
    async pause() {
      const { error } = await db.from("facebook_settings").update({ enabled: false, automatic_enabled: false }).eq("user_id", userId).eq("page_id", pageId);
      check(error);
    }
  };
}
