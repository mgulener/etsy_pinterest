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

export type EtsyListingRow = {
  id: string;
  etsy_listing_id: number;
  etsy_image_id: number | null;
  image_url: string | null;
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
  status: PinQueueStatus;
  attempt_count: number;
  last_error: string | null;
  scheduled_at: string;
  created_at: string;
  updated_at: string;
  processed_at: string | null;
};

export type InstagramPostRow = {
  id: string;
  etsy_listing_id: number;
  etsy_image_id: number | null;
  instagram_media_id: string;
  instagram_permalink: string | null;
  published_at: string;
  created_at: string;
};

export type Database = {
  public: {
    Tables: {
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
        Insert: Omit<InstagramQueueRow, "id" | "status" | "attempt_count" | "last_error" | "created_at" | "updated_at" | "processed_at"> & {
          id?: string;
          status?: PinQueueStatus;
          attempt_count?: number;
          last_error?: string | null;
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
        Insert: Omit<InstagramPostRow, "id" | "published_at" | "created_at"> & {
          id?: string;
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
