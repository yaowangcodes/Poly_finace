import { z } from "zod";
import { requireUser, checkOrigin } from "@/lib/server/auth";
import { body, json, failure } from "@/lib/server/http";
import { store, Conflict } from "@/lib/server/store";
import { ServiceError } from "@/lib/server/conversations";
import { interpretAnswer } from "@/lib/server/interview";
import { createInterview, answerChoice, refresh, bank, handoff, type Interview } from "@/lib/interview/engine";
export const runtime = "nodejs";
const input = z.object({
  action: z.enum(["answer", "restart", "edit", "confirm"]),
  version: z.number().int().nonnegative(),
  question_id: z.string().max(100).optional(),
  values: z.array(z.string().max(200)).max(10).optional(),
  text: z.string().trim().min(1).max(2000).optional(),
  field: z.string().max(100).optional(),
});
const key = (owner: string) => `INTERVIEW#${owner}`;
function response(state: Interview, version: number) {
  return { state, version, mode: (process.env.INTERVIEW_MODEL_ID || process.env.BEDROCK_MODEL_ID) ? "conversational" : "guided", handoff: handoff(state) };
}
export async function GET(request: Request) {
  try {
    const user = await requireUser();
    const row = await store().get<Interview>(key(user.owner), "current");
    if (row) row.value = refresh(row.value);
    if (new URL(request.url).searchParams.get("download") === "1") {
      if (!row) throw new ServiceError(404, "Start an interview first.");
      return new Response(JSON.stringify({ ...row.value, handoff: handoff(row.value) }, null, 2), { headers: { "Content-Type": "application/json", "Content-Disposition": 'attachment; filename="investor-profile.json"', "Cache-Control": "no-store" } });
    }
    return json(response(row?.value ?? createInterview(), row?.version ?? 0));
  } catch (error) { return failure(error); }
}
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const user = await requireUser();
    const data = input.parse(await body(request));
    const db = store();
    const row = await db.get<Interview>(key(user.owner), "current");
    if (data.version !== (row?.version ?? 0)) throw new Conflict("Your interview changed in another tab. Reload to see the latest answer.");
    let state = row ? refresh(row.value) : createInterview();
    if (state.history.length >= 200 && data.action === "answer") throw new ServiceError(400, "Interview limit reached. Download your profile and restart.");
    if (data.action === "restart") state = createInterview();
    if (data.action === "edit") {
      const entry = bank.find(e => e.field === data.field);
      if (!entry) throw new ServiceError(400, "Unknown profile field.");
      state.profile[entry.field] = null;
      state.answered = state.answered.filter(f => f !== entry.field);
      state.helped = state.helped.filter(f => f !== entry.field);
      state.confirmed_at = null;
      state.model_question = null;
      delete state.last_answer;
      if (state.clarification_attempts) delete state.clarification_attempts[entry.field];
      state = refresh(state);
      state.message = "Let's revisit that answer.";
    }
    if (data.action === "answer") {
      if (!state.next_question || data.question_id !== state.next_question.id) throw new Conflict("This question has changed. Reload before answering.");
      if (data.text && data.values?.length) throw new ServiceError(400, "Submit answer choices or your own words, not both.");
      if (data.text) {
        try { state = await interpretAnswer(state, data.text); }
        catch (error) {
          if (error instanceof ServiceError) throw error;
          throw new ServiceError(502, "We couldn't interpret that answer. Nothing was saved. Try an answer choice, or rephrase your response.");
        }
      }
      else {
        try { state = answerChoice(state, data.values ?? []); }
        catch (error) { throw new ServiceError(400, error instanceof Error ? error.message : "Invalid answer."); }
      }
    }
    if (data.action === "confirm") {
      state = refresh(state);
      if (!state.ready_for_review) throw new ServiceError(400, "Clarify required fields and conflicts before confirming.");
      state.status = "complete";
      state.confirmed_at = new Date().toISOString();
      state.message = "Your investor profile is confirmed and ready to export. Optimization still needs a validated translation of your constraints.";
    }
    const version = await db.put(key(user.owner), "current", state, row?.version ?? null);
    return json(response(state, version));
  } catch (error) { return failure(error); }
}
