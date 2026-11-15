import { afterEach, expect, it, vi } from "vitest";
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ host: "localhost:3000" }),
  cookies: async () => {
    throw new Error("Local mode must not use sign-in cookies");
  },
}));
import { requireUser, checkOrigin } from "@/lib/server/auth";
import { assertLocalRequest } from "@/lib/server/local-user";
import { buildPayload } from "@/lib/server/agentcore";
import { newConversation } from "@/lib/types";
afterEach(() => vi.unstubAllEnvs());
it("opens a stable single-user workspace without cookies, provider configuration, or fabricated JWTs", async () => {
  vi.stubEnv("WEB_AUTH_MODE", "local");
  vi.stubEnv("APP_ORIGIN", "http://localhost:3000");
  const user = await requireUser();
  expect(user.authentication).toBe("local");
  expect(user.name).toBe("Local workspace");
  expect((await requireUser()).owner).toBe(user.owner);
  const payload = buildPayload(
    newConversation(),
    { prompt: "hello", version: 0, action: "message" },
    user.token,
  );
  expect(payload).not.toHaveProperty("identity_token");
});
it("rejects public hosts, cross-site requests and missing mutation origin", () => {
  vi.stubEnv("WEB_AUTH_MODE", "local");
  vi.stubEnv("APP_ORIGIN", "http://localhost:3000");
  expect(() =>
    assertLocalRequest(new Headers({ host: "example.com" })),
  ).toThrow();
  expect(() =>
    assertLocalRequest(
      new Headers({ host: "localhost:3000", origin: "https://evil.example" }),
    ),
  ).toThrow();
  expect(() =>
    checkOrigin(
      new Request("http://localhost:3000/api", {
        headers: { host: "localhost:3000" },
      }),
    ),
  ).toThrow();
  expect(() =>
    checkOrigin(
      new Request("http://127.0.0.1:3000/api", {
        headers: { host: "127.0.0.1:3000", origin: "http://127.0.0.1:3000" },
      }),
    ),
  ).not.toThrow();
  vi.stubEnv("APP_ORIGIN", "https://public.example");
  expect(() =>
    assertLocalRequest(new Headers({ host: "public.example" })),
  ).toThrow();
});
