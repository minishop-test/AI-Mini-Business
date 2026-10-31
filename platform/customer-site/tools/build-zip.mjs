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
const apiUrl = option("--api-url", "https://REPLACE-WITH-YOUR-WORKER.workers.dev").replace(/\/$/, "");
const pagesOrigin = option("--pages-origin", "https://REPLACE-WITH-YOUR-PAGES-DOMAIN.pages.dev").replace(/\/$/, "");
const output = path.resolve(option("--output", path.join(ROOT, "dist", "customer-store.zip")));
const files = [
  "README.md", "package.json", "wrangler.toml", "schema.sql",
  "src/index.js", "site/index.html", "site/admin.html"
];
const archive = {};
for (const relative of files) {
  let content = await readFile(path.join(ROOT, relative), "utf8");
  if (relative === "site/index.html" || relative === "site/admin.html") {
    content = content.replaceAll("https://REPLACE-WITH-YOUR-WORKER.workers.dev", apiUrl);
  }
  if (relative === "wrangler.toml") {
    content = content.replace("https://REPLACE-WITH-YOUR-PAGES-DOMAIN.pages.dev", pagesOrigin);
  }
  archive["customer-store/" + relative] = strToU8(content);
}
const zip = zipSync(archive, { level: 6 });
await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, zip);
console.log("Created " + output);
console.log("Included " + files.length + " project files.");
console.log("ZIP bytes: " + zip.byteLength);
if (apiUrl.includes("REPLACE-WITH") || pagesOrigin.includes("REPLACE-WITH")) {
  console.warn("Reminder: replace the placeholder API URL or Pages origin before deployment.");
}
