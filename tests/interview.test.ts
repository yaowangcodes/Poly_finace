import { describe, expect, it } from "vitest";
import { createInterview, answerChoice, applyPatch, refresh, numericAnswer, handoff, bank } from "@/lib/interview/engine";

describe("adaptive text interview", () => {
  it("starts with unknowns and preserves the requested JSON shape", () => {
    const s = createInterview();
    expect(s.status).toBe("interviewing");
    expect(s.profile.risk_tolerance).toBeNull();
    expect(s.next_question?.id).toBe("objective");
    expect(s.ready_for_review).toBe(false);
  });
  it("helps on uncertainty, then moves on without making up an answer", () => {
    let s = answerChoice(createInterview(), ["Not sure"]);
    expect(s.next_question?.id).toBe("objective");
    expect(s.next_question?.help).toContain("okay to be unsure");
    s = answerChoice(s, ["Not sure"]);
    expect(s.next_question?.id).toBe("horizon_years");
    expect(s.profile.objective).toBeNull();
    expect(s.ready_for_review).toBe(false);
  });
  it("steers around short-horizon growth and records a user's chosen revision", () => {
    let s = applyPatch(createInterview(), { objective: "growth", horizon_years: 2 });
    expect(s.next_question?.id).toBe("conflict:horizon");
    s = answerChoice(s, ["Prioritize protecting money for that date"]);
    expect(s.profile.objective).toBe("capital_preservation");
    expect(s.unresolved_conflicts).toHaveLength(0);
  });
  it("keeps willingness separate from capacity for loss", () => {
    const s = applyPatch(createInterview(), { risk_tolerance: "high", capacity_for_loss: "low" });
    expect(s.unresolved_conflicts[0].id).toBe("capacity");
    expect(s.profile.capacity_for_loss).toBe("low");
    expect(s.ready_for_review).toBe(false);
  });
  it("combines exclusions, skips policy for none, and rejects incompatible selections", () => {
    const s = createInterview();
    s.answered = bank.slice(0, 7).map(e => e.field);
    refresh(s);
    answerChoice(s, ["Tobacco", "Weapons"]);
    expect(s.profile.ethical_exclusions).toEqual(["tobacco", "weapons"]);
    expect(s.next_question?.id).toBe("exclusion_policy");
    applyPatch(s, { ethical_exclusions: [] });
    expect(s.profile.exclusion_policy).toBe("none");
    applyPatch(s, { ethical_exclusions: ["tobacco"] });
    expect(s.profile.exclusion_policy).toBeNull();
    expect(s.answered).not.toContain("exclusion_policy");
  });
  it("will not mark unanswered required fields ready and does not invent optimizer limits", () => {
    const s = createInterview();
    s.answered = bank.map(e => e.field);
    refresh(s);
    expect(s.ready_for_review).toBe(false);
    expect(handoff(s).optimizer_constraints).toEqual({});
    expect(handoff(s).ready_for_optimization).toBe(false);
  });
  it("supports an entire guided interview and leaves optional uncertainty explicit", () => {
    let s = createInterview();
    for (let n = 0; n < bank.length + 10 && s.next_question; n++) {
      const q = s.next_question;
      const entry = bank.find(e => e.field === q.field)!;
      s = answerChoice(s, [entry.choices[0].label]);
    }
    expect(s.ready_for_review).toBe(true);
    expect(s.status).toBe("review");
    expect(s.next_question).toBeNull();
    expect(handoff(s).optimizer_constraints).toEqual({ crypto_max: 0 });
  });
  it("parses explicit values without confusing prose or percent units", () => {
    expect(numericAnswer("horizon_years", "4 years")).toEqual({ horizon_years: 4 });
    expect(numericAnswer("crypto_max", "3%")).toEqual({ crypto_max: .03 });
    expect(numericAnswer("portfolio_value", "$10,000")).toEqual({ portfolio_value: 10000 });
    expect(numericAnswer("horizon_years", "not 4 years, perhaps 10")).toBeNull();
    expect(() => applyPatch(createInterview(), { crypto_max: 2 })).toThrow();
  });
});
