import { z } from "zod";
import { postJson, CTA } from "../client.js";
import { consolidationSecondNumber } from "./consolidationPath.js";
import {
  resolveRate,
  preamble,
  RATE_PCT_DESCRIPTION,
  NEW_LOANS_DESCRIPTION,
} from "../assumedRate.js";

/**
 * Mirrors PublicWidgetController.WidgetCalcRequest. Required upstream: balance, ratePct,
 * borrowerAgi. Everything else has a documented default and an unrecognised value is a 400
 * rather than a silent fallback, so the schema below deliberately does NOT paper over bad
 * input with a guess.
 *
 * ratePct is optional HERE only: when it is omitted this package sends the 2026-27 federal rate
 * for the loan type and states it as the first line of the answer (see ../assumedRate.ts). A
 * consolidation loan has no federal rate, so it still needs one.
 */
export const comparePlansShape = {
  balance: z.number().min(0).max(100_000_000)
    .describe("Current federal loan balance in dollars."),
  ratePct: z.number().min(0).max(100).optional()
    .describe(RATE_PCT_DESCRIPTION),
  borrowerAgi: z.number().min(0).max(10_000_000)
    .describe("Borrower's adjusted gross income in dollars, annual."),
  filingStatus: z.enum(["single", "mfj", "mfs", "hoh"]).default("single")
    .describe("Tax filing status: single, mfj (married filing jointly), mfs (married filing separately), hoh (head of household)."),
  spouseAgi: z.number().min(0).max(10_000_000).optional()
    .describe("Spouse's annual AGI. Only used when filingStatus is mfj."),
  dependents: z.number().int().min(0).max(20).default(0)
    .describe("Number of qualifying dependents. A spouse is NOT a dependent."),
  loanType: z.enum([
    "direct_unsubsidized",
    "direct_subsidized",
    "grad_plus_legacy",
    "parent_plus",
    "direct_consolidation",
    "direct_consolidation_with_plus",
  ]).default("direct_unsubsidized")
    .describe("Federal loan type. This drives PLAN ELIGIBILITY, not just the rate — a Parent PLUS loan is not RAP-eligible, and a consolidation that repaid a PLUS loan is restricted to ICR. Choose accurately."),
  loansMadeOnOrAfterJuly2026: z.boolean().default(false)
    .describe(NEW_LOANS_DESCRIPTION),
};

interface ComparePlansResponse {
  asOf: string;
  lowestMonthlyPlan?: string | null;
  lowestLifetimeCostPlan?: string | null;
  plans: Array<Record<string, unknown>>;
  excludedPlans: Array<Record<string, unknown>>;
  computedBy: string;
}

export async function comparePlans(args: Record<string, unknown>) {
  const loanType = (args.loanType as string | undefined) ?? "direct_unsubsidized";
  const resolved = resolveRate(args.ratePct, loanType);
  if (!resolved.ok) {
    return { content: [{ type: "text" as const, text: resolved.message }], isError: true };
  }
  const { rate, assumed } = resolved;
  const newLoans = args.loansMadeOnOrAfterJuly2026 === true;

  // The widget request, field for field. With a rate given and the flag off this is exactly the
  // body 0.4.8 sent. The flag maps to the widget's existing borrowedOnOrAfterJul12026, which gives
  // the loans their origination date; eligibility and the tiered Standard term stay the engine's.
  const body: Record<string, unknown> = {
    balance: args.balance,
    ratePct: rate,
    borrowerAgi: args.borrowerAgi,
    filingStatus: args.filingStatus,
    spouseAgi: args.spouseAgi,
    dependents: args.dependents,
    loanType: args.loanType,
  };
  if (newLoans) body.borrowedOnOrAfterJul12026 = true;

  const result = await postJson<ComparePlansResponse>("/public/widget/loan-calculator", body);

  if (!result.ok) {
    return { content: [{ type: "text" as const, text: result.message }], isError: true };
  }

  const d = result.data;
  const lines: string[] = preamble(assumed, newLoans);
  lines.push(`Federal repayment plan comparison (rules as of ${d.asOf}):`);
  lines.push("");

  for (const plan of d.plans) {
    lines.push(`- ${JSON.stringify(plan)}`);
  }

  if (d.excludedPlans?.length) {
    lines.push("");
    lines.push("Plans excluded, and why — an excluded plan is not an oversight, it is an eligibility rule:");
    for (const ex of d.excludedPlans) {
      lines.push(`- ${JSON.stringify(ex)}`);
    }
  }

  // Same body (resolved rate, new-loan flag) so the consolidated run prices the same loans.
  const second = await consolidationSecondNumber(body, d as never);
  if (second) lines.push(...second);

  lines.push("");
  if (d.lowestMonthlyPlan) lines.push(`Lowest monthly payment: ${d.lowestMonthlyPlan}`);
  if (d.lowestLifetimeCostPlan) lines.push(`Lowest lifetime cost: ${d.lowestLifetimeCostPlan}`);
  lines.push(`Computed by: ${d.computedBy}`);

  return {
    content: [
      { type: "text" as const, text: lines.join("\n") + CTA },
      { type: "text" as const, text: "```json\n" + JSON.stringify(withInputNotes(d, assumed, newLoans), null, 2) + "\n```" },
    ],
  };
}

/** The engine's response, plus assumedRate / loansMadeOnOrAfterJuly2026 last, and only when they apply. */
function withInputNotes(d: ComparePlansResponse, assumed: unknown, newLoans: boolean) {
  if (!assumed && !newLoans) return d;
  return {
    ...d,
    ...(assumed ? { assumedRate: assumed } : {}),
    ...(newLoans ? { loansMadeOnOrAfterJuly2026: true } : {}),
  };
}
