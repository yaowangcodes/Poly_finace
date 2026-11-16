import type { Field, Interview } from "./engine";
export function conflictEvidence(state: Interview): { label: string; value: string; field?: Field }[] {
  const p = state.profile;
  const conflict = state.unresolved_conflicts[0];
  if (!conflict) return [];
  switch (conflict.id) {
    case "capacity": return [{ label: "Financial capacity for loss", value: "Even a small loss would affect your plans", field: "capacity_for_loss" }, { label: "Comfort with risk", value: "Comfortable with large fluctuations", field: "risk_tolerance" }];
    case "horizon": return [{ label: "Main objective", value: "Grow the investment", field: "objective" }, { label: "First withdrawal", value: `Within ${p.horizon_years} years`, field: "horizon_years" }];
    case "crypto": return [{ label: "Main objective", value: "Preserve capital", field: "objective" }, { label: "Cryptocurrency allowed", value: `Up to ${Number(p.crypto_max) * 100}%`, field: "crypto_max" }];
    case "return": return [{ label: "Annual return target", value: `${p.return_target_percent}% aspiration`, field: "return_target_percent" }, { label: "Risk limit", value: p.capacity_for_loss === "low" ? "Low capacity for loss" : "Low tolerance for risk", field: p.capacity_for_loss === "low" ? "capacity_for_loss" : "risk_tolerance" }];
    case "liquidity_amount": return [{ label: "Investment amount", value: `${p.portfolio_value} ${p.currency ?? "(currency unknown)"}`, field: "portfolio_value" }, { label: "Requested reserve", value: `${p.liquidity_amount} ${p.currency ?? "(currency unknown)"}`, field: "liquidity_amount" }];
    case "liquidity_zero": return [{ label: "Near-term withdrawal needs", value: p.liquidity_needs === "most" ? "Most of the investment" : "Some of the investment", field: "liquidity_needs" }, { label: "Requested reserve", value: "0", field: "liquidity_amount" }];
    // Model-detected conflicts have no deterministic field mapping. Show
    // recorded answers, rather than inventing either side of a disagreement.
    default: return state.history.slice(-2).map(h => ({ label: h.question, value: h.answer }));
  }
}
