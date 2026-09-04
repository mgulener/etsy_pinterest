export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type PinQueueStatus =
  | "pending"
  | "processing"
  | "published"
  | "failed"
  | "cancelled";

export type SyncJobStatus = "queued" | "running" | "succeeded" | "failed";
export type SyncJobType = "etsy_sync" | "instagram_ai_captions" | "instagram_publish";


export type SyncJobRow = {
  id: string;
  user_id: string | null;
  type: SyncJobType;
  status: SyncJobStatus;
  progress_current: number;
  progress_total: number;
  sync_limit: number | null;
  message: string;
  result: Json;
  error: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
};

export type AdminUserRow = {
  id: string;
  email: string;
  password_hash: string;
  password_salt: string;
  created_at: string;
  updated_at: string;
};

export type UserSettingsRow = {
  user_id: string;
  etsy_api_key: string | null;
  etsy_redirect_uri: string | null;
  etsy_shop_id: string | null;
  etsy_access_token: string | null;
  etsy_refresh_token: string | null;
  etsy_token_expires_at: number | null;
  etsy_token_scope: string | null;
  etsy_token_type: string | null;
  pinterest_enabled: boolean;
  pinterest_access_token: string | null;
  pinterest_board_id: string | null;
  instagram_enabled: boolean;
  instagram_access_token: string | null;
  instagram_account_id: string | null;
  instagram_user_id: string | null;
  instagram_post_mode: "single" | "carousel";
  meta_api_version: string | null;
  ai_captions_enabled: boolean;
  openai_api_key: string | null;
  openai_model: string | null;
  dry_run: boolean;
  max_pins_per_run: number;
  max_pin_retries: number;
  max_instagram_posts_per_run: number;
  max_instagram_retries: number;
  created_at: string;
  updated_at: string;
};

export type EtsyListingRow = {
  id: string;
  etsy_listing_id: number;
  etsy_image_id: number | null;
  image_url: string | null;
  image_urls: Json;
  title: string;
  description: string | null;
  url: string | null;
  state: string;
  original_creation_timestamp: number | null;
  first_seen_at: string;
  last_seen_at: string;
  created_at: string;
  updated_at: string;
};

export type PinQueueRow = {
  id: string;
  etsy_listing_id: number;
  etsy_image_id: number | null;
  image_url: string | null;
  title: string;
  description: string | null;
  destination_url: string | null;
  board_id: string;
  status: PinQueueStatus;
  attempt_count: number;
  last_error: string | null;
  scheduled_at: string;
  schedule_locked: boolean;
  created_at: string;
  updated_at: string;
  processed_at: string | null;
};

export type PinterestPostRow = {
  id: string;
  etsy_listing_id: number;
  etsy_image_id: number | null;
  pinterest_pin_id: string;
  pinterest_board_id: string;
  published_at: string;
  created_at: string;
};

export type InstagramQueueRow = {
  id: string;
  etsy_listing_id: number;
  etsy_image_id: number | null;
  image_url: string | null;
  title: string;
  description: string | null;
  destination_url: string | null;
  caption: string;
  post_mode: "single" | "carousel";
  media_urls: Json;
  available_media_urls: Json;
  caption_source: "rule" | "ai" | "manual";
  caption_generated_at: string | null;
  status: PinQueueStatus;
  attempt_count: number;
  last_error: string | null;
  scheduled_at: string;
  schedule_locked: boolean;
  processing_started_at: string | null;
  created_at: string;
  updated_at: string;
  processed_at: string | null;
};

export type InstagramPostRow = {
  id: string;
  etsy_listing_id: number;
  etsy_image_id: number | null;
  instagram_media_id: string;
  instagram_creation_id: string | null;
  media_type: string;
  caption: string | null;
  instagram_permalink: string | null;
  published_at: string;
  created_at: string;
};

export type Database = {
  public: {
    Tables: {
      sync_jobs: {
        Row: SyncJobRow;
        Insert: Omit<SyncJobRow, "id" | "status" | "progress_current" | "progress_total" | "sync_limit" | "message" | "result" | "error" | "started_at" | "completed_at" | "created_at" | "updated_at"> & {
          id?: string;
          status?: SyncJobStatus;
          progress_current?: number;
          progress_total?: number;
          sync_limit?: number | null;
          message?: string;
          result?: Json;
          error?: string | null;
          started_at?: string | null;
          completed_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Omit<SyncJobRow, "id" | "created_at">>;
        Relationships: [
          {
            foreignKeyName: "sync_jobs_user_id_fkey";
            columns: ["user_id"];
            referencedRelation: "admin_users";
            referencedColumns: ["id"];
          }
        ];
      };
      admin_users: {
        Row: AdminUserRow;
        Insert: Omit<AdminUserRow, "id" | "created_at" | "updated_at"> & {
          id?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Omit<AdminUserRow, "id" | "created_at">>;
        Relationships: [];
      };
      user_settings: {
        Row: UserSettingsRow;
        Insert: { user_id: string } & Partial<Omit<UserSettingsRow, "user_id" | "created_at" | "updated_at">> & {
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Omit<UserSettingsRow, "user_id" | "created_at">>;
        Relationships: [
          {
            foreignKeyName: "user_settings_user_id_fkey";
            columns: ["user_id"];
            referencedRelation: "admin_users";
            referencedColumns: ["id"];
          }
        ];
      };
      app_settings: {
        Row: {
          key: string;
          value: Json;
          updated_at: string;
        };
        Insert: {
          key: string;
          value: Json;
          updated_at?: string;
        };
        Update: {
          value?: Json;
          updated_at?: string;
        };
        Relationships: [];
      };
      etsy_listings: {
        Row: EtsyListingRow;
        Insert: Omit<EtsyListingRow, "id" | "first_seen_at" | "last_seen_at" | "created_at" | "updated_at"> & {
          first_seen_at?: string;
          last_seen_at?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Omit<EtsyListingRow, "id" | "created_at">>;
        Relationships: [];
      };
      pin_queue: {
        Row: PinQueueRow;
        Insert: Omit<PinQueueRow, "id" | "status" | "attempt_count" | "last_error" | "created_at" | "updated_at" | "processed_at"> & {
          id?: string;
          status?: PinQueueStatus;
          attempt_count?: number;
          last_error?: string | null;
          created_at?: string;
          updated_at?: string;
          processed_at?: string | null;
        };
        Update: Partial<Omit<PinQueueRow, "id" | "created_at">>;
        Relationships: [
          {
            foreignKeyName: "pin_queue_etsy_listing_id_fkey";
            columns: ["etsy_listing_id"];
            referencedRelation: "etsy_listings";
            referencedColumns: ["etsy_listing_id"];
          }
        ];
      };
      instagram_queue: {
        Row: InstagramQueueRow;
        Insert: Omit<InstagramQueueRow, "id" | "status" | "attempt_count" | "last_error" | "post_mode" | "media_urls" | "available_media_urls" | "caption_source" | "caption_generated_at" | "processing_started_at" | "created_at" | "updated_at" | "processed_at"> & {
          id?: string;
          status?: PinQueueStatus;
          attempt_count?: number;
          last_error?: string | null;
          post_mode?: "single" | "carousel";
          media_urls?: Json;
          available_media_urls?: Json;
          caption_source?: "rule" | "ai" | "manual";
          caption_generated_at?: string | null;
          processing_started_at?: string | null;
          created_at?: string;
          updated_at?: string;
          processed_at?: string | null;
        };
        Update: Partial<Omit<InstagramQueueRow, "id" | "created_at">>;
        Relationships: [
          {
            foreignKeyName: "instagram_queue_etsy_listing_id_fkey";
            columns: ["etsy_listing_id"];
            referencedRelation: "etsy_listings";
            referencedColumns: ["etsy_listing_id"];
          }
        ];
      };
      pinterest_posts: {
        Row: PinterestPostRow;
        Insert: Omit<PinterestPostRow, "id" | "published_at" | "created_at"> & {
          id?: string;
          published_at?: string;
          created_at?: string;
        };
        Update: never;
        Relationships: [
          {
            foreignKeyName: "pinterest_posts_etsy_listing_id_fkey";
            columns: ["etsy_listing_id"];
            referencedRelation: "etsy_listings";
            referencedColumns: ["etsy_listing_id"];
          }
        ];
      };
      instagram_posts: {
        Row: InstagramPostRow;
        Insert: Omit<InstagramPostRow, "id" | "media_type" | "published_at" | "created_at"> & {
          id?: string;
          media_type?: string;
          published_at?: string;
          created_at?: string;
        };
        Update: never;
        Relationships: [
          {
            foreignKeyName: "instagram_posts_etsy_listing_id_fkey";
            columns: ["etsy_listing_id"];
            referencedRelation: "etsy_listings";
            referencedColumns: ["etsy_listing_id"];
          }
        ];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: {
      pin_queue_status: PinQueueStatus;
    };
  };
};
