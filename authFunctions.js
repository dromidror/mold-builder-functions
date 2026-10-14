import { app } from "@azure/functions";
import { createAuthService } from "./authService.js";
import { TableUserStore } from "./userStore.js";

let service = null;

/**
 * The storage connection for the users table: USERS_STORAGE_CONNECTION, else the Flex Consumption
 * deployment storage (DEPLOYMENT_STORAGE_CONNECTION_STRING — the app's own storage account), else
 * AzureWebJobsStorage when it holds a connection string (locally: Azurite).
 */
export function usersConnection(env = process.env) {
  return env.USERS_STORAGE_CONNECTION || env.DEPLOYMENT_STORAGE_CONNECTION_STRING || env.AzureWebJobsStorage || "";
}

/** The auth service, configured from the app settings on first use. */
function authService() {
  if (!service) {
    const connection = usersConnection();
    const secret = process.env.AUTH_JWT_SECRET || "";
    if (!connection) throw new Error("Missing config: USERS_STORAGE_CONNECTION (or DEPLOYMENT_STORAGE_CONNECTION_STRING)");
    if (secret.length < 32) throw new Error("Missing config: AUTH_JWT_SECRET (at least 32 characters)");
    service = createAuthService({ store: new TableUserStore(connection, process.env.USERS_TABLE || "users"), secret });
  }
  return service;
}

async function readJson(request) {
  try { return await request.json(); } catch { return null; }
}

/** Run `action`, answering a config/storage failure with a generic 500 (details only in the log). */
async function respond(context, action) {
  try {
    const { status, body } = await action(authService());
    return { status, jsonBody: body };
  } catch (err) {
    context.error(err);
    return { status: 500, jsonBody: { error: "Something went wrong, please try again" } };
  }
}

app.http("signup", {
  methods: ["POST"],
  authLevel: "anonymous",
  route: "auth/signup",
  handler: async (request, context) => respond(context, async (auth) => auth.signup(await readJson(request)))
});

app.http("login", {
  methods: ["POST"],
  authLevel: "anonymous",
  route: "auth/login",
  handler: async (request, context) => respond(context, async (auth) => auth.login(await readJson(request)))
});

app.http("me", {
  methods: ["GET"],
  authLevel: "anonymous",
  route: "auth/me",
  handler: async (request, context) => respond(context, (auth) => auth.me(request.headers.get("authorization")))
});
