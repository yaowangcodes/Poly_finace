import "server-only";
import { randomUUID } from "node:crypto";
import {
  newConversation,
  runtimeSchema,
  type Conversation,
  type Turn,
} from "../types";
import { buildPayload } from "./agentcore";
import { Conflict, type Store } from "./store";
export class ServiceError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export const uncertainMessage =
  "The result of this request is uncertain. Your conversation may have been updated on the server. Refresh to check for a completed result. If it remains uncertain, explicitly start a new chat and review all limits; do not retry this turn.";
const ownerKey = (owner: string) => `USER#${owner}`;
export class Conversations {
  constructor(
    private db: Store,
    private invoke: (
      payload: ReturnType<typeof buildPayload>,
    ) => Promise<unknown>,
    private preflight: () => Promise<void> = async () => {},
  ) {}
  async list(owner: string) {
    return (await this.db.list<Conversation>(ownerKey(owner)))
      .map((r) => r.value)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  async get(owner: string, id: string): Promise<Conversation> {
    const row = await this.db.get<Conversation>(ownerKey(owner), id);
    if (!row) throw new ServiceError(404, "Conversation not found.");
    const c = row.value;
    if (
      c.status === "processing" &&
      c.startedAt &&
      Date.now() - Date.parse(c.startedAt) > 240_000
    ) {
      const blocked: Conversation = {
        ...c,
        status: "uncertain",
        error: uncertainMessage,
        version: c.version + 1,
      };
      try {
        await this.db.put(ownerKey(owner), id, blocked, c.version);
        return blocked;
      } catch (e) {
        if (e instanceof Conflict) return this.get(owner, id);
        throw e;
      }
    }
    return c;
  }
  async create(owner: string) {
    const c = newConversation();
    await this.db.put(ownerKey(owner), c.id, c, null);
    return c;
  }
  async stopWaiting(owner: string, id: string, version: number) {
    const c = await this.get(owner, id);
    if (
      c.version !== version ||
      c.status === "processing" ||
      c.status === "uncertain"
    )
      return c;
    // Fence a request that has not yet claimed its turn. Its old version can no
    // longer pass the conditional write if it arrives after this request.
    const blocked: Conversation = {
      ...c,
      status: "uncertain",
      version: c.version + 1,
      error: uncertainMessage,
    };
    try {
      await this.db.put(ownerKey(owner), id, blocked, c.version);
      return blocked;
    } catch (e) {
      if (e instanceof Conflict) return this.get(owner, id);
      throw e;
    }
  }
  async rename(owner: string, id: string, title: string, version: number) {
    const c = await this.get(owner, id);
    this.editable(c, version);
    const updated = {
      ...c,
      title,
      version: version + 1,
      updatedAt: new Date().toISOString(),
    };
    await this.db.put(ownerKey(owner), id, updated, version);
    return updated;
  }
  async delete(owner: string, id: string, version: number) {
    const c = await this.get(owner, id);
    if (c.version !== version) throw new Conflict("Conversation changed.");
    if (c.status === "processing")
      throw new ServiceError(
        409,
        "This conversation still has a pending turn.",
      );
    await this.db.delete(ownerKey(owner), id, version);
  }
  private editable(c: Conversation, version: number) {
    if (c.version !== version)
      throw new Conflict(
        "This conversation changed in another tab. Refresh before continuing.",
      );
    if (c.status === "processing" || c.status === "uncertain")
      throw new ServiceError(409, c.error ?? uncertainMessage);
  }
  async turn(owner: string, id: string, turn: Turn, token: string) {
    const c = await this.get(owner, id);
    this.editable(c, turn.version);
    if (
      (turn.action === "confirm" || turn.action === "reject") &&
      !c.proposedConstraints
    )
      throw new ServiceError(400, "There is no proposal to review.");
    if (Buffer.byteLength(JSON.stringify(c)) > 110_000)
      throw new ServiceError(
        409,
        "Conversation size limit reached. Start a new chat and reconfirm your limits.",
      );
    // Reject known configuration failures before reserving or invoking a turn.
    await this.preflight();
    const payload = buildPayload(c, turn, token); // server-owned session and revision only
    const now = new Date().toISOString(),
      turnId = randomUUID();
    const pending: Conversation = {
      ...c,
      status: "processing",
      version: c.version + 1,
      turnId,
      startedAt: now,
      error: null,
      updatedAt: now,
      title: c.messages.length === 0 && c.title === "New conversation"
          ? turn.prompt.slice(0, 60)
          : c.title,
      messages: [
        ...c.messages,
        {
          id: randomUUID(),
          role: "user",
          content: turn.prompt,
          createdAt: now,
        },
      ],
    };
    // Distributed CAS is durable BEFORE AWS. A crashed process leaves a blocked turn, never an auto-retry.
    await this.db.put(ownerKey(owner), id, pending, c.version);
    try {
      const raw = await this.invoke(payload);
      const parsed = runtimeSchema.safeParse(raw);
      if (!parsed.success || parsed.data.session_id !== c.sessionId)
        throw new Error("Memory, authorization, model or protocol error.");
      const r = parsed.data;
      if (
        turn.action === "reject" &&
        (r.protocol_version !== 2 || r.proposed_constraints !== null)
      )
        throw new Error("Runtime does not support rejection.");
      const completed: Conversation = {
        ...pending,
        status: "ready",
        version: pending.version + 1,
        revision: r.revision,
        confirmedConstraints: r.confirmed_constraints,
        proposedConstraints: r.proposed_constraints,
        messages: [
          ...pending.messages,
          {
            id: randomUUID(),
            role: "assistant",
            content: r.response,
            createdAt: new Date().toISOString(),
            portfolios: r.portfolio_results,
          },
        ],
        updatedAt: new Date().toISOString(),
        turnId: null,
        startedAt: null,
      };
      await this.db.put(ownerKey(owner), id, completed, pending.version);
      return completed;
    } catch {
      const failed: Conversation = {
        ...pending,
        status: "uncertain",
        version: pending.version + 1,
        error: uncertainMessage,
      };
      // A storage failure may itself be ambiguous. Never overwrite a completed record.
      try {
        await this.db.put(ownerKey(owner), id, failed, pending.version);
      } catch {
        /* retained processing state also blocks retries */
      }
      throw new ServiceError(409, uncertainMessage);
    }
  }
}
