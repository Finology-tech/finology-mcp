import { z } from "zod";
import { postJson, CTA } from "../client.js";

/**
 * The filing-status decision, priced on the loan side.
 *
 * A married borrower on an income-driven plan faces a genuine trade-off that no single
 * payment estimate can express: filing SEPARATELY removes the spouse's income from the
 * payment calculation, which lowers the monthly payment and usually the lifetime cost —
 * and raises the tax bill, because separate filers lose credits and face worse brackets.
 *
 * HARD, and the reason this tool is written the way it is: Finology's engine models the
 * LOAN side of that trade-off exactly. It does NOT model the tax cost of filing separately.
 * Returning only the loan half as though it were the answer would be the same confident
 * half-truth this whole server exists to replace. So the tax side is named explicitly as
 * unmodelled every time, and the tool says plainly that the two have to be weighed together.
 */
export const filingStatusSwingShape = {
  balance: z.number().min(0).max(100_000_000)
    .describe("Current federal loan balance in dollars."),
  ratePct: z.number().min(0).max(100)
    .describe("Weighted average interest rate as a percentage, e.g. 6.54 for 6.54%."),
  borrowerAgi: z.number().min(0).max(10_000_000)
    .describe("The borrower's own annual adjusted gross income in dollars."),
  spouseAgi: z.number().min(0).max(10_000_000)
    .describe("The spouse's annual AGI in dollars. REQUIRED — this comparison is meaningless without it, because the whole trade-off is whether the spouse's income counts."),
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
    .describe("Federal loan type. Drives plan eligibility, not just the rate."),
};

interface Plan {
  plan: string;
  label: string;
  monthlyPayment: number;
  lifetimeCost: number;
}

interface CalcResponse {
  asOf: string;
  lowestLifetimeCostPlan?: string | null;
  plans: Plan[];
  computedBy: string;
}

const usd = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

export async function filingStatusSwing(args: Record<string, unknown>) {
  const base = {
    balance: args.balance,
    ratePct: args.ratePct,
    borrowerAgi: args.borrowerAgi,
    dependents: args.dependents ?? 0,
    loanType: args.loanType ?? "direct_unsubsidized",
  };

  // Two runs. Jointly counts the spouse's income; separately does not — that single
  // difference is the entire decision.
  const [joint, separate] = await Promise.all([
    postJson<CalcResponse>("/public/widget/loan-calculator", {
      ...base,
      filingStatus: "mfj",
      spouseAgi: args.spouseAgi,
    }),
    postJson<CalcResponse>("/public/widget/loan-calculator", {
      ...base,
      filingStatus: "mfs",
    }),
  ]);

  if (!joint.ok) return { content: [{ type: "text" as const, text: joint.message }], isError: true };
  if (!separate.ok) return { content: [{ type: "text" as const, text: separate.message }], isError: true };

  // Compare income-driven plans only. Standard is unaffected by filing status, so including
  // it would dilute the swing with a row that cannot move.
  const idrOnly = (r: CalcResponse) => r.plans.filter((p) => p.plan !== "standard");

  const bestJoint = idrOnly(joint.data).sort((a, b) => a.lifetimeCost - b.lifetimeCost)[0];
  const bestSeparate = idrOnly(separate.data).sort((a, b) => a.lifetimeCost - b.lifetimeCost)[0];

  if (!bestJoint || !bestSeparate) {
    return {
      content: [{
        type: "text" as const,
        text: "This loan book has no income-driven plan available, so filing status does not change the repayment maths here. " +
          "Run the plan comparison tool to see which plans are open and which federal rule excludes the rest." + CTA,
      }],
    };
  }

  const monthlyDelta = bestJoint.monthlyPayment - bestSeparate.monthlyPayment;
  const lifetimeDelta = bestJoint.lifetimeCost - bestSeparate.lifetimeCost;

  const lines = [
    `**Filing status changes this borrower's loan cost by ${usd(Math.abs(lifetimeDelta))} over the life of the loan.**`,
    "",
    `| | Filing jointly | Filing separately |`,
    `|---|---|---|`,
    `| Best income-driven plan | ${bestJoint.label} | ${bestSeparate.label} |`,
    `| Monthly payment | ${usd(bestJoint.monthlyPayment)} | ${usd(bestSeparate.monthlyPayment)} |`,
    `| Lifetime loan cost | ${usd(bestJoint.lifetimeCost)} | ${usd(bestSeparate.lifetimeCost)} |`,
    "",
    monthlyDelta > 0
      ? `Filing separately lowers the monthly payment by ${usd(Math.abs(monthlyDelta))}, because the spouse's income stops counting toward it.`
      : `Filing jointly is the cheaper side on the loan alone here, by ${usd(Math.abs(monthlyDelta))} a month.`,
    "",
    "**This is only half the decision, and the half that is missing is the reason to get advice.**",
    "",
    "These figures are the LOAN side only. Filing separately also changes the tax return: separate",
    "filers commonly lose the student loan interest deduction, education credits, and favourable",
    "brackets, and in community-property states the income split is a further calculation. Finology",
    "Software's engine does not model that tax cost, and it is frequently large enough to reverse",
    "the answer above. The two have to be weighed together, against one household's actual return.",
    "",
    `Rules as of ${joint.data.asOf}. Source: ${joint.data.computedBy}.`,
  ];

  return {
    content: [
      { type: "text" as const, text: lines.join("\n") + CTA },
      {
        type: "text" as const,
        text: "```json\n" + JSON.stringify({
          filingJointly: { bestPlan: bestJoint, allPlans: joint.data.plans },
          filingSeparately: { bestPlan: bestSeparate, allPlans: separate.data.plans },
          monthlyDelta,
          lifetimeDelta,
          taxSideModelled: false,
        }, null, 2) + "\n```",
      },
    ],
  };
}
