const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "access-control-allow-origin": env.ALLOWED_ORIGIN || "https://ai-mini-business.pages.dev",
          "access-control-allow-methods": "GET,POST,OPTIONS",
          "access-control-allow-headers": "content-type,authorization",
          "access-control-max-age": "86400",
        },
      });
    }

    if (url.pathname === "/api/health" && request.method === "GET") {
      return json({ ok: true, service: "ai-mini-business-api", mode: "foundation" });
    }

    if (url.pathname === "/api/services" && request.method === "GET") {
      return json({
        services: [
          { id: "website", enabled: false, status: "coming_soon" },
          { id: "video-prompts", enabled: false, status: "coming_soon" },
          { id: "logo", enabled: false, status: "coming_soon" },
          { id: "business-content", enabled: false, status: "coming_soon" },
          { id: "documents", enabled: false, status: "coming_soon" },
        ],
      });
    }

    if (url.pathname === "/api/generate" && request.method === "POST") {
      // Generation stays disabled until authentication, quota reservation,
      // cost controls, payment workflow, and provider configuration are implemented.
      if (env.AI_ENABLED !== "true" || env.GLOBAL_PAUSE !== "false") {
        return json({ error: "generation_disabled", message: "AI generation is not enabled yet." }, 503);
      }
      return json({ error: "not_implemented", message: "Generation workflow is not implemented yet." }, 501);
    }

    return json({ error: "not_found" }, 404);
  },
};
