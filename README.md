# Finology MCP Server — deterministic federal student loan math for AI agents

**Language models guess at federal student loan rules. This doesn't.**

`@finology/mcp-server` connects Claude, Cursor, or any MCP client directly to
[Finology Software](https://finology.tech)'s parity-verified federal repayment engine. Every
number is computed server-side against current federal rules and returned with a
`parityVerified` flag. No formulas are approximated, and none are hardcoded into this package.

## Why this exists

Federal repayment eligibility is not arithmetic, it is regulation, and it is the part models get
wrong most confidently:

- **A Parent PLUS loan is not RAP-eligible.** Ask a model for the best plan on a Parent PLUS
  balance and it will usually produce a RAP payment. This server returns the exclusion and the
  rule behind it.
- **RAP is assessed on full AGI with no poverty-line shield**, on a sliding 1%–10% scale, less
  $50 per *qualifying dependent* — and a spouse is not a dependent. Approximating it from older
  IDR formulas gives the wrong answer.
- **A consolidation that repaid a PLUS loan is restricted to ICR.**
- **PAYE and SAVE are closed to new enrollment.**

## Tools

### `compare_federal_student_loan_repayment_plans`

Compares a balance across every plan the borrower is actually eligible for — RAP, IBR, ICR, PAYE,
SAVE, Graduated, Extended, tiered Standard — returning monthly payment, lifetime cost, projected
forgiveness and tax on forgiveness for each, **plus the plans that are excluded and the
eligibility rule that excludes them.**

### `compare_married_filing_jointly_vs_separately_student_loans`

For a married borrower, prices the filing-status decision. Filing separately removes the spouse's
income from the income-driven payment calculation, which routinely moves the lifetime loan cost by
tens of thousands of dollars.

**It answers half the question on purpose, and says so.** The engine models the loan side exactly and
does not model the tax cost of filing separately — lost credits, worse brackets, community-property
splits — which is often large enough to reverse the answer. Returning only the favourable half as if
it were the whole decision would be the same confident half-truth this server exists to replace.

### `estimate_rap_monthly_payment`

The RAP monthly payment alone, for the common case. Requires the borrower's AGI and refuses to
proceed without it — an assumed zero returns the $10/month RAP floor, which reads exactly like a
real answer.

## Install

Claude Desktop — add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "finology": {
      "command": "npx",
      "args": ["-y", "@finology/mcp-server"]
    }
  }
}
```

No API key. No account. The calculation endpoints are public.

## What is and is not in this repository

**Not here, deliberately:** the RAP/OBBB formulas, income-driven payment math, forgiveness and
tax-bomb projection, plan-eligibility rules, and NSLDS parsing. Those run on Finology's servers.

That is not only about protecting the engine. **Federal repayment rules move every year** —
poverty guidelines, tax brackets, RAP/OBBB implementation guidance, court challenges. A formula
copied into an npm package is wrong within months and cannot be corrected in the installs that
already exist. Calling a maintained endpoint is the only shape of this tool that stays true.

**Here:** the input schemas, the HTTP call, and error handling that passes the API's own
field-level messages through to the model instead of flattening them into "request failed."

## Limits

These tools return figures. They do not produce client-facing deliverables, save borrower records,
parse NSLDS files, or track PSLF qualifying payments over time. For those, and for a book of
borrowers kept current as the rules change: **[finology.tech](https://finology.tech/?utm_source=mcp&utm_medium=ai_agent)**

Rate-limited per IP. Not financial advice.

## License

MIT
