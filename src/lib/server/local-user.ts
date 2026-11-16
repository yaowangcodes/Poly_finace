import "server-only";
import { createHash } from "node:crypto";
import { ServiceError } from "./conversations";

export function localMode() {
  return process.env.WEB_AUTH_MODE === "local";
}

// This mode is one local workspace, not anonymous multi-user authentication.
export function assertLocalRequest(requestHeaders: Headers) {
  const origin = new URL(process.env.APP_ORIGIN ?? "http://localhost:3000");
  const loopback = ["localhost", "127.0.0.1", "[::1]"];
  const host = requestHeaders.get("host");
  const allowed = loopback.map(
    (name) => `${name}${origin.port ? `:${origin.port}` : ""}`,
  );
  if (!loopback.includes(origin.hostname) || !host || !allowed.includes(host)) {
    throw new ServiceError(
      403,
      "Local workspace mode is available only on localhost.",
    );
  }
  const suppliedOrigin = requestHeaders.get("origin");
  if (
    requestHeaders.get("sec-fetch-site") === "cross-site" ||
    (suppliedOrigin && suppliedOrigin !== `${origin.protocol}//${host}`)
  ) {
    throw new ServiceError(403, "Request origin was not accepted.");
  }
}

export function localIdentity() {
  const owner = process.env.LOCAL_OWNER_ID ?? "alphaforge-local-owner";
  return {
    owner: createHash("sha256").update(`local:${owner}`).digest("hex"),
    name: "Local workspace",
    token: "",
    authentication: "local" as const,
  };
}
