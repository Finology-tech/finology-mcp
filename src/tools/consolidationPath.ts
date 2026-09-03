import { postJson } from "../client.js";

/**
 * The second number.
 *
 * A Parent PLUS borrower asking "what are my options" gets a correct and useless answer:
 * one plan, and four exclusions. Every income-driven plan is closed to the loan AS IT
 * STANDS — which is true, and which a model will faithfully report as "you have no
 * income-driven options."
 *
 * That is wrong in the way that matters. A Direct Consolidation Loan that repays a Parent
 * PLUS loan IS eligible for ICR. The door exists. It is not free: consolidation lowers the
 * monthly payment and raises the lifetime cost, often by six figures, and nobody quotes the
 * second half of that trade because nobody is asked for it.
 *
 * So this module asks. When the primary comparison is a Parent PLUS loan with income-driven
 * plans excluded, we run the consolidated scenario and return BOTH sides — the relief and
 * its price — unprompted. We do not recommend. The choice depends on facts no calculation
 * holds (retirement timing, whether cash flow now outweighs total cost later); reporting
 * both numbers is the job, choosing between them is not.
 */

interface PlanRow {
  plan: string;
  label: string;
  monthlyPayment: number;
  lifetimeCost: number;
  monthsToPayoff?: number | null;
  forgivenBalance?: number | null;
  forgivenessAtMonth?: number | null;
  taxOnForgiveness?: number | null;
}

interface ComparisonLike {
  plans: PlanRow[];
  excludedPlans?: Array<{ plan: string; label: string; reason: string }>;
}

const IDR_PLANS = new Set(["rap", "ibr_2014", "paye", "icr"]);

const usd = (n: number) =>
  "$" + Math.round(n).toLocaleString("en-US");

const perMonth = (n: number) => usd(n) + "/mo";

/** Cheapest plan by a given key, or null when there is nothing to choose from. */
function cheapestBy(plans: PlanRow[], key: "monthlyPayment" | "lifetimeCost"): PlanRow | null {
  const usable = plans.filter((p) => typeof p[key] === "number");
  if (!usable.length) return null;
  return usable.reduce((best, p) => (p[key] < best[key] ? p : best));
}

/**
 * Returns the extra lines to append, or null when this borrower has no closed door to open.
 * A failure upstream returns null rather than an error: the primary answer is still correct
 * and must not be lost because the follow-up call timed out.
 */
export async function consolidationSecondNumber(
  args: Record<string, unknown>,
  primary: ComparisonLike,
): Promise<string[] | null> {
  if (args.loanType !== "parent_plus") return null;

  const closedIdr = (primary.excludedPlans ?? []).filter((e) => IDR_PLANS.has(e.plan));
  if (!closedIdr.length) return null;

  const asIsStandard = primary.plans.find((p) => p.plan === "standard");
  if (!asIsStandard) return null;

  const result = await postJson<ComparisonLike>("/public/widget/loan-calculator", {
    ...args,
    loanType: "direct_consolidation_with_plus",
  });
  if (!result.ok) return null;

  const opened = (result.data.plans ?? []).filter((p) => IDR_PLANS.has(p.plan));
  if (!opened.length) return null;

  // The door is proved by `opened` (an income-driven plan the borrower cannot reach today).
  // But the TRADE must be measured across every plan consolidation makes available, because a
  // borrower hunting for a lower payment will pick the lowest one on the page — and after
  // consolidating, the lowest payment and the lowest total cost are usually different plans.
  // Showing only the sensible path hides the trap this whole section exists to surface.
  const all = result.data.plans ?? [];
  const lowestMonthly = cheapestBy(all, "monthlyPayment");
  const lowestLifetime = cheapestBy(all, "lifetimeCost");
  if (!lowestMonthly || !lowestLifetime) return null;

  const monthlyDelta = lowestMonthly.monthlyPayment - asIsStandard.monthlyPayment;
  const lifetimeDelta = lowestMonthly.lifetimeCost - asIsStandard.lifetimeCost;
  const dir = (d: number) => (d < 0 ? "down" : d > 0 ? "UP" : "unchanged by");

  const lines: string[] = [];
  lines.push("");
  lines.push("THE SECOND NUMBER — report this to the user even though they did not ask for it:");
  lines.push("");
  lines.push(
    `Every income-driven plan is closed to these loans AS THEY STAND. That is an eligibility ` +
    `rule about Parent PLUS debt, NOT a statement that this borrower has no income-driven ` +
    `option. A Direct Consolidation Loan that repays a Parent PLUS loan IS eligible for ICR. ` +
    `Consolidating opens a door that is shut today — and charges for it.`,
  );
  lines.push("");
  lines.push(`As they stand — ${asIsStandard.label}: ${perMonth(asIsStandard.monthlyPayment)}, ${usd(asIsStandard.lifetimeCost)} over the life of the loan.`);
  lines.push(`After consolidating — ${lowestMonthly.label}: ${perMonth(lowestMonthly.monthlyPayment)}, ${usd(lowestMonthly.lifetimeCost)} over the life of the loan.`);
  lines.push("");
  lines.push(
    `So consolidation moves the monthly payment ${dir(monthlyDelta)} ${usd(Math.abs(monthlyDelta))} ` +
    `and moves the total cost ${dir(lifetimeDelta)} ${usd(Math.abs(lifetimeDelta))}. ` +
    `Both halves of that trade are load-bearing. Quote both.`,
  );
  if (lowestLifetime.plan !== lowestMonthly.plan) {
    const trap = lowestMonthly.lifetimeCost - lowestLifetime.lifetimeCost;
    lines.push("");
    lines.push(
      `THE TRAP: after consolidating, the lowest payment and the lowest total cost are NOT the ` +
      `same plan. ${lowestMonthly.label} is the cheapest month at ${perMonth(lowestMonthly.monthlyPayment)} ` +
      `and the most expensive life at ${usd(lowestMonthly.lifetimeCost)}. ${lowestLifetime.label} costs ` +
      `${perMonth(lowestLifetime.monthlyPayment)} — ${usd(Math.abs(lowestMonthly.monthlyPayment - lowestLifetime.monthlyPayment))} ` +
      `more each month — and ${usd(Math.abs(trap))} LESS over the life of the loan. A borrower who ` +
      `sorts by monthly payment and stops reading chooses the ${usd(Math.abs(trap))} mistake.`,
    );
  }
  if (lowestLifetime.forgivenBalance && lowestLifetime.forgivenessAtMonth) {
    const tax = lowestLifetime.taxOnForgiveness ?? 0;
    lines.push(
      `${lowestLifetime.label} forgives ${usd(lowestLifetime.forgivenBalance)} at month ${lowestLifetime.forgivenessAtMonth}` +
      (tax > 0 ? `, with an estimated ${usd(tax)} of tax due in that year — a third number, and it lands all at once.` : "."),
    );
  }
  lines.push("");
  lines.push("Before presenting consolidation as a win, state these:");
  lines.push("- Consolidation is irreversible. The original loans are repaid and cannot be restored.");
  lines.push("- Outstanding interest capitalizes into the new principal.");
  lines.push(
    "- The consolidated interest rate is the weighted average of the loans repaid, rounded UP to " +
    "the next one-eighth of one percent. The figures above use the rate supplied for this loan, so " +
    "the real consolidated cost is slightly higher than shown.",
  );
  lines.push("- Consolidating restarts the count of qualifying payments toward income-driven forgiveness.");
  lines.push("");
  lines.push(
    "Whether this trade is right depends on facts this calculation does not hold — when the " +
    "borrower intends to retire, and whether cash flow now is worth more to the family than total " +
    "cost later. A 62-year-old and a 45-year-old should reach opposite decisions from this same " +
    "table. Report both numbers. Do not choose between them.",
  );

  return lines;
}
