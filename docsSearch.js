/**
 * Dynamic-help retrieval + answer generation.
 *
 * Retrieval is Azure AI Search (the `docs` index built by tools/index-docs.mjs); the answer is
 * written by Azure OpenAI, grounded only in the retrieved passages. All endpoints/keys come from
 * app settings so nothing model-related ships in the app:
 *
 *   SEARCH_ENDPOINT      https://<svc>.search.windows.net
 *   SEARCH_API_KEY       a query key for that service
 *   SEARCH_INDEX         index name (default: "pottery-docs")
 *   AOAI_ENDPOINT        https://<res>.openai.azure.com
 *   AOAI_API_KEY         an Azure OpenAI key
 *   AOAI_DEPLOYMENT      chat model deployment name (a current GPT-5 family deployment, e.g. "help-chat")
 *   AOAI_API_VERSION     optional, defaults to a current GA version
 *
 * Kept host-independent (plain fetch, returns { status, body }) so it mirrors authService.js and
 * is unit-testable without the Functions host.
 */

const DEFAULT_INDEX = "pottery-docs";
const DEFAULT_AOAI_API_VERSION = "2025-04-01-preview"; // GPT-5 needs a newer API version
const TOP_K = 8;            // passages retrieved per question (the whole corpus is small, so be generous)

// Words that carry no topic in a help question; dropped from the SEARCH query only (the model still
// sees the full question). Without this, "how to create gallery" matches on "how"/"to"/"create"
// across the whole corpus and the gallery passages can miss the top results.
const FILLER = new Set([
  "how", "to", "do", "does", "did", "i", "me", "my", "a", "an", "the", "can", "could", "should",
  "would", "what", "whats", "where", "which", "when", "why", "is", "are", "was", "of", "for", "in",
  "on", "it", "and", "or", "with", "please", "want", "need", "way",
]);

/** The search terms for a question: lowercase words minus filler. Falls back to the question itself. */
export function searchQuery(question) {
  const words = String(question).toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const terms = words.filter((w) => !FILLER.has(w));
  return terms.length ? terms.join(" ") : String(question).trim();
}
const MAX_QUESTION = 500;   // guard against oversized prompts
const MAX_HISTORY = 6;      // recent prior questions kept for follow-ups

export function searchConfig(env = process.env) {
  return {
    searchEndpoint: (env.SEARCH_ENDPOINT || "").replace(/\/+$/, ""),
    searchKey: env.SEARCH_API_KEY || "",
    index: env.SEARCH_INDEX || DEFAULT_INDEX,
    aoaiEndpoint: (env.AOAI_ENDPOINT || "").replace(/\/+$/, ""),
    aoaiKey: env.AOAI_API_KEY || "",
    deployment: env.AOAI_DEPLOYMENT || "",
    aoaiApiVersion: env.AOAI_API_VERSION || DEFAULT_AOAI_API_VERSION,
  };
}

function assertConfigured(cfg) {
  const missing = [];
  if (!cfg.searchEndpoint) missing.push("SEARCH_ENDPOINT");
  if (!cfg.searchKey) missing.push("SEARCH_API_KEY");
  if (!cfg.aoaiEndpoint) missing.push("AOAI_ENDPOINT");
  if (!cfg.aoaiKey) missing.push("AOAI_API_KEY");
  if (!cfg.deployment) missing.push("AOAI_DEPLOYMENT");
  if (missing.length) throw new Error(`Missing config: ${missing.join(", ")}`);
}

/** Top documents for `query` from Azure AI Search. Returns [{ title, section, url, content }]. */
async function searchDocs(cfg, query, top = TOP_K) {
  const url = `${cfg.searchEndpoint}/indexes/${encodeURIComponent(cfg.index)}/docs/search?api-version=2023-11-01`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "api-key": cfg.searchKey },
    body: JSON.stringify({ search: query, top, queryType: "simple", searchMode: "any" }),
  });
  if (!res.ok) throw new Error(`Search query failed (${res.status})`);
  const json = await res.json();
  return (json.value || []).map((d) => ({
    title: d.title || "",
    section: d.section || "",
    url: d.url || "",
    content: d.content || "",
  }));
}

/** Autocomplete suggestions from the index's suggester. Empty list on any trouble. */
export async function suggest(query, env = process.env) {
  const cfg = searchConfig(env);
  const q = (query || "").trim();
  if (!q || !cfg.searchEndpoint || !cfg.searchKey) return [];
  try {
    const url = `${cfg.searchEndpoint}/indexes/${encodeURIComponent(cfg.index)}/docs/suggest?api-version=2023-11-01`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "api-key": cfg.searchKey },
      body: JSON.stringify({ search: q, suggesterName: "sg", top: 6, fuzzy: true }),
    });
    if (!res.ok) return [];
    const json = await res.json();
    // De-dupe suggestion texts, keep order.
    const seen = new Set();
    const out = [];
    for (const item of json.value || []) {
      const text = (item["@search.text"] || item.text || "").trim();
      if (text && !seen.has(text)) { seen.add(text); out.push(text); }
    }
    return out;
  } catch {
    return [];
  }
}

/** Build the system + user messages: answer only from the passages, tailored to the context. */
export function buildMessages(question, context, passages) {
  const ctx = context && typeof context === "object" ? context : {};
  const obj = ctx.object && typeof ctx.object === "object" ? ctx.object : {};
  const where = [
    ctx.screen ? `Screen: ${ctx.screen}` : null,
    obj.type ? `Object type: ${obj.type}` : null,
    obj.name ? `Object name: ${obj.name}` : null,
    obj.selectedPart ? `Selected part: ${obj.selectedPart}` : null,
    obj.parts != null ? `Part count: ${obj.parts}` : null,
    obj.dimensions ? `Dimensions: ${obj.dimensions}` : null,
  ].filter(Boolean).join("\n");

  const docsBlock = passages.length
    ? passages.map((p, i) => `[Doc ${i + 1}] ${p.title}${p.section ? " — " + p.section : ""}\n${p.content}`).join("\n\n")
    : "(no matching documentation found)";

  const system =
    "You are the in-app help assistant for Pottery Wheel, an app for designing tableware and " +
    "exporting STL models and casting molds. Answer the user's question using ONLY the " +
    "documentation passages provided. Give complete, practical, step-by-step instructions: combine " +
    "every relevant detail across the passages (recipes, glossary entries and overviews included) " +
    "and don't skip steps, but keep each step short. Tailor the answer to where they are in the " +
    "app and what they're building (given below). " +
    "If the passages don't cover the question, say so briefly and suggest the closest relevant " +
    "topic. Do not invent features. Prefer short paragraphs or short numbered steps. " +
    "Answer ONLY the final question. Earlier questions, if listed, are background for follow-ups " +
    "(\"and then?\") and have already been answered — never answer them again, and ignore them " +
    "when the final question is about a different topic. A one-word question is a topic: explain " +
    "what the documentation says about it.";

  // Earlier questions go INSIDE the final message as background. They must not be separate
  // `user` turns: with no assistant replies between them the model reads them as still-unanswered
  // questions and answers the old topic against the new topic's documentation.
  const history = (Array.isArray(ctx.history) ? ctx.history.slice(-MAX_HISTORY) : [])
    .filter((h) => typeof h === "string" && h.trim())
    .map((h) => h.trim().slice(0, MAX_QUESTION));
  const historyBlock = history.length
    ? `Earlier questions from this user (background only, already answered):\n${history.map((h) => `- ${h}`).join("\n")}\n\n`
    : "";

  const user =
    (where ? `The user's current context:\n${where}\n\n` : "") +
    historyBlock +
    `Documentation:\n${docsBlock}\n\n` +
    `Final question — answer this one: ${question}`;

  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}

/** Call Azure OpenAI chat completions; return the answer text. */
async function generateAnswer(cfg, messages) {
  const url = `${cfg.aoaiEndpoint}/openai/deployments/${encodeURIComponent(cfg.deployment)}/chat/completions?api-version=${encodeURIComponent(cfg.aoaiApiVersion)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "api-key": cfg.aoaiKey },
    // GPT-5 models are reasoning models: they reject `max_tokens` and a non-default `temperature`.
    // The completion budget also covers hidden reasoning tokens, so keep it roomy and the effort low.
    body: JSON.stringify({ messages, max_completion_tokens: 2000, reasoning_effort: "low" }),
  });
  if (!res.ok) throw new Error(`Answer generation failed (${res.status})`);
  const json = await res.json();
  const answer = json?.choices?.[0]?.message?.content?.trim();
  if (!answer) throw new Error("The model returned an empty answer");
  return answer;
}

/**
 * Answer `question` grounded in the docs, tailored to `context`.
 * Returns { status, body: { answer, sources } }.
 */
export async function ask(input, env = process.env) {
  const question = typeof input?.question === "string" ? input.question.trim() : "";
  if (!question) return { status: 400, body: { error: "Type a question" } };
  if (question.length > MAX_QUESTION) return { status: 400, body: { error: "Question is too long" } };

  const cfg = searchConfig(env);
  assertConfigured(cfg);

  const passages = await searchDocs(cfg, searchQuery(question));
  const messages = buildMessages(question, input?.context, passages);
  const answer = await generateAnswer(cfg, messages);

  // Unique source labels ("Title — Section") in retrieval order.
  const seen = new Set();
  const sources = [];
  for (const p of passages) {
    const label = p.section ? `${p.title} — ${p.section}` : p.title;
    if (label && !seen.has(label)) { seen.add(label); sources.push(label); }
  }
  return { status: 200, body: { answer, sources } };
}
