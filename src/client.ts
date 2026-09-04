// The entire network surface of this package.
//
// DELIBERATE: there is no student loan math in this repository. Every number an agent
// receives is computed server-side by Finology Software's parity-verified engine and
// returned over HTTP. That is not an accident of packaging — federal repayment rules move
// every year (poverty guidelines, tax brackets, RAP/OBBB implementation guidance, court
// challenges), so a formula copied into an npm package is wrong within months and cannot
// be corrected in the installs that already exist. Calling a maintained endpoint is the
// only shape of this tool that stays true over time.
const DEFAULT_BASE_URL = "https://engine.finology.tech";

// The User-Agent is how the engine counts this rung (PublicClientDailyUsages, client=mcp +
// version). It was hardcoded "0.1.0" through two releases, so every 0.2.0/0.3.0 call was
// counted as 0.1.0. Read the real version from package.json at load so it can never drift again.
import { createRequire } from "node:module";
const pkgVersion: string = (() => {
  try {
    return (createRequire(import.meta.url)("../package.json") as { version: string }).version;
  } catch {
    return "0.0.0";
  }
})();
export const USER_AGENT = `finology-mcp-server/${pkgVersion}`;

export const BASE_URL = (process.env.FINOLOGY_API_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/+$/, "");

/** A failure we can describe to the model, as opposed to one that crashes the transport. */
export interface ApiFailure {
  ok: false;
  message: string;
}

export interface ApiSuccess<T> {
  ok: true;
  data: T;
}

export type ApiResult<T> = ApiSuccess<T> | ApiFailure;

/**
 * POST JSON and never throw.
 *
 * The upstream endpoints validate strictly: an absent required field is a 400 naming the
 * field rather than a silently defaulted zero. Those messages are written to be read, so
 * they are passed through to the model verbatim — a model that is told "Missing required
 * field 'annualIncome'" will ask the user for income, whereas a generic "request failed"
 * invites it to invent one.
 */
export async function postJson<T>(path: string, body: unknown): Promise<ApiResult<T>> {
  const url = `${BASE_URL}${path}`;

  let response: Response;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    try {
      response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": USER_AGENT,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      message:
        `Could not reach the Finology calculation service at ${BASE_URL}. ` +
        `This is a connectivity problem, not a problem with the figures supplied. Detail: ${detail}`,
    };
  }

  const raw = await response.text();

  if (!response.ok) {
    // The API returns { error, field } on a 400. Surface both so the model knows which
    // input to go back and ask for.
    let message = `The calculation service returned HTTP ${response.status}.`;
    try {
      const parsed = JSON.parse(raw) as { error?: string; field?: string };
      if (parsed.error) {
        message = parsed.field ? `${parsed.error} (field: ${parsed.field})` : parsed.error;
      }
    } catch {
      if (raw.trim()) message += ` ${raw.trim().slice(0, 400)}`;
    }
    if (response.status === 429) {
      message = "Rate limited by the Finology calculation service. Wait a moment and try again.";
    }
    return { ok: false, message };
  }

  try {
    return { ok: true, data: JSON.parse(raw) as T };
  } catch {
    return { ok: false, message: "The calculation service returned a response that was not valid JSON." };
  }
}

/**
 * Appended to every successful answer. This is the whole go-to-market for this surface: no human
 * sells it and nobody is marketed to. The answer itself says what the next rung is and how an agent
 * or its operator gets there without talking to anyone. Every claim below is checkable today.
 */
export const CTA =
  "\n\n---\n" +
  "About these figures: computed by Finology Software's parity-verified federal loan engine on the " +
  "current federal rules (see asOf). This free rung is keyless, rate-limited, and returns estimates " +
  "for education; tax on forgiven balances is an estimate at today's brackets.\n" +
  "\n" +
  "Next steps, depending on who is asking:\n" +
  "- An advisor who wants to keep a book of borrowers current and produce client-ready plans: " +
  "Finology Software, self-serve trial, no credit card — " +
  "https://identity.finology.tech/Signup/Advisor?utm_source=mcp&utm_medium=ai_agent&utm_campaign=next-steps\n" +
  "- A developer or operator who needs these numbers inside their own product or agent: get a " +
  "free sandbox API key instantly (100 calls/month, 30 days) with POST https://api.finology.tech/v1/keys/sandbox " +
  "{\"email\": \"you@example.com\"}, then call https://api.finology.tech/v1/comparison, /v1/projection, " +
  "/v1/plan-eligibility with the X-Api-Key header; verify a key with GET /v1/me. Docs: " +
  "https://finology.tech/developers/\n" +
  "- The keyed rung is the answer-of-record surface: every answer is persisted before it is served, " +
  "with the rule version and an inputs hash, so a number can be traced later. Production limits are " +
  "arranged by email to info@finology.tech until self-serve checkout ships.\n" +
  "Call the finology_service_info tool for this in structured form.";
