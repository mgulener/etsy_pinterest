# Etsy Pinterest Automation

Next.js admin dashboard and backend automation for detecting new Etsy listings and publishing them to Pinterest through a durable Supabase queue.

The core invariant is strict:

```text
The same etsy_listing_id is never treated as a new product again, even if Etsy renews it.
```

That is enforced in application logic and with PostgreSQL unique constraints on `etsy_listings.etsy_listing_id`, `pin_queue.etsy_listing_id`, and `pinterest_posts.etsy_listing_id`.

## What changed from the legacy project

The original GitHub project was a small Express app using `node-cron`, `axios`, JSON token files, and direct Etsy-to-Pinterest publishing. It fetched one page of Etsy listings and attempted to pin every active listing on each scheduled run.

This version replaces that with:

- Next.js App Router pages and route handlers
- Supabase PostgreSQL persistence
- Database-backed initial bootstrap state
- Etsy pagination for 1300+ listings
- Queue-based Pinterest publishing with retry limits
- Atomic queue claiming to reduce concurrent duplicate processing risk
- Vercel Cron endpoints secured with `CRON_SECRET`
- Password-protected admin dashboard
- Dry-run publishing mode

## Project structure

```text
app/
  api/cron/sync-etsy/route.ts
  api/cron/publish-pins/route.ts
  api/sync/route.ts
  api/pins/route.ts
  dashboard/page.tsx
  listings/page.tsx
  queue/page.tsx
  pins/page.tsx
lib/
  etsy/
  pinterest/
  supabase/
  services/
  repositories/
  auth/
  config/
  utils/
supabase/migrations/
tests/
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

ADMIN_PASSWORD=
CRON_SECRET=

MAX_PINS_PER_RUN=10
MAX_PIN_RETRIES=3
DRY_RUN=true
```

Only `NEXT_PUBLIC_SUPABASE_URL` is public. `SUPABASE_SERVICE_ROLE_KEY`, Etsy credentials, Pinterest credentials, `ADMIN_PASSWORD`, and `CRON_SECRET` are server-only.

`ETSY_ACCESS_TOKEN` is optional when the OAuth callback flow has saved a token in Supabase. `ETSY_REDIRECT_URI` is also optional locally, but in production it is useful to set it explicitly to the exact Etsy callback URL.

## Supabase setup

1. Create a Supabase project.
2. Open the SQL editor or use the Supabase CLI.
3. Run `supabase/migrations/0001_initial_schema.sql`.
4. Add `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` to local and Vercel environments.

The migration creates:

- `etsy_listings`
- `pin_queue`
- `pinterest_posts`
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
5. No rows are inserted into `pin_queue` during bootstrap.

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
GET /api/cron/sync-etsy
```

The service:

1. Verifies `CRON_SECRET`.
2. Refuses to run if bootstrap is not completed.
3. Fetches every active Etsy listing with `limit=100`, `offset`, and `includes=Images`.
4. Checks existing database rows by `etsy_listing_id`.
5. Updates `last_seen_at` for known listings.
6. Inserts new listings and adds exactly one queue item per new `etsy_listing_id`.

It never uses Etsy timestamps, state transitions, active timestamps, or renew timestamps to decide whether something is new.

## Pinterest publishing

Vercel Cron calls:

```text
GET /api/cron/publish-pins
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

## Vercel deployment

`vercel.json` configures Hobby-plan-compatible daily cron jobs:

```text
/api/cron/sync-etsy     0 3 * * *
/api/cron/publish-pins  0 4 * * *
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
4. Click `Sync Etsy Now` or wait for `/api/cron/sync-etsy`.
5. Confirm one pending queue item appears.
6. Click `Publish Queue Now`.
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
