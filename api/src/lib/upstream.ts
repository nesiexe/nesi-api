export class UpstreamError extends Error {
  readonly statusCode: 502 | 503;
  constructor(
    public readonly category: "transport_error" | "http_error" | "invalid_response" | "rate_limited",
    public readonly upstreamStatus?: number,
    public readonly retryAt = 0,
  ) {
    super("Upstream service unavailable");
    this.statusCode = category === "rate_limited" || upstreamStatus === 403 ? 503 : 502;
  }
}

export function getRetryAt(headers: Headers, now = Date.now()): number {
  let retryAt = 0;
  const retry = headers.get("retry-after");
  if (retry) {
    const value = /^\d+$/.test(retry) ? now + Number(retry) * 1000 : Date.parse(retry);
    if (Number.isSafeInteger(value)) retryAt = Math.max(retryAt, value);
  }
  if (headers.get("x-ratelimit-remaining") === "0") {
    const reset = Number(headers.get("x-ratelimit-reset")) * 1000;
    if (Number.isSafeInteger(reset)) retryAt = Math.max(retryAt, reset);
  }
  return retryAt;
}

// Only this helper reads upstream bodies. Limits apply after decompression.
export async function requestJson(url: string, init: RequestInit = {}, options: {
  fetch?: typeof fetch; timeoutMs?: number; maxBytes?: number; now?: () => number;
} = {}) {
  const now = options.now ?? Date.now;
  const signal = AbortSignal.timeout(options.timeoutMs ?? 10_000);
  let response: Response;
  try {
    response = await (options.fetch ?? fetch)(url, {
      ...init, redirect: "error", signal: init.signal ? AbortSignal.any([signal, init.signal]) : signal,
    });
  } catch {
    throw new UpstreamError("transport_error");
  }
  const retryAt = getRetryAt(response.headers, now());
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new UpstreamError(response.status === 429 || retryAt > now() ? "rate_limited" : "http_error", response.status, retryAt);
  }
  if (response.status === 204) return { data: null, status: response.status, headers: response.headers };
  if (!response.body) throw new UpstreamError("invalid_response", response.status, retryAt);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > (options.maxBytes ?? 65_536)) throw new Error("Response too large");
      chunks.push(value);
    }
    const data: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    return { data, status: response.status, headers: response.headers };
  } catch {
    throw new UpstreamError("invalid_response", response.status, retryAt);
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

// Failure state is per provider, so changing client IPs cannot bypass the delay.
export function createUpstreamGuard(provider: string, logger: {
  warn: (details: unknown, message: string) => void;
}, now = () => Date.now()) {
  let failures = 0;
  let failure: { error: UpstreamError; retryAt: number } | undefined;
  return async <T>(loader: () => Promise<T>): Promise<T> => {
    if (failure && now() < failure.retryAt) throw failure.error;
    try {
      const result = await loader();
      failures = 0;
      failure = undefined;
      return result;
    } catch (error) {
      const safe = error instanceof UpstreamError ? error : new UpstreamError("invalid_response");
      failures = Math.min(failures + 1, 7);
      failure = { error: safe, retryAt: Math.max(safe.retryAt, now() + Math.min(60_000 * 2 ** (failures - 1), 3_600_000)) };
      logger.warn({ provider, category: safe.category, upstreamStatus: safe.upstreamStatus }, "Upstream request failed");
      throw safe;
    }
  };
}
