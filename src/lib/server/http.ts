import "server-only";
import { z } from "zod";
import { NextResponse } from "next/server";
import { Conflict, store } from "./store";
import { Conversations, ServiceError } from "./conversations";
import { invokeRuntime } from "./agentcore";
import { connectionHealth } from "./health";
export const service = () => new Conversations(store(), invokeRuntime, async () => {
  const health = await connectionHealth();
  if (health.status !== "ready") throw new ServiceError(424, health.message);
});
export function json(data: unknown, status = 200) {
  return NextResponse.json(data, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}
export function failure(error: unknown) {
  if (error instanceof ServiceError)
    return json({ error: error.message }, error.status);
  if (error instanceof Conflict) return json({ error: error.message }, 409);
  if (error instanceof z.ZodError)
    return json(
      { error: "Invalid request. Check the fields and numerical limits." },
      400,
    );
  return json(
    {
      error:
        "The service is unavailable. Refresh to check conversation state before sending another turn.",
    },
    503,
  );
}
export async function body(request: Request) {
  // Bound both announced and actual body size; no credentials or request bodies in logs.
  if (Number(request.headers.get("content-length")) > 24000)
    throw new ServiceError(413, "Request too large.");
  const reader = request.body?.getReader();
  if (!reader) throw new ServiceError(400, "Missing request.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 24000) {
      await reader.cancel();
      throw new ServiceError(413, "Request too large.");
    }
    chunks.push(value);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new ServiceError(400, "Invalid JSON.");
  }
}
