import { afterEach, describe, expect, it, vi } from "vitest";
import { createInterview, refresh, answerChoice } from "@/lib/interview/engine";
vi.mock("@/lib/server/interview-bedrock", () => ({ converse: vi.fn() }));
import { converse } from "@/lib/server/interview-bedrock";
import { interpretAnswer } from "@/lib/server/interview";
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });
describe("conversational interview", () => {
  it("interprets several explicit facts and chooses the next missing field", async () => {
    vi.stubEnv("INTERVIEW_MODEL_ID", "test-model");
    vi.mocked(converse).mockResolvedValue(JSON.stringify({ patch: { objective: "capital_preservation", horizon_years: 4 }, message: "Recorded your four-year goal.", follow_up: null }));
    const s = await interpretAnswer(createInterview(), "Protect my savings for a purchase in four years.");
    expect(s.profile.horizon_years).toBe(4);
    expect(s.next_question?.id).toBe("liquidity_needs");
    expect(s.history[0].answer).toContain("four years");
  });
  it("turns an ambiguous answer into a contextual follow-up with supported options", async () => {
    vi.stubEnv("INTERVIEW_MODEL_ID", "test-model");
    vi.mocked(converse).mockResolvedValue(JSON.stringify({ patch: {}, message: "Let's clarify which goal comes first.", follow_up: { field: "objective", text: "Is this money primarily for a purchase or long-term growth?", help: "Choose the main priority for this portfolio.", is_conflict: true, choices: [{ label: "The purchase is my priority", patch: { objective: "specific_goal" } }, { label: "Long-term growth", patch: { objective: "growth" } }] } }));
    let s = await interpretAnswer(createInterview(), "Maybe a home, or just build wealth.");
    expect(s.next_question?.text).toContain("purchase or long-term growth");
    expect(s.unresolved_conflicts[0].id).toBe("conversation");
    expect(s.ready_for_review).toBe(false);
    s = answerChoice(s, ["The purchase is my priority"]);
    expect(s.profile.objective).toBe("specific_goal");
    expect(s.model_question).toBeNull();
    expect(s.unresolved_conflicts).toHaveLength(0);
  });
  it("asks for clarification rather than applying unsupported model-generated fields", async () => {
    vi.stubEnv("INTERVIEW_MODEL_ID", "test-model");
    vi.mocked(converse).mockResolvedValue(JSON.stringify({ patch: { vol_max: .2 }, message: "invented constraint" }));
    const state = await interpretAnswer(createInterview(), "I like some risk");
    expect(state.profile.objective).toBeNull();
    expect(state.model_question).toBeTruthy();
    expect(state.history[0].answer).toBe("I like some risk");
  });
  it("keeps unknown free text unknown without an interview model", async () => {
    vi.stubEnv("INTERVIEW_MODEL_ID", "");
    const s = await interpretAnswer(createInterview(), "I'm not sure what my goals are");
    expect(s.profile.objective).toBeNull();
    expect(s.next_question?.id).toMatch(/^followup:/);
    expect(s.next_question?.text).not.toBe(createInterview().next_question?.text);
    expect(converse).not.toHaveBeenCalled();
  });
  it("accepts exact values without using a model", async () => {
    const s = createInterview(); s.answered = ["objective"]; refresh(s);
    await interpretAnswer(s, "4 years");
    expect(s.profile.horizon_years).toBe(4);
    expect(converse).not.toHaveBeenCalled();
  });
});

it("advances for a clear prose answer without an AWS model", async () => {
  vi.stubEnv("INTERVIEW_MODEL_ID", "");
  const state = await interpretAnswer(createInterview(), "I want to grow my money over time");
  expect(state.profile.objective).toBe("growth");
  expect(state.next_question?.id).toBe("horizon_years");
  expect(state.last_answer).toMatchObject({ extracted_fields: ["objective"], needs_clarification: false });
});
it("asks a targeted clarification when a model returns only a message", async () => {
  vi.stubEnv("INTERVIEW_MODEL_ID", "test-model");
  vi.mocked(converse).mockResolvedValue(JSON.stringify({ patch: {}, message: "Could you clarify?" }));
  const state = await interpretAnswer(createInterview(), "Something comfortable for later");
  expect(state.profile.objective).toBeNull();
  expect(state.next_question?.id).toMatch(/^followup:/);
  expect(state.next_question?.text).not.toBe(createInterview().next_question?.text);
  expect(state.last_answer?.needs_clarification).toBe(true);
});
it("records unclear text when inference is unavailable rather than discarding it", async () => {
  vi.stubEnv("INTERVIEW_MODEL_ID", "test-model");
  vi.mocked(converse).mockRejectedValue(new Error("Expired credentials"));
  const state = await interpretAnswer(createInterview(), "Something comfortable for later");
  expect(state.history[0].answer).toBe("Something comfortable for later");
  expect(state.next_question?.id).toMatch(/^followup:/);
  expect(state.profile.objective).toBeNull();
});
it("accepts free text to resolve a contradiction without re-asking the old conflict", async () => {
  vi.stubEnv("INTERVIEW_MODEL_ID", "");
  const state = createInterview();
  state.profile.objective = "growth"; state.profile.horizon_years = 2; refresh(state);
  const next = await interpretAnswer(state, "I want to protect my money");
  expect(next.profile.objective).toBe("capital_preservation");
  expect(next.unresolved_conflicts).toHaveLength(0);
  expect(next.next_question?.id).not.toMatch(/^(?:conflict|followup):/);
});

it("accepts a numeric free-text response to its own clarification", async () => {
  vi.stubEnv("INTERVIEW_MODEL_ID", "");
  const state = createInterview(); state.answered = ["objective"]; refresh(state);
  const unclear = await interpretAnswer(state, "I'm not sure yet");
  expect(unclear.next_question?.id).toMatch(/^followup:/);
  const clarified = await interpretAnswer(unclear, "4");
  expect(clarified.profile.horizon_years).toBe(4);
  expect(clarified.model_question).toBeNull();
  expect(clarified.next_question?.id).toBe("liquidity_needs");
});
