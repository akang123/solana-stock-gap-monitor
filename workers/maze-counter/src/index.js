const COUNTER_NAME = "stock-gap-maze";
const INITIAL_COUNT = 1013;
const ALLOWED_ORIGINS = new Set([
  "https://solanastockgapmonitor.site",
  "https://www.solanastockgapmonitor.site",
  "http://localhost:8765",
]);

function corsHeaders(request) {
  const origin = request.headers.get("Origin");
  const headers = new Headers({
    "Cache-Control": "no-store, max-age=0",
    "Content-Type": "application/json; charset=utf-8",
    "Vary": "Origin",
  });
  if (origin && ALLOWED_ORIGINS.has(origin)) headers.set("Access-Control-Allow-Origin", origin);
  return headers;
}

function jsonResponse(body, status, headers) {
  return new Response(JSON.stringify(body), { status, headers });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin");
    const headers = corsHeaders(request);

    if (request.method === "OPTIONS") {
      if (origin && !ALLOWED_ORIGINS.has(origin)) return jsonResponse({ error: "Origin not allowed" }, 403, headers);
      headers.set("Access-Control-Allow-Methods", "GET, OPTIONS");
      headers.set("Access-Control-Max-Age", "86400");
      return new Response(null, { status: 204, headers });
    }

    if (url.pathname !== "/api/plays") return jsonResponse({ error: "Not found" }, 404, headers);
    if (origin && !ALLOWED_ORIGINS.has(origin)) return jsonResponse({ error: "Origin not allowed" }, 403, headers);
    if (request.method !== "GET") {
      headers.set("Allow", "GET, OPTIONS");
      return jsonResponse({ error: "Method not allowed" }, 405, headers);
    }
    if (!env.DB) return jsonResponse({ error: "Counter storage is not configured" }, 503, headers);

    try {
      await env.DB.prepare(
        "INSERT OR IGNORE INTO game_counters (name, total) VALUES (?, ?)"
      ).bind(COUNTER_NAME, INITIAL_COUNT).run();
      await env.DB.prepare(
        "UPDATE game_counters SET total = total + 1 WHERE name = ?"
      ).bind(COUNTER_NAME).run();
      const counter = await env.DB.prepare(
        "SELECT total FROM game_counters WHERE name = ?"
      ).bind(COUNTER_NAME).first();

      if (!counter || !Number.isSafeInteger(counter.total)) throw new Error("Counter row is missing or invalid");
      return jsonResponse({ count: counter.total }, 200, headers);
    } catch {
      return jsonResponse({ error: "Could not update the play counter" }, 500, headers);
    }
  },
};
