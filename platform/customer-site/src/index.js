const encoder = new TextEncoder();

function json(data, status, request, env, extra = {}) {
  const origin = request.headers.get("Origin") || "";
  const headers = {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "vary": "Origin",
  };
  if (origin && origin === env.ALLOWED_ORIGIN) {
    headers["access-control-allow-origin"] = origin;
    headers["access-control-allow-methods"] = "GET,POST,PATCH,OPTIONS";
    headers["access-control-allow-headers"] = "content-type,authorization";
  }
  return new Response(JSON.stringify(data), { status, headers: { ...headers, ...extra } });
}

function trusted(request, env) {
  return Boolean(env.ALLOWED_ORIGIN && request.headers.get("Origin") === env.ALLOWED_ORIGIN);
}

async function bodyJson(request, max = 6000) {
  const text = await request.text();
  if (text.length > max) return null;
  try { return JSON.parse(text); } catch { return null; }
}

function validEmail(value) {
  return typeof value === "string" && value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

async function hashSessionToken(token) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(token));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

async function isAdmin(request, env) {
  const token = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!/^[a-f0-9]{64}$/i.test(token)) return false;
  const tokenHash = await hashSessionToken(token);
  const session = await env.DB.prepare(
    "SELECT token_hash FROM admin_sessions WHERE token_hash=? AND expires_at > CURRENT_TIMESTAMP"
  ).bind(tokenHash).first();
  return Boolean(session);
}

function id() { return crypto.randomUUID(); }

async function writeAudit(env, action, entityType, entityId, details = {}) {
  await env.DB.prepare(
    "INSERT INTO admin_audit_log (id,actor,action,entity_type,entity_id,details_json) VALUES (?,?,?,?,?,?)"
  ).bind(id(), "admin", action, entityType, entityId, JSON.stringify(details)).run();
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") {
      if (!trusted(request, env)) return new Response(null, { status: 403 });
      return new Response(null, { status: 204, headers: {
        "access-control-allow-origin": env.ALLOWED_ORIGIN,
        "access-control-allow-methods": "GET,POST,PATCH,OPTIONS",
        "access-control-allow-headers": "content-type,authorization",
        "access-control-max-age": "86400",
        "vary": "Origin",
      }});
    }
    if (!env.DB) return json({ error: "database_not_configured" }, 503, request, env);
    if (request.method !== "GET" && !trusted(request, env)) {
      return json({ error: "untrusted_origin" }, 403, request, env);
    }

    try {
      if (url.pathname === "/api/health" && request.method === "GET") {
        return json({ ok: true }, 200, request, env);
      }

      if (url.pathname === "/api/products" && request.method === "GET") {
        const rows = await env.DB.prepare(
          "SELECT id,name,description,price_vnd,image_url FROM products WHERE active=1 ORDER BY created_at DESC LIMIT 100"
        ).all();
        return json({ products: rows.results || [] }, 200, request, env);
      }

      if (url.pathname === "/api/orders" && request.method === "POST") {
        const data = await bodyJson(request);
        if (!data || typeof data.customer_name !== "string" || data.customer_name.trim().length < 1 ||
            data.customer_name.length > 120 || !validEmail(data.customer_email) ||
            typeof data.product_id !== "string" || !Number.isSafeInteger(data.quantity) ||
            data.quantity < 1 || data.quantity > 20 ||
            typeof (data.note || "") !== "string" || (data.note || "").length > 1000) {
          return json({ error: "invalid_order" }, 400, request, env);
        }
        const product = await env.DB.prepare(
          "SELECT id,name,price_vnd FROM products WHERE id=? AND active=1"
        ).bind(data.product_id).first();
        if (!product) return json({ error: "product_not_found" }, 404, request, env);
        const total = Number(product.price_vnd) * data.quantity;
        if (!Number.isSafeInteger(total) || total > 100000000000) return json({ error: "invalid_total" }, 400, request, env);
        const orderId = id();
        await env.DB.prepare(
          "INSERT INTO orders (id,customer_name,customer_email,product_id,product_name_snapshot,unit_price_vnd,quantity,total_vnd,note) VALUES (?,?,?,?,?,?,?,?,?)"
        ).bind(orderId,data.customer_name.trim(),data.customer_email.trim().toLowerCase(),product.id,product.name,product.price_vnd,data.quantity,total,(data.note||"").trim()).run();
        return json({ ok: true, order: { id: orderId, total_vnd: total, status: "new" } }, 201, request, env);
      }

      if (url.pathname === "/api/admin/login" && request.method === "POST") {
        const data = await bodyJson(request, 1000);
        const clientIp = request.headers.get("CF-Connecting-IP") || "unknown";
        const ipHash = await hashSessionToken("login:" + clientIp);
        const attempts = await env.DB.prepare("SELECT attempts, window_started FROM admin_login_attempts WHERE ip_hash=?").bind(ipHash).first();
        const windowActive = attempts && (Date.now() - Date.parse(attempts.window_started + " UTC")) < 15 * 60 * 1000;
        if (windowActive && attempts.attempts >= 5) return json({ error: "login_rate_limited", message: "Quá nhiều lần đăng nhập sai. Vui lòng thử lại sau 15 phút." }, 429, request, env);
        if (windowActive) {
          await env.DB.prepare("UPDATE admin_login_attempts SET attempts=attempts+1 WHERE ip_hash=?").bind(ipHash).run();
        } else {
          await env.DB.prepare("INSERT INTO admin_login_attempts (ip_hash,attempts,window_started) VALUES (?,1,CURRENT_TIMESTAMP) ON CONFLICT(ip_hash) DO UPDATE SET attempts=1,window_started=CURRENT_TIMESTAMP").bind(ipHash).run();
        }
        const expected = env.ADMIN_API_TOKEN || "";
        const supplied = typeof data?.token === "string" ? data.token : "";
        if (!expected || !supplied || supplied.length > 256) return json({ error: "unauthorized" }, 401, request, env);
        let mismatch = supplied.length ^ expected.length;
        const length = Math.max(supplied.length, expected.length);
        for (let i = 0; i < length; i++) mismatch |= (supplied.charCodeAt(i) || 0) ^ (expected.charCodeAt(i) || 0);
        if (mismatch !== 0) return json({ error: "unauthorized" }, 401, request, env);
        await env.DB.prepare("DELETE FROM admin_login_attempts WHERE ip_hash=?").bind(ipHash).run();
        const sessionToken = [...crypto.getRandomValues(new Uint8Array(32))].map(byte => byte.toString(16).padStart(2, "0")).join("");
        const tokenHash = await hashSessionToken(sessionToken);
        await env.DB.prepare("INSERT INTO admin_sessions (token_hash, expires_at) VALUES (?, datetime('now','+30 minutes'))").bind(tokenHash).run();
        return json({ ok: true, session_token: sessionToken, expires_in: 1800 }, 200, request, env);
      }

      if (url.pathname === "/api/admin/logout" && request.method === "POST") {
        const token = (request.headers.get("Authorization") || "").replace(/^Bearer\\s+/i, "");
        if (/^[a-f0-9]{64}$/i.test(token)) {
          await env.DB.prepare("DELETE FROM admin_sessions WHERE token_hash=?").bind(await hashSessionToken(token)).run();
        }
        return json({ ok: true }, 200, request, env);
      }

      if (url.pathname === "/api/admin/products" && request.method === "GET") {
        if (!(await isAdmin(request, env))) return json({ error: "unauthorized" }, 401, request, env);
        const rows = await env.DB.prepare(
          "SELECT id,name,description,price_vnd,image_url,active,created_at FROM products ORDER BY created_at DESC LIMIT 200"
        ).all();
        return json({ products: rows.results || [] }, 200, request, env);
      }

      if (url.pathname === "/api/admin/orders" && request.method === "GET") {
        if (!(await isAdmin(request, env))) return json({ error: "unauthorized" }, 401, request, env);
        const rows = await env.DB.prepare(
          "SELECT id,customer_name,customer_email,product_name_snapshot,unit_price_vnd,quantity,total_vnd,note,status,payment_status,delivery_status,created_at FROM orders ORDER BY created_at DESC LIMIT 200"
        ).all();
        return json({ orders: rows.results || [] }, 200, request, env);
      }

      if (url.pathname === "/api/admin/audit-log" && request.method === "GET") {
        if (!(await isAdmin(request, env))) return json({ error: "unauthorized" }, 401, request, env);
        const rows = await env.DB.prepare(
          "SELECT id,actor,action,entity_type,entity_id,details_json,created_at FROM admin_audit_log ORDER BY created_at DESC LIMIT 100"
        ).all();
        return json({ entries: rows.results || [] }, 200, request, env);
      }

      if (url.pathname === "/api/admin/products" && request.method === "POST") {
        if (!(await isAdmin(request, env))) return json({ error: "unauthorized" }, 401, request, env);
        const data = await bodyJson(request);
        if (!data || typeof data.name !== "string" || data.name.trim().length < 1 || data.name.length > 160 ||
            typeof (data.description || "") !== "string" || (data.description || "").length > 3000 ||
            !Number.isSafeInteger(data.price_vnd) || data.price_vnd < 0 || data.price_vnd > 100000000000 ||
            (data.image_url && (typeof data.image_url !== "string" || !/^https:\/\//i.test(data.image_url)))) {
          return json({ error: "invalid_product" }, 400, request, env);
        }
        const productId = id();
        await env.DB.prepare(
          "INSERT INTO products (id,name,description,price_vnd,image_url) VALUES (?,?,?,?,?)"
        ).bind(productId,data.name.trim(),(data.description||"").trim(),data.price_vnd,data.image_url||null).run();
        await writeAudit(env, "product.created", "product", productId, { name: data.name.trim(), price_vnd: data.price_vnd });
        return json({ ok: true, product_id: productId }, 201, request, env);
      }

      const productMatch = url.pathname.match(/^\/api\/admin\/products\/([0-9a-f-]{36})$/i);
      if (productMatch && request.method === "PATCH") {
        if (!(await isAdmin(request, env))) return json({ error: "unauthorized" }, 401, request, env);
        const data = await bodyJson(request, 5000);
        if (!data || typeof data !== "object" || Array.isArray(data)) return json({ error: "invalid_product" }, 400, request, env);
        const current = await env.DB.prepare("SELECT id,name,description,price_vnd,image_url,active FROM products WHERE id=?").bind(productMatch[1]).first();
        if (!current) return json({ error: "product_not_found" }, 404, request, env);
        const next = { name: current.name, description: current.description || "", price_vnd: current.price_vnd, image_url: current.image_url, active: current.active === 1 };
        if ("name" in data) { if (typeof data.name !== "string" || !data.name.trim() || data.name.length > 160) return json({ error: "invalid_product_name" }, 400, request, env); next.name = data.name.trim(); }
        if ("description" in data) { if (typeof data.description !== "string" || data.description.length > 3000) return json({ error: "invalid_product_description" }, 400, request, env); next.description = data.description.trim(); }
        if ("price_vnd" in data) { if (!Number.isSafeInteger(data.price_vnd) || data.price_vnd < 0 || data.price_vnd > 100000000000) return json({ error: "invalid_product_price" }, 400, request, env); next.price_vnd = data.price_vnd; }
        if ("image_url" in data) { if (data.image_url !== null && (typeof data.image_url !== "string" || data.image_url.length > 2000 || !/^https:\/\//i.test(data.image_url))) return json({ error: "invalid_product_image" }, 400, request, env); next.image_url = data.image_url || null; }
        if ("active" in data) { if (typeof data.active !== "boolean") return json({ error: "invalid_product_status" }, 400, request, env); next.active = data.active; }
        await env.DB.prepare("UPDATE products SET name=?,description=?,price_vnd=?,image_url=?,active=? WHERE id=?").bind(next.name,next.description,next.price_vnd,next.image_url,next.active?1:0,productMatch[1]).run();
        await writeAudit(env, "product.updated", "product", productMatch[1], { fields: Object.keys(data) });
        return json({ ok: true, product: next }, 200, request, env);
      }

      const statusMatch = url.pathname.match(/^\/api\/admin\/orders\/([0-9a-f-]{36})$/i);
      if (statusMatch && request.method === "PATCH") {
        if (!(await isAdmin(request, env))) return json({ error: "unauthorized" }, 401, request, env);
        const data = await bodyJson(request, 1000);
        if (!data || typeof data !== "object" || Array.isArray(data)) return json({ error: "invalid_order_update" }, 400, request, env);
        const current = await env.DB.prepare("SELECT id,payment_status,delivery_status FROM orders WHERE id=?").bind(statusMatch[1]).first();
        if (!current) return json({ error: "order_not_found" }, 404, request, env);
        const payment = data.payment_status ?? current.payment_status ?? "pending";
        const delivery = data.delivery_status ?? current.delivery_status ?? "pending";
        if (!["pending","paid","refunded"].includes(payment)) return json({ error: "invalid_payment_status" }, 400, request, env);
        if (!["pending","delivered"].includes(delivery)) return json({ error: "invalid_delivery_status" }, 400, request, env);
        if (delivery === "delivered" && payment !== "paid") return json({ error: "payment_required_before_delivery" }, 409, request, env);
        const result = await env.DB.prepare("UPDATE orders SET payment_status=?,delivery_status=?,status=CASE WHEN ?='delivered' THEN 'completed' ELSE status END WHERE id=?")
          .bind(payment,delivery,delivery,statusMatch[1]).run();
        if (!result.meta?.changes) return json({ error: "order_not_found" }, 404, request, env);
        await writeAudit(env, "order.payment_delivery_updated", "order", statusMatch[1], { payment_status: payment, delivery_status: delivery });
        return json({ ok: true, payment_status: payment, delivery_status: delivery }, 200, request, env);
      }

      return json({ error: "not_found" }, 404, request, env);
    } catch {
      return json({ error: "internal_error" }, 500, request, env);
    }
  },
};
