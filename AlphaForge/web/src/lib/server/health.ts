import "server-only";
import {
  BedrockAgentCoreControlClient,
  GetAgentRuntimeCommand,
  GetAgentRuntimeEndpointCommand,
  GetMemoryCommand,
} from "@aws-sdk/client-bedrock-agentcore-control";

const client = new BedrockAgentCoreControlClient({
  region: process.env.AWS_REGION ?? "us-east-1",
  maxAttempts: 1,
});
export async function connectionHealth() {
  const match = process.env.AGENTCORE_RUNTIME_ARN?.match(
    /^arn:[^:]+:bedrock-agentcore:([^:]+):\d{12}:runtime\/([^/]+)$/,
  );
  if (!match || match[1] !== (process.env.AWS_REGION ?? "us-east-1"))
    return {
      status: "disconnected",
      message:
        "Configure AGENTCORE_RUNTIME_ARN and its matching AWS_REGION on the server.",
    };
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const check = async () => {
      const endpoint = await client.send(
        new GetAgentRuntimeEndpointCommand({
          agentRuntimeId: match[2],
          endpointName: process.env.AGENTCORE_QUALIFIER ?? "DEFAULT",
        }),
        { abortSignal: controller.signal },
      );
      if (endpoint.status !== "READY" || !endpoint.liveVersion)
        return {
          status: "disconnected",
          message: "The Runtime endpoint is not ready.",
        };
      const runtime = await client.send(
        new GetAgentRuntimeCommand({
          agentRuntimeId: match[2],
          agentRuntimeVersion: endpoint.liveVersion,
        }),
        { abortSignal: controller.signal },
      );
      const env = runtime.environmentVariables ?? {};
      if (runtime.status !== "READY" || !env.AGENTCORE_MEMORY_ID)
        return {
          status: "disconnected",
          message:
            "The deployed Runtime is not ready or has no conversation Memory configured.",
        };
      if (
        process.env.WEB_AUTH_MODE === "local" &&
        (env.AUTH_MODE !== "iam_single_user" ||
          !env.SINGLE_USER_ACTOR_ID ||
          runtime.authorizerConfiguration)
      )
        return {
          status: "disconnected",
          message: "The Runtime still needs the IAM single-user update.",
        };
      const memory = await client.send(
        new GetMemoryCommand({ memoryId: env.AGENTCORE_MEMORY_ID }),
        { abortSignal: controller.signal },
      );
      if (memory.memory?.status !== "ACTIVE")
        return {
          status: "disconnected",
          message:
            "Conversation Memory is not active. Existing restrictions remain saved.",
        };
      return {
        status: "ready",
        message:
          "AWS configuration is ready. Memory restoration is verified when you send a message.",
      };
    };
    return await Promise.race([
      check(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error("timeout"));
        }, 10_000);
      }),
    ]);
  } catch {
    return {
      status: "disconnected",
      message:
        "AWS connection could not be verified. Check the server's AWS session, read permissions, and network; then retry. Saved conversations are unchanged.",
    };
  } finally {
    clearTimeout(timer);
  }
}
