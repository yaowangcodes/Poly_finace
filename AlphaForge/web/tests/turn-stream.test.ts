import { afterEach, expect, it, vi } from "vitest";
import { streamTurn } from "@/lib/server/turn-stream";
import { readApiResponse } from "@/lib/api-response";

afterEach(() => vi.useRealTimers());

it("sends heartbeat whitespace while preserving the final result", async () => {
  vi.useFakeTimers();
  let finish!: (response: Response) => void;
  const result = new Promise<Response>((resolve) => { finish = resolve; });
  const work = vi.fn(() => result);
  const response = streamTurn(work);
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  expect(decoder.decode((await reader.read()).value).trim()).toBe("");
  await vi.advanceTimersByTimeAsync(15000);
  expect(decoder.decode((await reader.read()).value).trim()).toBe("");
  finish(Response.json({ saved: true }));
  expect(JSON.parse(decoder.decode((await reader.read()).value))).toEqual({ status: 200, body: { saved: true } });
  expect((await reader.read()).done).toBe(true);
  expect(work).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});

it.each([401, 409, 424, 503])("preserves application error status %s", async (status) => {
  const response = streamTurn(async () => Response.json({ error: "failed" }, { status }));
  expect(await readApiResponse(response)).toEqual({ status, body: { error: "failed" } });
});

it("keeps ordinary responses compatible and rejects malformed envelopes", async () => {
  expect(await readApiResponse(Response.json({ value: 1 }))).toEqual({ status: 200, body: { value: 1 } });
  await expect(readApiResponse(Response.json({ status: "200", body: {} }, {
    headers: { "X-AlphaForge-Envelope": "1" },
  }))).rejects.toThrow("Incomplete response");
});

it("clears heartbeat on disconnect without retrying the mutation", async () => {
  vi.useFakeTimers();
  let finish!: (response: Response) => void;
  const work = vi.fn(() => new Promise<Response>(resolve => { finish = resolve; }));
  const response = streamTurn(work);
  await response.body!.cancel();
  expect(vi.getTimerCount()).toBe(0);
  finish(Response.json({ saved: true }));
  await vi.advanceTimersByTimeAsync(30000);
  expect(work).toHaveBeenCalledTimes(1);
});

it("returns a sanitized error envelope if delivery fails", async () => {
  const response = streamTurn(async () => { throw new Error("private detail"); });
  const parsed = await readApiResponse(response);
  expect(parsed.status).toBe(503);
  expect(JSON.stringify(parsed.body)).not.toContain("private detail");
});
