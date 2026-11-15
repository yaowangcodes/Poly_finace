import { beforeAll, expect, it, vi } from "vitest";
import { generateKeyPair, exportJWK, SignJWT, createLocalJWKSet } from "jose";
let local: ReturnType<typeof createLocalJWKSet>;
vi.mock("jose", async (importOriginal) => {
  const actual = await importOriginal<typeof import("jose")>();
  return {
    ...actual,
    createRemoteJWKSet:
      () =>
      (...args: Parameters<typeof local>) =>
        local(...args),
  };
});
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
}));
import { verifyIdentity, requireUser, checkOrigin } from "@/lib/server/auth";
let keys: Awaited<ReturnType<typeof generateKeyPair>>;
beforeAll(async () => {
  process.env.WEB_AUTH_MODE = "oidc";
  keys = await generateKeyPair("RS256");
  local = createLocalJWKSet({
    keys: [{ ...(await exportJWK(keys.publicKey)), kid: "test" }],
  });
  process.env.AUTH_ISSUER = "https://issuer.example";
  process.env.AUTH_AUDIENCE = "client";
  process.env.AUTH_JWKS_URL = "https://issuer.example/keys";
  process.env.APP_ORIGIN = "http://localhost:3000";
});
async function token(
  sub = "alice",
  aud = "client",
  iss = "https://issuer.example",
  expiry = "5m",
) {
  return new SignJWT({ name: "Alice" })
    .setProtectedHeader({ alg: "RS256", kid: "test" })
    .setSubject(sub)
    .setAudience(aud)
    .setIssuer(iss)
    .setExpirationTime(expiry)
    .sign(keys.privateKey);
}
it("verifies real signed identities, rejects wrong issuer/audience/expiry", async () => {
  const a = await verifyIdentity(await token());
  expect((await verifyIdentity(await token())).owner).toBe(a.owner);
  expect((await verifyIdentity(await token("bob"))).owner).not.toBe(a.owner);
  for (const t of [
    await token("alice", "wrong"),
    await token("alice", "client", "https://evil"),
    await token("alice", "client", "https://issuer.example", "-1s"),
    "unsigned",
  ])
    await expect(verifyIdentity(t)).rejects.toThrow();
});
it("requires server session before invocation and rejects cross-origin mutations", async () => {
  await expect(requireUser()).rejects.toMatchObject({ status: 401 });
  expect(() =>
    checkOrigin(
      new Request("http://localhost:3000/api", {
        headers: { origin: "https://evil" },
      }),
    ),
  ).toThrow();
  expect(() =>
    checkOrigin(
      new Request("http://localhost:3000/api", {
        headers: { origin: "http://localhost:3000" },
      }),
    ),
  ).not.toThrow();
});
