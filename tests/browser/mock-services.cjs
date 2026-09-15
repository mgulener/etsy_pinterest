// Loaded only by the isolated browser-test server. External API calls fail closed.
const originalFetch = globalThis.fetch;
const item = {
  id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
  etsy_listing_id: 123, etsy_image_id: 456,
  image_url: "/images/social-publishing-dashboard.png",
  title: "Halloween Reading Shirt",
  description: "A ghost reading a book. A playful Halloween design for book lovers.",
  pin_description: "A ghost reading a book. A playful Halloween design for book lovers.",
  pin_description_source: "ai", pin_description_generated_at: "2026-09-14T12:00:00.000Z",
  destination_url: "https://etsy.test/listing/123",
  board_id: "test-board", status: "pending", attempt_count: 0, last_error: null,
  scheduled_at: "2026-10-01T12:00:00.000Z", schedule_locked: false,
  created_at: "2026-09-14T12:00:00.000Z", updated_at: "2026-09-14T12:00:00.000Z", processed_at: null
};

const facebookSettings = {
  user_id: "browser-test-owner", page_id: "123", page_name: "TheCozyCedar Test",
  page_access_token: "test-facebook-token", api_version: "v24.0", enabled: false,
  automatic_enabled: false, interval_minutes: 15,
  verified_at: "2026-09-15T08:00:00.000Z", updated_at: "2026-09-15T08:00:00.000Z"
};
const facebookItem = {
  id: "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff", user_id: "browser-test-owner", page_id: "123",
  etsy_listing_id: 123, title: item.title, image_url: item.image_url,
  destination_url: "https://www.etsy.com/listing/123", message: "A spooky design for book lovers.",
  status: "pending", scheduled_at: "2026-10-01T12:00:00.000Z", schedule_locked: false,
  attempt_count: 0, last_error: null, request_started_at: null, facebook_post_id: null,
  published_at: null, created_at: item.created_at, updated_at: item.updated_at
};

globalThis.fetch = async (input, options = {}) => {
  const request = new Request(input, options);
  const url = new URL(request.url);
  if (["127.0.0.1", "localhost"].includes(url.hostname)) return originalFetch(input, options);
  if (url.origin === "https://graph.facebook.com" && request.method === "GET" && url.pathname === "/v24.0/me"
    && request.headers.get("authorization") === "Bearer test-facebook-token") {
    return Response.json({ id: "123", name: "TheCozyCedar Test" });
  }
  if (url.origin === "https://api.openai.com" && url.pathname === "/v1/responses") {
    await new Promise(resolve => setTimeout(resolve, 600));
    request.signal.throwIfAborted();
    return Response.json({ status: "completed", output: [{ type: "message", content: [{
      type: "output_text",
      text: JSON.stringify({ description: "A bookish twist on Halloween with a ghost reading its favorite story. A playful design for spooky-season readers." })
    }] }] });
  }
  if (url.origin !== "https://pinterest-description-db.test") throw new Error(`External request blocked in browser test: ${url.origin}`);
  if (url.pathname === "/rest/v1/user_settings" && request.method === "GET") {
    return Response.json({ user_id: "browser-test-owner", ai_captions_enabled: true, openai_api_key: "test-key", openai_model: "test-model", pinterest_enabled: false, dry_run: true });
  }
  if (url.pathname === "/rest/v1/pinterest_board_mappings") return Response.json([]);
  if (url.pathname === "/rest/v1/app_settings" && request.method === "GET") {
    return Response.json({ value: url.searchParams.get("key") === "eq.initial_sync_completed" ? true : [] });
  }
  if (url.pathname === "/rest/v1/sync_jobs" && request.method === "GET") return Response.json(null);
  if (["/rest/v1/etsy_listings", "/rest/v1/instagram_queue", "/rest/v1/instagram_posts", "/rest/v1/pinterest_posts"].includes(url.pathname)) {
    if (request.method === "HEAD") return new Response(null, { headers: { "content-range": url.pathname === "/rest/v1/etsy_listings" ? "*/1" : "*/0" } });
    if (request.method === "GET") return Response.json(url.pathname === "/rest/v1/etsy_listings" ? [{
      id: item.id, etsy_listing_id: 123, title: item.title, description: item.description,
      image_url: item.image_url, state: "active", url: facebookItem.destination_url,
      first_seen_at: item.created_at, last_seen_at: item.updated_at
    }] : [], { headers: { "content-range": "0-0/1" } });
    throw new Error("Unexpected catalog test mutation");
  }
  if (url.pathname === "/rest/v1/facebook_settings") {
    if (url.searchParams.get("user_id") !== "eq.browser-test-owner") throw new Error("Missing Facebook owner filter");
    if (request.method === "PATCH") {
      const body = await request.json();
      Object.assign(facebookSettings, body, { updated_at: new Date().toISOString() });
      return Response.json([{ user_id: "browser-test-owner" }]);
    }
    return Response.json({ ...facebookSettings });
  }
  if (url.pathname === "/rest/v1/facebook_queue") {
    if (url.searchParams.get("user_id") !== "eq.browser-test-owner" || url.searchParams.get("page_id") !== "eq.123") throw new Error("Missing Facebook queue ownership filters");
    if (request.method === "PATCH") {
      const body = await request.json();
      const matches = url.searchParams.get("id") === `eq.${facebookItem.id}` &&
        url.searchParams.get("updated_at") === `eq.${facebookItem.updated_at}` &&
        url.searchParams.get("status") === "in.(pending,failed)";
      if (matches) Object.assign(facebookItem, body, { updated_at: new Date().toISOString() });
      return Response.json(matches ? [facebookItem] : []);
    }
    if (request.method !== "GET" && request.method !== "HEAD") throw new Error("Unexpected Facebook test mutation");
    const status = url.searchParams.get("status");
    const search = (url.searchParams.get("title") ?? "").replace(/^ilike\.%|%$/g, "").toLowerCase();
    const include = (!status || status === `eq.${facebookItem.status}` || (status === "neq.published" && facebookItem.status !== "published")) &&
      (!search || facebookItem.title.toLowerCase().includes(search));
    const rows = include ? [{ ...facebookItem }] : [];
    if (request.method === "HEAD") return new Response(null, { headers: { "content-range": `*/${rows.length}` } });
    return Response.json(request.headers.get("accept")?.includes("vnd.pgrst.object") ? (rows[0] ?? null) : rows, { headers: { "content-range": `0-0/${rows.length}` } });
  }
  if (url.pathname === "/rest/v1/pin_queue") {
    if (request.method === "PATCH") {
      const body = await request.json();
      if (Object.keys(body).some(key => !["pin_description", "pin_description_source", "pin_description_generated_at"].includes(key))) throw new Error("Unexpected test mutation");
      const matches = url.searchParams.get("id") === `eq.${item.id}` &&
        url.searchParams.get("updated_at") === `eq.${item.updated_at}` &&
        url.searchParams.get("status") === "in.(pending,failed,cancelled)";
      if (matches) Object.assign(item, body, { updated_at: new Date().toISOString() });
      return Response.json(matches ? [item] : []);
    }
    if (request.method === "GET" || request.method === "HEAD") {
      const publishedOnly = url.searchParams.get("status") === "eq.published";
      const rows = publishedOnly ? [] : [{ ...item }];
      if (request.method === "HEAD") return new Response(null, { headers: { "content-range": `*/${rows.length}` } });
      return Response.json(url.searchParams.has("id") ? (rows[0] ?? null) : rows, { headers: { "content-range": `0-0/${rows.length}` } });
    }
  }
  throw new Error(`Unexpected test request: ${request.method} ${url.pathname}`);
};
