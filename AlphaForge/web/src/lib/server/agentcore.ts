import "server-only";
import {
  BedrockAgentCoreClient,
  InvokeAgentRuntimeCommand,
} from "@aws-sdk/client-bedrock-agentcore";
import type { Conversation, Turn } from "../types";
let client: BedrockAgentCoreClient | undefined;
export function buildPayload(c: Conversation, turn: Turn, token: string) {
  if (c.status !== "new" && !c.revision)
    throw new Error("Missing backend revision.");
  return {
    prompt: turn.prompt,
    ...(token ? { identity_token: token } : {}),
    session_id: c.sessionId,
    ...(c.status === "new"
      ? { new_conversation: true }
      : { revision: c.revision }),
    ...(turn.action === "confirm" ? { confirm_proposal: true } : {}),
    ...(turn.action === "reject" ? { reject_proposal: true } : {}),
    ...(turn.action === "edit"
      ? { confirmed_constraints: turn.constraints }
      : {}),
  };
}
export async function invokeRuntime(
  payload: ReturnType<typeof buildPayload>,
): Promise<unknown> {
  if (!process.env.AGENTCORE_RUNTIME_ARN)
    throw new Error("Runtime ARN is not configured.");
  client ??= new BedrockAgentCoreClient({
    region: process.env.AWS_REGION ?? "us-east-1",
    maxAttempts: 1,
  });
  // One deadline covers headers AND body consumption. Never retry a mutation.
  const controller = new AbortController();
  let response: { destroy?: () => void } | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      response?.destroy?.();
      reject(new Error("Runtime outcome uncertain: timeout."));
    }, 180_000);
  });
  const invoke = async () => {
    const result = await client!.send(
      new InvokeAgentRuntimeCommand({
        agentRuntimeArn: process.env.AGENTCORE_RUNTIME_ARN,
        qualifier: process.env.AGENTCORE_QUALIFIER ?? "DEFAULT",
        runtimeSessionId: payload.session_id,
        contentType: "application/json",
        accept: "application/json",
        payload: new TextEncoder().encode(JSON.stringify(payload)),
      }),
      { abortSignal: controller.signal },
    );
    if (!result.response) throw new Error("Runtime response missing.");
    response = result.response as { destroy?: () => void };
    if (controller.signal.aborted) {
      response.destroy?.();
      throw new Error("Runtime deadline elapsed.");
    }
    const text = await result.response.transformToString();
    if (Buffer.byteLength(text) > 180_000)
      throw new Error("Runtime response exceeds supported size.");
    return JSON.parse(text);
  };
  try {
    return await Promise.race([invoke(), deadline]);
  } finally {
    clearTimeout(timer);
  }
}
