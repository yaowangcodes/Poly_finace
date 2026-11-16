"use client";
import { useEffect, useState } from "react";
export function ConnectionStatus() {
  const [state, setState] = useState({
    status: "connecting",
    message: "Checking AWS connection without calling the model.",
  });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/health", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error();
        const result = await response.json();
        if (!["ready", "disconnected"].includes(result.status))
          throw new Error();
        if (!controller.signal.aborted) setState(result);
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setState({
            status: "disconnected",
            message:
              "Unable to check AWS connection. Your saved chats remain available.",
          });
      });
    return () => controller.abort();
  }, [attempt]);
  return (
    <div className="connection-status" role="status" title={state.message}>
      <span>
        {state.status === "ready"
          ? "Ready"
          : state.status === "connecting"
            ? "Connecting…"
            : "Disconnected"}
      </span>
      {state.status === "disconnected" && (
        <>
          <span>{state.message}</span>
          <button
            type="button"
            onClick={() => {
              setState({
                status: "connecting",
                message: "Checking AWS connection.",
              });
              setAttempt((x) => x + 1);
            }}
          >
            Retry connection
          </button>
        </>
      )}
    </div>
  );
}
