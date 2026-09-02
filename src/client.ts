// The entire network surface of this package.
//
// DELIBERATE: there is no student loan math in this repository. Every number an agent
// receives is computed server-side by Finology Software's parity-verified engine and
// returned over HTTP. That is not an accident of packaging — federal repayment rules move
// every year (poverty guidelines, tax brackets, RAP/OBBB implementation guidance, court
// challenges), so a formula copied into an npm package is wrong within months and cannot
// be corrected in the installs that already exist. Calling a maintained endpoint is the
// only shape of this tool that stays true over time.
const DEFAULT_BASE_URL = "https://internal-api.finology.tech";

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
          "User-Agent": "finology-mcp-server/0.1.0",
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

/** Appended to every successful answer. The tools return numbers; the app returns deliverables. */
export const CTA =
  "\n\n---\nThese figures come from Finology Software's parity-verified federal loan engine. " +
  "To build a client-facing report, compare scenarios side by side, or keep a book of borrowers " +
  "current as the rules change: https://finology.tech/?utm_source=mcp&utm_medium=ai_agent";
