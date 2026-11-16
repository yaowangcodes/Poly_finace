import { createHash, createHmac } from "node:crypto";
import { createRequire } from "node:module";
import { expect, it } from "vitest";
import { signedConverseRequest } from "@/lib/server/interview-bedrock";
// Compare the small REST adapter against the signer used by our installed AWS SDK.
const require = createRequire(import.meta.url);
const sdk = createRequire(require.resolve("@aws-sdk/client-bedrock-agentcore"));
const core = createRequire(sdk.resolve("@aws-sdk/core"));
const { SignatureV4 } = core("@smithy/signature-v4");
class Sha256 {
  private hash;
  constructor(secret?: Uint8Array) { this.hash = secret ? createHmac("sha256", secret) : createHash("sha256"); }
  update(data: Uint8Array) { this.hash.update(data); }
  async digest() { return this.hash.digest(); }
}
it.each(["us.anthropic.example-v1:0", "arn:aws:bedrock:us-east-1:123456789012:inference-profile/example"]) ("matches AWS SigV4 signing for %s", async model => {
  const credentials = { accessKeyId: "TESTKEY", secretAccessKey: "test-secret", sessionToken: "test-token" };
  const date = new Date("2026-11-16T00:00:00Z");
  const actual = signedConverseRequest("us-east-1", model, { messages: [] }, credentials, date);
  const url = new URL(actual.url);
  const signer = new SignatureV4({ credentials, region: "us-east-1", service: "bedrock", sha256: Sha256, applyChecksum: false });
  const expected = await signer.sign({ method: "POST", protocol: "https:", hostname: url.hostname, path: url.pathname, headers: { host: url.hostname, "content-type": "application/json" }, body: actual.body }, { signingDate: date });
  expect(actual.headers.authorization).toBe(expected.headers.authorization);
});
