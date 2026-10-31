import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { zipSync, strToU8 } from "fflate";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
function option(name, fallback = "") {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] || fallback : fallback;
}
function safeText(value, fallback, max) {
  if (typeof value !== "string") return fallback;
  const clean = value.trim();
  return clean && clean.length <= max ? clean : fallback;
}
function safeColor(value) {
  return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value) ? value : "#2563eb";
}
function sqlText(value) { return "'" + String(value).replace(/'/g, "''") + "'"; }

const apiUrl = option("--api-url", "https://REPLACE-WITH-YOUR-WORKER.workers.dev").replace(/\/$/, "");
const pagesOrigin = option("--pages-origin", "https://REPLACE-WITH-YOUR-PAGES-DOMAIN.pages.dev").replace(/\/$/, "");
const configPath = option("--config");
const output = path.resolve(option("--output", path.join(ROOT, "dist", "customer-store.zip")));
let config = {};
if (configPath) config = JSON.parse(await readFile(path.resolve(configPath), "utf8"));
const storeName = safeText(config.storeName, "Cửa hàng của tôi", 80);
const tagline = safeText(config.tagline, "Sản phẩm và dịch vụ", 160);
const primaryColor = safeColor(config.primaryColor);
const products = Array.isArray(config.products) ? config.products.slice(0, 30).map((p) => ({
  name: safeText(p?.name, "", 120),
  description: safeText(p?.description, "", 1000),
  priceVnd: Number.isSafeInteger(p?.priceVnd) && p.priceVnd >= 0 && p.priceVnd <= 1000000000 ? p.priceVnd : null,
  imageUrl: typeof p?.imageUrl === "string" && /^https:\/\//i.test(p.imageUrl) && p.imageUrl.length <= 2000 ? p.imageUrl : null,
})).filter(p => p.name && p.priceVnd !== null) : [];
const files = [
  "README.md", "package.json", "wrangler.toml", "schema.sql",
  "src/index.js", "site/index.html", "site/admin.html"
];
const archive = {};
for (const relative of files) {
  let content = await readFile(path.join(ROOT, relative), "utf8");
  if (relative === "site/index.html") {
    content = content.replace("<title>Cửa hàng của tôi</title>", "<title>" + storeName.replace(/[<&>]/g, "") + "</title>");
    content = content.replace('<h1 id="storeName">Cửa hàng của tôi</h1>', '<h1 id="storeName">' + storeName.replace(/[<&>]/g, "") + '</h1>');
    content = content.replace('<p class="muted" id="storeTagline" style="color:#cbd5e1">Sản phẩm và dịch vụ</p>', '<p class="muted" id="storeTagline" style="color:#cbd5e1">' + tagline.replace(/[<&>]/g, "") + '</p>');
    content = content.replace("background:#2563eb", "background:" + primaryColor);
    content = content.replaceAll("https://REPLACE-WITH-YOUR-WORKER.workers.dev", apiUrl);
  }
  if (relative === "site/admin.html") {
    content = content.replaceAll("https://REPLACE-WITH-YOUR-WORKER.workers.dev", apiUrl);
  }
  if (relative === "wrangler.toml") {
    content = content.replace("https://REPLACE-WITH-YOUR-PAGES-DOMAIN.pages.dev", pagesOrigin);
  }
  archive["customer-store/" + relative] = strToU8(content);
}
const seed = products.length
  ? "INSERT INTO products (id,name,description,price_vnd,image_url,active) VALUES\n" +
    products.map(p => "(" + sqlText(crypto.randomUUID()) + "," + sqlText(p.name) + "," + sqlText(p.description) + "," + p.priceVnd + "," + (p.imageUrl ? sqlText(p.imageUrl) : "NULL") + ",1)").join(",\n") + ";\n"
  : "-- No sample products supplied. Add products from admin.html after deployment.\n";
archive["customer-store/seed-products.sql"] = strToU8(seed);
archive["customer-store/store-config.json"] = strToU8(JSON.stringify({ storeName, tagline, primaryColor, productCount: products.length }, null, 2) + "\n");
const zip = zipSync(archive, { level: 6 });
await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, zip);
console.log("Created " + output);
console.log("Included " + Object.keys(archive).length + " files; seeded " + products.length + " products.");
console.log("ZIP bytes: " + zip.byteLength);
if (apiUrl.includes("REPLACE-WITH") || pagesOrigin.includes("REPLACE-WITH")) {
  console.warn("Reminder: replace the placeholder API URL or Pages origin before deployment.");
}
