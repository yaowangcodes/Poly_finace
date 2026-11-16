import { describe, expect, it } from "vitest";
import { bank, createInterview, refresh, type Field } from "@/lib/interview/engine";
import { extractTextAnswer } from "@/lib/interview/extract";
function at(field: Field) {
  const state = createInterview();
  state.answered = bank.slice(0, bank.findIndex(e => e.field === field)).map(e => e.field);
  return refresh(state);
}
describe("meaningful extraction from free-text answers", () => {
  it.each([
    ["objective", "I want to grow my money over time", { objective: "growth" }],
    ["objective", "I'm saving for a house in five years", { objective: "specific_goal", horizon_years: 5 }],
    ["objective", "I want to protect my savings", { objective: "capital_preservation" }],
    ["objective", "I'd like regular income", { objective: "income" }],
    ["horizon_years", "I will need the money in four years", { horizon_years: 4 }],
    ["liquidity_needs", "I won't need any of it this year", { liquidity_needs: "none" }],
    ["liquidity_needs", "I will need some of the money", { liquidity_needs: "some" }],
    ["income_stability", "I freelance and have savings as a buffer", { income_stability: "variable" }],
    ["capacity_for_loss", "I can't afford to lose money", { capacity_for_loss: "low" }],
    ["risk_tolerance", "moderate", { risk_tolerance: "moderate" }],
    ["risk_tolerance", "I would hold and keep it invested", { risk_tolerance: "moderate" }],
    ["knowledge_experience", "I'm a beginner and have never invested", { knowledge_experience: "beginner" }],
    ["ethical_exclusions", "I want to avoid tobacco and weapons", { ethical_exclusions: ["tobacco", "weapons"] }],
    ["ethical_exclusions", "I have no exclusions", { ethical_exclusions: [], exclusion_policy: "none" }],
    ["exclusion_policy", "These exclusions are mandatory", { exclusion_policy: "strict" }],
    ["crypto_max", "I don't want any cryptocurrency", { crypto_max: 0 }],
    ["crypto_max", "I'm open to at most 3% in crypto", { crypto_max: .03 }],
    ["return_target_percent", "I am aiming for 6% annually", { return_target_percent: 6 }],
    ["return_target_percent", "I have no fixed return target", { return_target_percent: null }],
    ["portfolio_value", "I want to invest $12,500 CAD", { portfolio_value: 12500, currency: "CAD" }],
    ["currency", "Canadian dollars please", { currency: "CAD" }],
  ] as const)("extracts %s from %s", (field, text, expected) => {
    expect(extractTextAnswer(at(field), text).patch).toEqual(expected);
  });
  it.each([
    ["objective", "I don't want growth"],
    ["objective", "I might buy a house or I might grow my money"],
    ["horizon_years", "between 3 and 5 years"],
    ["horizon_years", "not in 4 years, in 10 years"],
    ["risk_tolerance", "I wouldn't sell"],
    ["ethical_exclusions", "Tobacco is fine but exclude weapons"],
    ["ethical_exclusions", "Avoid fossil fuels and alcohol"],
    ["crypto_max", "I want crypto but no more than 5%"],
    ["crypto_max", "maybe 5%"],
    ["currency", "not USD, CAD"],
  ] as const)("does not guess %s from %s", (field, text) => {
    expect(extractTextAnswer(at(field), text).patch).toEqual({});
  });
});
