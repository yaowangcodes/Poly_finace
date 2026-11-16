import { bank, profileSchema, type Choice, type Field, type Interview } from "./engine";
type FollowUp = NonNullable<Interview["model_question"]>;
const words = (text: string) => text.toLowerCase().replace(/[’‘]/g, "'").replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
const stop = new Set(["a", "an", "the", "this", "that", "your", "you", "i", "my", "is", "are", "do", "would", "could", "can", "please", "clarify", "about", "to", "for", "of", "it", "in", "and", "or"]);
export function repeatedQuestion(candidate: string, previous: string[]): boolean {
  const clean = words(candidate);
  const tokens = new Set(clean.split(" ").filter(w => !stop.has(w)));
  return previous.some(question => {
    const other = words(question);
    if (clean === other || (other.length > 24 && clean.includes(other))) return true;
    const old = new Set(other.split(" ").filter(w => !stop.has(w)));
    const overlap = [...tokens].filter(t => old.has(t)).length;
    return old.size >= 4 && overlap / new Set([...tokens, ...old]).size >= .72;
  });
}
const reframes: Record<Field, [string, string]> = {
  objective: ["If you had to put one need first, would you protect the money, accept ups and downs for growth, or use it for an expense?", "Think of a successful outcome: would you have kept your savings intact, built a larger balance, or paid for something specific?"],
  horizon_years: ["What is the earliest expense that could require a withdrawal, and roughly how many years away is it?", "Could you leave this money invested for at least five years, or might an expense require it sooner? Choose a planning value below or give a number."],
  liquidity_needs: ["Could next year's essential bills be covered without withdrawing from this investment?", "Imagine an expense due within 12 months: would it use none, a portion, or almost all of this investment?"],
  income_stability: ["If your next pay cheque were delayed, would income or savings outside this investment still cover your essential bills?", "Which describes your safety net: dependable pay plus savings, variable pay with a buffer, or an uncertain buffer?"],
  capacity_for_loss: ["Would losing part of this investment affect paying for rent, food, or another essential commitment?", "Would a loss force changes to essential spending, only to optional plans, or neither?"],
  risk_tolerance: ["Would feeling worried about a market decline make you sell, or could you keep the investment despite the worry?", "Putting essential expenses aside, do investment ups and downs feel intolerable, manageable, or comfortable?"],
  knowledge_experience: ["Have you personally bought an investment before, or would this be your first time?", "Would you like beginner explanations, explanations of unfamiliar products, or technical detail about complex investments?"],
  ethical_exclusions: ["Is there a particular business activity you would refuse to invest in? You can name it or say there are no activity exclusions.", "Would you like to identify specific activities to exclude, or leave this requirement unknown while we discuss your broader values?"],
  exclusion_policy: ["If an investment's exposure could not be verified, would you want it held out or considered with an explanation?", "Would you accept an exception to these exclusions, or should they apply without exceptions?"],
  crypto_max: ["Is cryptocurrency completely off limits, or would you consider it within a stated percentage ceiling?", "For every $100 invested, how many dollars at most could be in crypto? Zero means excluded; enter that number as a percentage."],
  return_target_percent: ["Is a particular annual percentage necessary for your goal, or can we leave the return target unspecified?", "Would you like to record a percentage aspiration, or continue without a fixed target? No return is guaranteed."],
  constraints_notes: ["Is there one specific requirement you want us to record verbatim, or are there none?", "You can give a short note about a restriction, or leave this detail unknown for now."],
  portfolio_value: ["What single amount should the demonstration treat as the starting investment?", "Can you give a planning amount in dollars, rather than a range, for example 2,500?"],
  currency: ["Does the amount you entered refer to Canadian dollars or US dollars?", "If the number appeared on an account statement, would its currency code be CAD or USD?"],
  age: ["Can you give your age as one number, or would you prefer not to share it?", "Would you like to record an age in completed years, or leave age undisclosed?"],
  occupation: ["Would a broad work or study description fit, such as student, engineer, self-employed, or retired?", "Would you prefer to give a general occupation or leave it undisclosed?"],
  household: ["Do you live as a single person, with a partner, or in another arrangement? You may leave this undisclosed.", "Would single, partnered, or another household arrangement be the closest description?"],
  dependants: ["Does anyone rely on you to cover their essential expenses? If so, how many people?", "Count only people you financially support, even if they live elsewhere. What number fits, or would you rather not share?"],
  goal_details: ["Is there a purchase, retirement need, or other life goal behind this investment? A short description is enough.", "What would you hope this money makes possible? You can name one goal or say it is for general savings."],
  retirement_status: ["Is this money intended for retirement, another purpose, or spending during a retirement that has already started?", "Are you preparing for retirement, already retired, or investing for something unrelated to retirement?"],
  retirement_years: ["Roughly how many more years do you expect to work before retiring?", "What planning value in years would you use for retirement, even if the exact date is not settled?"],
  sector_interests: ["Is there one industry or theme you particularly want represented, or are you happy with no sector preference?", "Would technology, healthcare, clean energy, financial services, or another named industry fit your interest?"],
  diversification_preference: ["Should a favourite industry be a small part of a broadly spread portfolio, or a large focus?", "Would you rather spread money broadly, add a limited sector tilt, or accept a focused portfolio?"],
  company_preference: ["Would you feel more comfortable owning familiar established businesses, emerging businesses, or a mixture?", "Does understanding an established business matter more to you, or are unfamiliar emerging companies also acceptable?"],
  esg_priorities: ["Is the concern you described mainly about environmental impact, treatment of people, or how a company is governed?", "Which values category should we record: environment, social impact, governance, or no ESG preference? You may select several."],
  controversy_policy: ["If a company had a significant environmental or social controversy, would you exclude it or consider it after an explanation?", "Should unverified controversy exposure be held out, treated as a preference to review, or carry no additional restriction?"],
  liquidity_amount: ["What amount must be set aside for the near-term expense you have in mind?", "Can you name one reserve amount in your portfolio currency, rather than a range? It must not exceed the recorded investment."],
  liquidity_months: ["What is the earliest month when you might need to make that withdrawal: now, in a few months, or near the end of the year?", "How many months from today should the reserve be ready? Use 0 for immediately, up to 12 for a year."],
  tax_restrictions: ["Do you know the account type, such as TFSA, RRSP, or taxable, or is that still unknown?", "Is there a specific account or tax requirement to record, or no known restriction?"],
  regulatory_restrictions: ["Are any investment products or trading activities specifically forbidden by your employer or account?", "Would no leverage, no derivatives, another named restriction, or no known restriction fit?"],
};
export function clarification(state: Interview, answer: string): FollowUp {
  const q = state.next_question!;
  const entry = bank.find(e => e.field === q.field)!;
  const attempts = state.clarification_attempts?.[q.field] ?? 0;
  const prior = [...state.history.map(h => h.question), q.text];
  const activeConflict = state.unresolved_conflicts.find(c => c.id !== "conversation");
  let text = reframes[q.field][Math.min(attempts, 1)];
  let choices: Choice[] = activeConflict && (q.id.startsWith("conflict:") || state.model_question?.is_conflict) ? activeConflict.choices : entry.choices;
  const lower = answer.toLowerCase();
  let help = `You said: “${answer.slice(0, 280)}${answer.length > 280 ? "…" : ""}” Your response is saved; I need one more detail before changing this field.`;
  // Narrow to the actual ambiguity instead of making the user answer the
  // original broad question again. Button values remain explicit choices.
  if (q.field === "objective" && /grow|growth|wealth/.test(lower) && /safe|protect|preserv/.test(lower)) {
    text = "When growth and protecting your savings pull in different directions, which should take priority for this money?";
    choices = entry.choices.filter(c => ["growth", "capital_preservation"].includes(c.patch.objective ?? ""));
    help += " Wanting both is understandable. This asks which goal comes first, not whether you must abandon the other.";
  }
  if (q.field === "income_stability" && /freelanc|varies|variable|seasonal/.test(lower)) {
    text = "You described variable income. Do savings outside this investment cover essential bills when income is lower?";
    choices = [
      { label: "Yes, I have a buffer for lower-income periods", patch: { income_stability: "variable" } },
      { label: "No, my income or buffer may not cover essentials", patch: { income_stability: "unreliable" } },
    ];
  }
  const numbered = lower.replace(/\b(one|two|three|four|five|six|seven|eight|nine|ten|twelve|fifteen|twenty)\b/g, w => String(({one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10,twelve:12,fifteen:15,twenty:20} as Record<string, number>)[w]));
  const range = numbered.match(/\b(\d+(?:\.\d+)?)\s*(?:-|–|to|or|and)\s*(\d+(?:\.\d+)?)/);
  if (range && ["horizon_years", "retirement_years", "liquidity_months", "liquidity_amount", "portfolio_value", "crypto_max", "return_target_percent"].includes(q.field)) {
    const values = [Number(range[1]), Number(range[2])];
    const percentages = ["crypto_max", "return_target_percent"].includes(q.field);
    const unit = ["horizon_years", "retirement_years"].includes(q.field) ? "years" : q.field === "liquidity_months" ? "months" : percentages ? "%" : "in your portfolio currency";
    const specific = values.map(value => ({ label: `Use ${value}${percentages ? "" : " "}${unit}`, patch: { [q.field]: q.field === "crypto_max" ? value / 100 : value } }));
    if (specific.every(c => profileSchema.partial().safeParse(c.patch).success)) {
      text = `You gave a range of ${values[0]}–${values[1]} ${unit}. Which end should we record as your explicit planning value, or is it still undecided?`;
      choices = specific;
      help += " The range is preserved in your transcript. Neither endpoint is selected automatically.";
    }
  }
  if (repeatedQuestion(text, prior)) {
    const alternative = reframes[q.field].find(t => !repeatedQuestion(t, prior));
    text = alternative ?? `Which of the concrete answers below best captures what you mean by “${answer.slice(0, 100)}”, or would you like to leave ${q.field.replaceAll("_", " ")} unknown for now?`;
  }
  return { field: q.field, text, help, choices, is_conflict: Boolean(activeConflict || state.model_question?.is_conflict), selection: choices === entry.choices && entry.multiple ? "multiple" : "single" };
}
export function validateFollowUp(state: Interview, answer: string, proposed?: FollowUp | null): FollowUp {
  const previous = [...state.history.map(h => h.question), state.next_question!.text];
  // Prefixing the old question with an acknowledgment is still repetition.
  if (proposed && !repeatedQuestion(proposed.text, previous)) {
    return { ...proposed, help: `You said: “${answer.slice(0, 240)}${answer.length > 240 ? "…" : ""}” ${proposed.help}`.slice(0, 1500) };
  }
  return clarification(state, answer);
}
