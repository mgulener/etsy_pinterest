export type RequiredEnvKey =
  | "NEXT_PUBLIC_SUPABASE_URL"
  | "SUPABASE_SERVICE_ROLE_KEY"
  | "ETSY_API_KEY"
  | "PINTEREST_ACCESS_TOKEN"
  | "PINTEREST_BOARD_ID"
  | "INSTAGRAM_ACCESS_TOKEN"
  | "INSTAGRAM_USER_ID"
  | "CRON_SECRET"
  | "ADMIN_PASSWORD";

export function getRequiredEnv(key: RequiredEnvKey): string {
  const value = process.env[key];

  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }

  return value;
}

export function getOptionalNumber(key: string, fallback: number): number {
  const rawValue = process.env[key];

  if (!rawValue) {
    return fallback;
  }

  const value = Number.parseInt(rawValue, 10);

  if (Number.isNaN(value) || value < 1) {
    throw new Error(`${key} must be a positive integer`);
  }

  return value;
}

export function getServerEnv() {
  return {
    supabaseUrl: getRequiredEnv("NEXT_PUBLIC_SUPABASE_URL"),
    supabaseServiceRoleKey: getRequiredEnv("SUPABASE_SERVICE_ROLE_KEY"),
    etsyApiKey: getRequiredEnv("ETSY_API_KEY"),
    etsyAccessToken: process.env.ETSY_ACCESS_TOKEN,
    etsyRefreshToken: process.env.ETSY_REFRESH_TOKEN,
    etsyRedirectUri: process.env.ETSY_REDIRECT_URI,
    etsyShopId: process.env.ETSY_SHOP_ID,
    pinterestAccessToken: getRequiredEnv("PINTEREST_ACCESS_TOKEN"),
    pinterestBoardId: getRequiredEnv("PINTEREST_BOARD_ID"),
    instagramAccessToken: process.env.INSTAGRAM_ACCESS_TOKEN,
    instagramAccountId: process.env.INSTAGRAM_ACCOUNT_ID,
    instagramUserId: process.env.INSTAGRAM_USER_ID,
    instagramEnabled: process.env.INSTAGRAM_ENABLED,
    instagramPostMode: process.env.INSTAGRAM_POST_MODE,
    metaApiVersion: process.env.META_API_VERSION,
    cronSecret: getRequiredEnv("CRON_SECRET"),
    adminPassword: getRequiredEnv("ADMIN_PASSWORD"),
    maxPinsPerRun: getOptionalNumber("MAX_PINS_PER_RUN", 10),
    maxPinRetries: getOptionalNumber("MAX_PIN_RETRIES", 3),
    dryRun: process.env.DRY_RUN === "true"
  };
}
