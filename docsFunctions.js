import { app } from "@azure/functions";
import { verifyToken } from "./token.js";
import { ask, suggest } from "./docsSearch.js";

/**
 * Dynamic help (the app's always-on search bar):
 *   - POST docs/ask      → an Azure OpenAI answer grounded in the docs (Azure AI Search), tailored
 *                          to the caller's context. Requires a valid session (bearer token).
 *   - GET  docs/suggest  → type-ahead suggestions from the docs index. Requires a session too.
 *
 * Auth mirrors auth/me: anonymous function auth, the JWT is verified here with AUTH_JWT_SECRET.
 */

/** The signed-in email for a Bearer header, or null. Mirrors authService.me's token handling. */
async function authedEmail(request) {
  const header = request.headers.get("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) return null;
  try {
    return await verifyToken(token, process.env.AUTH_JWT_SECRET || "");
  } catch {
    return null;
  }
}

async function readJson(request) {
  try { return await request.json(); } catch { return null; }
}

app.http("docsAsk", {
  methods: ["POST"],
  authLevel: "anonymous",
  route: "docs/ask",
  handler: async (request, context) => {
    const email = await authedEmail(request);
    if (!email) return { status: 401, jsonBody: { error: "Not signed in" } };
    try {
      const { status, body } = await ask(await readJson(request));
      return { status, jsonBody: body };
    } catch (err) {
      context.error(err);
      return { status: 500, jsonBody: { error: "Help is unavailable right now, please try again" } };
    }
  }
});

app.http("docsSuggest", {
  methods: ["GET"],
  authLevel: "anonymous",
  route: "docs/suggest",
  handler: async (request) => {
    const email = await authedEmail(request);
    if (!email) return { status: 401, jsonBody: { error: "Not signed in" } };
    const q = request.query.get("q") || "";
    // Suggestions never error out loud — an empty list is a fine answer.
    const suggestions = await suggest(q);
    return { status: 200, jsonBody: { suggestions } };
  }
});
