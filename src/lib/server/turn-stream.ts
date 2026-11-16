import "server-only";

// JSON whitespace keeps the origin connection active without inventing model output.
// The final envelope preserves the operation's status even after HTTP headers are sent.
export function streamTurn(work: () => Promise<Response>): Response {
  const encoder = new TextEncoder();
  let stopped = false;
  let timer: ReturnType<typeof setInterval> | undefined;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(" ".repeat(2048) + "\n"));
      timer = setInterval(() => {
        if (!stopped) controller.enqueue(encoder.encode(" ".repeat(2048) + "\n"));
      }, 15_000);
      void (async () => {
        try {
          const response = await work();
          const payload = await response.json();
          if (!stopped) {
            controller.enqueue(encoder.encode(JSON.stringify({ status: response.status, body: payload })));
            controller.close();
          }
        } catch {
          if (!stopped) {
            controller.enqueue(encoder.encode(JSON.stringify({ status: 503, body: {
              error: "The result could not be delivered. Refresh to check conversation state before retrying.",
            } })));
            controller.close();
          }
        } finally {
          stopped = true;
          clearInterval(timer);
        }
      })();
    },
    cancel() {
      stopped = true;
      clearInterval(timer);
      // Do not retry or cancel an in-flight mutation: its final state is persisted.
    },
  });
  return new Response(stream, { headers: {
    "Content-Type": "application/json", "Cache-Control": "no-store, no-transform",
    "X-AlphaForge-Envelope": "1", "X-Accel-Buffering": "no",
  } });
}
