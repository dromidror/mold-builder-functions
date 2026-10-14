import { hashPassword, verifyPassword } from "./password.js";
import { issueToken, verifyToken } from "./token.js";

export const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 256;
const MAX_NAME_LENGTH = 100;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// A login for an unknown email still runs a hash check against this, so its timing matches a
// wrong password and does not reveal which emails have accounts.
const DUMMY_HASH = hashPassword("not-a-real-password");

/** Emails are compared case-insensitively, without surrounding spaces. */
export function normalizeEmail(email) {
  return typeof email === "string" ? email.trim().toLowerCase() : "";
}

function error(status, message) { return { status, body: { error: message } }; }

function publicUser(user) { return { email: user.email, name: user.name ?? "" }; }

/**
 * Sign up / login / current user, independent of the HTTP host so it can be tested directly.
 * Each method returns { status, body }.
 */
export function createAuthService({ store, secret, now = () => Math.floor(Date.now() / 1000) }) {
  return {
    async signup(input) {
      const email = normalizeEmail(input?.email);
      const password = input?.password;
      const name = typeof input?.name === "string" ? input.name.trim().slice(0, MAX_NAME_LENGTH) : "";
      if (!EMAIL.test(email) || email.length > 254) return error(400, "Enter a valid email address");
      if (typeof password !== "string" || password.length < MIN_PASSWORD_LENGTH)
        return error(400, `Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
      if (password.length > MAX_PASSWORD_LENGTH) return error(400, "Password is too long");

      const user = { email, name, passwordHash: await hashPassword(password), createdAt: new Date(now() * 1000).toISOString() };
      if (!(await store.create(user))) return error(409, "An account with this email already exists");
      return { status: 201, body: { token: await issueToken(email, secret, now()), user: publicUser(user) } };
    },

    async login(input) {
      const email = normalizeEmail(input?.email);
      const password = input?.password;
      if (!email || typeof password !== "string" || password.length > MAX_PASSWORD_LENGTH)
        return error(400, "Enter your email and password");
      const user = await store.get(email);
      const ok = await verifyPassword(password, user?.passwordHash ?? (await DUMMY_HASH));
      if (!user || !ok) return error(401, "Invalid email or password");
      return { status: 200, body: { token: await issueToken(email, secret, now()), user: publicUser(user) } };
    },

    /** The signed-in user for an "Authorization: Bearer <token>" header. */
    async me(authorization) {
      const token = typeof authorization === "string" && authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
      if (!token) return error(401, "Not signed in");
      let email;
      try { email = await verifyToken(token, secret, now()); } catch { return error(401, "Session expired, please sign in again"); }
      const user = await store.get(email);
      if (!user) return error(401, "Account not found");
      return { status: 200, body: { user: publicUser(user) } };
    }
  };
}
