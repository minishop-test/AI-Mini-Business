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

async function rateLimit(db, request, scope, identity, limit, windowSeconds) {
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const key = await sha256(scope + "|" + ip + "|" + (identity || ""));
  const now = Math.floor(Date.now() / 1000);
  const result = await db.prepare(
    "INSERT INTO api_rate_limits (rate_key, window_started_at, hits, updated_at) VALUES (?, ?, 1, CURRENT_TIMESTAMP) " +
    "ON CONFLICT(rate_key) DO UPDATE SET " +
    "hits = CASE WHEN window_started_at <= ? THEN 1 ELSE hits + 1 END, " +
    "window_started_at = CASE WHEN window_started_at <= ? THEN excluded.window_started_at ELSE window_started_at END, " +
    "updated_at = CURRENT_TIMESTAMP RETURNING hits"
  ).bind(key, now, now - windowSeconds, now - windowSeconds).first();
  return Number(result?.hits || 0) <= limit;
}

async function createEmailActionToken(db, userId, purpose, lifetimeMinutes) {
  const token = randomToken(32);
  const tokenHash = await sha256(token);
  const id = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + lifetimeMinutes * 60000).toISOString();
  await db.batch([
    db.prepare("UPDATE email_action_tokens SET used_at = CURRENT_TIMESTAMP WHERE user_id = ? AND purpose = ? AND used_at IS NULL").bind(userId, purpose),
    db.prepare("INSERT INTO email_action_tokens (id, user_id, token_hash, purpose, expires_at) VALUES (?, ?, ?, ?, ?)").bind(id, userId, tokenHash, purpose, expiresAt),
  ]);
  return token;
}

async function sendActionEmail(env, recipient, subject, actionUrl, intro) {
  if (!env.RESEND_API_KEY || !env.EMAIL_FROM) {
    throw new Error("email_provider_not_configured");
  }
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "authorization": "Bearer " + env.RESEND_API_KEY, "content-type": "application/json" },
    body: JSON.stringify({
      from: env.EMAIL_FROM,
      to: [recipient],
      subject,
      text: intro + "\\n\\n" + actionUrl + "\\n\\nNếu bạn không thực hiện yêu cầu này, hãy bỏ qua email.",
    }),
  });
  if (!response.ok) throw new Error("email_delivery_failed");
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

async function getQuotaSnapshot(db, userId) {
  const day = new Date().toISOString().slice(0, 10);
  const rows = await db.prepare(
    "SELECT s.service_id, s.enabled, s.registered_free_uses, s.max_input_chars, s.max_output_tokens, " +
    "(SELECT COUNT(*) FROM usage_events u WHERE u.user_id = ? AND u.service_id = s.service_id AND u.status IN ('reserved','completed') ) AS used " +
    "FROM service_settings s ORDER BY s.service_id"
  ).bind(userId).all();
  const controls = await db.prepare(
    "SELECT control_key, control_value FROM platform_controls WHERE control_key IN ('global_ai_pause','daily_budget_units')"
  ).all();
  const values = Object.fromEntries((controls.results || []).map(x => [x.control_key, x.control_value]));
  const budget = Math.max(0, Number(values.daily_budget_units || 0));
  const used = await db.prepare(
    "SELECT COALESCE(SUM(estimated_cost_units),0) AS units FROM usage_events WHERE created_at >= ? AND status IN ('reserved','completed')"
  ).bind(day + " 00:00:00").first();
  return {
    day_utc: day,
    global_ai_pause: values.global_ai_pause !== "false",
    daily_budget_units: budget,
    daily_used_units: Number(used?.units || 0),
    services: (rows.results || []).map(x => ({
      service_id: x.service_id,
      enabled: Boolean(x.enabled),
      free_limit: Number(x.registered_free_uses),
      used: Number(x.used),
      remaining: Math.max(0, Number(x.registered_free_uses) - Number(x.used)),
      max_input_chars: Number(x.max_input_chars),
      max_output_tokens: Number(x.max_output_tokens),
    })),
  };
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
      if (url.pathname === "/api/auth/register" && request.method === "POST" &&
          !(await rateLimit(env.DB, request, "register", "", 5, 900))) {
        return json({ error: "rate_limited", message: "Quá nhiều lần đăng ký từ kết nối này. Vui lòng thử lại sau 15 phút." }, 429, env, request, { "retry-after": "900" });
      }
      if (url.pathname === "/api/auth/login" && request.method === "POST" &&
          !(await rateLimit(env.DB, request, "login", "", 10, 900))) {
        return json({ error: "rate_limited", message: "Quá nhiều lần đăng nhập. Vui lòng thử lại sau 15 phút." }, 429, env, request, { "retry-after": "900" });
      }
      if (["/api/auth/resend-verification", "/api/auth/forgot-password"].includes(url.pathname) && request.method === "POST" &&
          !(await rateLimit(env.DB, request, "email-action", url.pathname, 3, 3600))) {
        return json({ error: "rate_limited", message: "Bạn đã yêu cầu quá nhiều email. Vui lòng thử lại sau một giờ." }, 429, env, request, { "retry-after": "3600" });
      }
      if (["/api/auth/verify-email", "/api/auth/reset-password"].includes(url.pathname) && request.method === "POST" &&
          !(await rateLimit(env.DB, request, "email-token", url.pathname, 10, 900))) {
        return json({ error: "rate_limited", message: "Quá nhiều lần thử. Vui lòng chờ 15 phút." }, 429, env, request, { "retry-after": "900" });
      }

      if (url.pathname === "/api/auth/register" && request.method === "POST") {
        const body = await readJson(request);
        const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
        const password = body?.password;
        if (!validEmail(email) || typeof password !== "string" || password.length < 12 || password.length > 128) {
          return json({ error: "invalid_input", message: "Email không hợp lệ; mật khẩu cần từ 12 đến 128 ký tự." }, 400, env, request);
        }
        const salt = crypto.getRandomValues(new Uint8Array(16));
        const passwordHash = await hashPassword(password, salt);
        const userId = crypto.randomUUID();
        try {
          await env.DB.prepare(
            "INSERT INTO users (id, email, password_hash, role) VALUES (?, ?, ?, 'customer')"
          ).bind(userId, email, `pbkdf2-sha256$${PBKDF2_ITERATIONS}$${bytesToBase64(salt)}$${passwordHash}`).run();
        } catch {
          return json({ error: "account_exists_or_registration_failed" }, 409, env, request);
        }
        try {
          const token = await createEmailActionToken(env.DB, userId, "verify_email", 60);
          const verifyUrl = new URL("/platform/customer/", env.PUBLIC_SITE_URL || env.ALLOWED_ORIGIN);
          verifyUrl.searchParams.set("verify", token);
          await sendActionEmail(env, email, "Xác minh email – AI Mini Business", verifyUrl.toString(), "Nhấn vào liên kết sau để xác minh email. Liên kết có hiệu lực trong 60 phút.");
        } catch {
          return json({ ok: true, verification_required: true, email_delivery_pending: true, message: "Tài khoản đã tạo. Chưa gửi được email xác minh; hãy dùng chức năng gửi lại email sau khi quản trị viên cấu hình dịch vụ email." }, 201, env, request);
        }
        return json({ ok: true, verification_required: true, message: "Tài khoản đã tạo. Vui lòng mở email để xác minh trước khi đăng nhập." }, 201, env, request);
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
        const verified = await env.DB.prepare("SELECT email_verified_at FROM users WHERE id = ?").bind(user.id).first();
        if (!verified?.email_verified_at) return json({ error: "email_not_verified", message: "Hãy xác minh email trước khi đăng nhập." }, 403, env, request);

        const token = await createSession(env.DB, user.id);
        return json({ ok: true, user: { id: user.id, email: user.email, role: user.role } }, 200, env, request, {
          "set-cookie": sessionCookie(token, SESSION_DAYS * 86400),
        });
      }

      if (url.pathname === "/api/auth/verify-email" && request.method === "POST") {
        const body = await readJson(request);
        if (typeof body?.token !== "string" || body.token.length < 20 || body.token.length > 200) {
          return json({ error: "invalid_or_expired_token" }, 400, env, request);
        }
        const tokenHash = await sha256(body.token);
        const action = await env.DB.prepare(
          "SELECT id, user_id FROM email_action_tokens WHERE token_hash = ? AND purpose = 'verify_email' AND used_at IS NULL AND expires_at > ? LIMIT 1"
        ).bind(tokenHash, new Date().toISOString()).first();
        if (!action) return json({ error: "invalid_or_expired_token" }, 400, env, request);
        const result = await env.DB.batch([
          env.DB.prepare("UPDATE users SET email_verified_at = CURRENT_TIMESTAMP WHERE id = ? AND email_verified_at IS NULL AND EXISTS (SELECT 1 FROM email_action_tokens WHERE id = ? AND used_at IS NULL AND expires_at > ?)").bind(action.user_id, action.id, new Date().toISOString()),
          env.DB.prepare("UPDATE email_action_tokens SET used_at = CURRENT_TIMESTAMP WHERE id = ? AND used_at IS NULL").bind(action.id),
        ]);
        if (!result[0]?.meta?.changes) return json({ error: "token_already_used" }, 409, env, request);
        return json({ ok: true, message: "Email đã được xác minh. Bạn có thể đăng nhập." }, 200, env, request);
      }

      if (url.pathname === "/api/auth/resend-verification" && request.method === "POST") {
        const body = await readJson(request);
        const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
        if (!validEmail(email)) return json({ error: "invalid_input" }, 400, env, request);
        const user = await env.DB.prepare("SELECT id, email, email_verified_at FROM users WHERE email = ? LIMIT 1").bind(email).first();
        if (user && !user.email_verified_at) {
          try {
            const token = await createEmailActionToken(env.DB, user.id, "verify_email", 60);
            const verifyUrl = new URL("/platform/customer/", env.PUBLIC_SITE_URL || env.ALLOWED_ORIGIN);
            verifyUrl.searchParams.set("verify", token);
            await sendActionEmail(env, email, "Xác minh email – AI Mini Business", verifyUrl.toString(), "Nhấn vào liên kết sau để xác minh email. Liên kết có hiệu lực trong 60 phút.");
          } catch {
            return json({ error: "email_delivery_unavailable" }, 503, env, request);
          }
        }
        return json({ ok: true, message: "Nếu email tồn tại và chưa xác minh, hướng dẫn sẽ được gửi." }, 200, env, request);
      }

      if (url.pathname === "/api/auth/forgot-password" && request.method === "POST") {
        const body = await readJson(request);
        const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
        if (!validEmail(email)) return json({ error: "invalid_input" }, 400, env, request);
        const user = await env.DB.prepare("SELECT id, email, email_verified_at FROM users WHERE email = ? LIMIT 1").bind(email).first();
        if (user?.email_verified_at) {
          try {
            const token = await createEmailActionToken(env.DB, user.id, "reset_password", 30);
            const resetUrl = new URL("/platform/customer/", env.PUBLIC_SITE_URL || env.ALLOWED_ORIGIN);
            resetUrl.searchParams.set("reset", token);
            await sendActionEmail(env, email, "Đặt lại mật khẩu – AI Mini Business", resetUrl.toString(), "Nhấn vào liên kết sau để đặt mật khẩu mới. Liên kết có hiệu lực trong 30 phút.");
          } catch {
            return json({ error: "email_delivery_unavailable" }, 503, env, request);
          }
        }
        return json({ ok: true, message: "Nếu tài khoản tồn tại và đã xác minh, hướng dẫn đặt lại mật khẩu sẽ được gửi." }, 200, env, request);
      }

      if (url.pathname === "/api/auth/reset-password" && request.method === "POST") {
        const body = await readJson(request);
        if (typeof body?.token !== "string" || body.token.length < 20 || body.token.length > 200 ||
            typeof body?.password !== "string" || body.password.length < 12 || body.password.length > 128) {
          return json({ error: "invalid_input", message: "Liên kết không hợp lệ hoặc mật khẩu chưa đủ 12 ký tự." }, 400, env, request);
        }
        const tokenHash = await sha256(body.token);
        const action = await env.DB.prepare(
          "SELECT id, user_id FROM email_action_tokens WHERE token_hash = ? AND purpose = 'reset_password' AND used_at IS NULL AND expires_at > ? LIMIT 1"
        ).bind(tokenHash, new Date().toISOString()).first();
        if (!action) return json({ error: "invalid_or_expired_token" }, 400, env, request);
        const salt = crypto.getRandomValues(new Uint8Array(16));
        const passwordHash = await hashPassword(body.password, salt);
        const result = await env.DB.batch([
          env.DB.prepare("UPDATE users SET password_hash = ? WHERE id = ? AND EXISTS (SELECT 1 FROM email_action_tokens WHERE id = ? AND used_at IS NULL AND expires_at > ?)").bind("pbkdf2-sha256$" + PBKDF2_ITERATIONS + "$" + bytesToBase64(salt) + "$" + passwordHash, action.user_id, action.id, new Date().toISOString()),
          env.DB.prepare("UPDATE email_action_tokens SET used_at = CURRENT_TIMESTAMP WHERE id = ? AND used_at IS NULL").bind(action.id),
          env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(action.user_id),
        ]);
        if (!result[0]?.meta?.changes) return json({ error: "token_already_used" }, 409, env, request);
        return json({ ok: true, message: "Mật khẩu đã được thay đổi. Hãy đăng nhập lại." }, 200, env, request);
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

    if (url.pathname === "/api/orders" && request.method === "POST") {
      if (!env.DB) return json({ error: "database_not_configured" }, 503, env, request);
      if (!requireTrustedOrigin(request, env)) return json({ error: "untrusted_origin" }, 403, env, request);
      const user = await currentUser(request, env.DB);
      if (!user) return json({ error: "not_authenticated" }, 401, env, request);
      if (!(await rateLimit(env.DB, request, "order-create", user.id, 10, 900))) {
        return json({ error: "rate_limited", message: "Bạn đã gửi quá nhiều yêu cầu. Vui lòng thử lại sau 15 phút." }, 429, env, request, { "retry-after": "900" });
      }
      const body = await readJson(request);
      const serviceId = body?.service_id;
      const allowedIds = ["website", "video-prompts", "logo", "business-content", "documents"];
      const brief = typeof body?.brief === "string" ? body.brief.trim() : "";
      if (!allowedIds.includes(serviceId) || brief.length < 10 || brief.length > 8000) {
        return json({ error: "invalid_order_input" }, 400, env, request);
      }
      const orderId = crypto.randomUUID();
      await env.DB.prepare(
        "INSERT INTO orders (id, user_id, service_id, status, customer_brief, amount_vnd) VALUES (?, ?, ?, 'pending_review', ?, 0)"
      ).bind(orderId, user.id, serviceId, brief).run();
      return json({ ok: true, order: { id: orderId, status: "pending_review", service_id: serviceId } }, 201, env, request);
    }

    if (url.pathname === "/api/orders/me" && request.method === "GET") {
      if (!env.DB) return json({ error: "database_not_configured" }, 503, env, request);
      const user = await currentUser(request, env.DB);
      if (!user) return json({ error: "not_authenticated" }, 401, env, request);
      const rows = await env.DB.prepare(
        "SELECT id, service_id, status, customer_brief, amount_vnd, payment_reference, admin_note, preview_text, delivery_url, created_at, updated_at FROM orders WHERE user_id = ? ORDER BY created_at DESC LIMIT 100"
      ).bind(user.id).all();
      return json({ orders: rows.results || [] }, 200, env, request);
    }

    if (url.pathname.startsWith("/api/quota/")) {
      if (!env.DB) return json({ error: "database_not_configured" }, 503, env, request);
      if (request.method === "POST" && !requireTrustedOrigin(request, env)) {
        return json({ error: "untrusted_origin" }, 403, env, request);
      }
      const user = await currentUser(request, env.DB);
      if (!user) return json({ error: "not_authenticated" }, 401, env, request);

      if (url.pathname === "/api/quota/me" && request.method === "GET") {
        return json(await getQuotaSnapshot(env.DB, user.id), 200, env, request);
      }

      if (url.pathname === "/api/quota/reserve" && request.method === "POST") {
        const body = await readJson(request);
        const serviceId = body?.service_id;
        const allowedIds = ["website", "video-prompts", "logo", "business-content", "documents"];
        if (!allowedIds.includes(serviceId)) return json({ error: "invalid_service" }, 400, env, request);

        const settings = await env.DB.prepare(
          "SELECT enabled, registered_free_uses, max_input_chars FROM service_settings WHERE service_id = ?"
        ).bind(serviceId).first();
        if (!settings || !settings.enabled) return json({ error: "service_unavailable" }, 403, env, request);
        const pause = await env.DB.prepare(
          "SELECT control_value FROM platform_controls WHERE control_key = 'global_ai_pause'"
        ).first();
        if (pause?.control_value !== "false") return json({ error: "global_ai_pause" }, 503, env, request);

        const brief = typeof body?.brief === "string" ? body.brief.trim() : "";
        if (!brief || brief.length > Number(settings.max_input_chars)) {
          return json({ error: "invalid_brief", max_input_chars: Number(settings.max_input_chars) }, 400, env, request);
        }

        const reservationId = crypto.randomUUID();
        const eventId = crypto.randomUUID();
        const day = new Date().toISOString().slice(0, 10);
        const fixedCostUnits = 1000;
        const reservationResults = await env.DB.batch([
          env.DB.prepare(
            "INSERT INTO usage_events (id, user_id, service_id, status, units, estimated_cost_units) " +
            "SELECT ?, ?, ?, 'reserved', 1, ? " +
            "WHERE (SELECT COUNT(*) FROM usage_events WHERE user_id = ? AND service_id = ? AND status IN ('reserved','completed')) < ? " +
            "AND (SELECT COALESCE(SUM(estimated_cost_units),0) FROM usage_events WHERE created_at >= ? AND status IN ('reserved','completed')) + ? <= " +
            "CAST(COALESCE((SELECT control_value FROM platform_controls WHERE control_key = 'daily_budget_units'), '0') AS INTEGER) " +
            "AND (SELECT control_value FROM platform_controls WHERE control_key = 'global_ai_pause') = 'false' " +
            "AND (SELECT enabled FROM service_settings WHERE service_id = ?) = 1"
          ).bind(eventId, user.id, serviceId, fixedCostUnits, user.id, serviceId, Number(settings.registered_free_uses), day + " 00:00:00", fixedCostUnits, serviceId),
          env.DB.prepare(
            "INSERT INTO quota_reservations (id, usage_event_id, user_id, service_id, reserved_units, reservation_date_utc, status) " +
            "SELECT ?, ?, ?, ?, 1, ?, 'reserved' WHERE EXISTS (SELECT 1 FROM usage_events WHERE id = ? AND status = 'reserved')"
          ).bind(reservationId, eventId, user.id, serviceId, day, eventId),
        ]);
        const result = reservationResults[0];

        if (!result?.meta?.changes) {
          const snapshot = await getQuotaSnapshot(env.DB, user.id);
          const target = snapshot.services.find(x => x.service_id === serviceId);
          if (target && target.remaining <= 0) return json({ error: "free_quota_exhausted", quota: target }, 429, env, request);
          return json({ error: "daily_budget_or_pause", quota: snapshot }, 429, env, request);
        }

        return json({
          ok: true,
          reservation_id: reservationId,
          message: "Đã giữ một lượt miễn phí. Tác vụ AI chưa chạy cho đến khi quy trình tạo sản phẩm được triển khai.",
          generation_started: false,
        }, 201, env, request);
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

      if (url.pathname === "/api/admin/customers" && request.method === "GET") {
        const rows = await env.DB.prepare(
          "SELECT u.id, u.email, u.role, u.created_at, (SELECT COUNT(*) FROM orders o WHERE o.user_id = u.id) AS order_count, (SELECT COUNT(*) FROM usage_events e WHERE e.user_id = u.id) AS usage_count FROM users u ORDER BY u.created_at DESC LIMIT 100"
        ).all();
        return json({ customers: rows.results || [] }, 200, env, request);
      }

      if (url.pathname === "/api/admin/orders" && request.method === "GET") {
        const status = url.searchParams.get("status");
        const validStatuses = ["pending_review", "awaiting_payment", "paid", "processing", "delivered", "cancelled"];
        if (status && !validStatuses.includes(status)) return json({ error: "invalid_status_filter" }, 400, env, request);
        const rows = status
          ? await env.DB.prepare(
              "SELECT o.*, u.email AS customer_email FROM orders o LEFT JOIN users u ON u.id = o.user_id WHERE o.status = ? ORDER BY o.created_at DESC LIMIT 100"
            ).bind(status).all()
          : await env.DB.prepare(
              "SELECT o.*, u.email AS customer_email FROM orders o LEFT JOIN users u ON u.id = o.user_id ORDER BY o.created_at DESC LIMIT 100"
            ).all();
        return json({ orders: rows.results || [] }, 200, env, request);
      }

      if (url.pathname === "/api/admin/order" && request.method === "POST") {
        const body = await readJson(request);
        const orderId = body?.order_id;
        const nextStatus = body?.status;
        const validStatuses = ["pending_review", "awaiting_payment", "paid", "processing", "delivered", "cancelled"];
        if (typeof orderId !== "string" || !validStatuses.includes(nextStatus)) {
          return json({ error: "invalid_input" }, 400, env, request);
        }
        const existing = await env.DB.prepare(
          "SELECT id, status, delivery_url FROM orders WHERE id = ? LIMIT 1"
        ).bind(orderId).first();
        if (!existing) return json({ error: "order_not_found" }, 404, env, request);
        const transitions = {
          pending_review: ["awaiting_payment", "cancelled"],
          awaiting_payment: ["paid", "cancelled"],
          paid: ["processing", "cancelled"],
          processing: ["delivered"],
          delivered: [],
          cancelled: [],
        };
        if (!transitions[existing.status]?.includes(nextStatus)) {
          return json({ error: "invalid_status_transition", current_status: existing.status }, 409, env, request);
        }
        const amount = body.amount_vnd;
        if (nextStatus === "awaiting_payment" && (!Number.isSafeInteger(amount) || amount < 0 || amount > 1000000000)) {
          return json({ error: "valid_amount_required" }, 400, env, request);
        }
        if (body.preview_text !== undefined && (typeof body.preview_text !== "string" || body.preview_text.length > 30000)) {
          return json({ error: "preview_too_long" }, 400, env, request);
        }
        if (body.admin_note !== undefined && (typeof body.admin_note !== "string" || body.admin_note.length > 3000)) {
          return json({ error: "admin_note_too_long" }, 400, env, request);
        }
        if (body.delivery_url !== undefined && (typeof body.delivery_url !== "string" || body.delivery_url.length > 2000 || (body.delivery_url && !/^https:\/\//i.test(body.delivery_url)))) {
          return json({ error: "invalid_delivery_url" }, 400, env, request);
        }
        if (nextStatus === "delivered" && !(body.delivery_url || existing.delivery_url)) {
          return json({ error: "delivery_url_required", message: "Cần có đường dẫn HTTPS trước khi đánh dấu đã bàn giao." }, 400, env, request);
        }
        const paymentReference = typeof body.payment_reference === "string" ? body.payment_reference.slice(0, 200) : null;
        const updateResult = await env.DB.prepare(
          "UPDATE orders SET status = ?, amount_vnd = CASE WHEN ? = 'awaiting_payment' THEN ? ELSE amount_vnd END, " +
          "preview_text = COALESCE(?, preview_text), admin_note = COALESCE(?, admin_note), " +
          "delivery_url = COALESCE(?, delivery_url), payment_reference = COALESCE(?, payment_reference), " +
          "reviewed_at = CASE WHEN ? = 'awaiting_payment' THEN CURRENT_TIMESTAMP ELSE reviewed_at END, " +
          "paid_at = CASE WHEN ? = 'paid' THEN CURRENT_TIMESTAMP ELSE paid_at END, " +
          "delivered_at = CASE WHEN ? = 'delivered' THEN CURRENT_TIMESTAMP ELSE delivered_at END, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = ?"
        ).bind(nextStatus, nextStatus, amount ?? null, body.preview_text ?? null, body.admin_note ?? null, body.delivery_url ?? null, paymentReference, nextStatus, nextStatus, nextStatus, orderId, existing.status).run();
        if (!updateResult.meta?.changes) {
          return json({ error: "order_changed_retry", message: "Đơn hàng vừa được cập nhật ở thao tác khác. Hãy tải lại đơn." }, 409, env, request);
        }
        await audit(env.DB, user.id, "order_status_changed", orderId, { from: existing.status, to: nextStatus });
        return json({ ok: true, order_id: orderId, status: nextStatus }, 200, env, request);
      }

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

      if (url.pathname === "/api/admin/reservation" && request.method === "POST") {
        const body = await readJson(request);
        if (typeof body?.reservation_id !== "string" || !["complete", "release"].includes(body?.action)) {
          return json({ error: "invalid_input" }, 400, env, request);
        }
        const reservation = await env.DB.prepare(
          "SELECT id, usage_event_id, status FROM quota_reservations WHERE id = ? LIMIT 1"
        ).bind(body.reservation_id).first();
        if (!reservation || reservation.status !== "reserved") {
          return json({ error: "reservation_not_found_or_closed" }, 404, env, request);
        }
        const nextStatus = body.action === "complete" ? "completed" : "refunded";
        await env.DB.batch([
          env.DB.prepare(
            "UPDATE quota_reservations SET status = ?, settled_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'reserved'"
          ).bind(body.action === "complete" ? "settled" : "released", reservation.id),
          env.DB.prepare(
            "UPDATE usage_events SET status = ?, completed_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'reserved'"
          ).bind(nextStatus, reservation.usage_event_id),
        ]);
        await audit(env.DB, user.id, "quota_reservation_" + body.action, reservation.id, {});
        return json({ ok: true, reservation_id: reservation.id, status: nextStatus }, 200, env, request);
      }

      return json({ error: "not_found" }, 404, env, request);
    }

    if (url.pathname === "/api/generate" && request.method === "POST") {
      return json({ error: "generation_disabled", message: "AI generation is not enabled yet." }, 503, env, request);
    }

    return json({ error: "not_found" }, 404, env, request);
  },
};
