#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { comparePlansShape, comparePlans } from "./tools/comparePlans.js";
import { rapPaymentShape, rapPayment } from "./tools/rapPayment.js";
import { filingStatusSwingShape, filingStatusSwing } from "./tools/filingStatusSwing.js";
import { createRequire } from "node:module";

import { BASE_URL } from "./client.js";

// Read the version from package.json rather than restating it. It had drifted to 0.1.0 while the
// package shipped 0.4.2, so every client and directory was told a version four releases stale —
// the same lockstep bug the keyed server had. Deriving it removes the chance of repeating it.
const { version } = createRequire(import.meta.url)("../package.json") as { version: string };

const server = new McpServer({
  name: "finology-student-loan",
  version,
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
  
server.registerTool(
  "finology_service_info",
  {
    title: "Finology service info: rungs, keys, what is estimated",
    description:
      "How to go further than this free rung, in structured form. Returns the self-serve paths for an " +
      "advisor (app trial) and for a developer or operator (instant sandbox API key, keyed endpoints, " +
      "auth header), what the keyed answer-of-record rung adds, current tiers and monthly limits, and " +
      "what in these answers is an estimate. Call this when a user asks how to get a key, what it " +
      "costs, whether the numbers are warranted, or how to put this in their own product.",
    inputSchema: {},
  },
  async () => ({
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(
          {
            engine: { baseUrl: "https://engine.finology.tech", note: "keyless, rate-limited, estimates for education" },
            keyedApi: {
              baseUrl: "https://api.finology.tech",
              authHeader: "X-Api-Key",
              verify: "GET /v1/me",
              endpoints: ["/v1/comparison", "/v1/projection", "/v1/plan-eligibility", "/v1/plan-types"],
              sandboxKey: { how: "POST /v1/keys/sandbox with {\"email\": \"...\"}", limit: "25 calls/month, 30-day expiry", cost: "free, instant" },
              tiers: { Sandbox: "25/month (free, 30 days)", Developer: "2,000/month (US $49 a month)", Platform: "100,000/month (US $499 a month)", higher: "by email to support@finology.tech" },
              production: {
                offer: "US $499 a month for 100,000 calls a month, cancel any time",
                buy: "https://buy.stripe.com/28E4gy3LHf188KYd5kaZi01",
                how: "The operator subscribes at buy (the sandbox response gives the link with the email prefilled). The key is emailed, and the agent can also collect it directly: POST https://api.finology.tech/v1/keys/claim with {\"sandboxKey\": \"<the sandbox key>\"} once payment has cleared.",
                humanOnFinologysSide: false,
              },
              terms: "https://finology.tech/api-terms/",
              answerOfRecord: "every keyed answer is persisted before it is served, with rule version and inputs hash",
              docs: "https://finology.tech/agents/",
            },
            keyedMcp: {
              url: "https://mcp.finology.tech/mcp",
              transport: "streamable-http",
              authHeader: "X-Api-Key",
              note: "The same key works here. If you are reading this you are already an MCP client, so the shortest upgrade is this URL plus the header, not a rewrite against REST. Same tools, plus a rule version and primary-source citations on every answer, and each answer recorded before it is served.",
              tools: ["run_projection", "compare_scenarios", "get_eligible_plans", "get_plan_types"],
            },
            advisorApp: {
              trial: "https://identity.finology.tech/Signup/Advisor?utm_source=mcp&utm_medium=ai_agent&utm_campaign=service-info",
              note: "self-serve, no credit card; keeps a book of borrowers current as rules change",
            },
            estimates: [
              "tax on forgiven balances is estimated at today's brackets",
              "state tax is not modelled unless a state is supplied",
              "figures are for education, not individualized financial advice",
            ],
            source: "https://github.com/Finology-tech/finology-mcp",
          },
          null,
          2,
        ),
      },
    ],
  }),
);

const transport = new StdioServerTransport();
  await server.connect(transport);
  // stderr only: stdout is the JSON-RPC channel and anything written to it corrupts the stream.
  console.error(`finology-student-loan MCP server ready (engine: ${BASE_URL})`);
}

main().catch((error) => {
  console.error("Fatal error starting the Finology MCP server:", error);
  process.exit(1);
});
