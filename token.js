import { SignJWT, jwtVerify } from "jose";

export const ISSUER = "mold-builder";
export const TOKEN_LIFETIME_SECONDS = 30 * 24 * 60 * 60; // 30 days

function key(secret) {
  if (!secret || secret.length < 32) throw new Error("AUTH_JWT_SECRET must be at least 32 characters");
  return new TextEncoder().encode(secret);
}

/** A signed session token (HS256) for the user `email`, valid for TOKEN_LIFETIME_SECONDS. */
export async function issueToken(email, secret, nowSeconds = Math.floor(Date.now() / 1000)) {
  return new SignJWT({})
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(email)
    .setIssuer(ISSUER)
    .setIssuedAt(nowSeconds)
    .setExpirationTime(nowSeconds + TOKEN_LIFETIME_SECONDS)
    .sign(key(secret));
}

/** The email a valid, unexpired token was issued for; throws when the token is bad. */
export async function verifyToken(token, secret, nowSeconds) {
  const { payload } = await jwtVerify(token, key(secret), {
    issuer: ISSUER,
    algorithms: ["HS256"],
    ...(nowSeconds !== undefined ? { currentDate: new Date(nowSeconds * 1000) } : {})
  });
  if (typeof payload.sub !== "string") throw new Error("Token has no subject");
  return payload.sub;
}
