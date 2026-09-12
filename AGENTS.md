<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Etsy Write Approval

- Granting OAuth `listings_w` is permission setup, NOT authorization to change Etsy products.
- Never mutate Etsy listings, sections, prices, titles, inventory or other shop data without the
  user's explicit approval of the specific changes. An Excel recommendation is not approval.
- Present exact listing IDs and current/proposed values before requesting approval. Approval
  applies only to that plan; changed targets or stale Etsy values require a new review.
- Keep Etsy sync and cron read-only. Do not add automatic section assignment to either flow.
- A future mutation workflow must enforce authentication, ownership, explicit plan approval,
  expiry, replay protection and stale-value checks on the server, with recorded results and tests.
- Until that workflow exists, do not introduce an ungated Etsy mutation endpoint or script.
