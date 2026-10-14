import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

// scrypt cost parameters (N = 2^14, r = 8, p = 1 — the Node defaults, ~16 MB per hash).
const N = 16384;
const R = 8;
const P = 1;
const KEY_LENGTH = 64;
const SALT_BYTES = 16;

function derive(password, salt, n, r, p, keyLength) {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keyLength, { N: n, r, p, maxmem: 64 * 1024 * 1024 }, (err, key) =>
      err ? reject(err) : resolve(key)
    );
  });
}

/**
 * Hash a password for storage: "scrypt$N$r$p$<salt b64>$<hash b64>", with a random salt per user.
 * The parameters are stored with the hash so they can be raised later without breaking old ones.
 */
export async function hashPassword(password) {
  const salt = randomBytes(SALT_BYTES);
  const key = await derive(password, salt, N, R, P, KEY_LENGTH);
  return ["scrypt", N, R, P, salt.toString("base64"), key.toString("base64")].join("$");
}

/** Does `password` match the stored `hash`? Constant-time; false for a malformed hash. */
export async function verifyPassword(password, hash) {
  const parts = typeof hash === "string" ? hash.split("$") : [];
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, n, r, p, saltB64, keyB64] = parts;
  const expected = Buffer.from(keyB64, "base64");
  const key = await derive(password, Buffer.from(saltB64, "base64"), Number(n), Number(r), Number(p), expected.length);
  return key.length === expected.length && timingSafeEqual(key, expected);
}
