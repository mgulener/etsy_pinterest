# AI-assisted seasonal scheduling

## Separation of responsibilities

- The model classifies product design themes from title, description and Etsy tags. It never chooses dates or publication times.
- The server validates event IDs, evidence, confidence and optional explicit event years.
- A deterministic US calendar computes annual dates and delivery cutoffs. Display times remain in the existing Europe/Istanbul UI.
- Only high-confidence, evidence-backed classifications receive seasonal promotion. Ambiguous/unsupported events and school-local dates require review; they are not silently treated as Halloween or assigned invented dates.
- Cached results are per user and invalidated by product-input hash, classifier version or a model change during classification refresh. Queue planning also rejects stale product hashes.

## Calendar sources

- US federal holiday recurrence rules: https://www.opm.gov/policy-data-oversight/pay-leave/pay-administration/fact-sheets/holidays-work-schedules-and-pay/
- Halloween, October 31: https://guides.loc.gov/chronicling-america-halloween
- October awareness month: https://stacks.cdc.gov/view/cdc/81912
- Mother's Day: https://www.law.cornell.edu/uscode/text/36/117
- Father's Day: https://www.law.cornell.edu/uscode/text/36/109
- Grandparents Day: https://www.law.cornell.edu/uscode/text/36/125
- Patriot Day: https://www.law.cornell.edu/uscode/text/36/144
- Month of the Military Child: https://www.defense.gov/Spotlights/Month-of-the-Military-Child/

The calendar uses actual holiday dates, not substitute office-closure dates. Spring/summer/autumn/winter are explicitly approximate three-month merchandising windows, not astronomical dates. School calendars, Easter and Hanukkah currently require review. A quoted year on a vintage design is not automatically an event year.

## Ranking

Eligible seasonal items in the promotion window come first, then evergreen, future seasons, review-required items and expired explicitly dated products. A 14-day production-plus-delivery assumption is provisional; activation requires an explicit lead-time choice. Default lookahead is 90 days. Event-only products after the delivery cutoff lose current-season priority. Winter spans years correctly. Manual schedules and processing/published/cancelled/failed rows are never moved by the planner. Equal priorities use oldest queue creation date, then stable ID.

## Rollout

1. Run `node --env-file=.env.local --import tsx scripts/classify-seasonal-products.ts --pilot=60`. This reads current products and calls the configured AI, but does not change production tables, queues or Etsy. Reports/checkpoints stay in ignored `.local/`.
2. Review the report, especially ambiguous and multi-event products. Agreement with keyword rules is not proof of accuracy. Correct the classifier/tests before expanding.
3. Apply `supabase/migrations/0026_seasonal_planning.sql` before deploying this version. The new policy defaults to disabled. Refresh the local catalog through the read-only Etsy sync so existing products have their current titles, descriptions and tags before the full classification pass; adding previously missing tags invalidates older input hashes.
4. `--apply` creates/resumes the full per-user classification cache, using at most three concurrent AI batches. Use `--concurrency=1` for a slower run after throttling. Validated pilot results are reused only when inputs still match. Whole responses are checkpointed before database writes, so interrupted saves can resume without another AI call. Provider failures report only a safe error code, not private response text. `--apply --enable --lead-days=N` additionally enables seasonal planning and rebuilds enabled channel schedules. Do not run concurrent full backfills or rebuilds. Pilot and full-catalog reports are saved separately in `.local/`.
5. Daily Etsy sync updates cached product data, classifies up to 50 missing/changed products (new products first) within a 60-second AI budget, and replans all enabled queues even when there are no new products. Each AI call times out after 30 seconds; another batch starts only when at least 30 seconds remain. Longer backfills resume from saved classifications. AI failure fails the job visibly without deleting existing products or receipts. Products awaiting classification receive no automatic seasonal promotion.

The feature does not mutate Etsy listings. The existing publisher locks, duplicate protection, channel enable flags and cadence still apply. Browser sessions are not required by daily cron; the deployment must still receive its existing daily cron trigger. No new local recurring task is created.
