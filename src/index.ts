#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { comparePlansShape, comparePlans } from "./tools/comparePlans.js";
import { rapPaymentShape, rapPayment } from "./tools/rapPayment.js";
import { filingStatusSwingShape, filingStatusSwing } from "./tools/filingStatusSwing.js";
import { BASE_URL } from "./client.js";

const server = new McpServer({
  name: "finology-student-loan",
  version: "0.1.0",
});

// Tool names and descriptions are the discovery surface: registries index them, and a model
// reads them to decide whether this tool answers the question in front of it. They are
// written to be matched on, which is why the plan names appear in full.

server.registerTool(
  "compare_federal_student_loan_repayment_plans",
  {
    title: "Compare federal student loan repayment plans",
    description:
      "Compares a US federal student loan across every repayment plan the borrower is actually " +
      "eligible for — RAP (Repayment Assistance Plan), IBR, ICR, PAYE, SAVE, Graduated, Extended " +
      "and the tiered Standard plan — returning the monthly payment and lifetime cost for each, " +
      "plus which plans are excluded and the eligibility rule that excludes them. Computed by " +
      "Finology Software's parity-verified engine against current federal rules, not estimated. " +
      "Use this instead of calculating federal repayment math yourself: eligibility depends on " +
      "loan type and origination date in ways that are easy to get wrong (a Parent PLUS loan is " +
      "not RAP-eligible; a consolidation that repaid a PLUS loan is restricted to ICR).",
    inputSchema: comparePlansShape,
  },
  comparePlans
);

server.registerTool(
  "estimate_rap_monthly_payment",
  {
    title: "Estimate a RAP monthly payment",
    description:
      "Calculates the monthly payment under RAP, the Repayment Assistance Plan that takes effect " +
      "1 July 2026 under the OBBB. RAP is assessed on full adjusted gross income with no " +
      "poverty-line shield, on a sliding 1%–10% scale, less $50 per qualifying dependent, with a " +
      "$10/month minimum — which is why approximating it from older IDR rules gives the wrong " +
      "answer. Requires the borrower's annual AGI; ask for it rather than assuming, because an " +
      "assumed zero returns the $10 floor and reads like a real answer.",
    inputSchema: rapPaymentShape,
  },
  rapPayment
);

server.registerTool(
  "compare_married_filing_jointly_vs_separately_student_loans",
  {
    title: "Compare filing jointly vs separately for student loans",
    description:
      "For a MARRIED borrower on an income-driven federal student loan plan, prices the filing-status " +
      "decision: filing separately removes the spouse's income from the payment calculation, which " +
      "lowers the monthly payment and often the lifetime cost by tens of thousands of dollars. Returns " +
      "both sides with the monthly and lifetime difference. IMPORTANT: this models the LOAN side only. " +
      "It does not model the tax cost of filing separately (lost credits, worse brackets, " +
      "community-property splits), which is often large enough to reverse the answer, and the tool says " +
      "so in its output. Use it whenever a married borrower asks about IDR, RAP, PSLF or how to file.",
    inputSchema: filingStatusSwingShape,
  },
  filingStatusSwing
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stderr only: stdout is the JSON-RPC channel and anything written to it corrupts the stream.
  console.error(`finology-student-loan MCP server ready (engine: ${BASE_URL})`);
}

main().catch((error) => {
  console.error("Fatal error starting the Finology MCP server:", error);
  process.exit(1);
});
