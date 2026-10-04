// The xAI Responses API, and the settings it needs. Server only. XAI_API_KEY and the management
// key come from the server's environment and never reach the browser, a log line, an error
// message, or a case. Grok reads and proposes here. Nothing in this file changes a model, and xAI
// offers no endpoint that would.

export const XAI_API_BASE = "https://api.x.ai/v1";
export const XAI_MANAGEMENT_BASE = "https://management-api.x.ai/v1";
/** The model docs.x.ai names for remote MCP and file_search. GROK_MODEL overrides it. */
export const DEFAULT_GROK_MODEL = "grok-4.7";

export type XaiEnv = {
  apiKey: string;
  /** Needed only to build a per-request collection. Null means the case is sent inline. */
  managementKey: string | null;
  model: string;
  apiBase: string;
  managementBase: string;
};

type Env = Record<string, string | undefined>;

/** Null when Grok is not set up on this deployment. */
export function xaiEnv(env: Env = process.env): XaiEnv | null {
  const apiKey = env.XAI_API_KEY?.trim();
  if (!apiKey) return null;
  return {
    apiKey,
    managementKey: env.XAI_MANAGEMENT_API_KEY?.trim() || null,
    model: env.GROK_MODEL?.trim() || DEFAULT_GROK_MODEL,
    // The two base URLs exist so a test can point at a local stand-in. They are server settings.
    apiBase: (env.XAI_API_BASE_URL?.trim() || XAI_API_BASE).replace(/\/+$/, ""),
    managementBase: (env.XAI_MANAGEMENT_BASE_URL?.trim() || XAI_MANAGEMENT_BASE).replace(/\/+$/, ""),
  };
}

export type XaiErrorKind = "http" | "network" | "timeout" | "shape";

export class XaiError extends Error {
  constructor(
    readonly kind: XaiErrorKind,
    message: string,
    readonly status: number | null = null,
  ) {
    super(message);
    this.name = "XaiError";
  }
}

/** Removes every secret from text before it is shown, logged, or stored. */
export function scrub(text: string, secrets: (string | null | undefined)[]): string {
  let out = text;
  for (const secret of secrets) {
    if (secret && secret.length >= 6) out = out.split(secret).join("[redacted]");
  }
  return out.replace(/Bearer\s+[A-Za-z0-9._~+/=-]{8,}/g, "Bearer [redacted]");
}

const MAX_ERROR_CHARS = 300;

function secretsOf(env: XaiEnv): string[] {
  return [env.apiKey, env.managementKey ?? ""];
}

/** One sentence from an xAI error body, with no secret in it. */
export function describeHttpError(status: number, body: string, env: XaiEnv): string {
  let detail = body.trim();
  try {
    const parsed = JSON.parse(body) as { error?: unknown; message?: unknown; code?: unknown };
    const error = parsed.error;
    const picked =
      typeof error === "string"
        ? error
        : typeof error === "object" && error !== null && typeof (error as { message?: unknown }).message === "string"
          ? (error as { message: string }).message
          : typeof parsed.message === "string"
            ? parsed.message
            : detail;
    detail = picked;
  } catch {
    // The body was not JSON. Its first characters stand in.
  }
  return `xAI answered ${status}: ${scrub(detail, secretsOf(env)).slice(0, MAX_ERROR_CHARS) || "no detail"}`;
}

export type FetchLike = typeof fetch;

export type ResponsesResult = {
  id: string | null;
  output: unknown[];
  /** Why the response stopped early, or null when it finished. */
  incomplete: string | null;
};

/** POST /v1/responses. Throws `XaiError` for anything but a finished or incomplete response. */
export async function createResponse(
  body: unknown,
  env: XaiEnv,
  { fetch: fetchImpl = fetch, signal }: { fetch?: FetchLike; signal?: AbortSignal } = {},
): Promise<ResponsesResult> {
  let response: Response;
  try {
    response = await fetchImpl(`${env.apiBase}/responses`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.apiKey}` },
      body: JSON.stringify(body),
      signal,
    });
  } catch (error) {
    if (signal?.aborted) throw new XaiError("timeout", "Grok did not finish before the time limit.");
    throw new XaiError("network", `Grok could not be reached: ${scrub(error instanceof Error ? error.message : "network error", secretsOf(env))}`);
  }

  const text = await response.text().catch(() => "");
  if (!response.ok) throw new XaiError("http", describeHttpError(response.status, text, env), response.status);

  let parsed: { id?: unknown; output?: unknown; status?: unknown; error?: unknown; incomplete_details?: unknown };
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new XaiError("shape", "xAI answered with something that is not JSON.", response.status);
  }
  if (parsed.status === "failed" || (parsed.error !== undefined && parsed.error !== null)) {
    const detail = typeof parsed.error === "object" && parsed.error !== null ? JSON.stringify(parsed.error) : String(parsed.error ?? "failed");
    throw new XaiError("http", `xAI could not finish the response: ${scrub(detail, secretsOf(env)).slice(0, MAX_ERROR_CHARS)}`, response.status);
  }
  if (!Array.isArray(parsed.output)) throw new XaiError("shape", "xAI answered without an output list.", response.status);

  const details = parsed.incomplete_details;
  const reason =
    parsed.status === "incomplete"
      ? typeof details === "object" && details !== null && typeof (details as { reason?: unknown }).reason === "string"
        ? (details as { reason: string }).reason
        : "unknown"
      : null;
  return { id: typeof parsed.id === "string" ? parsed.id : null, output: parsed.output, incomplete: reason };
}
