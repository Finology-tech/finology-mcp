// Balance-only inputs (mirrors Finology-tech/finology PR #1642). Hermetic: fetch is replaced
// with a recorder, so these assert the exact widget request this package sends and the answer
// it builds from the engine's response. The engine's own numbers are covered by the live smoke.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";

import { comparePlans, comparePlansShape } from "../src/tools/comparePlans.js";
import { filingStatusSwing, filingStatusSwingShape } from "../src/tools/filingStatusSwing.js";
import { NO_RATE_TO_ASSUME, NEW_LOANS_STATEMENT } from "../src/assumedRate.js";

const UNDERGRAD_STATEMENT =
  "No rate was given, so this uses the 2026-27 federal rate for an undergraduate Direct Unsubsidized loan, 6.52%. " +
  "Your own loans' rates are on studentaid.gov or your loan file. Graduate and professional Direct Unsubsidized " +
  "loans carry 8.07% for 2026-27; for those, run it again with ratePct 8.07.";

type Body = Record<string, unknown>;
let calls: Body[] = [];
let respond: (body: Body) => unknown;
const realFetch = globalThis.fetch;

const plan = (plan: string, label: string, monthlyPayment: number, lifetimeCost: number) =>
  ({ plan, label, monthlyPayment, lifetimeCost });

/** A canned engine response that depends on the request, so a wrong rate or status shows up in the numbers. */
function engine(body: Body) {
  const rate = body.ratePct as number;
  const jointBump = body.filingStatus === "mfj" ? 200 : 0;
  if (body.borrowedOnOrAfterJul12026 === true) {
    return {
      asOf: "2026-07-01", computedBy: "test engine",
      plans: [plan("obbb_standard", "Tiered Standard", 10 * rate, 1), plan("rap", "RAP", 150 + jointBump, 50_000 + jointBump)],
      excludedPlans: [{ plan: "ibr_2014", label: "IBR", reason: "on or after July 1, 2026" }],
    };
  }
  if (body.loanType === "parent_plus") {
    return {
      asOf: "2026-07-01", computedBy: "test engine",
      plans: [plan("standard", "Standard (10-year)", 100 * rate, 1000 * rate)],
      excludedPlans: [{ plan: "icr", label: "ICR", reason: "Parent PLUS" }],
    };
  }
  return {
    asOf: "2026-07-01", computedBy: "test engine",
    lowestMonthlyPlan: "rap", lowestLifetimeCostPlan: "standard",
    plans: [
      plan("standard", "Standard (10-year)", 100 * rate, 1000 * rate),
      plan("rap", "RAP", 350 + jointBump, 70_000 + 10 * rate + jointBump),
      plan("ibr_2014", "IBR", 384 + jointBump, 72_000 + 10 * rate + jointBump),
    ],
    excludedPlans: [],
  };
}

beforeEach(() => {
  calls = [];
  respond = engine;
  globalThis.fetch = (async (_url: unknown, init?: { body?: string }) => {
    const body = JSON.parse(init?.body ?? "{}") as Body;
    calls.push(body);
    return new Response(JSON.stringify(respond(body)), { status: 200 });
  }) as typeof fetch;
});
afterEach(() => { globalThis.fetch = realFetch; });

const parseCompare = (input: Body) => z.object(comparePlansShape).parse(input) as Body;
const parseSwing = (input: Body) => z.object(filingStatusSwingShape).parse(input) as Body;
const text = (r: { content: Array<{ text: string }> }) => r.content.map((c) => c.text).join("\n");
const first = (r: { content: Array<{ text: string }> }) => r.content[0].text;

// ------------------------------------------------------------------ compare: rate given

test("compare, rate given: request is the 0.4.8 body, answer has no assumption", async () => {
  const args = parseCompare({ balance: 60000, ratePct: 6.5, borrowerAgi: 70000, loanType: "direct_unsubsidized" });
  const r = await comparePlans(args);
  assert.equal(calls.length, 1);
  // 0.4.8 posted the parsed args as they were; the flag is the only new key and it is not sent when false.
  const { loansMadeOnOrAfterJuly2026, ...old } = args;
  assert.equal(loansMadeOnOrAfterJuly2026, false);
  assert.deepEqual(calls[0], old);
  assert.ok(!("borrowedOnOrAfterJul12026" in calls[0]));
  assert.ok(first(r).startsWith("Federal repayment plan comparison (rules as of 2026-07-01):"));
  assert.ok(!text(r).includes("No rate was given"));
  assert.ok(!text(r).includes("assumedRate"));
  assert.ok(!text(r).includes(NEW_LOANS_STATEMENT));
});

// ------------------------------------------------------------------ compare: rate omitted

test("compare, rate omitted: statement is the first line and the numbers equal the same call at 6.52", async () => {
  const omitted = await comparePlans(parseCompare({ balance: 60000, borrowerAgi: 70000 }));
  const omittedBody = calls[0];
  calls = [];
  const given = await comparePlans(parseCompare({ balance: 60000, ratePct: 6.52, borrowerAgi: 70000 }));
  const givenBody = calls[0];

  assert.equal(omittedBody.ratePct, 6.52);
  assert.deepEqual(omittedBody, givenBody);
  assert.equal(first(omitted).split("\n")[0], UNDERGRAD_STATEMENT);
  // Everything after the statement and its blank line is the rate-given answer, unchanged.
  assert.equal(first(omitted), UNDERGRAD_STATEMENT + "\n\n" + first(given));
  const json = JSON.parse(omitted.content[1].text.replace(/^```json\n|\n```$/g, ""));
  assert.equal(json.assumedRate.ratePct, 6.52);
  assert.equal(json.assumedRate.awardYear, "2026-27");
  assert.equal(Object.keys(json).at(-1), "assumedRate");
});

test("compare, rate omitted: each loan type gets its 2026-27 rate", async () => {
  const cases: Array<[string, number, string]> = [
    ["direct_unsubsidized", 6.52, "an undergraduate Direct Unsubsidized loan, 6.52%"],
    ["direct_subsidized", 6.52, "a Direct Subsidized loan, 6.52%"],
    ["grad_plus_legacy", 9.07, "a Grad PLUS loan, 9.07%"],
    ["parent_plus", 9.07, "a Parent PLUS loan, 9.07%"],
  ];
  for (const [loanType, rate, phrase] of cases) {
    calls = [];
    const r = await comparePlans(parseCompare({ balance: 50000, borrowerAgi: 60000, loanType }));
    assert.equal(calls[0].ratePct, rate, loanType);
    assert.ok(first(r).startsWith(`No rate was given, so this uses the 2026-27 federal rate for ${phrase}.`), loanType);
    if (loanType !== "direct_unsubsidized") assert.ok(!first(r).includes("8.07"), loanType);
  }
});

test("compare, Parent PLUS rate omitted: the consolidation second number runs at the same assumed rate", async () => {
  const r = await comparePlans(parseCompare({ balance: 80000, borrowerAgi: 60000, loanType: "parent_plus" }));
  assert.equal(calls.length, 2);
  assert.equal(calls[1].loanType, "direct_consolidation_with_plus");
  assert.equal(calls[1].ratePct, 9.07);
  assert.ok(first(r).startsWith("No rate was given"));
});

// ------------------------------------------------------------------ consolidation needs a rate

test("compare and swing, consolidation without a rate: the PR's error, no engine call", async () => {
  for (const loanType of ["direct_consolidation", "direct_consolidation_with_plus"]) {
    calls = [];
    const c = await comparePlans(parseCompare({ balance: 60000, borrowerAgi: 70000, loanType }));
    assert.equal(c.isError, true);
    assert.equal(first(c), NO_RATE_TO_ASSUME);
    const s = await filingStatusSwing(parseSwing({ balance: 60000, borrowerAgi: 70000, spouseAgi: 50000, loanType }));
    assert.equal(s.isError, true);
    assert.equal(first(s), NO_RATE_TO_ASSUME);
    assert.equal(calls.length, 0);
  }
  // With a rate, consolidation runs as before.
  const ok = await comparePlans(parseCompare({ balance: 60000, ratePct: 6.875, borrowerAgi: 70000, loanType: "direct_consolidation" }));
  assert.equal(ok.isError, undefined);
  assert.equal(calls[0].ratePct, 6.875);
});

// ------------------------------------------------------------------ new-loan flag

test("compare, new-loan flag: sends borrowedOnOrAfterJul12026 and opens with the new-loans line", async () => {
  const r = await comparePlans(parseCompare({ balance: 27000, ratePct: 6.52, borrowerAgi: 45000, loansMadeOnOrAfterJuly2026: true }));
  assert.equal(calls[0].borrowedOnOrAfterJul12026, true);
  assert.ok(!("loansMadeOnOrAfterJuly2026" in calls[0]));
  assert.equal(first(r).split("\n")[0], NEW_LOANS_STATEMENT);
  const json = JSON.parse(r.content[1].text.replace(/^```json\n|\n```$/g, ""));
  assert.equal(json.loansMadeOnOrAfterJuly2026, true);
  assert.equal(json.assumedRate, undefined);
});

test("compare, rate omitted and new loans: rate statement first, then the new-loans line", async () => {
  const r = await comparePlans(parseCompare({ balance: 27000, borrowerAgi: 45000, loansMadeOnOrAfterJuly2026: true }));
  const lines = first(r).split("\n");
  assert.equal(lines[0], UNDERGRAD_STATEMENT);
  assert.equal(lines[2], NEW_LOANS_STATEMENT);
  assert.equal(calls[0].ratePct, 6.52);
  assert.equal(calls[0].borrowedOnOrAfterJul12026, true);
});

// ------------------------------------------------------------------ filing-status swing

test("swing, rate given: both bodies are the 0.4.8 bodies", async () => {
  await filingStatusSwing(parseSwing({ balance: 60000, ratePct: 6.5, borrowerAgi: 70000, spouseAgi: 50000 }));
  const base = { balance: 60000, ratePct: 6.5, borrowerAgi: 70000, dependents: 0, loanType: "direct_unsubsidized" };
  const byStatus = Object.fromEntries(calls.map((c) => [c.filingStatus, c]));
  assert.deepEqual(byStatus.mfj, { ...base, filingStatus: "mfj", spouseAgi: 50000 });
  assert.deepEqual(byStatus.mfs, { ...base, filingStatus: "mfs" });
});

test("swing, rate omitted: statement first, same answer as rate 6.52 given", async () => {
  const omitted = await filingStatusSwing(parseSwing({ balance: 60000, borrowerAgi: 70000, spouseAgi: 50000 }));
  const omittedBodies = calls;
  calls = [];
  const given = await filingStatusSwing(parseSwing({ balance: 60000, ratePct: 6.52, borrowerAgi: 70000, spouseAgi: 50000 }));
  assert.deepEqual(omittedBodies, calls);
  assert.ok(omittedBodies.every((b) => b.ratePct === 6.52));
  assert.equal(first(omitted), UNDERGRAD_STATEMENT + "\n\n" + first(given));
});

test("swing, new loans: flag sent on both runs, best plan is never the tiered Standard", async () => {
  const r = await filingStatusSwing(parseSwing({ balance: 27000, ratePct: 6.52, borrowerAgi: 45000, spouseAgi: 40000, loansMadeOnOrAfterJuly2026: true }));
  assert.equal(calls.length, 2);
  assert.ok(calls.every((b) => b.borrowedOnOrAfterJul12026 === true));
  assert.equal(first(r).split("\n")[0], NEW_LOANS_STATEMENT);
  const json = JSON.parse(r.content[1].text.replace(/^```json\n|\n```$/g, ""));
  assert.equal(json.filingJointly.bestPlan.plan, "rap");
  assert.equal(json.filingSeparately.bestPlan.plan, "rap");
  assert.equal(json.loansMadeOnOrAfterJuly2026, true);
});

// ------------------------------------------------------------------ schema

test("schema: balance and income alone parse; ratePct is optional; the flag defaults to false", () => {
  const c = parseCompare({ balance: 60000, borrowerAgi: 70000 });
  assert.equal(c.ratePct, undefined);
  assert.equal(c.loansMadeOnOrAfterJuly2026, false);
  const s = parseSwing({ balance: 60000, borrowerAgi: 70000, spouseAgi: 50000 });
  assert.equal(s.ratePct, undefined);
  assert.throws(() => parseCompare({ ratePct: 6.5, borrowerAgi: 70000 }));
  assert.throws(() => parseSwing({ balance: 60000, borrowerAgi: 70000 }));
  // Parameter order is unchanged; the flag is appended last.
  assert.deepEqual(Object.keys(comparePlansShape),
    ["balance", "ratePct", "borrowerAgi", "filingStatus", "spouseAgi", "dependents", "loanType", "loansMadeOnOrAfterJuly2026"]);
  assert.deepEqual(Object.keys(filingStatusSwingShape),
    ["balance", "ratePct", "borrowerAgi", "spouseAgi", "dependents", "loanType", "loansMadeOnOrAfterJuly2026"]);
});
