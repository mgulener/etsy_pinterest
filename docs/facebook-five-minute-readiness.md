# Facebook five-minute readiness — 15 September 2026

Ready for the existing task heartbeat to be enabled by the coordinating task.
This task created no automation and made exactly one real CLI publication attempt.

## Verified live state

- Page: The Cozy Cedar, API ID `1332088883317238`, API `v26.0`.
- `enabled=true`, `automatic_enabled=true`, `interval_minutes=5`; shared dry run off.
- Separate migration `0024_facebook_five_minute_interval.sql` applied successfully through the authorized Supabase SQL editor. Migration 0023 was not changed or reapplied.
- Added 1,568 existing active products once. All 1,568 messages matched saved product descriptions; no new AI calls. Seasonal/Halloween order and every five-minute interval were verified across the entire pending queue.
- Original published listing `4401083163`, post `1332088883317238_122097389523482257`, and its publication history remain unchanged.
- Final counts: pending **1,567**, published **2**, processing **0**, needs_review **0**, failed **0**, cancelled **0**.
- Next scheduled listing: `4401073596`, **15 September 2026 13:35:00 Europe/Istanbul**. The database also enforces five minutes after the actual prior publication, so earliest eligibility is 13:35:08.582; an earlier heartbeat returns waiting.

## Single real attempt

Listing `4400754542` published at **13:30:08.582 Europe/Istanbul**, attempt count **1**.

```json
{"status":"published","postId":"1332088883317238_122097396975482257","receiptVerified":true}
```

[Published Facebook post](https://www.facebook.com/1332088883317238_122097396975482257)

## Exact command

Working directory: `/Users/muratgulener/Desktop/Etsy_Pinterest`.

```sh
/Users/muratgulener/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --env-file=.env.local --import tsx scripts/trigger-facebook-publish.ts --run
```

Omit `--run` for read-only status. The bundled Node runtime and `--import tsx` were tested directly without a dev server dependency. Outputs contain no credentials or personal account data.

Normal zero-exit statuses: `read_only`, `disabled`, `dry_run`, `busy`, `waiting`, `published`.
Nonzero statuses: `failed`, `needs_review`, `error`. Do not retry automatically or resume a paused Page. Active processing returns busy without pausing; processing at least five minutes old, missing/invalid start time, or needs_review pauses automatic publishing. The command never builds a queue or enables publishing.

## Verification

- 28 passing tests across Facebook publishing, real local PostgreSQL migration/concurrency tests, and scheduled CLI tests; none skipped.
- Five-minute validation and shorter interval rejection; manual/automatic concurrent claims select exactly once; durable processing/review lock; receipt and deduplication constraints; disabled/dry-run/busy behavior; stale processing; failure/metadata/receipt handling; default read-only and no retry.
- Full typecheck and lint passed. Unknown CLI argument returned safe JSON and exit 1.
- Browser test was updated for five-minute form validation but could not start because the existing port-3001 Next development server holds this project's lock. That server was left running. The existing signed-in browser independently displayed interval 5, Facebook enabled, and scheduled publishing enabled.
- No Etsy writes, Instagram/Pinterest automation changes, commit, push, or deployment.

Five minutes is the user's schedule, not a provider quota promise. Meta restrictions can still pause publication.
