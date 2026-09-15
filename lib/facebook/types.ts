export type FacebookSettings = {
  user_id: string;
  page_id: string;
  page_name: string;
  page_access_token: string;
  api_version: string;
  enabled: boolean;
  automatic_enabled: boolean;
  interval_minutes: number;
  verified_at: string;
  updated_at: string;
};

export type FacebookQueueStatus = "pending" | "processing" | "published" | "failed" | "needs_review" | "cancelled";

export type FacebookQueueRow = {
  id: string;
  user_id: string;
  page_id: string;
  etsy_listing_id: number;
  title: string;
  image_url: string;
  destination_url: string;
  message: string;
  status: FacebookQueueStatus;
  scheduled_at: string;
  schedule_locked: boolean;
  attempt_count: number;
  last_error: string | null;
  request_started_at: string | null;
  facebook_post_id: string | null;
  published_at: string | null;
  created_at: string;
  updated_at: string;
};

export class FacebookError extends Error {
  constructor(message: string, public readonly ambiguous = false, public readonly pause = false) {
    super(message);
  }
}

export type FacebookActionState = { ok: boolean; message: string };

export class FacebookTokenError extends FacebookError {
  constructor(expired: boolean) {
    super(expired
      ? "Facebook Page access token has expired. Reconnect with a long-lived Page access token in Settings."
      : "Facebook Page access token is invalid or revoked. Reconnect the Page in Settings.", false, true);
  }
}
