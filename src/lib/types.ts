import { z } from "zod";
import limits from "./constraint-limits.json";
export { limits };
export const labels: Record<string, string> = {
  cash_min: "Minimum cash",
  crypto_max: "Cryptocurrency maximum",
  vol_max: "Annual volatility maximum",
  bond_min: "Minimum bonds",
  equity_max: "Equity maximum",
  position_max: "Single position maximum",
  hhi_max: "Asset concentration (HHI)",
  beta_max: "Beta maximum",
  te_max: "Tracking error maximum",
  cvar_max: "95% session CVaR maximum",
  downside_max: "Downside deviation maximum",
  stress_max: "Stress loss maximum",
  usd_max: "USD maximum",
  canada_min: "Minimum Canada",
  gold_min: "Minimum gold",
  turnover_max: "Turnover maximum",
};
export const unitless = new Set(["hhi_max", "beta_max"]);
export function formatLimit(key: string, value: number | null | undefined) {
  return value == null
    ? "Removed"
    : unitless.has(key)
      ? value.toFixed(3)
      : `${(value * 100).toLocaleString(undefined, { maximumFractionDigits: 2 })}%`;
}
export const constraintPatch = z
  .record(z.string(), z.number().finite().nullable())
  .superRefine((v, ctx) => {
    for (const [key, value] of Object.entries(v)) {
      const max = limits[key as keyof typeof limits];
      if (max === undefined || (value !== null && (value < 0 || value > max)))
        ctx.addIssue({
          code: "custom",
          message: `Invalid limit: ${key}`,
          path: [key],
        });
    }
  });
const numeric = z.record(z.string(), z.number().finite());
export const portfolioSchema = z
  .object({
    status: z.string(),
    profile: z.string().optional(),
    message: z.string().optional(),
    weights: numeric.optional(),
    metrics: z.record(z.string(), z.number().finite().nullable()).optional(),
    asset_classes: z.record(z.string(), z.string()).optional(),
    historical_analytics: z.object({
      label: z.string(),
      concentration_label: z.string(),
      methodology: z.string(),
      start_date: z.string(),
      end_date: z.string().nullable(),
      observations: z.number(),
      valid_months: z.number(),
      maximum_drawdown_date: z.string().optional(),
      unavailable_reasons: z.record(z.string(), z.string()),
      history: z.array(z.object({
        date: z.string(), portfolio: z.number(), benchmark: z.number().nullable(), drawdown: z.number(),
      })),
    }).optional(),
    constraints: numeric.optional(),
    constraint_checks: z
      .array(
        z.object({
          constraint: z.string(),
          actual: z.number(),
          limit: z.number(),
          slack: z.number(),
          binding: z.boolean(),
        }),
      )
      .optional(),
    exposures: numeric.optional(),
    provenance: z.record(z.string(), z.unknown()).optional(),
    warnings: z.array(z.string()).optional(),
    assumptions: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();
export type Portfolio = z.infer<typeof portfolioSchema>;
export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  portfolios?: Portfolio[];
}
export interface Conversation {
  id: string;
  title: string;
  messages: ChatMessage[];
  sessionId: string;
  revision: string | null;
  confirmedConstraints: Record<string, number>;
  proposedConstraints: Record<string, number | null> | null;
  createdAt: string;
  updatedAt: string;
  version: number;
  status: "new" | "ready" | "processing" | "uncertain";
  error: string | null;
  turnId: string | null;
  startedAt: string | null;
}
export const turnSchema = z
  .object({
    prompt: z.string().trim().min(1).max(16000),
    version: z.number().int().nonnegative(),
    action: z.enum(["message", "confirm", "reject", "edit"]).default("message"),
    constraints: constraintPatch.optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if ((v.action === "edit") !== (v.constraints !== undefined))
      ctx.addIssue({
        code: "custom",
        message: "Only edit accepts an explicit constraint patch.",
      });
  });
export type Turn = z.infer<typeof turnSchema>;
export const runtimeSchema = z.object({
  status: z.literal("ok"),
  response: z.string(),
  session_id: z.uuid(),
  revision: z.uuid(),
  confirmed_constraints: numeric,
  proposed_constraints: constraintPatch.nullable(),
  protocol_version: z.literal(2).optional(),
  portfolio_results: z.array(portfolioSchema).default([]),
});
export function newConversation(
  id = crypto.randomUUID(),
  now = new Date().toISOString(),
): Conversation {
  return {
    id,
    sessionId: id,
    title: "New conversation",
    messages: [],
    revision: null,
    confirmedConstraints: {},
    proposedConstraints: null,
    createdAt: now,
    updatedAt: now,
    version: 0,
    status: "new",
    error: null,
    turnId: null,
    startedAt: null,
  };
}
export function conversationGroup(date: string, now = new Date()) {
  const today = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  ).getTime();
  const day = new Date(date);
  const timestamp = new Date(
    day.getFullYear(),
    day.getMonth(),
    day.getDate(),
  ).getTime();
  const days = Math.round((today - timestamp) / 86400000);
  return days <= 0
    ? "Today"
    : days === 1
      ? "Yesterday"
      : days < 7
        ? "Previous 7 Days"
        : "Older";
}
