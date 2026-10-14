import { app } from "@azure/functions";

app.http("health", {
  methods: ["GET"],
  authLevel: "anonymous",
  route: "health",
  handler: async () => ({ status: 200, jsonBody: { ok: true, version: "1.0.0" } })
});
