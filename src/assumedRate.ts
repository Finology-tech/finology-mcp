/**
 * A balance alone is enough (mirrors Finology-tech/finology PR #1642, AssumedFederalRate.cs).
 *
 * A linked loan account often shows the balance only, never the rate. When no ratePct is given,
 * the compare tools run the federal fixed rate for the loan type for the most recent award year
 * and say so as the first line of the answer.
 *
 * Rates for Direct Loans first disbursed July 1, 2026 through June 30, 2027 (FSA electronic
 * announcement on Direct Loan interest rates, 2026-06-04; HEA 455(b)(8)): the 10-year Treasury
 * high yield at the May 12, 2026 auction, 4.468%, plus 2.05 (undergraduate), 3.60 (graduate or
 * professional) and 4.60 (PLUS) points: 6.52%, 8.07% and 9.07%. These are award-year inputs, not
 * repayment math; every payment is still computed by the engine at the rate sent.
 *
 * A Direct Consolidation Loan has no award-year rate (its rate is the weighted average of the
 * loans it repaid, rounded up to the next one-eighth of a percent), so there is none to assume.
 */

export const AWARD_YEAR = "2026-27";
export const UNDERGRADUATE_DIRECT = 6.52;
export const GRADUATE_DIRECT_UNSUBSIDIZED = 8.07;
export const PLUS = 9.07;

export interface Assumption {
  awardYear: string;
  ratePct: number;
  loanType: string;
  /** The plain-words statement every answer that used this rate opens with. */
  statement: string;
}

const pct = (rate: number) => rate.toFixed(2) + "%";

/** The rate to assume for a loan-type key; null when there is no federal rate to assume. */
export function assumedRateFor(loanType: string): Assumption | null {
  const pick: Record<string, [number, string]> = {
    direct_unsubsidized: [UNDERGRADUATE_DIRECT, "an undergraduate Direct Unsubsidized loan"],
    direct_subsidized: [UNDERGRADUATE_DIRECT, "a Direct Subsidized loan"],
    grad_plus_legacy: [PLUS, "a Grad PLUS loan"],
    parent_plus: [PLUS, "a Parent PLUS loan"],
  };
  const p = pick[loanType];
  if (!p) return null;
  const [rate, name] = p;
  let statement =
    `No rate was given, so this uses the ${AWARD_YEAR} federal rate for ${name}, ${pct(rate)}. ` +
    "Your own loans' rates are on studentaid.gov or your loan file.";
  if (loanType === "direct_unsubsidized") {
    statement +=
      ` Graduate and professional Direct Unsubsidized loans carry ${pct(GRADUATE_DIRECT_UNSUBSIDIZED)} for ${AWARD_YEAR}; ` +
      `for those, run it again with ratePct ${GRADUATE_DIRECT_UNSUBSIDIZED.toFixed(2)}.`;
  }
  return { awardYear: AWARD_YEAR, ratePct: rate, loanType, statement };
}

/** The refusal for a loan type with no federal rate to assume (a consolidation loan). */
export const NO_RATE_TO_ASSUME =
  "A Direct Consolidation Loan's rate is the weighted average of the rates of the loans it repaid, " +
  "rounded up to the next one-eighth of a percent, so there is no federal rate to assume. Ask the borrower " +
  "for the rate (it is on studentaid.gov or their loan file) and pass it as ratePct.";

/** The header line when the loans were run as made on or after July 1, 2026. */
export const NEW_LOANS_STATEMENT =
  "These loans were run as made on or after July 1, 2026, so only the plans new loans can elect are priced: " +
  "RAP and the tiered Standard plan (a Parent PLUS loan: the tiered Standard plan only).";

export const RATE_PCT_DESCRIPTION =
  "Optional. Weighted average interest rate as a percentage, e.g. 6.54 for 6.54%. Omit it when the rate is not known " +
  "(a linked account often shows the balance only): the 2026-27 federal rate for loanType is then used and stated in the answer " +
  "(undergraduate Direct 6.52%, PLUS 9.07%; for graduate or professional Direct Unsubsidized loans pass 8.07). " +
  "Required for a consolidation loan, which has no federal rate.";

export const NEW_LOANS_DESCRIPTION =
  "Optional, default false. Set true when the borrower says the loans are new: first disbursed (or consolidated) on or after " +
  "July 1, 2026. New loans can elect only RAP and the tiered Standard plan (Parent PLUS: the tiered Standard plan only), " +
  "so leaving this false for new loans offers plans they cannot elect.";

export type ResolvedRate =
  | { ok: true; rate: number; assumed: Assumption | null }
  | { ok: false; message: string };

/** The rate to send: the caller's, or the assumed federal rate for the loan type (stated in the answer). */
export function resolveRate(ratePct: unknown, loanType: string): ResolvedRate {
  if (typeof ratePct === "number") return { ok: true, rate: ratePct, assumed: null };
  const assumed = assumedRateFor(loanType);
  if (!assumed) return { ok: false, message: NO_RATE_TO_ASSUME };
  return { ok: true, rate: assumed.ratePct, assumed };
}

/** The assumed-rate and new-loan statements that open an answer; empty when neither applies. */
export function preamble(assumed: Assumption | null, newLoans: boolean): string[] {
  const lines: string[] = [];
  if (assumed) lines.push(assumed.statement, "");
  if (newLoans) lines.push(NEW_LOANS_STATEMENT, "");
  return lines;
}
