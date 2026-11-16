import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Interview } from "@/lib/interview/engine";
import { createInterview, bank } from "@/lib/interview/engine";
const mocks = vi.hoisted(() => ({ owner: "alice", rows: new Map<string, { value: Interview; version: number }>() }));
vi.mock("@/lib/server/auth", () => ({ requireUser: async () => ({ owner: mocks.owner }), checkOrigin: (r: Request) => { if (r.headers.get("origin") !== "http://localhost:3000") throw new Error("Bad origin"); } }));
vi.mock("@/lib/server/store", async importOriginal => {
  const original = await importOriginal<typeof import("@/lib/server/store")>();
  return { ...original, store: () => ({
    get: async (owner: string, id: string) => structuredClone(mocks.rows.get(`${owner}/${id}`) ?? null),
    put: async (owner: string, id: string, value: Interview, expected: number | null) => {
      const key = `${owner}/${id}`;
      const previous = mocks.rows.get(key);
      if ((previous?.version ?? null) !== expected) throw new original.Conflict("Interview changed");
      const version = (expected ?? -1) + 1;
      mocks.rows.set(key, { value: structuredClone(value), version }); return version;
    },
  }) };
});
import { GET, POST } from "@/app/api/interview/route";
const post = (data: unknown) => POST(new Request("http://localhost:3000/api/interview", { method: "POST", headers: { origin: "http://localhost:3000", "content-type": "application/json" }, body: JSON.stringify(data) }));
beforeEach(() => { mocks.rows.clear(); mocks.owner = "alice"; vi.stubEnv("INTERVIEW_MODEL_ID", ""); });
afterEach(() => vi.unstubAllEnvs());
it("persists, resumes, and isolates owners", async () => {
  const r = await post({ action: "answer", version: 0, question_id: "objective", values: ["Protect my money"] });
  expect(r.status).toBe(200);
  expect((await r.json()).state.profile.objective).toBe("capital_preservation");
  expect((await (await GET(new Request("http://localhost:3000/api/interview"))).json()).state.profile.objective).toBe("capital_preservation");
  mocks.owner = "bob";
  expect((await (await GET(new Request("http://localhost:3000/api/interview"))).json()).state.profile.objective).toBeNull();
});
it("rejects stale versions and questions without changing the profile", async () => {
  await post({ action: "answer", version: 0, question_id: "objective", values: ["Protect my money"] });
  expect((await post({ action: "answer", version: 0, question_id: "objective", values: ["Grow over time"] })).status).toBe(409);
  await post({ action: "answer", version: 0, question_id: "horizon_years", values: ["3–5 years · use 4"] });
  expect((await post({ action: "restart", version: 0 })).status).toBe(409);
});
it("blocks confirmation with unknowns, then confirms and exports complete profiles", async () => {
  expect((await post({ action: "confirm", version: 0 })).status).toBe(400);
  const state = createInterview();
  for (const entry of bank) Object.assign(state.profile, entry.choices[0].patch);
  state.answered = bank.map(e => e.field);
  mocks.rows.set("INTERVIEW#alice/current", { value: state, version: 2 });
  const response = await post({ action: "confirm", version: 2 });
  expect(response.status).toBe(200);
  expect((await response.json()).state.status).toBe("complete");
  const download = await GET(new Request("http://localhost:3000/api/interview?download=1"));
  expect(download.headers.get("content-disposition")).toContain("investor-profile.json");
  const exported = await download.json();
  expect(exported.confirmed_at).toBeTruthy();
  expect(exported.handoff.ready_for_optimization).toBe(false);
});
it("saves a prose answer, extracts its value, advances, and exports the evidence", async () => {
  const r = await post({ action: "answer", version: 0, question_id: "objective", text: "I want to grow my savings" });
  expect(r.status).toBe(200);
  const data = await r.json();
  expect(data.state.profile.objective).toBe("growth");
  expect(data.state.next_question.id).toBe("horizon_years");
  const download = await GET(new Request("http://localhost:3000/api/interview?download=1"));
  const exported = await download.json();
  expect(exported.profile.objective).toBe("growth");
  expect(exported.history[0].answer).toBe("I want to grow my savings");
});
it("persists an unclear answer and asks a distinct clarification instead of silently repeating", async () => {
  const r = await post({ action: "answer", version: 0, question_id: "objective", text: "Not sure yet" });
  const data = await r.json();
  expect(r.status).toBe(200);
  expect(data.state.profile.objective).toBeNull();
  expect(data.state.next_question.id).toMatch(/^followup:/);
  expect(data.state.next_question.text).not.toBe(createInterview().next_question?.text);
  expect(data.state.history[0].answer).toBe("Not sure yet");
});
it("exports the new persona, ESG and liquidity fields", async () => {
  const state = createInterview();
  Object.assign(state.profile, { age: 41, occupation: "Operations manager", household: "partnered", dependants: 2, goal_details: "Balanced growth for future family needs", retirement_status: "not_a_goal", sector_interests: ["ai"], diversification_preference: "broad", company_preference: "mix", esg_priorities: ["environmental", "social"], controversy_policy: "strict", liquidity_needs: "some", liquidity_amount: 250, liquidity_months: 6, currency: "CAD", tax_restrictions: "TFSA", regulatory_restrictions: "No leverage" });
  mocks.rows.set("INTERVIEW#alice/current", { value: state, version: 0 });
  const exported = await (await GET(new Request("http://localhost:3000/api/interview?download=1"))).json();
  expect(exported.profile).toMatchObject({ age: 41, dependants: 2, sector_interests: ["ai"], controversy_policy: "strict", tax_restrictions: "TFSA" });
  expect(exported.handoff.esg_priorities).toEqual(["environmental", "social"]);
  expect(exported.handoff.liquidity_reserve).toEqual({ amount: 250, months_until_needed: 6, currency: "CAD" });
});
