import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { FileStore, Conflict } from "@/lib/server/store";
import { Conversations } from "@/lib/server/conversations";
import { buildPayload } from "@/lib/server/agentcore";
import { newConversation, turnSchema, conversationGroup } from "@/lib/types";
const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(
    dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })),
  );
});
async function setup() {
  const dir = await mkdtemp(path.join(tmpdir(), "af-test-"));
  dirs.push(dir);
  const db = new FileStore(dir);
  const invoke = vi.fn(async (payload: ReturnType<typeof buildPayload>) => ({
    status: "ok",
    response: "Calculated",
    session_id: payload.session_id,
    revision: randomUUID(),
    confirmed_constraints: { crypto_max: 0, cash_min: 0.2 },
    proposed_constraints: null,
    portfolio_results: [],
    protocol_version: 2,
  }));
  return { db, dir, invoke, service: new Conversations(db, invoke) };
}
const turn = (version = 0) => ({
  prompt: "Please analyze.",
  action: "message" as const,
  version,
});
describe("durable conversations and runtime contract", () => {
  it("creates unique UUIDs without invoking AWS, and restores after restart", async () => {
    const { service, invoke, dir } = await setup();
    const a = await service.create("alice"),
      b = await service.create("alice");
    expect(a.id).not.toBe(b.id);
    expect(a.sessionId).toBe(a.id);
    expect(a.revision).toBeNull();
    expect(invoke).not.toHaveBeenCalled();
    const restarted = new Conversations(new FileStore(dir), invoke);
    expect((await restarted.list("alice")).map((c) => c.id)).toContain(a.id);
  });
  it("forwards new flag once and reuses exact session/revision, preserving returned constraints", async () => {
    const { service, invoke } = await setup();
    const c = await service.create("alice");
    const first = await service.turn("alice", c.id, turn(), "secret");
    expect(invoke.mock.calls[0][0]).toMatchObject({
      new_conversation: true,
      session_id: c.id,
      identity_token: "secret",
    });
    const second = await service.turn(
      "alice",
      c.id,
      turn(first.version),
      "secret",
    );
    expect(invoke.mock.calls[1][0]).toMatchObject({
      revision: first.revision,
      session_id: c.id,
    });
    expect(invoke.mock.calls[1][0]).not.toHaveProperty("new_conversation");
    expect(second.confirmedConstraints).toEqual({
      crypto_max: 0,
      cash_min: 0.2,
    });
  });
  it("switching conversations never modifies another state", async () => {
    const { service } = await setup();
    const a = await service.create("alice"),
      b = await service.create("alice");
    await service.turn("alice", a.id, turn(), "token");
    expect(await service.get("alice", b.id)).toEqual(b);
  });
  it("checks ownership for read, rename, delete, invoke and cancellation", async () => {
    const { service, invoke } = await setup();
    const c = await service.create("alice");
    for (const op of [
      () => service.get("bob", c.id),
      () => service.rename("bob", c.id, "Stolen", 0),
      () => service.delete("bob", c.id, 0),
      () => service.turn("bob", c.id, turn(), "token"),
      () => service.stopWaiting("bob", c.id, 0),
    ])
      await expect(op()).rejects.toMatchObject({ status: 404 });
    expect(await service.list("bob")).toEqual([]);
    expect(invoke).not.toHaveBeenCalled();
  });
  it("reserves turns across independent server instances and rejects stale clients", async () => {
    const { service, db, invoke } = await setup();
    const c = await service.create("alice");
    const other = new Conversations(db, invoke);
    const settled = await Promise.allSettled([
      service.turn("alice", c.id, turn(), "token"),
      other.turn("alice", c.id, turn(), "token"),
    ]);
    expect(settled.filter((v) => v.status === "fulfilled")).toHaveLength(1);
    expect(invoke).toHaveBeenCalledTimes(1);
    await expect(
      service.turn("alice", c.id, turn(), "token"),
    ).rejects.toThrow();
  });
  it("confirms and rejects actual proposals with the latest revision", async () => {
    const { service, db, invoke } = await setup();
    let c = await service.create("alice");
    c = {
      ...c,
      status: "ready",
      revision: randomUUID(),
      proposedConstraints: { cash_min: 0.3 },
      confirmedConstraints: { crypto_max: 0 },
      version: 1,
    };
    await db.put(`USER#alice`, c.id, c, 0);
    await service.turn(
      "alice",
      c.id,
      { ...turn(1), action: "confirm" },
      "token",
    );
    expect(invoke.mock.calls[0][0]).toMatchObject({
      confirm_proposal: true,
      revision: c.revision,
    });
    const d = await service.create("alice");
    const pending = {
      ...d,
      status: "ready" as const,
      revision: randomUUID(),
      proposedConstraints: { cash_min: 0.3 },
      version: 1,
    };
    await db.put("USER#alice", d.id, pending, 0);
    await service.turn(
      "alice",
      d.id,
      { ...turn(1), action: "reject" },
      "token",
    );
    expect(invoke.mock.calls[1][0]).toHaveProperty("reject_proposal", true);
    expect(invoke.mock.calls[1][0]).not.toHaveProperty("confirmed_constraints");
  });
  it("blocks memory errors and ambiguous timeouts durably, with no automatic retries", async () => {
    const { service, invoke } = await setup();
    for (const error of [false, true]) {
      const c = await service.create("alice");
      if (error) invoke.mockRejectedValueOnce(new Error("timeout"));
      else
        invoke.mockResolvedValueOnce({
          status: "conversation_unavailable",
        } as never);
      await expect(
        service.turn("alice", c.id, turn(), "token"),
      ).rejects.toMatchObject({ status: 409 });
      const saved = await service.get("alice", c.id);
      expect(saved.status).toBe("uncertain");
      await expect(
        service.turn("alice", c.id, turn(saved.version), "token"),
      ).rejects.toThrow();
    }
    expect(invoke).toHaveBeenCalledTimes(2);
  });
  it("fences a canceled request that has not claimed its turn", async () => {
    const { service, invoke } = await setup();
    const c = await service.create("alice");
    expect((await service.stopWaiting("alice", c.id, 0)).status).toBe(
      "uncertain",
    );
    await expect(
      service.turn("alice", c.id, turn(), "token"),
    ).rejects.toThrow();
    expect(invoke).not.toHaveBeenCalled();
  });
  it("rejects protocol mismatch for discard and retains confirmed values on failure", async () => {
    const { service, db, invoke } = await setup();
    let c = await service.create("alice");
    c = {
      ...c,
      version: 1,
      status: "ready",
      revision: randomUUID(),
      confirmedConstraints: { crypto_max: 0 },
      proposedConstraints: { crypto_max: 0.2 },
    };
    await db.put("USER#alice", c.id, c, 0);
    invoke.mockResolvedValueOnce({ status: "invalid_input" } as never);
    await expect(
      service.turn("alice", c.id, { ...turn(1), action: "reject" }, "token"),
    ).rejects.toThrow();
    expect((await service.get("alice", c.id)).confirmedConstraints).toEqual({
      crypto_max: 0,
    });
  });
  it("validates limits and never accepts a browser identity or session override", () => {
    expect(() => turnSchema.parse({ ...turn(), actor_id: "bob" })).toThrow();
    expect(() =>
      turnSchema.parse({ ...turn(), sessionId: randomUUID() }),
    ).toThrow();
    expect(() =>
      turnSchema.parse({
        ...turn(),
        action: "edit",
        constraints: { cash_min: 20 },
      }),
    ).toThrow();
    expect(
      turnSchema.parse({
        ...turn(),
        action: "edit",
        constraints: { cash_min: null },
      }).constraints,
    ).toEqual({ cash_min: null });
  });
  it("rejects missing revision and tests grouping by local calendar date", () => {
    expect(() =>
      buildPayload({ ...newConversation(), status: "ready" }, turn(), "token"),
    ).toThrow();
    expect(
      conversationGroup("2026-11-14T12:00:00", new Date("2026-11-15T12:00:00")),
    ).toBe("Yesterday");
  });
  it("enforces conditional writes and safe storage bounds", async () => {
    const { db } = await setup();
    await db.put("alice", "id", { data: "x" }, null);
    await expect(db.put("alice", "id", {}, null)).rejects.toBeInstanceOf(
      Conflict,
    );
    await expect(
      db.put("alice", "large", { data: "x".repeat(301000) }, null),
    ).rejects.toThrow("storage limit");
  });
});
it("marks abandoned in-flight turns uncertain without releasing the lock for retry", async () => {
  const { service, db, invoke } = await setup();
  const c = await service.create("alice");
  await db.put(
    "USER#alice",
    c.id,
    {
      ...c,
      version: 1,
      status: "processing",
      startedAt: new Date(Date.now() - 300000).toISOString(),
    },
    0,
  );
  const recovered = await service.get("alice", c.id);
  expect(recovered.status).toBe("uncertain");
  await expect(
    service.turn("alice", c.id, turn(recovered.version), "token"),
  ).rejects.toThrow();
  expect(invoke).not.toHaveBeenCalled();
});


it("leaves session, constraints and revision untouched when preflight fails", async () => {
  const { db, service, invoke } = await setup();
  const c = await service.create("alice");
  const guarded = new Conversations(db, invoke, async () => {
    throw new Error("Runtime Memory is not configured.");
  });
  await expect(guarded.turn("alice", c.id, turn(), "")).rejects.toThrow("Runtime Memory");
  expect(invoke).not.toHaveBeenCalled();
  expect(await guarded.get("alice", c.id)).toEqual(c);
});
