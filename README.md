# Etsy Social Automation

Next.js admin dashboard and backend automation for detecting new Etsy listings and publishing them to Pinterest and Instagram through durable Supabase queues.

The core invariant is strict:

```text
The same etsy_listing_id is never treated as a new product again, even if Etsy renews it.
```

That is enforced in application logic and with PostgreSQL unique constraints on `etsy_listings.etsy_listing_id`, `pin_queue.etsy_listing_id`, `pinterest_posts.etsy_listing_id`, `instagram_queue.etsy_listing_id`, and `instagram_posts.etsy_listing_id`.

## What changed from the legacy project

The original GitHub project was a small Express app using `node-cron`, `axios`, JSON token files, and direct Etsy-to-Pinterest publishing. It fetched one page of Etsy listings and attempted to pin every active listing on each scheduled run.

This version replaces that with:

- Next.js App Router pages and route handlers
- Supabase PostgreSQL persistence
- Database-backed initial bootstrap state
- Etsy pagination for 1300+ listings
- Queue-based Pinterest publishing with retry limits
- Queue-based Instagram publishing with retry limits
- Atomic queue claiming to reduce concurrent duplicate processing risk
- Vercel Cron endpoints secured with `CRON_SECRET`
- Password-protected admin dashboard
- Dry-run publishing mode

## Project structure

```text
app/
  api/cron/etsy/sync/route.ts
  api/cron/pinterest/publish/route.ts
  api/cron/instagram/publish/route.ts
  api/etsy/sync/route.ts
  api/pinterest/publish/route.ts
  api/instagram/publish/route.ts
  dashboard/page.tsx
  etsy/listings/page.tsx
  pinterest/queue/page.tsx
  pinterest/posts/page.tsx
  instagram/queue/page.tsx
  instagram/posts/page.tsx
lib/
  etsy/
  pinterest/
  instagram/
  supabase/
  services/
    syncEtsyListings.ts
    publishPinterestPins.ts
    publishInstagramPosts.ts
  repositories/
  auth/
  config/
  utils/
supabase/migrations/
tests/
```

Canonical dashboard routes:

```text
/dashboard
/etsy/listings
/pinterest/queue
/pinterest/posts
/instagram/queue
/instagram/posts
/privacy
```

Canonical manual API routes:

```text
POST /api/etsy/sync
POST /api/pinterest/publish
POST /api/instagram/publish
```

## Environment variables

Copy `.env.example` to `.env.local` for local development.

```text
NEXT_PUBLIC_SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=

ETSY_API_KEY=
ETSY_ACCESS_TOKEN=
ETSY_REFRESH_TOKEN=
ETSY_REDIRECT_URI=
ETSY_SHOP_ID=

PINTEREST_ACCESS_TOKEN=
PINTEREST_BOARD_ID=

INSTAGRAM_ACCESS_TOKEN=
INSTAGRAM_ACCOUNT_ID=
INSTAGRAM_USER_ID=
INSTAGRAM_ENABLED=
INSTAGRAM_POST_MODE=single
META_API_VERSION=v25.0
INSTAGRAM_CONTAINER_MAX_POLLS=6
INSTAGRAM_CONTAINER_POLL_INTERVAL_MS=1000
INSTAGRAM_CAROUSEL_MAX_ITEMS=10

ADMIN_PASSWORD=
CRON_SECRET=

MAX_PINS_PER_RUN=10
MAX_PIN_RETRIES=3
MAX_INSTAGRAM_POSTS_PER_RUN=5
MAX_INSTAGRAM_RETRIES=3
DRY_RUN=true
INSTAGRAM_DRY_RUN=true
```

Only `NEXT_PUBLIC_SUPABASE_URL` is public. `SUPABASE_SERVICE_ROLE_KEY`, Etsy credentials, Pinterest credentials, Instagram credentials, `ADMIN_PASSWORD`, and `CRON_SECRET` are server-only.

`ETSY_ACCESS_TOKEN` is optional when the OAuth callback flow has saved a token in Supabase. `ETSY_REDIRECT_URI` is also optional locally, but in production it is useful to set it explicitly to the exact Etsy callback URL.

Instagram queueing is enabled automatically when `INSTAGRAM_ACCESS_TOKEN` and either `INSTAGRAM_ACCOUNT_ID` or `INSTAGRAM_USER_ID` exist. Set `INSTAGRAM_ENABLED=false` to explicitly disable Instagram queueing. `INSTAGRAM_DRY_RUN` overrides `DRY_RUN` for Instagram publishing only.

## Supabase setup

1. Create a Supabase project.
2. Open the SQL editor or use the Supabase CLI.
3. Run `supabase/migrations/0001_initial_schema.sql`.
4. Run `supabase/migrations/0002_instagram_publishing.sql`.
5. Run `supabase/migrations/0003_instagram_publishing_details.sql`.
6. Add `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` to local and Vercel environments.

The migration creates:

- `etsy_listings`
- `pin_queue`
- `pinterest_posts`
- `instagram_queue`
- `instagram_posts`
- `app_settings`
- `pin_queue_status` enum
- indexes and `updated_at` triggers

## Local setup

```bash
npm install
npm run dev
```

Then open `http://localhost:3000` and sign in with `ADMIN_PASSWORD`.

Useful checks:

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

## Bootstrap flow

On first production setup, keep `DRY_RUN=true`.

1. Deploy the app with all env variables configured.
2. Sign in to the dashboard.
3. If the dashboard shows `Initial Etsy Sync Required`, click `Bootstrap Existing Listings`.
4. The app fetches all active Etsy listings, stores them in `etsy_listings`, and sets `app_settings.initial_sync_completed = true`.
5. No rows are inserted into `pin_queue` or `instagram_queue` during bootstrap.

This prevents the existing 1300+ listings from being treated as new listings.

## Etsy OAuth setup

Create a seller app in Etsy Developer, then add this callback URL to the app:

```text
https://YOUR-VERCEL-DOMAIN.vercel.app/api/auth/etsy/callback
```

Set:

```text
ETSY_API_KEY=keystring:shared_secret
ETSY_REDIRECT_URI=https://YOUR-VERCEL-DOMAIN.vercel.app/api/auth/etsy/callback
```

Sign in to the dashboard, click `Connect Etsy`, approve the requested `listings_r shops_r` scopes, and Etsy will redirect back to `/api/auth/etsy/callback`. The app stores the access and refresh token in Supabase `app_settings` under `etsy_oauth_token`.

## Normal Etsy sync

Vercel Cron calls:

```text
GET /api/cron/etsy/sync
```

The service:

1. Verifies `CRON_SECRET`.
2. Refuses to run if bootstrap is not completed.
3. Fetches every active Etsy listing with `limit=100`, `offset`, and `includes=Images`.
4. Checks existing database rows by `etsy_listing_id`.
5. Updates `last_seen_at` for known listings.
6. Inserts new listings and adds exactly one Pinterest queue item per new `etsy_listing_id`.
7. Adds exactly one Instagram queue item per new `etsy_listing_id` when Instagram is enabled.

It never uses Etsy timestamps, state transitions, active timestamps, or renew timestamps to decide whether something is new.

## Pinterest publishing

Vercel Cron calls:

```text
GET /api/cron/pinterest/publish
```

The service:

1. Verifies `CRON_SECRET`.
2. Loads oldest pending queue items, capped by `MAX_PINS_PER_RUN`.
3. Atomically claims each row by updating `pending -> processing` with a conditional update.
4. Checks whether a Pinterest post already exists for the `etsy_listing_id`.
5. Creates a Pinterest Pin unless `DRY_RUN=true`.
6. Inserts `pinterest_posts` only after Pinterest returns a Pin ID.
7. Marks the queue row `published`, returns it to `pending`, or marks it `failed` after `MAX_PIN_RETRIES`.

Manual buttons on the dashboard call the same server-side services.

## Instagram publishing

Instagram publishing uses the official Meta Instagram API content publishing flow:

1. Create a media container from the Etsy image URL.
2. Poll the container status with a bounded retry loop.
3. Publish that container as an Instagram media object.
4. Store the returned media ID, creation ID, media type, caption, and permalink in `instagram_posts`.
5. Mark the `instagram_queue` row `published`, return it to `pending`, or mark it `failed` after `MAX_INSTAGRAM_RETRIES`.

Set these Vercel environment variables when the Meta app/token is ready:

```text
INSTAGRAM_ACCESS_TOKEN=<server-only Instagram User access token>
INSTAGRAM_ACCOUNT_ID=<Instagram professional account id>
INSTAGRAM_ENABLED=true
INSTAGRAM_POST_MODE=single
INSTAGRAM_DRY_RUN=true
```

The Instagram account must be a Business or Creator professional account. Personal Instagram accounts are not supported. The image URL must be publicly accessible over HTTPS because Meta fetches the media from the URL. The first implementation uses Etsy image URLs directly; `resolveInstagramMediaUrls()` keeps the media URL layer isolated so a later Supabase Storage fallback can be added without changing the Instagram API client.

### Instagram Setup

1. Create or use a Meta app that has access to the Instagram API with Instagram Login.
2. Connect a Business or Creator Instagram professional account.
3. Request the current publishing permissions required by Meta, including `instagram_business_basic` and `instagram_business_content_publish`.
4. Generate an Instagram User access token for that professional account.
5. Find the Instagram professional account ID and set it as `INSTAGRAM_ACCOUNT_ID`.
6. Add the env vars to Vercel as server-side production variables.
7. Keep `INSTAGRAM_DRY_RUN=true` for the first test.
8. Create a new Etsy listing and run `Sync Etsy Now`.
9. Confirm it appears in `/instagram/queue`.
10. Click `Publish Instagram Now` and confirm it stays pending in dry-run mode.
11. Set `INSTAGRAM_DRY_RUN=false` only after the queue and caption look right.

Post modes:

```text
INSTAGRAM_POST_MODE=single
```

Publishes one image feed post from the first Etsy image.

```text
INSTAGRAM_POST_MODE=carousel
```

Publishes one carousel post from the first eligible Etsy image URLs, capped by `INSTAGRAM_CAROUSEL_MAX_ITEMS`. The invariant still holds: one `etsy_listing_id` gets at most one automatic Instagram publication.

Token notes:

- Keep `INSTAGRAM_ACCESS_TOKEN` server-side only.
- Never log the token or expose it in the browser.
- Tokens can expire. Authentication errors are classified as permanent so the worker does not waste all retry attempts on an invalid token.
- Common permanent errors are invalid/expired token and invalid media URL.
- Common retryable errors are temporary Meta failures and rate limits.

## Vercel deployment

`vercel.json` configures Hobby-plan-compatible daily cron jobs:

```text
/api/cron/etsy/sync            0 3 * * *
/api/cron/pinterest/publish    0 4 * * *
/api/cron/instagram/publish    0 5 * * *
```

Vercel Hobby accounts only allow daily cron schedules. On a Pro plan, you can change these back to a more active cadence such as sync every 6 hours and publish every hour. Vercel cron jobs run on production deployments. Set the same environment variables in the Vercel project settings.

For cron security, send either:

```text
Authorization: Bearer <CRON_SECRET>
```

or:

```text
x-cron-secret: <CRON_SECRET>
```

## Production dry-run checklist

1. Set `DRY_RUN=true`.
2. Run bootstrap from the dashboard.
3. Create one new Etsy listing.
4. Click `Sync Etsy Now` or wait for `/api/cron/etsy/sync`.
5. Confirm one pending queue item appears.
6. Click `Publish Pins Now` or `Publish Instagram Now`.
7. Confirm logs show `[DRY RUN] Would publish...` and no Pinterest Pin is created.
8. Set `DRY_RUN=false` only after the queue behavior looks correct.

## Future extensions

The database currently uses one automatic Pin per Etsy listing. The schema already stores `etsy_image_id`, so it can be migrated later from:

```text
UNIQUE(etsy_listing_id)
```

to:

```text
UNIQUE(etsy_listing_id, etsy_image_id)
```

The Pinterest client accepts a generic `createPin({ boardId, imageUrl, title, description, destinationUrl })` input, so future board routing, AI-generated SEO text, multiple images, and UTM tracking can be added without coupling Pinterest publishing to Etsy response objects.
