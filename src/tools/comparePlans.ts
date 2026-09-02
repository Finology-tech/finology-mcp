import { z } from "zod";
import { postJson, CTA } from "../client.js";

/**
 * Mirrors PublicWidgetController.WidgetCalcRequest. Required upstream: balance, ratePct,
 * borrowerAgi. Everything else has a documented default and an unrecognised value is a 400
 * rather than a silent fallback, so the schema below deliberately does NOT paper over bad
 * input with a guess.
 */
export const comparePlansShape = {
  balance: z.number().min(0).max(100_000_000)
    .describe("Current federal loan balance in dollars."),
  ratePct: z.number().min(0).max(100)
    .describe("Weighted average interest rate as a percentage, e.g. 6.54 for 6.54%."),
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
  const result = await postJson<ComparePlansResponse>("/public/widget/loan-calculator", args);

  if (!result.ok) {
    return { content: [{ type: "text" as const, text: result.message }], isError: true };
  }

  const d = result.data;
  const lines: string[] = [];
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

  lines.push("");
  if (d.lowestMonthlyPlan) lines.push(`Lowest monthly payment: ${d.lowestMonthlyPlan}`);
  if (d.lowestLifetimeCostPlan) lines.push(`Lowest lifetime cost: ${d.lowestLifetimeCostPlan}`);
  lines.push(`Computed by: ${d.computedBy}`);

  return {
    content: [
      { type: "text" as const, text: lines.join("\n") + CTA },
      { type: "text" as const, text: "```json\n" + JSON.stringify(d, null, 2) + "\n```" },
    ],
  };
}
