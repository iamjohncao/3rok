import { describe, expect, it } from "vitest";
import { TEST_ENV, assistantMessage, fakeXai } from "./test-support/fake-xai";
import { DEFAULT_GROK_MODEL, XaiError, createResponse, describeHttpError, scrub, xaiEnv } from "./xai";

describe("xaiEnv", () => {
  it("is null without XAI_API_KEY, so Grok is not set up", () => {
    expect(xaiEnv({})).toBeNull();
    expect(xaiEnv({ XAI_API_KEY: "  " })).toBeNull();
  });

  it("reads the key, the optional management key, and the model", () => {
    const env = xaiEnv({ XAI_API_KEY: " k1234567 ", XAI_MANAGEMENT_API_KEY: "m1234567", GROK_MODEL: "grok-next" });
    expect(env).toMatchObject({ apiKey: "k1234567", managementKey: "m1234567", model: "grok-next", apiBase: "https://api.x.ai/v1", managementBase: "https://management-api.x.ai/v1" });
  });

  it("defaults the model and has no management key unless one is set", () => {
    expect(xaiEnv({ XAI_API_KEY: "k1234567" })).toMatchObject({ model: DEFAULT_GROK_MODEL, managementKey: null });
  });
});

describe("scrub", () => {
  it("removes every secret and any bearer token", () => {
    expect(scrub("key abcdef123456 and Bearer abcdefghijklmnop", ["abcdef123456"])).toBe("key [redacted] and Bearer [redacted]");
  });

  it("ignores empty and very short secrets, which would blank ordinary words", () => {
    expect(scrub("a b c", ["", "a", null, undefined])).toBe("a b c");
  });
});

describe("createResponse", () => {
  it("posts the body to /responses with the key in the Authorization header, and returns the output", async () => {
    const xai = fakeXai(() => ({ output: [assistantMessage("hello")] }));
    const result = await createResponse({ model: "m", input: "hi" }, TEST_ENV, { fetch: xai.fetch });
    expect(result.output).toHaveLength(1);
    expect(result.incomplete).toBeNull();
    expect(xai.requests[0]).toMatchObject({ method: "POST", url: "https://xai.test/v1/responses", body: { model: "m", input: "hi" } });
    expect(xai.requests[0].headers.authorization).toBe(`Bearer ${TEST_ENV.apiKey}`);
  });

  it("reports why a response stopped early", async () => {
    const xai = fakeXai(() => ({ output: [], status: "incomplete", incomplete_details: { reason: "max_output_tokens" } }));
    expect((await createResponse({}, TEST_ENV, { fetch: xai.fetch })).incomplete).toBe("max_output_tokens");
  });

  it("turns an HTTP error into one sentence with no secret in it", async () => {
    const fetchImpl = (async () => new Response(JSON.stringify({ error: { message: `bad key ${TEST_ENV.apiKey}` } }), { status: 401 })) as typeof fetch;
    const error = await createResponse({}, TEST_ENV, { fetch: fetchImpl }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(XaiError);
    expect((error as XaiError).status).toBe(401);
    expect((error as XaiError).message).toBe("xAI answered 401: bad key [redacted]");
    expect((error as XaiError).message).not.toContain(TEST_ENV.apiKey);
  });

  it("copes with an error body that is not JSON", () => {
    expect(describeHttpError(502, "<html>Bad gateway</html>", TEST_ENV)).toBe("xAI answered 502: <html>Bad gateway</html>");
    expect(describeHttpError(500, "", TEST_ENV)).toBe("xAI answered 500: no detail");
  });

  it("keeps the secret out of a network failure", async () => {
    const fetchImpl = (async () => {
      throw new Error(`connect failed for ${TEST_ENV.apiKey}`);
    }) as typeof fetch;
    const error = (await createResponse({}, TEST_ENV, { fetch: fetchImpl }).catch((e: unknown) => e)) as XaiError;
    expect(error.kind).toBe("network");
    expect(error.message).not.toContain(TEST_ENV.apiKey);
  });

  it("says it timed out when the deadline aborts the request", async () => {
    const controller = new AbortController();
    const fetchImpl = (async () => {
      controller.abort();
      throw new DOMException("aborted", "AbortError");
    }) as typeof fetch;
    const error = (await createResponse({}, TEST_ENV, { fetch: fetchImpl, signal: controller.signal }).catch((e: unknown) => e)) as XaiError;
    expect(error.kind).toBe("timeout");
  });

  it("refuses an answer that is not JSON, has no output list, or says it failed", async () => {
    const answer = (body: string, status = 200) => (async () => new Response(body, { status })) as typeof fetch;
    expect(((await createResponse({}, TEST_ENV, { fetch: answer("nope") }).catch((e) => e)) as XaiError).kind).toBe("shape");
    expect(((await createResponse({}, TEST_ENV, { fetch: answer("{}") }).catch((e) => e)) as XaiError).kind).toBe("shape");
    const failed = (await createResponse({}, TEST_ENV, { fetch: answer(JSON.stringify({ status: "failed", error: { message: "boom" }, output: [] })) }).catch((e) => e)) as XaiError;
    expect(failed.message).toContain("could not finish the response");
  });
});
