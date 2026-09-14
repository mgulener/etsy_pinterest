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

globalThis.fetch = async (input, options = {}) => {
  const request = new Request(input, options);
  const url = new URL(request.url);
  if (["127.0.0.1", "localhost"].includes(url.hostname)) return originalFetch(input, options);
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
    return Response.json({ user_id: "browser-test-owner", ai_captions_enabled: true, openai_api_key: "test-key", openai_model: "test-model", pinterest_enabled: false });
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
