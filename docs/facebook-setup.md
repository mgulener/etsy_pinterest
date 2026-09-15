# Facebook Page publishing

Facebook is an independent, opt-in channel. Pinterest and Instagram credentials,
queues and existing schedulers are unchanged. Do not paste tokens into Git, chat,
screenshots or workflow files.

## Database and account

1. Apply `supabase/migrations/0023_facebook_channel.sql` before enabling Facebook.
   Until then the Facebook settings and queue show an unavailable-storage notice.
2. In the existing Meta developer app, configure the Facebook Pages use case.
   Obtain the Page access token for the intended business Page, with
   `pages_manage_posts` and `pages_read_engagement`. `pages_show_list` is used
   when discovering Pages through a user access token. App Review / advanced
   access may be required for accounts outside the app's permitted roles.
3. In `/settings#facebook`, enter that Page ID, its Page access token, and the
   Graph API version enabled for the app. This is not an Instagram account ID
   or Instagram token. Tokens are saved server-side per administrator and never
   returned to client components. Blank token input preserves the saved token
   only when the Page ID is unchanged.
4. Save verifies `/me?fields=id,name` against the supplied Page ID. This confirms
   identity, not all publishing permissions. A successful test publication is
   still required. Permission revocation or token expiry requires reconnection;
   this first implementation does not claim to renew tokens automatically.

## Long-lived Page access

Do not schedule publications with a short-lived token from Graph API Explorer.
Generate a user token with the existing Page permissions, exchange it server-side
for a long-lived user token using the Meta app ID and secret, then request
`/{app-scoped-user-id}/accounts` with that long-lived user token. Save only the
token returned for the intended Page. Never expose the app secret or user token
in a browser URL, application response, log or checked-in file.

Use Meta's access token debugger to confirm the app, Page, granted permissions,
validity and expiration before enabling scheduled publishing. Meta documents
long-lived Page tokens as having no fixed expiration date, but they can still be
invalidated by revoked permissions or account/security changes. This is not an
unconditional permanent credential and there is no generic refresh-token flow.
An expired user token must be reauthorized before it can be exchanged.

Error code 190 stops the scheduled trigger before publication. Subcode 463 is
reported as expiry; other invalid-token cases require reconnection. Only locally
defined error messages are returned, never upstream text that could echo secrets.

Reference: https://developers.facebook.com/docs/facebook-login/guides/access-tokens/get-long-lived/

## First publication

1. Enable Facebook but leave **Allow scheduled publishing** off.
2. On Etsy Listings, use **Add to Facebook queue** for one chosen product, or
   use **Build Facebook Queue** to import active cached products in bulk.
   Neither action modifies Etsy or publishes anything.
3. Review `/facebook/queue`. Each post has one image, an editable message and
   its Etsy link. Existing short Pinterest product descriptions are reused when
   available; otherwise a short listing excerpt is used. No extra OpenAI request
   is made by this channel.
4. Edit the message and publication time (Istanbul, UTC+3), then save. Cancel
   discards the draft. The Etsy link is appended at publication time. Prices are
   not separately sent as metadata; check imported text before publication.
5. When the scheduled time arrives, **Publish Next Post** sends at most one post.
   The shared Dry Run setting suppresses all Facebook writes. Verify the real
   post from `/facebook/posts` before enabling automation.

## Scheduling and safety

- New products discovered by Etsy sync enter Facebook only when Facebook is
  enabled. Existing products are added explicitly with the bulk-build control.
- The existing seasonal-priority helper is used to schedule unlocked drafts.
  Manually locked times are preserved. Published items are last in the queue.
- The minimum interval defaults to 15 minutes, configurable from 5 to 1440 after migration 0024.
  This is an application safety setting, not a claimed Meta platform quota.
- Automated publication additionally requires **Allow scheduled publishing**.
  The authenticated endpoint is `GET /api/cron/facebook/publish`, protected by
  `Authorization: Bearer <CRON_SECRET>` or the existing `x-cron-secret` header.
  Adding the endpoint does NOT create a scheduler. No Facebook automation is
  installed or enabled by this change; agree on the cadence after the test.
- Each Page is serialized by a PostgreSQL advisory lock during claim. Manual
  and cron triggers use the same guard, due-time check and interval check.
- The processing intent is committed before Meta is called. The returned Page
  post ID and published status are saved in one database write. No automatic
  HTTP retry is used for publication.
- Timeout, malformed success, HTTP 5xx or an unconfirmed database receipt leaves
  the post in `needs_review` (or `processing` if the database is unreachable)
  and pauses Facebook. Never reset such rows merely because they are old.
  Compare the actual Page and provider logs before reconciliation. There is no
  unsafe retry button for these statuses.
- Known rejections are `failed`; retry is manual after resolving the cause.
  Permission, token and known rate-limit errors also pause the channel.
- Removing a draft keeps a cancelled tombstone to prevent the next sync/build
  from silently recreating it. No Facebook or Etsy content is deleted.
- Queue data and settings are scoped by administrator and Page. Because the
  existing Etsy cache remains shop-wide, operations additionally require its
  unique configured Etsy owner. This is not a migration of the entire legacy
  application to multi-shop tenancy.

## Verification

`npm test`, `npm run typecheck`, `npm run lint`, and `npm run build`.
`npm run test:e2e:facebook` uses the isolated mock server and never calls Meta.
The PostgreSQL integration test starts a temporary socket-only cluster when
`POSTGRES_BIN` (or the local Homebrew PostgreSQL 14 installation) is available;
otherwise that integration test is explicitly skipped.

Official references:
- https://developers.facebook.com/docs/pages-api/posts/
- https://developers.facebook.com/docs/pages-api/getting-started/
- https://www.postman.com/meta/facebook/folder/3nyjb4m/tokens
- https://github.com/facebook/facebook-nodejs-business-sdk/blob/main/src/objects/page.js

## Local five-minute trigger

Apply `0024_facebook_five_minute_interval.sql` after migration 0023. Only Facebook's
minimum interval changes to five minutes; the default remains fifteen minutes.
Five minutes is the user's schedule, not a Meta quota guarantee.

From `/Users/muratgulener/Desktop/Etsy_Pinterest`, inspect without writes:

```sh
/Users/muratgulener/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --env-file=.env.local --import tsx scripts/trigger-facebook-publish.ts
```

Append `--run` for at most one automatic publication. The command resolves the
single connected Etsy owner and checks Page `1332088883317238`, verifies the Page
token identity, uses the existing database claim and atomic receipt, and checks
the saved receipt. It never enables publishing, rebuilds the queue, retries a
publication, starts a loop, or generates descriptions. `--env-file` uses the
existing local secrets without printing them; a development server is unnecessary.

JSON statuses: `read_only`, `disabled`, `dry_run`, `waiting`, `published`, `failed`,
`needs_review`, `busy`, `error`. Failures/review/errors exit nonzero. Failed automatic
publications pause publishing; metadata/receipt/queue uncertainty also turns off
`automatic_enabled`. Inspect the Page and queue before any manual retry or resume.
An active claim returns `busy` without pausing. A claim at least five minutes old,
one without a valid start time, or a `needs_review` item pauses automatic publication. Unknown arguments exit nonzero without changing state.

The separate task heartbeat owns the schedule. Keep it paused until setup and the
single real CLI attempt have been reviewed. Stop scheduling after any nonzero exit;
never automatically re-enable a paused Page or retry an uncertain publication.
