import { beforeEach, expect, it, vi } from "vitest";
const send = vi.hoisted(() => vi.fn());
vi.mock("@aws-sdk/client-bedrock-agentcore-control", () => ({
  BedrockAgentCoreControlClient: class {
    send = send;
  },
  GetAgentRuntimeCommand: class {
    constructor(public input: unknown) {}
  },
  GetAgentRuntimeEndpointCommand: class {
    constructor(public input: unknown) {}
  },
  GetMemoryCommand: class {
    constructor(public input: unknown) {}
  },
}));
import { connectionHealth } from "@/lib/server/health";
beforeEach(() => {
  send.mockReset();
  vi.stubEnv("AWS_REGION", "us-east-1");
  vi.stubEnv("WEB_AUTH_MODE", "local");
  vi.stubEnv(
    "AGENTCORE_RUNTIME_ARN",
    "arn:aws:bedrock-agentcore:us-east-1:339712771896:runtime/AlphaForgePortfolio-TevjcpB3OT",
  );
});
it("checks the endpoint's live version and Memory without invoking the model", async () => {
  send
    .mockResolvedValueOnce({ status: "READY", liveVersion: "2" })
    .mockResolvedValueOnce({
      status: "READY",
      environmentVariables: {
        AUTH_MODE: "iam_single_user",
        SINGLE_USER_ACTOR_ID: "owner",
        AGENTCORE_MEMORY_ID: "memory",
      },
    })
    .mockResolvedValueOnce({ memory: { status: "ACTIVE" } });
  expect((await connectionHealth()).status).toBe("ready");
  expect(send.mock.calls[1][0].input.agentRuntimeVersion).toBe("2");
  expect(send).toHaveBeenCalledTimes(3);
});
it("reports an old deployment instead of claiming readiness", async () => {
  send
    .mockResolvedValueOnce({ status: "READY", liveVersion: "1" })
    .mockResolvedValueOnce({ status: "READY", environmentVariables: {} });
  expect((await connectionHealth()).status).toBe("disconnected");
});
it("sanitizes expired credential and permission errors", async () => {
  send.mockRejectedValueOnce(new Error("private credential data"));
  const result = await connectionHealth();
  expect(result.status).toBe("disconnected");
  expect(JSON.stringify(result)).not.toContain("private credential data");
});
it("bounds credential resolution even if the SDK never settles", async () => {
  vi.useFakeTimers();
  send.mockImplementationOnce(() => new Promise(() => {}));
  const result = connectionHealth();
  await vi.advanceTimersByTimeAsync(10_001);
  expect((await result).status).toBe("disconnected");
  vi.useRealTimers();
});
