import { getOptionalNumber } from "@/lib/config/env";
import { getCurrentSession } from "@/lib/auth/session";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export type UserSettings = {
  userId: string | null;
  etsyApiKey: string | null;
  etsyRedirectUri: string | null;
  etsyShopId: string | null;
  etsyAccessToken: string | null;
  etsyRefreshToken: string | null;
  etsyTokenExpiresAt: number | null;
  etsyTokenScope: string | null;
  etsyTokenType: string | null;
  pinterestEnabled: boolean;
  pinterestAccessToken: string | null;
  pinterestBoardId: string | null;
  instagramEnabled: boolean;
  instagramAccessToken: string | null;
  instagramAccountId: string | null;
  instagramUserId: string | null;
  instagramPostMode: "single" | "carousel";
  metaApiVersion: string | null;
  aiCaptionsEnabled: boolean;
  openaiApiKey: string | null;
  openaiModel: string | null;
  dryRun: boolean;
  maxPinsPerRun: number;
  maxPinRetries: number;
  maxInstagramPostsPerRun: number;
  maxInstagramRetries: number;
};

export type UserSettingsInput = Omit<UserSettings, "userId" | "etsyAccessToken" | "etsyRefreshToken" | "etsyTokenExpiresAt" | "etsyTokenScope" | "etsyTokenType">;

type SettingsRow = {
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
};

function clean(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function fromRow(row: SettingsRow | null): UserSettings {
  return {
    userId: row?.user_id ?? null,
    etsyApiKey: row?.etsy_api_key ?? process.env.ETSY_API_KEY ?? null,
    etsyRedirectUri: row?.etsy_redirect_uri ?? process.env.ETSY_REDIRECT_URI ?? null,
    etsyShopId: row?.etsy_shop_id ?? process.env.ETSY_SHOP_ID ?? null,
    etsyAccessToken: row?.etsy_access_token ?? process.env.ETSY_ACCESS_TOKEN ?? null,
    etsyRefreshToken: row?.etsy_refresh_token ?? process.env.ETSY_REFRESH_TOKEN ?? null,
    etsyTokenExpiresAt: row?.etsy_token_expires_at ?? null,
    etsyTokenScope: row?.etsy_token_scope ?? null,
    etsyTokenType: row?.etsy_token_type ?? null,
    pinterestEnabled: row?.pinterest_enabled ?? process.env.PINTEREST_ENABLED !== "false",
    pinterestAccessToken: row?.pinterest_access_token ?? process.env.PINTEREST_ACCESS_TOKEN ?? null,
    pinterestBoardId: row?.pinterest_board_id ?? process.env.PINTEREST_BOARD_ID ?? null,
    instagramEnabled: row?.instagram_enabled ?? process.env.INSTAGRAM_ENABLED === "true",
    instagramAccessToken: row?.instagram_access_token ?? process.env.INSTAGRAM_ACCESS_TOKEN ?? null,
    instagramAccountId: row?.instagram_account_id ?? process.env.INSTAGRAM_ACCOUNT_ID ?? null,
    instagramUserId: row?.instagram_user_id ?? process.env.INSTAGRAM_USER_ID ?? null,
    instagramPostMode: row?.instagram_post_mode ?? (process.env.INSTAGRAM_POST_MODE === "carousel" ? "carousel" : "single"),
    metaApiVersion: row?.meta_api_version ?? process.env.META_API_VERSION ?? process.env.INSTAGRAM_API_VERSION ?? null,
    aiCaptionsEnabled: row?.ai_captions_enabled ?? process.env.AI_CAPTIONS_ENABLED === "true",
    openaiApiKey: row?.openai_api_key ?? process.env.OPENAI_API_KEY ?? null,
    openaiModel: row?.openai_model ?? process.env.OPENAI_MODEL ?? "gpt-5.4-mini",
    dryRun: row?.dry_run ?? process.env.DRY_RUN === "true",
    maxPinsPerRun: row?.max_pins_per_run ?? getOptionalNumber("MAX_PINS_PER_RUN", 10),
    maxPinRetries: row?.max_pin_retries ?? getOptionalNumber("MAX_PIN_RETRIES", 3),
    maxInstagramPostsPerRun: row?.max_instagram_posts_per_run ?? getOptionalNumber("MAX_INSTAGRAM_POSTS_PER_RUN", 5),
    maxInstagramRetries: row?.max_instagram_retries ?? getOptionalNumber("MAX_INSTAGRAM_RETRIES", 3)
  };
}

export function requireSetting(value: string | null, label: string) {
  if (!value) {
    throw new Error(`Missing required setting: ${label}`);
  }

  return value;
}

export async function getSettingsForUser(userId: string | null | undefined) {
  if (!userId) {
    return fromRow(null);
  }

  const { data, error } = await getSupabaseAdmin()
    .from("user_settings")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to read user settings: ${error.message}`);
  }

  return fromRow(data as SettingsRow | null);
}

export async function getCurrentUserSettings() {
  const session = await getCurrentSession();
  return getSettingsForUser(session?.userId);
}

export async function saveUserSettings(userId: string, settings: UserSettingsInput) {
  const { error } = await getSupabaseAdmin()
    .from("user_settings")
    .upsert(
      {
        user_id: userId,
        etsy_api_key: clean(settings.etsyApiKey),
        etsy_redirect_uri: clean(settings.etsyRedirectUri),
        etsy_shop_id: clean(settings.etsyShopId),
        pinterest_enabled: settings.pinterestEnabled,
        pinterest_access_token: clean(settings.pinterestAccessToken),
        pinterest_board_id: clean(settings.pinterestBoardId),
        instagram_enabled: settings.instagramEnabled,
        instagram_access_token: clean(settings.instagramAccessToken),
        instagram_account_id: clean(settings.instagramAccountId),
        instagram_user_id: clean(settings.instagramUserId),
        instagram_post_mode: settings.instagramPostMode,
        meta_api_version: clean(settings.metaApiVersion),
        ai_captions_enabled: settings.aiCaptionsEnabled,
        openai_api_key: clean(settings.openaiApiKey),
        openai_model: clean(settings.openaiModel),
        dry_run: settings.dryRun,
        max_pins_per_run: settings.maxPinsPerRun,
        max_pin_retries: settings.maxPinRetries,
        max_instagram_posts_per_run: settings.maxInstagramPostsPerRun,
        max_instagram_retries: settings.maxInstagramRetries
      },
      { onConflict: "user_id" }
    );

  if (error) {
    throw new Error(`Failed to save user settings: ${error.message}`);
  }
}

export async function saveEtsyTokenForUser(input: {
  userId: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  scope?: string;
  tokenType?: string;
}) {
  const { error } = await getSupabaseAdmin()
    .from("user_settings")
    .upsert(
      {
        user_id: input.userId,
        etsy_access_token: input.accessToken,
        etsy_refresh_token: input.refreshToken,
        etsy_token_expires_at: input.expiresAt,
        etsy_token_scope: input.scope ?? null,
        etsy_token_type: input.tokenType ?? null
      },
      { onConflict: "user_id" }
    );

  if (error) {
    throw new Error(`Failed to save Etsy OAuth token: ${error.message}`);
  }
}

export async function saveEtsyShopIdForUser(userId: string, shopId: number | string) {
  const { error } = await getSupabaseAdmin()
    .from("user_settings")
    .upsert(
      {
        user_id: userId,
        etsy_shop_id: String(shopId)
      },
      { onConflict: "user_id" }
    );

  if (error) {
    throw new Error(`Failed to save Etsy shop id: ${error.message}`);
  }
}
