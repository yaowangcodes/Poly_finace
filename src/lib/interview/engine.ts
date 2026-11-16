import { z } from "zod";

export const profileSchema = z.object({
  objective: z.enum(["capital_preservation", "growth", "income", "specific_goal"]).nullable(),
  horizon_years: z.number().min(0).max(100).nullable(),
  risk_tolerance: z.enum(["low", "moderate", "high"]).nullable(),
  capacity_for_loss: z.enum(["low", "moderate", "high"]).nullable(),
  liquidity_needs: z.enum(["none", "some", "most"]).nullable(),
  income_stability: z.enum(["stable", "variable", "unreliable"]).nullable(),
  knowledge_experience: z.enum(["beginner", "some", "experienced"]).nullable(),
  ethical_exclusions: z.array(z.enum(["tobacco", "weapons", "gambling", "fossil_fuels"])).nullable(),
  exclusion_policy: z.enum(["strict", "preference", "none"]).nullable(),
  crypto_max: z.number().min(0).max(1).nullable(),
  return_target_percent: z.number().min(0).max(100).nullable(),
  constraints_notes: z.string().max(2000).nullable(),
  portfolio_value: z.number().positive().max(1e12).nullable(),
  currency: z.enum(["CAD", "USD"]).nullable(),
  age: z.number().int().min(18).max(120).nullable(),
  occupation: z.string().min(1).max(500).nullable(),
  household: z.enum(["single", "partnered", "other"]).nullable(),
  dependants: z.number().int().min(0).max(30).nullable(),
  goal_details: z.string().min(1).max(2000).nullable(),
  retirement_status: z.enum(["not_a_goal", "planning", "retired"]).nullable(),
  retirement_years: z.number().min(0).max(100).nullable(),
  sector_interests: z.array(z.enum(["technology", "ai", "healthcare", "clean_energy", "financials", "other"])).nullable(),
  diversification_preference: z.enum(["broad", "sector_tilt", "focused"]).nullable(),
  company_preference: z.enum(["established", "emerging", "mix", "no_preference"]).nullable(),
  esg_priorities: z.array(z.enum(["environmental", "social", "governance"])).nullable(),
  controversy_policy: z.enum(["strict", "preference", "none"]).nullable(),
  liquidity_amount: z.number().min(0).max(1e12).nullable(),
  liquidity_months: z.number().min(0).max(12).nullable(),
  tax_restrictions: z.string().min(1).max(2000).nullable(),
  regulatory_restrictions: z.string().min(1).max(2000).nullable(),
});
export type Profile = z.infer<typeof profileSchema>;
export type Field = keyof Profile;
export type Choice = { label: string; patch: Partial<Profile> };
export type Question = { id: string; field: Field; text: string; help: string; selection: "single" | "multiple"; options: string[] };
export type Entry = { field: Field; text: string; help: string; choices: Choice[]; multiple?: boolean; optional?: boolean; when?: (p: Profile) => boolean; requiredWhen?: (p: Profile) => boolean };
const c = (label: string, patch: Partial<Profile>): Choice => ({ label, patch });
export const bank: Entry[] = [
  { field: "objective", text: "What would you most like this money to do?", help: "Choose your main priority. We can clarify other goals as we go.", choices: [c("Protect my money", { objective: "capital_preservation" }), c("Grow over time", { objective: "growth" }), c("Provide income", { objective: "income" }), c("Fund a specific goal", { objective: "specific_goal" })] },
  { field: "horizon_years", text: "When will you first need to withdraw this money?", help: "Think about tuition, a home purchase, retirement, or another expense. Enter an exact number of years if you know it; the buttons use the stated planning value.", choices: [c("Within 1 year · use 1", { horizon_years: 1 }), c("1–3 years · use 2", { horizon_years: 2 }), c("3–5 years · use 4", { horizon_years: 4 }), c("5–10 years · use 7", { horizon_years: 7 }), c("10+ years · use 15", { horizon_years: 15 })] },
  { field: "liquidity_needs", text: "How much of this money might you need for near-term expenses?", help: "Near-term means the next 12 months. Money needed for essentials may need to remain available.", choices: [c("None of it", { liquidity_needs: "none" }), c("Some of it", { liquidity_needs: "some" }), c("Most or all of it", { liquidity_needs: "most" })] },
  { field: "income_stability", text: "How dependable is your income and financial buffer?", help: "Consider whether income and emergency savings cover your regular essential expenses outside this investment.", choices: [c("Reliable income and emergency savings", { income_stability: "stable" }), c("Income varies, but I have a buffer", { income_stability: "variable" }), c("Income or emergency savings are uncertain", { income_stability: "unreliable" })] },
  { field: "capacity_for_loss", text: "Could a loss affect essential spending or your goal?", help: "This asks what you can financially afford, separately from how you feel about risk.", choices: [c("Even a small loss would affect my plans", { capacity_for_loss: "low" }), c("I could absorb some loss and adjust", { capacity_for_loss: "moderate" }), c("I could absorb a substantial loss", { capacity_for_loss: "high" })] },
  { field: "risk_tolerance", text: "If $10,000 fell to $8,000, how would you feel?", help: "Imagine circumstances otherwise stayed the same. There is no correct answer, and a temporary decline is not a guaranteed maximum loss.", choices: [c("Very uncomfortable; I would want to sell", { risk_tolerance: "low" }), c("Uncomfortable, but I could keep it invested", { risk_tolerance: "moderate" }), c("Comfortable with large fluctuations", { risk_tolerance: "high" })] },
  { field: "knowledge_experience", text: "How familiar are you with investing?", help: "This helps us explain unfamiliar concepts without assuming knowledge.", choices: [c("I'm new to investing", { knowledge_experience: "beginner" }), c("I've used stocks, funds, or ETFs", { knowledge_experience: "some" }), c("I understand risk and complex investments", { knowledge_experience: "experienced" })] },
  { field: "ethical_exclusions", text: "Which activities should your investments avoid?", help: "Select all that apply. We will ask whether these are mandatory exclusions or preferences. This records your requirements; it does not verify asset exposure.", multiple: true, choices: [c("Tobacco", { ethical_exclusions: ["tobacco"] }), c("Weapons", { ethical_exclusions: ["weapons"] }), c("Gambling", { ethical_exclusions: ["gambling"] }), c("Fossil fuels", { ethical_exclusions: ["fossil_fuels"] }), c("No exclusions", { ethical_exclusions: [], exclusion_policy: "none" })] },
  { field: "exclusion_policy", text: "How should we apply your exclusions?", help: "Strict exclusions require exposure checks, including fund holdings. Unknown exposure must remain unverified.", choices: [c("Mandatory; hold out unverified assets", { exclusion_policy: "strict" }), c("Preferences; show me the trade-offs", { exclusion_policy: "preference" })] },
  { field: "crypto_max", text: "Would you consider cryptocurrency?", help: "Choose an explicit maximum share of the portfolio. This is a ceiling, not a promise to invest that amount.", choices: [c("Exclude it · maximum 0%", { crypto_max: 0 }), c("Consider up to 2%", { crypto_max: 0.02 }), c("Consider up to 5%", { crypto_max: 0.05 }), c("Consider up to 10%", { crypto_max: 0.1 })] },
  { field: "return_target_percent", text: "Do you have an annual return target?", help: "Targets are aspirations, never guaranteed. You can leave this unspecified. Enter a percentage to provide your own target.", optional: true, choices: [c("No fixed target", { return_target_percent: null }), c("Around 3%", { return_target_percent: 3 }), c("Around 5%", { return_target_percent: 5 }), c("Around 8%", { return_target_percent: 8 })] },
  { field: "constraints_notes", text: "Are there account, tax, currency, or other restrictions to record?", help: "For example: a CAD account, existing holdings, a specific goal amount, or products you cannot hold. Avoid account numbers and identifying information. Recorded restrictions still need a supported enforcement step.", optional: true, choices: [c("No additional restrictions", { constraints_notes: "None reported" })] },
  { field: "portfolio_value", text: "How much are you planning to invest?", help: "This is for later sizing. Enter a positive amount, or leave it unknown for now. Currency comes next.", optional: true, choices: [c("$1,000", { portfolio_value: 1000 }), c("$10,000", { portfolio_value: 10000 }), c("$50,000", { portfolio_value: 50000 })] },
  { field: "currency", requiredWhen: p => p.liquidity_needs === "some" || p.liquidity_needs === "most", text: "Which currency is that amount in?", help: "This records the currency for later sizing; it does not set currency exposure limits.", optional: true, choices: [c("Canadian dollars · CAD", { currency: "CAD" }), c("US dollars · USD", { currency: "USD" })] },
  { field: "age", text: "How old are you?", help: "Enter your age in years. You can also choose not to share it. This is context, not an automatic risk rating.", optional: true, choices: [c("Prefer not to say", { age: null })] },
  { field: "occupation", text: "What do you do for work or study?", help: "A broad description is enough, such as software engineer, healthcare professional, student, or retired. Please omit employer names and identifying details.", optional: true, choices: [c("Student", { occupation: "Student" }), c("Employed", { occupation: "Employed; occupation not specified" }), c("Self-employed", { occupation: "Self-employed; occupation not specified" }), c("Retired", { occupation: "Retired" }), c("Prefer not to say", { occupation: null })] },
  { field: "household", text: "How would you describe your household situation?", help: "This helps describe your circumstances. You do not need to share names or other identifying information.", optional: true, choices: [c("Single", { household: "single" }), c("Married or living with a partner", { household: "partnered" }), c("Another household arrangement", { household: "other" }), c("Prefer not to say", { household: null })] },
  { field: "dependants", text: "How many people depend on you financially?", help: "Count people whose essential expenses you help cover, including children or other family members. Enter an exact number if the buttons do not fit.", optional: true, choices: [c("No financial dependants", { dependants: 0 }), c("1 person", { dependants: 1 }), c("2 people", { dependants: 2 }), c("3 people", { dependants: 3 }), c("Prefer not to say", { dependants: null })] },
  { field: "goal_details", text: "What is this money ultimately for?", help: "Describe your goal in your own words. Include a target amount and deadline if you have one. This preserves the context behind your main investment objective.", choices: [c("General long-term wealth building", { goal_details: "General long-term wealth building; no specific purchase reported" }), c("Retirement", { goal_details: "Retirement", retirement_status: "planning" }), c("Future income", { goal_details: "Supplement future income" }), c("Protect savings for future needs", { goal_details: "Preserve savings for future needs" })] },
  { field: "retirement_status", text: "Is retirement part of this investment goal?", help: "If it is, we will ask when you expect to retire. A retirement date and the first withdrawal date can be different.", choices: [c("Retirement is not a goal for this money", { retirement_status: "not_a_goal" }), c("I am planning for retirement", { retirement_status: "planning" }), c("I am already retired", { retirement_status: "retired" })] },
  { field: "retirement_years", text: "About how many years until you expect to retire?", help: "Enter a number of years. If you are uncertain, we will keep this unknown rather than invent a retirement date.", when: p => p.retirement_status === "planning", choices: [c("Within 1 year · use 1", { retirement_years: 1 }), c("In 3 years", { retirement_years: 3 }), c("In 5 years", { retirement_years: 5 }), c("In 10 years", { retirement_years: 10 }), c("In 20 years", { retirement_years: 20 })] },
  { field: "sector_interests", text: "Are there industries or themes you are especially interested in?", help: "Select all that apply. An interest is not permission to concentrate the portfolio. For another sector, use your own words so we can retain the details.", multiple: true, choices: [c("Technology", { sector_interests: ["technology"] }), c("Artificial intelligence", { sector_interests: ["ai"] }), c("Healthcare", { sector_interests: ["healthcare"] }), c("Clean energy", { sector_interests: ["clean_energy"] }), c("Financial services", { sector_interests: ["financials"] }), c("No sector preference", { sector_interests: [] })] },
  { field: "diversification_preference", text: "How would you like to balance your interests with diversification?", help: "Broad diversification spreads investments across industries and assets. A sector tilt keeps a particular interest within a diversified portfolio. A focused portfolio accepts more concentration.", choices: [c("Diversify broadly across industries and assets", { diversification_preference: "broad" }), c("Stay diversified with a tilt toward my interests", { diversification_preference: "sector_tilt" }), c("I prefer a focused portfolio", { diversification_preference: "focused" })] },
  { field: "company_preference", text: "What kinds of businesses are you most comfortable investing in?", help: "Think about established businesses you understand versus emerging companies with less predictable outcomes. This records a preference, not a guarantee about quality or stability.", choices: [c("Established businesses I understand", { company_preference: "established" }), c("Emerging and innovative companies", { company_preference: "emerging" }), c("A mix of established and emerging companies", { company_preference: "mix" }), c("No company-type preference", { company_preference: "no_preference" })] },
  { field: "esg_priorities", text: "Which environmental, social, or governance values should we consider?", help: "Select all that apply. These values are separate from specific activity exclusions such as tobacco or fossil fuels. Add any more specific requirements in your own words.", multiple: true, choices: [c("Environmental impact and climate", { esg_priorities: ["environmental"] }), c("Social impact, labour, and human rights", { esg_priorities: ["social"] }), c("Governance, ethics, and company conduct", { esg_priorities: ["governance"] }), c("No ESG preference", { esg_priorities: [] })] },
  { field: "controversy_policy", text: "How should we handle companies with significant environmental or social controversies?", help: "This requires external evidence, including fund holdings where relevant. Recording a rule does not mean an asset has been verified to meet it.", choices: [c("Exclude them; hold out unverified exposure", { controversy_policy: "strict" }), c("Prefer to avoid them; explain any trade-offs", { controversy_policy: "preference" }), c("No additional controversy restriction", { controversy_policy: "none" })] },
  { field: "liquidity_amount", text: "How much of this investment needs to stay available over the next 12 months?", help: "Enter an amount in the portfolio currency. This is a reserve from the investment, separate from emergency savings held elsewhere. Please use an exact planning amount rather than a range.", when: p => p.liquidity_needs === "some" || p.liquidity_needs === "most", choices: [c("500 in my portfolio currency", { liquidity_amount: 500 }), c("1,000 in my portfolio currency", { liquidity_amount: 1000 }), c("5,000 in my portfolio currency", { liquidity_amount: 5000 })] },
  { field: "liquidity_months", text: "How soon will you first need that reserved money?", help: "Enter the number of months from now, from 0 to 12. Zero means immediately. This records the withdrawal timing separately from your long-term horizon.", when: p => p.liquidity_needs === "some" || p.liquidity_needs === "most", choices: [c("Immediately · 0 months", { liquidity_months: 0 }), c("In 1 month", { liquidity_months: 1 }), c("In 3 months", { liquidity_months: 3 }), c("In 6 months", { liquidity_months: 6 }), c("In 12 months", { liquidity_months: 12 })] },
  { field: "tax_restrictions", text: "Are there account or tax requirements this portfolio must respect?", help: "For example, an RRSP, TFSA, taxable account, or a restriction on realizing gains. Record what you know without sharing account numbers. We record these requirements; enforcement still needs validation.", optional: true, choices: [c("No account or tax restrictions reported", { tax_restrictions: "None reported" }), c("TFSA", { tax_restrictions: "TFSA; eligibility and permitted investments need validation" }), c("RRSP", { tax_restrictions: "RRSP; eligibility and permitted investments need validation" }), c("Taxable account", { tax_restrictions: "Taxable account; tax treatment needs validation" })] },
  { field: "regulatory_restrictions", text: "Are there legal, employer, or investment-product restrictions we should record?", help: "For example, an employer trading restriction, no leverage, or products you cannot hold. We do not infer legal eligibility from age, occupation, or experience.", optional: true, choices: [c("No regulatory restrictions reported", { regulatory_restrictions: "None reported" }), c("No leverage or margin", { regulatory_restrictions: "No leverage or margin" }), c("No derivatives", { regulatory_restrictions: "No derivatives" })] },
];
export type Conflict = { id: string; text: string; choices: Choice[] };
export type Interview = {
  status: "interviewing" | "review" | "complete";
  profile: Profile;
  unresolved_conflicts: Conflict[];
  next_question: Question | null;
  ready_for_review: boolean;
  answered: Field[];
  unknown_fields: Field[];
  helped: Field[];
  message: string;
  history: { question: string; answer: string }[];
  confirmed_at: string | null;
  clarification_attempts?: Partial<Record<Field, number>>;
  last_answer?: { text: string; extracted_fields: Field[]; needs_clarification: boolean };
  model_question?: { field: Field; text: string; help: string; choices: Choice[]; is_conflict: boolean; selection?: "single" | "multiple" } | null;
};
export function conflicts(p: Profile): Conflict[] {
  const result: Conflict[] = [];
  if (p.risk_tolerance === "high" && p.capacity_for_loss === "low") result.push({ id: "capacity", text: "You feel comfortable with large fluctuations, but said even a small loss would affect your plans. How should we clarify that?", choices: [c("I need a lower-risk approach", { risk_tolerance: "low" }), c("My ability to absorb losses is actually moderate", { capacity_for_loss: "moderate" })] });
  if (p.objective === "growth" && p.horizon_years !== null && p.horizon_years <= 3) result.push({ id: "horizon", text: "You want growth but expect to need the money within three years. A decline could leave less money available when you need it. Which priority fits?", choices: [c("Prioritize protecting money for that date", { objective: "capital_preservation" }), c("I can leave it invested longer · use 7 years", { horizon_years: 7 })] });
  if (p.objective === "capital_preservation" && p.crypto_max !== null && p.crypto_max > 0) result.push({ id: "crypto", text: "Protecting capital is your priority, while you also allow cryptocurrency. This prototype cannot separately protect a retirement or essential-spending bucket. How should we proceed?", choices: [c("Exclude crypto from this portfolio", { crypto_max: 0 }), c("Revisit my main goal as growth", { objective: "growth" })] });
  if (p.return_target_percent !== null && p.return_target_percent >= 8 && (p.risk_tolerance === "low" || p.capacity_for_loss === "low")) result.push({ id: "return", text: "Your return target may require more risk than your stated limits allow. Which priority should guide the proposal?", choices: [c("Keep my risk limits; remove the fixed target", { return_target_percent: null })] });
  if ((p.liquidity_needs === "some" || p.liquidity_needs === "most") && p.liquidity_amount !== null && p.portfolio_value !== null && p.liquidity_amount > p.portfolio_value) result.push({
    id: "liquidity_amount", text: "The amount you want to keep available is larger than the investment amount you recorded. Please correct the reserve or revisit your investment amount.",
    choices: [c("Keep the whole recorded investment available", { liquidity_amount: p.portfolio_value })],
  });
  if ((p.liquidity_needs === "some" || p.liquidity_needs === "most") && p.liquidity_amount === 0) result.push({
    id: "liquidity_zero", text: "You said you need some money soon, but entered a zero reserve. Do you have no near-term withdrawal needs, or should the reserve be a positive amount?",
    choices: [c("I have no near-term withdrawal needs", { liquidity_needs: "none" })],
  });
  return result;
}
export function applicable(entry: Entry, profile: Profile) {
  return !entry.when || entry.when(profile);
}
export function refresh(s: Interview): Interview {
  const previousConfirmed = s.status === "complete";
  s.profile = profileSchema.parse({ ...Object.fromEntries(Object.keys(profileSchema.shape).map(k => [k, null])), ...s.profile });
  s.unresolved_conflicts = conflicts(s.profile);
  if (s.model_question?.is_conflict) s.unresolved_conflicts.push({ id: "conversation", text: s.model_question.text, choices: s.model_question.choices });
  const conflict = s.unresolved_conflicts.find(c => c.id !== "conversation");
  const entry = bank.find(e => applicable(e, s.profile) && !s.answered.includes(e.field));
  const missing = bank.filter(e => applicable(e, s.profile) && (!e.optional || e.requiredWhen?.(s.profile)) && s.profile[e.field] === null);
  s.ready_for_review = !s.unresolved_conflicts.length && !s.model_question && !entry && !missing.length;
  s.status = s.ready_for_review ? (previousConfirmed ? "complete" : "review") : "interviewing";
  if (!s.ready_for_review) s.confirmed_at = null;
  s.next_question = s.model_question ? {
    id: `followup:${s.history.length}`, field: s.model_question.field,
    text: s.model_question.text, help: s.model_question.help,
    selection: s.model_question.selection ?? "single",
    options: [...s.model_question.choices.map(c => c.label), "Not sure", "Answer in my own words"],
  } : conflict ? {
    id: `conflict:${conflict.id}`, field: Object.keys(conflict.choices[0].patch)[0] as Field,
    text: conflict.text,
    help: "You can also explain in your own words. We will keep this conflict open until the underlying preferences are clarified.",
    selection: "single", options: [...conflict.choices.map(c => c.label), "Not sure", "Answer in my own words"],
  } : entry ? {
    id: entry.field, field: entry.field, text: entry.text,
    help: s.helped.includes(entry.field) ? `That's okay to be unsure. ${entry.help} You can choose Not sure again to move on; required unknowns will need clarification before review.` : entry.help,
    selection: entry.multiple ? "multiple" : "single",
    options: [...entry.choices.map(c => c.label), "Not sure", "Answer in my own words"],
  } : null;
  s.unknown_fields = bank.filter(e => applicable(e, s.profile) && s.profile[e.field] === null).map(e => e.field);
  return s;
}
export function createInterview(): Interview {
  return refresh({ status: "interviewing", profile: profileSchema.parse(Object.fromEntries(Object.keys(profileSchema.shape).map(k => [k, null]))), unresolved_conflicts: [], next_question: null, ready_for_review: false, answered: [], unknown_fields: [], helped: [], message: "Let's build your investor profile, one question at a time.", history: [], confirmed_at: null });
}
export function applyPatch(s: Interview, patch: Partial<Profile>): Interview {
  const profile = profileSchema.parse({ ...s.profile, ...patch });
  const keys = Object.keys(patch) as Field[];
  for (const field of keys) {
    if (profile[field] !== null || bank.find(e => e.field === field)?.optional) {
      if (s.clarification_attempts) delete s.clarification_attempts[field];
    }
  }
  if (keys.includes("liquidity_needs") && profile.liquidity_needs !== s.profile.liquidity_needs) {
    for (const field of ["liquidity_amount", "liquidity_months"] as const) {
      if (!(field in patch)) { profile[field] = null; s.answered = s.answered.filter(f => f !== field); }
    }
  }
  if (keys.includes("retirement_status") && profile.retirement_status !== s.profile.retirement_status && !("retirement_years" in patch)) {
    profile.retirement_years = null;
    s.answered = s.answered.filter(f => f !== "retirement_years");
  }
  s.profile = profile;
  s.answered = [...new Set([...s.answered, ...keys])];
  s.confirmed_at = null;
  if (profile.ethical_exclusions?.length === 0) {
    s.profile.exclusion_policy = "none";
    s.answered = [...new Set([...s.answered, "exclusion_policy" as const])];
  } else if (keys.includes("ethical_exclusions") && profile.exclusion_policy === "none") {
    s.profile.exclusion_policy = null;
    s.answered = s.answered.filter(k => k !== "exclusion_policy");
  }
  return refresh(s);
}
export function answerChoice(s: Interview, values: string[]): Interview {
  const q = s.next_question;
  if (!q) throw new Error("There is no active question.");
  delete s.last_answer;
  if (values.includes("Not sure")) {
    if (values.length !== 1) throw new Error("Choose Not sure on its own.");
    s.history.push({ question: q.text, answer: "Not sure" });
    s.message = "Uncertainty is okay. We will keep this information unknown until you clarify it.";
    if (!q.id.startsWith("conflict:") && !q.id.startsWith("followup:") && s.helped.includes(q.field)) s.answered = [...new Set([...s.answered, q.field])];
    else s.helped = [...new Set([...s.helped, q.field])];
    return refresh(s);
  }
  const choices = q.id.startsWith("conflict:") ? s.unresolved_conflicts.find(c => q.id === `conflict:${c.id}`)!.choices : q.id.startsWith("followup:") ? s.model_question!.choices : bank.find(e => e.field === q.field)!.choices;
  if (!values.length || (q.selection === "single" && values.length !== 1) || values.some(v => !choices.some(c => c.label === v))) throw new Error("Choose one of the available answers.");
  if (q.selection === "multiple" && values.includes("No exclusions") && values.length > 1) throw new Error("Choose No exclusions on its own.");
  const selected = choices.filter(c => values.includes(c.label));
  const patch = Object.assign({}, ...selected.map(c => c.patch)) as Partial<Profile>;
  if (q.selection === "multiple") {
    const lists = selected.map(c => c.patch[q.field]).filter(Array.isArray) as string[][];
    if (lists.some(list => list.length === 0) && selected.length > 1) throw new Error("Choose the no-preference option on its own.");
    Object.assign(patch, { [q.field]: [...new Set(lists.flat())] });
  }
  if (q.id.startsWith("followup:")) s.model_question = null;
  s.history.push({ question: q.text, answer: values.join("; ") });
  s.message = "Saved. The next question follows from your profile so far.";
  const next = applyPatch(s, patch);
  next.last_answer = { text: values.join("; "), extracted_fields: Object.keys(patch) as Field[], needs_clarification: next.unresolved_conflicts.length > 0 };
  return next;
}
export function numericAnswer(field: Field, text: string): Partial<Profile> | null {
  if (!["horizon_years", "portfolio_value", "crypto_max", "return_target_percent", "age", "dependants", "retirement_years", "liquidity_amount", "liquidity_months"].includes(field)) return null;
  // Only accept a bare number with its expected unit. Other language needs interpretation.
  const match = text.trim().match(/^\$?([0-9]+(?:,[0-9]{3})*(?:\.[0-9]+)?)\s*(%|years?(?: old)?|months?|people|persons?|dependants?|dollars?)?$/i);
  if (!match) return null;
  const unit = match[2]?.toLowerCase();
  if (unit) {
    const valid = ["horizon_years", "retirement_years", "age"].includes(field) ? unit.startsWith("year")
      : field === "liquidity_months" ? unit.startsWith("month")
      : field === "dependants" ? /^(people|persons?|dependants?)$/.test(unit)
      : ["portfolio_value", "liquidity_amount"].includes(field) ? unit.startsWith("dollar")
      : unit === "%";
    if (!valid) return null;
  }
  if (text.trim().startsWith("$") && !["portfolio_value", "liquidity_amount"].includes(field)) return null;
  const value = Number(match[1].replaceAll(",", ""));
  return { [field]: field === "crypto_max" ? value / 100 : value };
}
export function handoff(s: Interview) {
  return {
    profile: s.profile,
    confirmed: s.status === "complete",
    optimizer_constraints: s.profile.crypto_max === null ? {} : { crypto_max: s.profile.crypto_max },
    excluded_activity_tags: s.profile.ethical_exclusions ?? [],
    exclusion_policy: s.profile.exclusion_policy,
    esg_priorities: s.profile.esg_priorities,
    controversy_policy: s.profile.controversy_policy,
    liquidity_reserve: { amount: s.profile.liquidity_needs === "none" ? 0 : s.profile.liquidity_amount, months_until_needed: s.profile.liquidity_needs === "none" ? null : s.profile.liquidity_months, currency: s.profile.currency },
    unknown_fields: s.unknown_fields,
    unresolved_conflicts: s.unresolved_conflicts,
    requires_translation: ["risk policy and numeric limits", "liquidity reserve treatment", "sector and diversification preferences", "account and tax restrictions"],
    requires_validation: ["asset eligibility and ETF exposure", "optimizer feasibility"],
    ready_for_optimization: false,
  };
}
