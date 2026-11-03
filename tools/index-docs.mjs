/**
 * Build (or rebuild) the Azure AI Search index that powers the app's dynamic help, from the
 * MkDocs documentation in the pottery-wheel-docs repo.
 *
 * It (1) creates the index with a suggester if missing, (2) reads every docs/**­/*.md, splits each
 * page into chunks by heading, strips MkDocs-only syntax to readable text, and (3) uploads the
 * chunks. Re-running replaces documents (merge-or-upload) and deletes chunks that no longer exist.
 *
 * Usage:
 *   SEARCH_ENDPOINT=https://<svc>.search.windows.net \
 *   SEARCH_ADMIN_KEY=<admin key> \
 *   DOCS_DIR=../pottery-wheel-docs/docs \
 *   [SEARCH_INDEX=pottery-docs] [DOCS_BASE_URL=https://dromidror.github.io/pottery-wheel-docs/] \
 *   node tools/index-docs.mjs
 *
 * Needs an ADMIN key (create/upload), unlike the function which uses a query key.
 */
import { readdir, readFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { createHash } from "node:crypto";

const endpoint = (process.env.SEARCH_ENDPOINT || "").replace(/\/+$/, "");
const adminKey = process.env.SEARCH_ADMIN_KEY || "";
const index = process.env.SEARCH_INDEX || "pottery-docs";
const docsDir = process.env.DOCS_DIR || "../pottery-wheel-docs/docs";
const baseUrl = (process.env.DOCS_BASE_URL || "https://dromidror.github.io/pottery-wheel-docs/").replace(/\/+$/, "") + "/";
const API = "2023-11-01";

if (!endpoint || !adminKey) {
  console.error("Set SEARCH_ENDPOINT and SEARCH_ADMIN_KEY.");
  process.exit(1);
}

const headers = { "Content-Type": "application/json", "api-key": adminKey };

async function ensureIndex() {
  const def = {
    name: index,
    fields: [
      { name: "id", type: "Edm.String", key: true, filterable: true },
      { name: "title", type: "Edm.String", searchable: true, analyzer: "en.lucene" },
      { name: "section", type: "Edm.String", searchable: true, analyzer: "en.lucene" },
      { name: "content", type: "Edm.String", searchable: true, analyzer: "en.lucene" },
      { name: "url", type: "Edm.String", searchable: false },
      { name: "path", type: "Edm.String", filterable: true, searchable: false },
    ],
    suggesters: [{ name: "sg", searchMode: "analyzingInfixMatching", sourceFields: ["title", "section", "content"] }],
  };
  const res = await fetch(`${endpoint}/indexes/${index}?api-version=${API}`, {
    method: "PUT", headers, body: JSON.stringify(def),
  });
  if (!res.ok && res.status !== 204) {
    throw new Error(`Create/update index failed (${res.status}): ${await res.text()}`);
  }
  console.log(`Index "${index}" ready.`);
}

/** All .md files under dir, recursively. */
async function markdownFiles(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await markdownFiles(full));
    else if (entry.isFile() && entry.name.endsWith(".md")) out.push(full);
  }
  return out;
}

/** Strip MkDocs/Material + markdown syntax down to plain, searchable prose. */
function toPlainText(md) {
  return md
    .replace(/```[\s\S]*?```/g, " ")                 // code fences
    .replace(/<figure[\s\S]*?<\/figure>/g, " ")      // figures
    .replace(/!!!\s+\w+(\s+"[^"]*")?/g, "")          // admonition markers
    .replace(/^\s*\?\?\?.*$/gm, "")                   // collapsible markers
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")           // images
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")          // links -> text
    .replace(/<[^>]+>/g, " ")                        // stray HTML
    .replace(/[*_`#>]+/g, " ")                        // emphasis/heading marks
    .replace(/\{[^}]*\}/g, " ")                       // attr lists {.class}
    .replace(/[ \t]+/g, " ")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

/** URL for a page path like "exporting/molds.md" -> baseUrl + "exporting/molds/". */
function pageUrl(relPath) {
  let p = relPath.split(sep).join("/").replace(/\.md$/, "");
  if (p.endsWith("/index")) p = p.slice(0, -"index".length);
  return baseUrl + (p ? p + "/" : "");
}

/** Split a page into { section, text } chunks by level-2 (##) headings; intro before the first. */
function chunkByHeading(md) {
  const lines = md.split("\n");
  let pageTitle = "";
  const chunks = [];
  let section = "";
  let buf = [];
  const flush = () => {
    const text = toPlainText(buf.join("\n"));
    if (text) chunks.push({ section, text });
    buf = [];
  };
  for (const line of lines) {
    const h1 = line.match(/^#\s+(.*)$/);
    const h2 = line.match(/^##\s+(.*)$/);
    if (h1 && !pageTitle) { pageTitle = h1[1].trim(); continue; }
    if (h2) { flush(); section = h2[1].replace(/\{[^}]*\}/g, "").trim(); continue; }
    buf.push(line);
  }
  flush();
  return { pageTitle, chunks };
}

function docId(relPath, i) {
  const hash = createHash("sha1").update(`${relPath}#${i}`).digest("hex").slice(0, 24);
  return `d_${hash}`;
}

async function upload(documents, action) {
  if (!documents.length) return;
  const value = documents.map((d) => ({ "@search.action": action, ...d }));
  const res = await fetch(`${endpoint}/indexes/${index}/docs/index?api-version=${API}`, {
    method: "POST", headers, body: JSON.stringify({ value }),
  });
  if (!res.ok) throw new Error(`Upload failed (${res.status}): ${await res.text()}`);
}

/** Every id currently in the index (to delete stale chunks after a rebuild). */
async function existingIds() {
  const ids = new Set();
  let skip = 0;
  for (;;) {
    const res = await fetch(`${endpoint}/indexes/${index}/docs/search?api-version=${API}`, {
      method: "POST", headers,
      body: JSON.stringify({ search: "*", select: "id", top: 1000, skip }),
    });
    if (!res.ok) break;
    const json = await res.json();
    const batch = json.value || [];
    for (const d of batch) ids.add(d.id);
    if (batch.length < 1000) break;
    skip += 1000;
  }
  return ids;
}

async function main() {
  await ensureIndex();
  const before = await existingIds();

  const files = await markdownFiles(docsDir);
  const docs = [];
  const live = new Set();
  for (const file of files) {
    const rel = relative(docsDir, file);
    const md = await readFile(file, "utf8");
    const { pageTitle, chunks } = chunkByHeading(md);
    const url = pageUrl(rel);
    chunks.forEach((c, i) => {
      const id = docId(rel, i);
      live.add(id);
      docs.push({
        id,
        title: pageTitle || rel,
        section: c.section,
        content: c.text,
        url,
        path: rel.split(sep).join("/"),
      });
    });
  }

  // Upload in batches of 100 (service limit is 1000, 16 MB).
  for (let i = 0; i < docs.length; i += 100) await upload(docs.slice(i, i + 100), "mergeOrUpload");
  console.log(`Uploaded ${docs.length} chunks from ${files.length} pages.`);

  const stale = [...before].filter((id) => !live.has(id)).map((id) => ({ id }));
  if (stale.length) { await upload(stale, "delete"); console.log(`Deleted ${stale.length} stale chunks.`); }
}

main().catch((err) => { console.error(err); process.exit(1); });
