import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { env } from "../api/src/lib/env";
import { Logger } from "../api/src/lib/logger";

vi.mock("../api/src/lib/env", () => ({ env: {
  SPOTIFY_CLIENT_ID: "test-client", SPOTIFY_CLIENT_SECRET: "", SPOTIFY_REFRESH_TOKEN: "test-refresh",
} }));
vi.mock("../api/src/lib/logger", () => ({ Logger: { warn: vi.fn() } }));

beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks();
  env.SPOTIFY_REFRESH_TOKEN = "test-refresh";
  vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockRejectedValue(new Error("Unexpected network")));
});
afterEach(() => { vi.unstubAllGlobals(); });

test("deduplicates refresh requests and supports PKCE refresh without a client secret", async () => {
  vi.mocked(fetch).mockImplementation(async (url, init) => {
    if (url === "https://accounts.spotify.com/api/token") {
      expect((init!.body as URLSearchParams).get("client_id")).toBe("test-client");
      expect(new Headers(init!.headers).has("authorization")).toBe(false);
      return Response.json({ access_token: "test-access", expires_in: 3600 });
    }
    return new Response(null, { status: 204 });
  });
  const { fetchCurrentlyPlaying } = await import("../api/src/modules/now-playing/repositories/spotify-repo.js");
  expect(await Promise.all([fetchCurrentlyPlaying(), fetchCurrentlyPlaying()])).toEqual([null, null]);
  expect(fetch).toHaveBeenCalledTimes(2);
});

test("sanitizes refresh failures and prevents immediate retries", async () => {
  vi.mocked(fetch).mockResolvedValue(new Response("PRIVATE_SENTINEL", { status: 400 }));
  const { fetchCurrentlyPlaying } = await import("../api/src/modules/now-playing/repositories/spotify-repo.js");
  await expect(fetchCurrentlyPlaying()).rejects.toThrow("Upstream service unavailable");
  await expect(fetchCurrentlyPlaying()).rejects.toThrow("Upstream service unavailable");
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(vi.mocked(Logger.warn).mock.calls)).not.toContain("PRIVATE_SENTINEL");
});

test("discards a refresh response when authorization changes during the request", async () => {
  vi.mocked(fetch).mockImplementation(async () => {
    env.SPOTIFY_REFRESH_TOKEN = "new-account";
    return Response.json({ access_token: "old-access", refresh_token: "old-rotated", expires_in: 3600 });
  });
  const { fetchCurrentlyPlaying } = await import("../api/src/modules/now-playing/repositories/spotify-repo.js");
  await expect(fetchCurrentlyPlaying()).rejects.toThrow("Upstream service unavailable");
  expect(env.SPOTIFY_REFRESH_TOKEN).toBe("new-account");
  expect(fetch).toHaveBeenCalledTimes(1);
});
