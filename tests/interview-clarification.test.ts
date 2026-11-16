import { afterEach, expect, it, vi } from "vitest";
import { bank, createInterview, refresh, answerChoice, type Field } from "@/lib/interview/engine";
import { repeatedQuestion } from "@/lib/interview/clarification";
vi.mock("@/lib/server/interview-bedrock", () => ({ converse: vi.fn() }));
import { converse } from "@/lib/server/interview-bedrock";
import { interpretAnswer } from "@/lib/server/interview";
const at = (field: Field) => {
  const s = createInterview();
  s.answered = bank.slice(0, bank.findIndex(e => e.field === field)).map(e => e.field);
  return refresh(s);
};
afterEach(() => { vi.unstubAllEnvs(); vi.resetAllMocks(); });
it("asks about the missing buffer after a user mentions freelance income", async () => {
  vi.stubEnv("INTERVIEW_MODEL_ID", "");
  const s = await interpretAnswer(at("income_stability"), "I freelance");
  expect(s.next_question?.text).toContain("savings outside this investment");
  expect(s.next_question?.help).toContain("I freelance");
  expect(s.profile.income_stability).toBeNull();
  answerChoice(s, ["Yes, I have a buffer for lower-income periods"]);
  expect(s.profile.income_stability).toBe("variable");
});
it("clarifies a range with explicit endpoints and never silently picks one", async () => {
  vi.stubEnv("INTERVIEW_MODEL_ID", "");
  const s = await interpretAnswer(at("horizon_years"), "between three and five years");
  expect(s.profile.horizon_years).toBeNull();
  expect(s.next_question?.text).toContain("3–5");
  expect(s.next_question?.options).toContain("Use 3 years");
  expect(s.next_question?.options).toContain("Use 5 years");
  answerChoice(s, ["Use 3 years"]);
  expect(s.profile.horizon_years).toBe(3);
});
it("uses a fresh narrower framing when uncertainty persists", async () => {
  vi.stubEnv("INTERVIEW_MODEL_ID", "");
  let s = createInterview();
  const previous = [s.next_question!.text];
  for (let i = 0; i < 3; i++) {
    s = await interpretAnswer(s, "I'm not sure yet");
    expect(previous).not.toContain(s.next_question!.text);
    previous.push(s.next_question!.text);
  }
  expect(s.profile.objective).toBeNull();
  const next = await interpretAnswer(s, "I'm still unsure");
  expect(next.profile.objective).toBeNull();
  expect(next.ready_for_review).toBe(false);
  expect(next.next_question?.id).toBe("horizon_years");
});
it("rejects a model's repeated question even if it has an acknowledgment prefix", async () => {
  vi.stubEnv("INTERVIEW_MODEL_ID", "test");
  const state = createInterview();
  vi.mocked(converse).mockResolvedValue(JSON.stringify({ patch: {}, message: "Please clarify", follow_up: { field: "objective", text: `Thanks for that. ${state.next_question!.text}`, help: "Choose again", is_conflict: false, choices: bank[0].choices.slice(0, 2) } }));
  const s = await interpretAnswer(state, "Something comfortable");
  expect(s.next_question?.text).not.toContain(state.history[0].question);
  expect(s.next_question?.help).toContain("Something comfortable");
  expect(s.profile.objective).toBeNull();
});
it("recognizes near-identical reformulations, not only identical strings", () => {
  expect(repeatedQuestion("Could you clarify what your main priority for this money is?", ["What is your main priority for this money?"])).toBe(true);
  expect(repeatedQuestion("Would a market decline force you to change essential spending?", ["How comfortable are you with risk?"])).toBe(false);
});
