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

function isAdmin(request, env) {
  const expected = env.ADMIN_API_TOKEN || "";
  const supplied = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!expected || supplied.length !== expected.length) return false;
  let mismatch = 0;
  for (let i = 0; i < expected.length; i++) mismatch |= expected.charCodeAt(i) ^ supplied.charCodeAt(i);
  return mismatch === 0;
}

function id() { return crypto.randomUUID(); }

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
            typeof (data.customer_phone || "") !== "string" || (data.customer_phone || "").length > 30 ||
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
          "INSERT INTO orders (id,customer_name,customer_email,customer_phone,product_id,product_name_snapshot,unit_price_vnd,quantity,total_vnd,note) VALUES (?,?,?,?,?,?,?,?,?,?)"
        ).bind(orderId,data.customer_name.trim(),data.customer_email.trim().toLowerCase(),(data.customer_phone||"").trim(),product.id,product.name,product.price_vnd,data.quantity,total,(data.note||"").trim()).run();
        return json({ ok: true, order: { id: orderId, total_vnd: total, status: "new" } }, 201, request, env);
      }

      if (url.pathname === "/api/admin/products" && request.method === "GET") {
        if (!isAdmin(request, env)) return json({ error: "unauthorized" }, 401, request, env);
        const rows = await env.DB.prepare(
          "SELECT id,name,description,price_vnd,image_url,active,created_at FROM products ORDER BY created_at DESC LIMIT 200"
        ).all();
        return json({ products: rows.results || [] }, 200, request, env);
      }

      if (url.pathname === "/api/admin/orders" && request.method === "GET") {
        if (!isAdmin(request, env)) return json({ error: "unauthorized" }, 401, request, env);
        const rows = await env.DB.prepare(
          "SELECT id,customer_name,customer_email,customer_phone,product_name_snapshot,unit_price_vnd,quantity,total_vnd,note,status,created_at FROM orders ORDER BY created_at DESC LIMIT 200"
        ).all();
        return json({ orders: rows.results || [] }, 200, request, env);
      }

      if (url.pathname === "/api/admin/products" && request.method === "POST") {
        if (!isAdmin(request, env)) return json({ error: "unauthorized" }, 401, request, env);
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
        return json({ ok: true, product_id: productId }, 201, request, env);
      }

      const productMatch = url.pathname.match(/^\/api\/admin\/products\/([0-9a-f-]{36})$/i);
      if (productMatch && request.method === "PATCH") {
        if (!isAdmin(request, env)) return json({ error: "unauthorized" }, 401, request, env);
        const data = await bodyJson(request, 1000);
        if (!data || typeof data.active !== "boolean") return json({ error: "invalid_product_status" }, 400, request, env);
        const result = await env.DB.prepare("UPDATE products SET active=? WHERE id=?").bind(data.active ? 1 : 0, productMatch[1]).run();
        if (!result.meta?.changes) return json({ error: "product_not_found" }, 404, request, env);
        return json({ ok: true, active: data.active }, 200, request, env);
      }

      const statusMatch = url.pathname.match(/^\/api\/admin\/orders\/([0-9a-f-]{36})$/i);
      if (statusMatch && request.method === "PATCH") {
        if (!isAdmin(request, env)) return json({ error: "unauthorized" }, 401, request, env);
        const data = await bodyJson(request, 1000);
        const allowed = ["new","confirmed","completed","cancelled"];
        if (!data || !allowed.includes(data.status)) return json({ error: "invalid_status" }, 400, request, env);
        const result = await env.DB.prepare("UPDATE orders SET status=? WHERE id=?").bind(data.status,statusMatch[1]).run();
        if (!result.meta?.changes) return json({ error: "order_not_found" }, 404, request, env);
        return json({ ok: true, status: data.status }, 200, request, env);
      }

      return json({ error: "not_found" }, 404, request, env);
    } catch {
      return json({ error: "internal_error" }, 500, request, env);
    }
  },
};
