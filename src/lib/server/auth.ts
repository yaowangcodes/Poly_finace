import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { cookies, headers } from "next/headers";
import { localMode, assertLocalRequest, localIdentity } from "./local-user";
import { createRemoteJWKSet, jwtVerify, EncryptJWT, jwtDecrypt } from "jose";
import * as oidc from "openid-client";
import { store } from "./store";
import { ServiceError } from "./conversations";
export function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}
export function origin() {
  const url = new URL(required("APP_ORIGIN"));
  if (
    url.protocol !== "https:" &&
    !(
      url.protocol === "http:" &&
      ["localhost", "127.0.0.1"].includes(url.hostname)
    )
  )
    throw new Error("HTTPS application origin required.");
  return url.origin;
}
function key() {
  const k = Buffer.from(required("SESSION_ENCRYPTION_KEY"), "base64");
  if (k.length !== 32) throw new Error("Session key must be 32 bytes.");
  return k;
}
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
function cookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    secure: origin().startsWith("https:"),
    sameSite: "lax" as const,
    path: "/",
    maxAge,
  };
}
export function cookieName() {
  return origin().startsWith("https:") ? "__Host-af-session" : "af-session";
}
async function seal(data: Record<string, unknown>, seconds: number) {
  return new EncryptJWT(data)
    .setProtectedHeader({ alg: "dir", enc: "A256GCM" })
    .setIssuedAt()
    .setExpirationTime(`${seconds}s`)
    .encrypt(key());
}
async function unseal(value: string) {
  return (
    await jwtDecrypt(value, key(), {
      keyManagementAlgorithms: ["dir"],
      contentEncryptionAlgorithms: ["A256GCM"],
    })
  ).payload;
}
let configPromise: Promise<oidc.Configuration> | undefined;
function configuration() {
  const issuer = new URL(required("AUTH_ISSUER"));
  if (issuer.protocol !== "https:") throw new Error("HTTPS issuer required.");
  if (required("AUTH_AUDIENCE") !== required("OIDC_CLIENT_ID"))
    throw new Error("ID token audience must equal OIDC client ID.");
  return (configPromise ??= oidc.discovery(
    issuer,
    required("OIDC_CLIENT_ID"),
    required("OIDC_CLIENT_SECRET"),
  ));
}
let jwks: ReturnType<typeof createRemoteJWKSet> | undefined;
export async function verifyIdentity(token: string) {
  const url = new URL(required("AUTH_JWKS_URL"));
  if (url.protocol !== "https:") throw new Error("HTTPS JWKS required.");
  jwks ??= createRemoteJWKSet(url, { timeoutDuration: 5000 });
  const { payload } = await jwtVerify(token, jwks, {
    issuer: required("AUTH_ISSUER"),
    audience: required("AUTH_AUDIENCE"),
    algorithms: ["RS256"],
    requiredClaims: ["iss", "sub", "aud", "exp"],
  });
  if (!payload.sub) throw new Error("Missing user subject.");
  return {
    owner: hash(JSON.stringify([payload.iss, payload.sub])),
    name: typeof payload.name === "string" ? payload.name : "Researcher",
    exp: payload.exp!,
  };
}
export async function beginLogin() {
  if (localMode()) {
    await requireUser();
    return new URL(origin());
  }
  const config = await configuration(),
    verifier = oidc.randomPKCECodeVerifier(),
    state = oidc.randomState(),
    nonce = oidc.randomNonce();
  const jar = await cookies();
  jar.set(
    "af-login",
    await seal({ verifier, state, nonce }, 600),
    cookieOptions(600),
  );
  return oidc.buildAuthorizationUrl(config, {
    redirect_uri: `${origin()}/api/auth/callback`,
    scope: "openid profile",
    code_challenge: await oidc.calculatePKCECodeChallenge(verifier),
    code_challenge_method: "S256",
    state,
    nonce,
  });
}
interface SessionData {
  encryptedToken: string;
  owner: string;
  name: string;
  expires: number;
}
export async function completeLogin(requestUrl: string) {
  const jar = await cookies(),
    transient = jar.get("af-login")?.value;
  jar.delete("af-login");
  if (!transient)
    throw new ServiceError(401, "Login expired. Please sign in again.");
  const data = await unseal(transient);
  if (
    typeof data.verifier !== "string" ||
    typeof data.state !== "string" ||
    typeof data.nonce !== "string"
  )
    throw new Error("Invalid login state.");
  const callback = new URL(requestUrl);
  callback.host = new URL(origin()).host;
  callback.protocol = new URL(origin()).protocol;
  const tokens = await oidc.authorizationCodeGrant(
    await configuration(),
    callback,
    {
      pkceCodeVerifier: data.verifier,
      expectedState: data.state,
      expectedNonce: data.nonce,
      idTokenExpected: true,
    },
  );
  if (!tokens.id_token) throw new Error("Provider did not issue an ID token.");
  const identity = await verifyIdentity(tokens.id_token);
  const seconds = Math.min(3600, identity.exp - Math.floor(Date.now() / 1000));
  if (seconds < 1) throw new Error("Expired identity token.");
  const id = randomBytes(32).toString("base64url"),
    expires = Math.floor(Date.now() / 1000) + seconds;
  await store().put<SessionData>(
    "SESSIONS",
    hash(id),
    {
      owner: identity.owner,
      name: identity.name,
      expires,
      encryptedToken: await seal({ token: tokens.id_token }, seconds),
    },
    null,
    expires,
  );
  jar.set(cookieName(), id, cookieOptions(seconds));
}
export async function requireUser() {
  if (localMode()) {
    assertLocalRequest(await headers());
    return localIdentity();
  }
  try {
    const id = (await cookies()).get(cookieName())?.value;
    if (!id) throw new Error("Missing session.");
    const record = await store().get<SessionData>("SESSIONS", hash(id));
    if (!record || record.value.expires <= Date.now() / 1000)
      throw new Error("Expired session.");
    const sealed = await unseal(record.value.encryptedToken);
    if (typeof sealed.token !== "string") throw new Error("Invalid token.");
    const identity = await verifyIdentity(sealed.token);
    if (identity.owner !== record.value.owner)
      throw new Error("Session owner mismatch.");
    return {
      ...identity,
      token: sealed.token,
      authentication: "oidc" as const,
    };
  } catch {
    throw new ServiceError(
      401,
      "Your sign-in has expired or is unavailable. Sign in again; your conversations are retained.",
    );
  }
}
export async function logout() {
  if (localMode()) {
    await requireUser();
    return;
  }
  const jar = await cookies(),
    id = jar.get(cookieName())?.value;
  jar.delete(cookieName());
  if (id) {
    const row = await store().get("SESSIONS", hash(id));
    if (row) await store().delete("SESSIONS", hash(id), row.version);
  }
}
export function checkOrigin(request: Request) {
  if (localMode()) {
    assertLocalRequest(request.headers);
    if (!request.headers.get("origin"))
      throw new ServiceError(403, "Request origin is required.");
    return;
  }
  if (request.headers.get("origin") !== origin())
    throw new ServiceError(403, "Request origin was not accepted.");
}
