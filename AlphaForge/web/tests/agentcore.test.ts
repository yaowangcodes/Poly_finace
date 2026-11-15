import { expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  send: vi.fn(),
  config: vi.fn(),
  command: vi.fn(),
}));
vi.mock("@aws-sdk/client-bedrock-agentcore", () => ({
  BedrockAgentCoreClient: class {
    constructor(c: unknown) {
      mocks.config(c);
    }
    send = mocks.send;
  },
  InvokeAgentRuntimeCommand: class {
    constructor(input: unknown) {
      mocks.command(input);
    }
  },
}));
import { invokeRuntime, buildPayload } from "@/lib/server/agentcore";
import { newConversation } from "@/lib/types";
it("uses the correct SDK command, identical runtime session, server token, and no SDK retries", async () => {
  process.env.AGENTCORE_RUNTIME_ARN =
    "arn:aws:bedrock-agentcore:us-east-1:123456789012:runtime/Test-1234567890";
  mocks.send.mockResolvedValue({
    response: { transformToString: async () => '{"status":"ok"}' },
  });
  const c = newConversation(),
    p = buildPayload(
      c,
      { prompt: "hello", version: 0, action: "message" },
      "private-token",
    );
  await invokeRuntime(p);
  expect(mocks.config).toHaveBeenCalledWith(
    expect.objectContaining({ maxAttempts: 1 }),
  );
  const command = mocks.command.mock.calls[0][0];
  expect(command.runtimeSessionId).toBe(c.sessionId);
  expect(
    JSON.parse(new TextDecoder().decode(command.payload)).identity_token,
  ).toBe("private-token");
});
it("the deadline includes a stalled response body and never retries it", async () => {
  vi.useFakeTimers();
  const destroy = vi.fn();
  mocks.send.mockResolvedValueOnce({
    response: { destroy, transformToString: () => new Promise(() => {}) },
  });
  const pending = invokeRuntime(
    buildPayload(
      newConversation(),
      { prompt: "hello", version: 0, action: "message" },
      "private-token",
    ),
  );
  const assertion = expect(pending).rejects.toThrow("timeout");
  await vi.advanceTimersByTimeAsync(180_001);
  await assertion;
  expect(destroy).toHaveBeenCalledOnce();
  vi.useRealTimers();
});
