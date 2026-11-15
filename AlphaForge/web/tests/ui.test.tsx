// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  render,
  screen,
  waitFor,
  cleanup,
  fireEvent,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChatApp } from "@/components/chat-app";
import { PortfolioPanel, metricValue } from "@/components/portfolio";
import { Constraints } from "@/components/constraints";
import { newConversation, type Conversation } from "@/lib/types";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  PieChart: () => <div data-testid="allocation-chart" />,
  Pie: () => null,
  Cell: () => null,
  Tooltip: () => null,
}));
beforeEach(() => {
  localStorage.clear();
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it("renders actual structured weights and metrics; missing fields are unavailable", async () => {
  render(
    <PortfolioPanel
      result={{
        status: "optimal",
        profile: "Custom",
        weights: { CASH: 0.3, SPY: 0.7 },
        metrics: { annual_volatility: 0.08 },
        constraint_checks: [
          {
            constraint: "cash_min",
            actual: 0.3,
            limit: 0.3,
            slack: 0,
            binding: true,
          },
        ],
      }}
    />,
  );
  expect(screen.getByText("8.00%")).toBeInTheDocument();
  expect(screen.getAllByText("Unavailable")).toHaveLength(4);
  await userEvent.click(
    screen.getByRole("button", { name: /View allocation/ }),
  );
  expect(screen.getByRole("cell", { name: "70.000%" })).toBeInTheDocument();
  expect(screen.getByText("Binding")).toBeInTheDocument();
  expect(screen.getByRole("cell", { name: "Cash" })).toBeInTheDocument();
  expect(metricValue("beta", null)).toBe("Unavailable");
});
it("shows infeasibility without fabricating allocation", () => {
  render(
    <PortfolioPanel
      result={{ status: "infeasible", message: "No limits were relaxed." }}
    />,
  );
  expect(screen.getByText("No feasible portfolio")).toBeInTheDocument();
  expect(screen.queryByTestId("allocation-chart")).not.toBeInTheDocument();
});
it("distinguishes proposed values and sends confirm/reject, without optimistic mutation", async () => {
  const c = {
      ...newConversation(),
      confirmedConstraints: { cash_min: 0.2, crypto_max: 0 },
      proposedConstraints: { cash_min: 0.3 },
    },
    onTurn = vi.fn();
  render(<Constraints conversation={c} disabled={false} onTurn={onTurn} />);
  expect(screen.getByText("CONFIRMED BY YOU")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Confirm change" }));
  expect(onTurn.mock.calls[0][0].action).toBe("confirm");
  await userEvent.click(screen.getByRole("button", { name: "Discard" }));
  expect(onTurn.mock.calls[1][0].action).toBe("reject");
  expect(c.confirmedConstraints.cash_min).toBe(0.2);
});
it("requires review for direct editing and validates percentages", async () => {
  const onTurn = vi.fn();
  render(
    <Constraints
      conversation={newConversation()}
      disabled={false}
      onTurn={onTurn}
    />,
  );
  await userEvent.click(
    screen.getByRole("button", { name: "Edit constraints" }),
  );
  await userEvent.type(screen.getByRole("spinbutton"), "200");
  expect(
    screen.getByRole("button", { name: "Confirm and apply" }),
  ).toBeDisabled();
  await userEvent.clear(screen.getByRole("spinbutton"));
  await userEvent.type(screen.getByRole("spinbutton"), "30");
  expect(onTurn).not.toHaveBeenCalled();
  await userEvent.click(
    screen.getByRole("button", { name: "Confirm and apply" }),
  );
  expect(onTurn.mock.calls[0][0].constraints).toEqual({ cash_min: 0.3 });
});
it("supports saved navigation, search, fresh New Chat, switching and mobile drawer controls", async () => {
  let list: Conversation[] = [
    {
      ...newConversation(),
      title: "Cash research",
      messages: [
        {
          id: "m",
          role: "assistant",
          content: "Previously saved answer",
          createdAt: new Date().toISOString(),
        },
      ],
      confirmedConstraints: { cash_min: 0.2 },
    },
  ];
  const fetcher = vi.fn(async (url: string, options?: RequestInit) => {
    if (url === "/api/me")
      return new Response(JSON.stringify({ name: "Alice" }));
    if (url === "/api/conversations" && options?.method === "POST") {
      const c = newConversation();
      list = [c, ...list];
      return new Response(JSON.stringify(c));
    }
    if (url === "/api/conversations") return new Response(JSON.stringify(list));
    return new Response(JSON.stringify(list.find((c) => url.endsWith(c.id))));
  });
  vi.stubGlobal("fetch", fetcher);
  const view = render(<ChatApp />);
  await screen.findByText("Previously saved answer");
  await userEvent.click(screen.getByRole("button", { name: "New chat" }));
  await screen.findByText("Welcome to AlphaForge");
  expect(
    fetcher.mock.calls.filter(([url]) => url.includes("/turn")),
  ).toHaveLength(0);
  await userEvent.click(screen.getByRole("button", { name: "Cash research" }));
  await screen.findByText("Previously saved answer");
  await userEvent.type(
    screen.getByRole("textbox", { name: "Search conversations" }),
    "absent",
  );
  expect(screen.getByText("No matching conversations")).toBeInTheDocument();
  await userEvent.click(
    screen.getByRole("button", { name: "Open navigation" }),
  );
  expect(view.container.querySelector(".sidebar")).toHaveClass("mobile-open");
  await userEvent.click(
    screen.getByRole("button", { name: "Close navigation" }),
  );
  expect(view.container.querySelector(".sidebar")).not.toHaveClass(
    "mobile-open",
  );
  view.unmount();
  render(<ChatApp />);
  await screen.findByText("Welcome to AlphaForge");
  expect(
    screen.getByRole("button", { name: "Cash research" }),
  ).toBeInTheDocument();
});
it("Enter submits, Shift+Enter does not, and the composer disables overlapping turns", async () => {
  const c = newConversation();
  let complete: ((r: Response) => void) | undefined;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url === "/api/me")
        return new Response(JSON.stringify({ name: "Alice" }));
      if (url === "/api/conversations")
        return new Response(JSON.stringify([c]));
      if (url.endsWith("/turn"))
        return new Promise<Response>((resolve) => {
          complete = resolve;
        });
      return new Response(JSON.stringify({ ...c, status: "processing" }));
    }),
  );
  render(<ChatApp />);
  const input = screen.getByRole("textbox", { name: "Message AlphaForge" });
  await waitFor(() => expect(input).not.toBeDisabled());
  await userEvent.type(input, "Analyze cash");
  fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
  expect(screen.queryByText("AlphaForge is working")).not.toBeInTheDocument();
  fireEvent.keyDown(input, { key: "Enter" });
  await screen.findByText("AlphaForge is working");
  expect(
    screen.getByRole("button", { name: "Stop waiting for response" }),
  ).toBeInTheDocument();
  complete?.(
    new Response(
      JSON.stringify({
        ...c,
        status: "ready",
        version: 2,
        revision: crypto.randomUUID(),
        messages: [
          {
            id: "reply",
            role: "assistant",
            content: "Completed research",
            createdAt: new Date().toISOString(),
          },
        ],
      }),
    ),
  );
  await screen.findByText("Completed research");
});
it("reconciles interrupted requests on reload before allowing another turn", async () => {
  const c = newConversation();
  localStorage.setItem(`af:pending:${c.id}`, "0");
  const fetcher = vi.fn(async (url: string) => {
    if (url === "/api/me")
      return new Response(JSON.stringify({ name: "Alice" }));
    if (url === "/api/conversations") return new Response(JSON.stringify([c]));
    return new Response(
      JSON.stringify({
        ...c,
        status: "uncertain",
        version: 1,
        error: "Previous request is uncertain.",
      }),
    );
  });
  vi.stubGlobal("fetch", fetcher);
  render(<ChatApp />);
  await screen.findByText("This conversation needs review");
  expect(screen.getByRole("button", { name: "Send message" })).toBeDisabled();
  expect(
    fetcher.mock.calls.some(([url]) => url.endsWith("/stop-waiting")),
  ).toBe(true);
  expect(localStorage.getItem(`af:pending:${c.id}`)).toBeNull();
});
it("local workspace enables chat without showing sign-in or sign-out", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async (url: string) =>
        new Response(
          JSON.stringify(
            url === "/api/me"
              ? { name: "Local workspace", authentication: "local" }
              : [],
          ),
        ),
    ),
  );
  render(<ChatApp />);
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "New chat" })).toBeEnabled(),
  );
  expect(
    screen.queryByRole("link", { name: /Sign in/ }),
  ).not.toBeInTheDocument();
  await userEvent.click(
    screen.getByRole("button", { name: /Local workspace.*Personal workspace/ }),
  );
  expect(
    screen.queryByRole("button", { name: /Sign out/ }),
  ).not.toBeInTheDocument();
  expect(screen.getByText(/No sign-in is needed/)).toBeInTheDocument();
});

it("checks connection on load and retries without sending an agent turn", async () => {
  const fetcher = vi.fn(async (url: string) => {
    if (url === "/api/me") return new Response(JSON.stringify({ name: "Local workspace", authentication: "local" }));
    if (url === "/api/conversations") return new Response("[]");
    return new Response(JSON.stringify({ status: "disconnected", message: "AWS session expired." }));
  });
  vi.stubGlobal("fetch", fetcher);
  render(<ChatApp />);
  await screen.findByText("Disconnected");
  expect(screen.getByText("AWS session expired.")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Retry connection" }));
  await screen.findByText("Disconnected");
  expect(fetcher.mock.calls.filter(([url]) => url === "/api/health")).toHaveLength(2);
  expect(fetcher.mock.calls.some(([url]) => url.endsWith("/turn"))).toBe(false);
});

it("does not fence a turn rejected by the connection preflight", async () => {
  const c = newConversation();
  const fetcher = vi.fn(async (url: string) => {
    if (url === "/api/me") return new Response(JSON.stringify({ name: "Local workspace", authentication: "local" }));
    if (url === "/api/health") return new Response(JSON.stringify({ status: "disconnected", message: "Memory missing" }));
    if (url === "/api/conversations") return new Response(JSON.stringify([c]));
    if (url.endsWith("/turn")) return new Response(JSON.stringify({ error: "Runtime configuration needs updating." }), { status: 424 });
    return new Response(JSON.stringify(c));
  });
  vi.stubGlobal("fetch", fetcher);
  render(<ChatApp />);
  const input = screen.getByRole("textbox", { name: "Message AlphaForge" });
  await waitFor(() => expect(input).toBeEnabled());
  await userEvent.type(input, "Hello");
  fireEvent.keyDown(input, { key: "Enter" });
  await screen.findByText("Runtime configuration needs updating.");
  await waitFor(() => expect(localStorage.getItem(`af:pending:${c.id}`)).toBeNull());
  expect(fetcher.mock.calls.some(([url]) => url.endsWith("/stop-waiting"))).toBe(false);
  expect(screen.queryByText("This conversation needs review")).not.toBeInTheDocument();
});
