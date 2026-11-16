import { describe, expect, it } from "vitest";
import { applicable, applyPatch, bank, createInterview, refresh, answerChoice, handoff, type Field } from "@/lib/interview/engine";
import { interpretAnswer } from "@/lib/server/interview";
const at = (field: Field) => {
  const s = createInterview();
  s.answered = bank.filter(e => e.field !== field).map(e => e.field);
  return refresh(s);
};
describe("complete persona context", () => {
  it("covers every missing persona category with a structured question", () => {
    const fields = bank.map(e => e.field);
    for (const field of ["age", "occupation", "household", "dependants", "goal_details", "retirement_status", "retirement_years", "sector_interests", "diversification_preference", "company_preference", "esg_priorities", "controversy_policy", "liquidity_amount", "liquidity_months", "tax_restrictions", "regulatory_restrictions"]) expect(fields).toContain(field);
  });
  it("migrates old confirmed profiles without losing responses and asks the new questions", () => {
    const s = createInterview();
    for (const e of bank.slice(0, 14)) Object.assign(s.profile, e.choices[0].patch);
    s.answered = bank.slice(0, 14).map(e => e.field);
    for (const e of bank.slice(14)) Reflect.deleteProperty(s.profile, e.field);
    s.status = "complete"; s.confirmed_at = "2026-11-16T00:00:00.000Z";
    refresh(s);
    expect(s.profile.objective).toBe("capital_preservation");
    expect(s.profile.age).toBeNull();
    expect(s.next_question?.id).toBe("age");
    expect(s.status).toBe("interviewing");
    expect(s.confirmed_at).toBeNull();
  });
  it("asks retirement timing only when planning retirement", () => {
    const s = createInterview();
    const entry = bank.find(e => e.field === "retirement_years")!;
    expect(applicable(entry, s.profile)).toBe(false);
    applyPatch(s, { retirement_status: "planning" });
    expect(applicable(entry, s.profile)).toBe(true);
    applyPatch(s, { retirement_years: 5, retirement_status: "retired" });
    expect(applicable(entry, s.profile)).toBe(false);
    applyPatch(s, { retirement_status: "planning" });
    expect(s.profile.retirement_years).toBeNull();
    expect(s.answered).not.toContain("retirement_years");
  });
  it("requires the reserve amount and timing only when liquidity is needed", () => {
    const s = createInterview();
    applyPatch(s, { liquidity_needs: "none" });
    expect(s.unknown_fields).not.toContain("liquidity_amount");
    expect(handoff(s).liquidity_reserve.amount).toBe(0);
    applyPatch(s, { liquidity_needs: "some" });
    expect(s.unknown_fields).toContain("liquidity_amount");
    expect(s.unknown_fields).toContain("liquidity_months");
    applyPatch(s, { liquidity_amount: 300, liquidity_months: 3, currency: "CAD" });
    expect(handoff(s).liquidity_reserve).toEqual({ amount: 300, months_until_needed: 3, currency: "CAD" });
  });
  it("combines sector and ESG choices and rejects combining none with a preference", () => {
    const s = at("sector_interests");
    answerChoice(s, ["Technology", "Artificial intelligence"]);
    expect(s.profile.sector_interests).toEqual(["technology", "ai"]);
    const esg = at("esg_priorities");
    answerChoice(esg, ["Environmental impact and climate", "Social impact, labour, and human rights"]);
    expect(esg.profile.esg_priorities).toEqual(["environmental", "social"]);
    expect(() => answerChoice(at("sector_interests"), ["Technology", "No sector preference"])).toThrow();
  });
  it("checks impossible reserves instead of treating them as ready", () => {
    const s = applyPatch(createInterview(), { liquidity_needs: "some", portfolio_value: 1000, liquidity_amount: 2000 });
    expect(s.unresolved_conflicts.some(c => c.id === "liquidity_amount")).toBe(true);
    expect(s.ready_for_review).toBe(false);
    applyPatch(s, { liquidity_amount: 200 });
    expect(s.unresolved_conflicts.some(c => c.id === "liquidity_amount")).toBe(false);
  });
  it("records prose descriptions, exact age, dependants, and liquidity timing", async () => {
    expect((await interpretAnswer(at("age"), "41 years old")).profile.age).toBe(41);
    expect((await interpretAnswer(at("dependants"), "I have 2 children")).profile.dependants).toBe(2);
    expect((await interpretAnswer(at("occupation"), "Operations manager")).profile.occupation).toBe("Operations manager");
    expect((await interpretAnswer(at("goal_details"), "Preserve retirement savings while maintaining some growth")).profile.goal_details).toContain("retirement savings");
    const state = at("liquidity_months"); state.profile.liquidity_needs = "some"; refresh(state);
    expect((await interpretAnswer(state, "in three months")).profile.liquidity_months).toBe(3);
  });
  it("keeps unlisted sector interests verbatim rather than dropping them", async () => {
    const s = await interpretAnswer(at("sector_interests"), "Real estate");
    expect(s.profile.sector_interests).toEqual(["other"]);
    expect(s.profile.constraints_notes).toContain("Real estate");
  });
});
