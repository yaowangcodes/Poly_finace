import "server-only";
import { createHash, createHmac } from "node:crypto";
import { BedrockAgentCoreClient } from "@aws-sdk/client-bedrock-agentcore";
import { z } from "zod";

const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const mac = (key: string | Buffer, value: string) => createHmac("sha256", key).update(value).digest();
const encode = (value: string) => encodeURIComponent(value).replace(/[!'()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
// Reuse the existing SDK credential chain (environment, profiles, container and IAM roles).
let provider: BedrockAgentCoreClient | undefined;
export function signedConverseRequest(region: string, model: string, payload: unknown, credentials: { accessKeyId: string; secretAccessKey: string; sessionToken?: string }, now = new Date()) {
  if (!/^[a-z]{2}(?:-[a-z]+)+-\d$/.test(region)) throw new Error("Invalid AWS region.");
  const host = `bedrock-runtime.${region}.amazonaws.com`;
  const path = `/model/${encode(model)}/converse`;
  const body = JSON.stringify(payload);
  const date = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const day = date.slice(0, 8);
  const headers: Record<string, string> = { "content-type": "application/json", host, "x-amz-date": date };
  if (credentials.sessionToken) headers["x-amz-security-token"] = credentials.sessionToken;
  const names = Object.keys(headers).sort();
  // SigV4's generic service canonical URI encodes the already escaped path again.
  const canonicalPath = path.split("/").map(encode).join("/");
  const canonical = ["POST", canonicalPath, "", names.map(n => `${n}:${headers[n].trim()}\n`).join(""), names.join(";"), digest(body)].join("\n");
  const scope = `${day}/${region}/bedrock/aws4_request`;
  const signingKey = mac(mac(mac(mac(`AWS4${credentials.secretAccessKey}`, day), region), "bedrock"), "aws4_request");
  const signature = mac(signingKey, ["AWS4-HMAC-SHA256", date, scope, digest(canonical)].join("\n")).toString("hex");
  headers.authorization = `AWS4-HMAC-SHA256 Credential=${credentials.accessKeyId}/${scope}, SignedHeaders=${names.join(";")}, Signature=${signature}`;
  return { url: `https://${host}${path}`, headers, body };
}
export async function converse(model: string, payload: unknown) {
  const region = process.env.AWS_REGION ?? "us-east-1";
  provider ??= new BedrockAgentCoreClient({ region });
  const request = signedConverseRequest(region, model, payload, await provider.config.credentials());
  const response = await fetch(request.url, { method: "POST", headers: request.headers, body: request.body, signal: AbortSignal.timeout(25000), redirect: "error" });
  if (!response.ok) throw new Error(`Interview inference unavailable (${response.status}).`);
  const parsed = z.object({ output: z.object({ message: z.object({ content: z.array(z.object({ text: z.string().optional() })) }) }) }).parse(await response.json());
  return parsed.output.message.content.map(c => c.text ?? "").join("");
}
