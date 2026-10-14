import { beforeEach, describe, expect, it } from "vitest";
import { createAuthService } from "../authService.js";
import { TOKEN_LIFETIME_SECONDS } from "../token.js";
import { MemoryUserStore } from "../userStore.js";

const SECRET = "test-secret-that-is-at-least-32-characters-long";

describe("auth service", () => {
  let store, clock, auth;
  beforeEach(() => {
    store = new MemoryUserStore();
    clock = 1_800_000_000;
    auth = createAuthService({ store, secret: SECRET, now: () => clock });
  });

  it("signs up, then logs in with the same email in any case", async () => {
    const up = await auth.signup({ email: " Potter@Example.com ", password: "glaze1234", name: "Dror" });
    expect(up.status).toBe(201);
    expect(up.body.user).toEqual({ email: "potter@example.com", name: "Dror" });
    expect(typeof up.body.token).toBe("string");
    expect(JSON.stringify(up.body)).not.toContain("passwordHash");

    const login = await auth.login({ email: "POTTER@example.com", password: "glaze1234" });
    expect(login.status).toBe(200);
    expect(login.body.user.email).toBe("potter@example.com");
  });

  it("stores only a hash of the password", async () => {
    await auth.signup({ email: "a@b.co", password: "glaze1234" });
    const saved = await store.get("a@b.co");
    expect(saved.passwordHash).not.toContain("glaze1234");
  });

  it("refuses a second account for the same email", async () => {
    await auth.signup({ email: "a@b.co", password: "glaze1234" });
    const again = await auth.signup({ email: "A@B.co", password: "other5678" });
    expect(again.status).toBe(409);
  });

  it("validates the email and password", async () => {
    expect((await auth.signup({ email: "not-an-email", password: "glaze1234" })).status).toBe(400);
    expect((await auth.signup({ email: "a@b.co", password: "short" })).status).toBe(400);
    expect((await auth.signup(null)).status).toBe(400);
  });

  it("gives the same answer for a wrong password and an unknown email", async () => {
    await auth.signup({ email: "a@b.co", password: "glaze1234" });
    const wrong = await auth.login({ email: "a@b.co", password: "nope12345" });
    const unknown = await auth.login({ email: "x@b.co", password: "glaze1234" });
    expect(wrong).toEqual(unknown);
    expect(wrong.status).toBe(401);
  });

  it("returns the current user for a valid token, until it expires", async () => {
    const { body } = await auth.signup({ email: "a@b.co", password: "glaze1234", name: "A" });
    const me = await auth.me(`Bearer ${body.token}`);
    expect(me).toEqual({ status: 200, body: { user: { email: "a@b.co", name: "A" } } });

    expect((await auth.me("")).status).toBe(401);
    expect((await auth.me("Bearer garbage")).status).toBe(401);
    clock += TOKEN_LIFETIME_SECONDS + 1;
    expect((await auth.me(`Bearer ${body.token}`)).status).toBe(401);
  });

  it("rejects a token signed with another secret", async () => {
    const other = createAuthService({ store, secret: "another-secret-that-is-also-32-characters!", now: () => clock });
    const { body } = await other.signup({ email: "a@b.co", password: "glaze1234" });
    expect((await auth.me(`Bearer ${body.token}`)).status).toBe(401);
  });
});
