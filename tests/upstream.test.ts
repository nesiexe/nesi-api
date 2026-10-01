import { afterEach, expect, test, vi } from "vitest";
import { createUpstreamGuard, requestJson } from "../api/src/lib/upstream";

afterEach(() => vi.useRealTimers());

test("overrides redirect following and passes an abort signal to the transport", async () => {
  const transport = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ ok: true }));
  expect((await requestJson("https://example.test", { redirect: "follow" }, { fetch: transport })).data).toEqual({ ok: true });
  const options = transport.mock.calls[0][1]!;
  expect(options.redirect).toBe("error");
  expect(options.signal).toBeInstanceOf(AbortSignal);
});

test("cancels oversized streamed responses before parsing", async () => {
  const cancel = vi.fn();
  const body = new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(new Uint8Array(65_537)); }, cancel,
  });
  await expect(requestJson("https://example.test", {}, {
    fetch: vi.fn<typeof fetch>().mockResolvedValue(new Response(body)),
  })).rejects.toMatchObject({ category: "invalid_response", message: "Upstream service unavailable" });
  expect(cancel).toHaveBeenCalled();
});

test("cancels error bodies without reading or exposing them", async () => {
  const cancel = vi.fn();
  const body = new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode("PRIVATE_SENTINEL")); }, cancel });
  await expect(requestJson("https://example.test", {}, {
    fetch: vi.fn<typeof fetch>().mockResolvedValue(new Response(body, { status: 429, headers: { "retry-after": "120" } })),
  })).rejects.toMatchObject({ statusCode: 503, message: "Upstream service unavailable" });
  expect(cancel).toHaveBeenCalled();
});

test("deadline remains active while the response body is being read", async () => {
  const transport = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
    return new Response(new ReadableStream({ start(controller) {
      init!.signal!.addEventListener("abort", () => controller.error(new Error("PRIVATE_SENTINEL")), { once: true });
    } }));
  });
  await expect(requestJson("https://example.test", {}, { fetch: transport, timeoutMs: 10 }))
    .rejects.toMatchObject({ message: "Upstream service unavailable" });
});

test("shared failure backoff sanitizes exceptions and honors upstream retry headers", async () => {
  let clock = 0;
  const logger = { warn: vi.fn() };
  const guard = createUpstreamGuard("test", logger, () => clock);
  const loader = vi.fn(async () => { throw new Error("PRIVATE_SENTINEL"); });
  await expect(guard(loader)).rejects.toThrow("Upstream service unavailable");
  await expect(guard(loader)).rejects.toThrow();
  expect(loader).toHaveBeenCalledTimes(1);
  clock = 60_001;
  await expect(guard(loader)).rejects.toThrow();
  clock += 60_001;
  await expect(guard(loader)).rejects.toThrow();
  expect(loader).toHaveBeenCalledTimes(2);
  clock += 60_001;
  expect(await guard(async () => 42)).toBe(42);
  expect(JSON.stringify(logger.warn.mock.calls)).not.toContain("PRIVATE_SENTINEL");
});
