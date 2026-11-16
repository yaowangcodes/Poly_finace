import { bank, profileSchema, numericAnswer, type Interview, type Profile } from "./engine";

type FollowUp = NonNullable<Interview["model_question"]>;
export type Extraction = { patch: Partial<Profile>; followUp?: FollowUp };
const numberWords: Record<string, number> = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12, fifteen: 15, twenty: 20 };
const normalize = (s: string) => s.toLowerCase().replace(/[’‘]/g, "'").replace(/\s+/g, " ").trim();
function oneOf<T>(matches: [boolean, T][]): T | undefined {
  const values = [...new Set(matches.filter(([match]) => match).map(([, value]) => value))];
  return values.length === 1 ? values[0] : undefined;
}
function years(text: string): number | undefined {
  const withDigits = text.replace(/\b(zero|one|two|three|four|five|six|seven|eight|nine|ten|twelve|fifteen|twenty)\b/g, word => String(numberWords[word]));
  // Do not collapse a range or several dates to an arbitrary planning value.
  if (/\d\s*(?:-|–|to|or)\s*\d|between\s+\d+\s+and\s+\d/.test(withDigits)) return undefined;
  const matches = [...withDigits.matchAll(/\b(\d+(?:\.\d+)?)\s*years?\b/g)];
  if (matches.length === 1 && !/\b(?:not|isn't|isnt|no longer)\b/.test(withDigits)) return Number(matches[0][1]);
  if (/\b(?:next year|in a year)\b/.test(text)) return 1;
  return undefined;
}
function percent(text: string): number | undefined {
  const matches = [...text.matchAll(/\b(\d+(?:\.\d+)?)\s*(?:%|percent\b|per cent\b)/g)];
  return matches.length === 1 ? Number(matches[0][1]) : undefined;
}
export { clarification } from "./clarification";

// High-confidence interpretations of common wording. Ambiguous, negated, or
// conditional statements are left for the model or a contextual clarification.
export function extractTextAnswer(state: Interview, input: string): Extraction {
  const q = state.next_question!;
  const field = q.field;
  const text = normalize(input);
  const patch: Partial<Profile> = {};
  const numeric = !q.id.startsWith("conflict:") && !state.model_question?.is_conflict ? numericAnswer(field, input) : null;
  if (numeric) return { patch: numeric };
  const entry = bank.find(e => e.field === field)!;
  const activeChoices = q.id.startsWith("followup:") ? state.model_question?.choices : q.id.startsWith("conflict:") ? state.unresolved_conflicts.find(c => q.id === `conflict:${c.id}`)?.choices : entry.choices;
  const exact = activeChoices?.find(c => normalize(c.label) === text);
  if (exact) return { patch: exact.patch };
  const direct = profileSchema.shape[field].safeParse(field === "currency" ? text.toUpperCase() : text.replaceAll(" ", "_"));
  if (direct.success && typeof direct.data === "string" && !["constraints_notes", "occupation", "goal_details", "tax_restrictions", "regulatory_restrictions"].includes(field)) return { patch: { [field]: direct.data } };
  if (["constraints_notes", "occupation", "goal_details", "tax_restrictions", "regulatory_restrictions"].includes(field)) {
    if (/\b(?:not sure|don't know|do not know|unsure)\b/.test(text)) return { patch };
    return { patch: { [field]: /^(?:none|no|nothing|no restrictions)[.!]?$/.test(text) ? "None reported" : input.trim() } };
  }
  if (/\b(?:not sure|don't know|do not know|unsure|maybe|possibly|depends|haven't decided|undecided)\b/.test(text)) return { patch };

  if (field === "objective") {
    if (/\b(?:mix|both|balance|combination)\b/.test(text)) return { patch };
    const objective = oneOf<Profile["objective"]>([
      [/\b(?:preserv(?:e|ing|ation)|protect(?:ing)? (?:my |the )?(?:money|capital|savings)|keep (?:my )?money safe)\b/.test(text), "capital_preservation"],
      [/\b(?:grow(?:ing|th)?|build(?:ing)? (?:my )?wealth)\b/.test(text), "growth"],
      [/\b(?:passive|regular|monthly|dividend|investment) income\b|^(?:income|cash flow)[.!]?$/.test(text), "income"],
      [/\b(?:buy(?:ing)? (?:a |my first )?(?:house|home|car)|down payment|tuition|wedding|specific (?:goal|purchase)|sav(?:e|ing) (?:up )?for (?:a |my )?(?:house|home|car|retirement))\b/.test(text), "specific_goal"],
    ]);
    if (objective && !/\b(?:not|don't|do not|instead|rather than)\b/.test(text)) patch.objective = objective;
    const horizon = years(text);
    if (horizon !== undefined && patch.objective) patch.horizon_years = horizon;
  }
  if (["horizon_years", "retirement_years"].includes(field)) {
    const value = years(text);
    if (value !== undefined) Object.assign(patch, { [field]: value });
  }
  if (field === "risk_tolerance") {
    const value = oneOf<Profile["risk_tolerance"]>([
      [/\b(?:sell(?: everything| it all)?|panic|very uncomfortable|low risk|risk averse|can't handle|cannot handle)\b/.test(text), "low"],
      [/\b(?:hold|keep it invested|stay invested|moderate risk|uncomfortable but)\b/.test(text), "moderate"],
      [/\b(?:high risk|comfortable with (?:large |big |market )?(?:fluctuations|swings|volatility)|not worried|buy more)\b/.test(text), "high"],
    ]);
    if (value && !/\b(?:wouldn't|would not|don't want to|do not want to|not comfortable|not sell)\b/.test(text)) patch.risk_tolerance = value;
  }
  if (field === "capacity_for_loss") {
    const value = oneOf<Profile["capacity_for_loss"]>([
      [/\b(?:can't afford|cannot afford|couldn't afford|even a small loss|affect (?:my )?(?:rent|essentials|essential spending)|need (?:it|this money) for rent)\b/.test(text), "low"],
      [/\b(?:some loss|some losses|some adjustments|absorb some|moderate)\b/.test(text), "moderate"],
      [/\b(?:substantial loss|large loss|without (?:changing|affecting) my plans|high)\b/.test(text), "high"],
    ]);
    if (value && !/\b(?:not|wouldn't|would not)\b/.test(text)) patch.capacity_for_loss = value;
  }
  if (field === "liquidity_needs") {
    const value = oneOf<Profile["liquidity_needs"]>([
      [/\b(?:none|none of it|won't need (?:any|it|this)|will not need (?:any|it|this)|don't need any|do not need any|no withdrawals)\b/.test(text), "none"],
      [/\b(?:some|a portion|a bit|part of it)\b/.test(text), "some"],
      [/\b(?:most|all of it|all this money|all the money|everything)\b/.test(text), "most"],
    ]);
    if (value && (value === "none" || !/\b(?:not|don't|do not|won't|will not)\b/.test(text))) patch.liquidity_needs = value;
  }
  if (field === "income_stability") {
    const value = oneOf<Profile["income_stability"]>([
      [/\b(?:stable|reliable|steady) income\b/.test(text) && /\b(?:savings|buffer|emergency fund)\b/.test(text) && !/\b(?:no|not|without)\b/.test(text), "stable"],
      [/\b(?:varies|variable|freelance|fluctuates|seasonal)\b/.test(text) && /\b(?:buffer|savings|emergency fund)\b/.test(text) && !/\b(?:no|not|without)\b/.test(text), "variable"],
      [/\b(?:unreliable|unstable|uncertain|no (?:income|savings|buffer|emergency fund))\b/.test(text), "unreliable"],
    ]);
    if (value) patch.income_stability = value;
  }
  if (field === "knowledge_experience") {
    const value = oneOf<Profile["knowledge_experience"]>([
      [/\b(?:beginner|new to investing|never invested|no (?:investment |investing )?experience|first time investing)\b/.test(text), "beginner"],
      [/\b(?:some experience|intermediate|bought (?:stocks|etfs|funds)|used (?:stocks|etfs|funds))\b/.test(text), "some"],
      [/\b(?:advanced|experienced investor|complex investments|professional investor)\b/.test(text), "experienced"],
    ]);
    if (value && !/\b(?:not|wouldn't)\b/.test(text)) patch.knowledge_experience = value;
  }
  if (field === "ethical_exclusions") {
    const none = /^(?:none|no exclusions|nothing to exclude|i (?:have no|don't have any) exclusions)[.!]?$/.test(text);
    if (none) { patch.ethical_exclusions = []; patch.exclusion_policy = "none"; }
    else if (/\b(?:avoid|exclude|no|without|don't want|do not want)\b/.test(text) || /^(?:tobacco|weapons|gambling|fossil fuels)(?:\s*(?:,|and|&)\s*(?:tobacco|weapons|gambling|fossil fuels))*[.!]?$/.test(text)) {
      const tags: NonNullable<Profile["ethical_exclusions"]> = [];
      if (/\btobacco\b/.test(text)) tags.push("tobacco");
      if (/\bweapons\b/.test(text)) tags.push("weapons");
      if (/\bgambling\b/.test(text)) tags.push("gambling");
      if (/\bfossil fuels\b/.test(text)) tags.push("fossil_fuels");
      // Unsupported or qualified exclusions need model interpretation, not a
      // misleading claim that the listed tags capture the entire requirement.
      const remainder = text.replace(/\b(?:tobacco|weapons|gambling|fossil fuels|i|want|to|avoid|exclude|no|without|don't|do not|and|or|my|investments|should|please|any|companies|involved|in|the)\b/g, "").replace(/[\s,.!&]/g, "");
      if (tags.length && !remainder) patch.ethical_exclusions = tags;
    }
  }
  if (field === "exclusion_policy") {
    const value = oneOf<Profile["exclusion_policy"]>([
      [/\b(?:mandatory|strict|must|non-negotiable|hold out unverified|no exceptions)\b/.test(text), "strict"],
      [/\b(?:preference|flexible|trade-offs|tradeoffs|not mandatory|not strict)\b/.test(text), "preference"],
    ]);
    if (value) patch.exclusion_policy = value;
  }
  if (field === "crypto_max") {
    const excluded = /\b(?:no crypto(?:currency)?|exclude crypto(?:currency)?|don't want (?:any )?crypto(?:currency)?|do not want (?:any )?crypto(?:currency)?|not interested in crypto(?:currency)?)\b/.test(text);
    const value = percent(text);
    if (excluded && value === undefined) patch.crypto_max = 0;
    else if (!excluded && value !== undefined && /\b(?:up to|at most|maximum|max|limit|cap|no more than)\b/.test(text)) patch.crypto_max = value / 100;
  }
  if (field === "return_target_percent") {
    if (/\b(?:no (?:fixed |specific )?(?:target|return target)|not targeting|leave (?:it |this )?unspecified|no fixed return)\b/.test(text)) patch.return_target_percent = null;
    else {
      const value = percent(text);
      if (value !== undefined && !/\b(?:not|don't|do not|guarantee)\b/.test(text)) patch.return_target_percent = value;
    }
  }
  if (field === "portfolio_value" || field === "liquidity_amount") {
    const amounts = [...text.matchAll(/(?:\$\s*|\b)(\d+(?:,\d{3})*(?:\.\d+)?)\s*(k|thousand|million|dollars|cad|usd)?\b/g)];
    if (amounts.length === 1 && /\b(?:invest|investing|investment|portfolio|have|amount)\b|\$|dollars|cad|usd/.test(text) && !/\b(?:not|between|or|to|about)\b/.test(text.replace(/(?:want|plan|going) to /g, ""))) {
      const amount = Number(amounts[0][1].replaceAll(",", ""));
      Object.assign(patch, { [field]: amount * (/^(?:k|thousand)$/.test(amounts[0][2] ?? "") ? 1000 : amounts[0][2] === "million" ? 1e6 : 1) });
      if (/\b(?:cad|canadian dollars)\b/.test(text) && !/\busd\b/.test(text)) patch.currency = "CAD";
      if (/\b(?:usd|us dollars|u\.s\. dollars)\b/.test(text) && !/\bcad\b/.test(text)) patch.currency = "USD";
    }
  }
  if (field === "currency") {
    const value = oneOf<Profile["currency"]>([[/\b(?:cad|canadian(?: dollars)?)\b/.test(text), "CAD"], [/\b(?:usd|us dollars|u\.s\. dollars|american(?: dollars)?)\b/.test(text), "USD"]]);
    if (value && !/\b(?:not|instead|rather than)\b/.test(text)) patch.currency = value;
  }
  if (field === "liquidity_months") {
    const numbered = text.replace(/\b(one|two|three|four|five|six|seven|eight|nine|ten|twelve)\b/g, word => String(numberWords[word]));
    const match = numbered.match(/^(?:in |within |after )?(\d+(?:\.\d+)?) months?[.!]?$/);
    if (match) patch.liquidity_months = Number(match[1]);
    else if (/^(?:now|immediately|right away)[.!]?$/.test(text)) patch.liquidity_months = 0;
  }
  if (field === "age" || field === "dependants") {
    const match = text.match(field === "age" ? /^(?:i am |i'm )?(\d+) years? old[.!]?$/ : /^(?:i have )?(\d+) (?:children|kids|dependants|dependents|people)[.!]?$/);
    if (match) Object.assign(patch, { [field]: Number(match[1]) });
    if (field === "dependants" && /^(?:none|no one|nobody|no dependants|no dependents)[.!]?$/.test(text)) patch.dependants = 0;
  }
  if (field === "retirement_status") {
    if (/^(?:i am |i'm )?(?:already )?retired[.!]?$/.test(text)) patch.retirement_status = "retired";
    else if (/\b(?:planning for retirement|plan to retire|retire in)\b/.test(text)) {
      patch.retirement_status = "planning";
      const value = years(text); if (value !== undefined) patch.retirement_years = value;
    } else if (/^(?:not for retirement|retirement is not a goal|no retirement goal)[.!]?$/.test(text)) patch.retirement_status = "not_a_goal";
  }
  if (field === "sector_interests" || field === "esg_priorities") {
    if (/^(?:none|no preference|no sector preference|no esg preference)[.!]?$/.test(text)) Object.assign(patch, { [field]: [] });
    else {
      const aliases = field === "sector_interests" ? { technology: "technology", tech: "technology", ai: "ai", "artificial intelligence": "ai", healthcare: "healthcare", "clean energy": "clean_energy", "financial services": "financials", financials: "financials" }
        : { environmental: "environmental", environment: "environmental", climate: "environmental", social: "social", "human rights": "social", governance: "governance" };
      const parts = text.replace(/[.!]$/, "").split(/\s*(?:,|&|\band\b)\s*/);
      const tags = parts.map(part => aliases[part as keyof typeof aliases]);
      if (tags.length && tags.every(Boolean)) Object.assign(patch, { [field]: [...new Set(tags)] });
      else if (field === "sector_interests" && !/\b(?:not|don't|do not|avoid|exclude|no|but|unless|if|either|rather than)\b/.test(text)) {
        patch.sector_interests = [...new Set([...tags.filter(Boolean), "other"])] as NonNullable<Profile["sector_interests"]>;
        patch.constraints_notes = [state.profile.constraints_notes === "None reported" ? "" : state.profile.constraints_notes, `Sector interests in user's words: ${input.trim()}`].filter(Boolean).join("\n");
      }
    }
  }
  // Conflicting conditional clauses are not high-confidence interpretations.
  if (/\b(?:but|unless|if|either|rather than)\b/.test(text) && !/uncomfortable but (?:hold|keep)/.test(text)) return { patch: {} };
  return { patch };
}
