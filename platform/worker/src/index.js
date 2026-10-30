const SESSION_DAYS = 7;
const PBKDF2_ITERATIONS = 100000;
const encoder = new TextEncoder();

function corsHeaders(env, request) {
  const allowed = env.ALLOWED_ORIGIN || "";
  const origin = request.headers.get("Origin") || "";
  const headers = {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "vary": "Origin",
  };
  if (allowed && origin === allowed) {
    headers["access-control-allow-origin"] = allowed;
    headers["access-control-allow-credentials"] = "true";
    headers["access-control-allow-methods"] = "GET,POST,OPTIONS";
    headers["access-control-allow-headers"] = "content-type";
  }
  return headers;
}

function json(data, status, env, request, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { ...corsHeaders(env, request), ...extraHeaders },
  });
}

function bytesToBase64(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value) {
  const binary = atob(value);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function randomToken(size = 32) {
  const bytes = crypto.getRandomValues(new Uint8Array(size));
  return bytesToBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function sha256(value) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

async function hashPassword(password, saltBytes) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: saltBytes, iterations: PBKDF2_ITERATIONS },
    key,
    256
  );
  return bytesToBase64(new Uint8Array(bits));
}

function constantTimeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

function getCookie(request, name) {
  const cookie = request.headers.get("Cookie") || "";
  const prefix = name + "=";
  const item = cookie.split(";").map((part) => part.trim()).find((part) => part.startsWith(prefix));
  return item ? item.slice(prefix.length) : null;
}

function sessionCookie(token, maxAge) {
  return `session=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAge}`;
}

function validEmail(email) {
  return typeof email === "string" && email.length <= 254 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

async function readJson(request) {
  const length = Number(request.headers.get("content-length") || 0);
  if (length > 10000) return null;
  const raw = await request.text();
  if (raw.length > 10000) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

function requireTrustedOrigin(request, env) {
  const expected = env.ALLOWED_ORIGIN;
  const origin = request.headers.get("Origin");
  return Boolean(expected && origin === expected);
}

async function createSession(db, userId) {
  const token = randomToken();
  const tokenHash = await sha256(token);
  const id = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86400000).toISOString();
  await db.prepare(
    "INSERT INTO sessions (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)"
  ).bind(id, userId, tokenHash, expiresAt).run();
  return token;
}

async function currentUser(request, db) {
  const token = getCookie(request, "session");
  if (!token) return null;
  const tokenHash = await sha256(token);
  const row = await db.prepare(
    "SELECT users.id, users.email, users.role FROM sessions JOIN users ON users.id = sessions.user_id WHERE sessions.token_hash = ? AND sessions.expires_at > ? LIMIT 1"
  ).bind(tokenHash, new Date().toISOString()).first();
  return row || null;
}

async function audit(db, adminId, action, targetId, details) {
  await db.prepare(
    "INSERT INTO admin_audit_log (id, admin_user_id, action, target_id, details_json) VALUES (?, ?, ?, ?, ?)"
  ).bind(crypto.randomUUID(), adminId, action, targetId || null, JSON.stringify(details || {})).run();
}

async function adminOverview(db) {
  const [users, orders, usage, services, pause] = await Promise.all([
    db.prepare("SELECT COUNT(*) AS total FROM users").first(),
    db.prepare("SELECT status, COUNT(*) AS total FROM orders GROUP BY status").all(),
    db.prepare("SELECT status, COUNT(*) AS total FROM usage_events GROUP BY status").all(),
    db.prepare("SELECT service_id, enabled, guest_free_uses, registered_free_uses, max_input_chars, max_output_tokens FROM service_settings ORDER BY service_id").all(),
    db.prepare("SELECT control_value FROM platform_controls WHERE control_key = 'global_ai_pause'").first(),
  ]);
  return {
    users: users?.total || 0,
    orders_by_status: orders?.results || [],
    usage_by_status: usage?.results || [],
    services: services?.results || [],
    global_ai_pause: pause?.control_value !== "false",
    generation_enabled: false,
    note: "AI generation remains disabled until quota reservation and cost controls are completed.",
  };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: { ...corsHeaders(env, request), "access-control-max-age": "86400" },
      });
    }

    if (url.pathname === "/api/health" && request.method === "GET") {
      return json({ ok: true, service: "ai-mini-business-api", mode: "foundation" }, 200, env, request);
    }

    if (url.pathname === "/api/services" && request.method === "GET") {
      if (!env.DB) return json({ error: "database_not_configured" }, 503, env, request);
      const rows = await env.DB.prepare(
        "SELECT service_id AS id, enabled FROM service_settings ORDER BY service_id"
      ).all();
      return json({ services: rows.results || [] }, 200, env, request);
    }

    if (url.pathname.startsWith("/api/auth/")) {
      if (!env.DB) return json({ error: "database_not_configured" }, 503, env, request);

      if (request.method === "POST" && !requireTrustedOrigin(request, env)) {
        return json({ error: "untrusted_origin" }, 403, env, request);
      }

      if (url.pathname === "/api/auth/register" && request.method === "POST") {
        const body = await readJson(request);
        const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
        const password = body?.password;
        if (!validEmail(email) || typeof password !== "string" || password.length < 12 || password.length > 128) {
          return json({ error: "invalid_input", message: "Email không hợp lệ; mật khẩu cần từ 12 đến 128 ký tự." }, 400, env, request);
        }

        const existing = await env.DB.prepare("SELECT id FROM users WHERE email = ? LIMIT 1").bind(email).first();
        if (existing) return json({ error: "account_exists" }, 409, env, request);

        const salt = crypto.getRandomValues(new Uint8Array(16));
        const passwordHash = await hashPassword(password, salt);
        const userId = crypto.randomUUID();
        try {
          await env.DB.prepare(
            "INSERT INTO users (id, email, password_hash, role) VALUES (?, ?, ?, 'customer')"
          ).bind(userId, email, `pbkdf2-sha256$${PBKDF2_ITERATIONS}$${bytesToBase64(salt)}$${passwordHash}`).run();
        } catch {
          return json({ error: "registration_failed" }, 400, env, request);
        }
        const token = await createSession(env.DB, userId);
        return json({ ok: true, user: { id: userId, email, role: "customer" } }, 201, env, request, {
          "set-cookie": sessionCookie(token, SESSION_DAYS * 86400),
        });
      }

      if (url.pathname === "/api/auth/login" && request.method === "POST") {
        const body = await readJson(request);
        const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
        const password = body?.password;
        if (!validEmail(email) || typeof password !== "string" || password.length > 128) {
          return json({ error: "invalid_credentials" }, 401, env, request);
        }
        const user = await env.DB.prepare(
          "SELECT id, email, role, password_hash FROM users WHERE email = ? LIMIT 1"
        ).bind(email).first();
        if (!user?.password_hash) return json({ error: "invalid_credentials" }, 401, env, request);

        const parts = user.password_hash.split("$");
        if (parts.length !== 4 || parts[0] !== "pbkdf2-sha256" || Number(parts[1]) !== PBKDF2_ITERATIONS) {
          return json({ error: "invalid_credentials" }, 401, env, request);
        }
        let matches = false;
        try {
          const calculated = await hashPassword(password, base64ToBytes(parts[2]));
          matches = constantTimeEqual(calculated, parts[3]);
        } catch { matches = false; }
        if (!matches) return json({ error: "invalid_credentials" }, 401, env, request);

        const token = await createSession(env.DB, user.id);
        return json({ ok: true, user: { id: user.id, email: user.email, role: user.role } }, 200, env, request, {
          "set-cookie": sessionCookie(token, SESSION_DAYS * 86400),
        });
      }

      if (url.pathname === "/api/auth/me" && request.method === "GET") {
        const user = await currentUser(request, env.DB);
        return user
          ? json({ user }, 200, env, request)
          : json({ error: "not_authenticated" }, 401, env, request);
      }

      if (url.pathname === "/api/auth/logout" && request.method === "POST") {
        const token = getCookie(request, "session");
        if (token) {
          await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(await sha256(token)).run();
        }
        return json({ ok: true }, 200, env, request, {
          "set-cookie": sessionCookie("", 0),
        });
      }
    }

    if (url.pathname.startsWith("/api/admin/")) {
      if (!env.DB) return json({ error: "database_not_configured" }, 503, env, request);
      if (request.method !== "GET" && !requireTrustedOrigin(request, env)) {
        return json({ error: "untrusted_origin" }, 403, env, request);
      }
      const user = await currentUser(request, env.DB);
      if (!user) return json({ error: "not_authenticated" }, 401, env, request);
      if (user.role !== "admin") return json({ error: "forbidden" }, 403, env, request);

      if (url.pathname === "/api/admin/overview" && request.method === "GET") {
        return json(await adminOverview(env.DB), 200, env, request);
      }

      if (url.pathname === "/api/admin/pause" && request.method === "POST") {
        const body = await readJson(request);
        if (typeof body?.paused !== "boolean") {
          return json({ error: "invalid_input", message: "paused phải là true hoặc false." }, 400, env, request);
        }
        await env.DB.prepare(
          "INSERT INTO platform_controls (control_key, control_value, updated_at) VALUES ('global_ai_pause', ?, CURRENT_TIMESTAMP) ON CONFLICT(control_key) DO UPDATE SET control_value = excluded.control_value, updated_at = CURRENT_TIMESTAMP"
        ).bind(String(body.paused)).run();
        await audit(env.DB, user.id, "global_ai_pause_changed", null, { paused: body.paused });
        return json({ ok: true, global_ai_pause: body.paused }, 200, env, request);
      }

      if (url.pathname === "/api/admin/service" && request.method === "POST") {
        const body = await readJson(request);
        const validIds = ["website", "video-prompts", "logo", "business-content", "documents"];
        if (!validIds.includes(body?.service_id) || typeof body?.enabled !== "boolean") {
          return json({ error: "invalid_input" }, 400, env, request);
        }
        await env.DB.prepare(
          "UPDATE service_settings SET enabled = ?, updated_at = CURRENT_TIMESTAMP WHERE service_id = ?"
        ).bind(body.enabled ? 1 : 0, body.service_id).run();
        await audit(env.DB, user.id, "service_enabled_changed", body.service_id, { enabled: body.enabled });
        return json({ ok: true, service_id: body.service_id, enabled: body.enabled }, 200, env, request);
      }

      if (url.pathname === "/api/admin/usage" && request.method === "GET") {
        const rows = await env.DB.prepare(
          "SELECT service_id, status, COUNT(*) AS requests, COALESCE(SUM(estimated_cost_units), 0) AS estimated_units, COALESCE(SUM(actual_cost_units), 0) AS actual_units FROM usage_events GROUP BY service_id, status ORDER BY service_id, status"
        ).all();
        return json({ usage: rows.results || [] }, 200, env, request);
      }

      return json({ error: "not_found" }, 404, env, request);
    }

    if (url.pathname === "/api/generate" && request.method === "POST") {
      return json({ error: "generation_disabled", message: "AI generation is not enabled yet." }, 503, env, request);
    }

    return json({ error: "not_found" }, 404, env, request);
  },
};
