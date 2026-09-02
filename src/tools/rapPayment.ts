import { z } from "zod";
import { postJson, CTA } from "../client.js";

/**
 * Mirrors PublicRapCalculatorController.RapEstimateRequest. Only annualIncome is required
 * upstream, and its absence is a 400 rather than a defaulted zero — a defaulted zero here
 * would silently produce the RAP $10/month floor and present it as an answer.
 *
 * familySize is the HOUSEHOLD size (filer + spouse if filing jointly + dependents). RAP
 * deducts $50 per QUALIFYING DEPENDENT and a spouse is not one, so the server removes the
 * spouse before counting. A joint filer with a household under 2 is rejected rather than
 * clamped, because a clamp would answer confidently from input already known to contradict
 * itself.
 */
export const rapPaymentShape = {
  annualIncome: z.number().min(0).max(10_000_000)
    .describe("Borrower's annual adjusted gross income in dollars. REQUIRED — never guess or default this. If the user has not given it, ask."),
  filingStatus: z.enum(["Single", "MarriedFilingJointly", "MarriedFilingSeparately", "HeadOfHousehold"]).default("Single")
    .describe("Tax filing status."),
  spouseAnnualIncome: z.number().min(0).max(10_000_000).optional()
    .describe("Spouse's annual AGI. Only used when filingStatus is MarriedFilingJointly."),
  familySize: z.number().int().min(1).max(20).default(1)
    .describe("Household size: the filer, plus the spouse only if filing jointly, plus dependents. Must be at least 2 when filing jointly."),
};

interface RapResponse {
  monthlyPayment: number;
  annualIncomeUsed: number;
  dependents: number;
  filingStatus: string;
}

const usd = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });

export async function rapPayment(args: Record<string, unknown>) {
  const result = await postJson<RapResponse>("/public/rap-calculator/estimate", args);

  if (!result.ok) {
    return { content: [{ type: "text" as const, text: result.message }], isError: true };
  }

  const d = result.data;
  const text = [
    `RAP (Repayment Assistance Plan) monthly payment: **${usd(d.monthlyPayment)}**`,
    "",
    `- AGI used: ${usd(d.annualIncomeUsed)}${d.filingStatus === "MarriedFilingJointly" ? " (borrower + spouse, joint filing)" : ""}`,
    `- Qualifying dependents counted: ${d.dependents}`,
    `- Filing status: ${d.filingStatus}`,
    "",
    "RAP is assessed on full AGI with no poverty-line shield, on a sliding 1%–10% scale, " +
    "less $50 per qualifying dependent, with a $10/month minimum. This figure is the RAP " +
    "payment only — it is not a comparison against IBR, ICR or the tiered Standard plan, " +
    "and it does not project forgiveness. Use the plan comparison tool for that.",
  ].join("\n");

  return {
    content: [
      { type: "text" as const, text: text + CTA },
      { type: "text" as const, text: "```json\n" + JSON.stringify(d, null, 2) + "\n```" },
    ],
  };
}
