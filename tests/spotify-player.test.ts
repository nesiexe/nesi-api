import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { env } from "../api/src/lib/env";
import { Logger } from "../api/src/lib/logger";

vi.mock("../api/src/lib/env", () => ({ env: {
  NESI_SPOTIFY_CLIENT_ID: "test-client", NESI_SPOTIFY_CLIENT_SECRET: "", NESI_SPOTIFY_REFRESH_TOKEN: "test-refresh",
} }));
vi.mock("../api/src/lib/logger", () => ({ Logger: { warn: vi.fn() } }));

beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks();
  env.NESI_SPOTIFY_REFRESH_TOKEN = "test-refresh";
  env.FROG_SPOTIFY_CLIENT_ID = "frog-client";
  env.FROG_SPOTIFY_CLIENT_SECRET = "frog-secret";
  env.FROG_SPOTIFY_REFRESH_TOKEN = "frog-refresh";
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
  expect(await Promise.all([fetchCurrentlyPlaying("nesi"), fetchCurrentlyPlaying("nesi")])).toEqual([null, null]);
  expect(fetch).toHaveBeenCalledTimes(2);
});

test("sanitizes refresh failures and prevents immediate retries", async () => {
  vi.mocked(fetch).mockResolvedValue(new Response("PRIVATE_SENTINEL", { status: 400 }));
  const { fetchCurrentlyPlaying } = await import("../api/src/modules/now-playing/repositories/spotify-repo.js");
  await expect(fetchCurrentlyPlaying("nesi")).rejects.toThrow("Upstream service unavailable");
  await expect(fetchCurrentlyPlaying("nesi")).rejects.toThrow("Upstream service unavailable");
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(vi.mocked(Logger.warn).mock.calls)).not.toContain("PRIVATE_SENTINEL");
});

test("discards a refresh response when authorization changes during the request", async () => {
  vi.mocked(fetch).mockImplementation(async () => {
    env.NESI_SPOTIFY_REFRESH_TOKEN = "new-account";
    return Response.json({ access_token: "old-access", refresh_token: "old-rotated", expires_in: 3600 });
  });
  const { fetchCurrentlyPlaying } = await import("../api/src/modules/now-playing/repositories/spotify-repo.js");
  await expect(fetchCurrentlyPlaying("nesi")).rejects.toThrow("Upstream service unavailable");
  expect(env.NESI_SPOTIFY_REFRESH_TOKEN).toBe("new-account");
  expect(fetch).toHaveBeenCalledTimes(1);
});


test("isolates concurrent users, cached results and credential invalidation", async () => {
  vi.mocked(fetch).mockImplementation(async (url, init) => {
    if (url === "https://accounts.spotify.com/api/token") {
      const body = init!.body as URLSearchParams;
      const frog = body.get("client_id") === "frog-client";
      expect(body.get("refresh_token")).toBe(frog ? "frog-refresh" : env.NESI_SPOTIFY_REFRESH_TOKEN);
      if (frog) expect(new Headers(init!.headers).get("authorization"))
        .toBe(`Basic ${Buffer.from("frog-client:frog-secret").toString("base64")}`);
      return Response.json({ access_token: frog ? "frog-access" : "nesi-access", expires_in: 3600 });
    }
    const frog = new Headers(init!.headers).get("authorization") === "Bearer frog-access";
    return Response.json({ is_playing: frog, item: null });
  });
  const { fetchCurrentlyPlaying } = await import("../api/src/modules/now-playing/repositories/spotify-repo.js");
  const results = await Promise.all([
    fetchCurrentlyPlaying("nesi"), fetchCurrentlyPlaying("frog"),
    fetchCurrentlyPlaying("nesi"), fetchCurrentlyPlaying("frog"),
  ]);
  expect(results.map((result) => result?.isPlaying)).toEqual([false, true, false, true]);
  expect(fetch).toHaveBeenCalledTimes(4);
  await fetchCurrentlyPlaying("nesi");
  await fetchCurrentlyPlaying("frog");
  expect(fetch).toHaveBeenCalledTimes(4);
  env.NESI_SPOTIFY_REFRESH_TOKEN = "changed-token";
  await fetchCurrentlyPlaying("nesi");
  await fetchCurrentlyPlaying("frog");
  expect(fetch).toHaveBeenCalledTimes(6);
});

test("one user's refresh failure does not block the other user", async () => {
  vi.mocked(fetch).mockImplementation(async (url, init) => {
    if (url === "https://accounts.spotify.com/api/token") {
      if ((init!.body as URLSearchParams).get("client_id") === "test-client") return new Response(null, { status: 400 });
      return Response.json({ access_token: "frog-access", expires_in: 3600 });
    }
    return new Response(null, { status: 204 });
  });
  const { fetchCurrentlyPlaying } = await import("../api/src/modules/now-playing/repositories/spotify-repo.js");
  await expect(fetchCurrentlyPlaying("nesi")).rejects.toThrow();
  await expect(fetchCurrentlyPlaying("frog")).resolves.toBeNull();
});

test("route validates usernames and selects the requested account", async () => {
  const { buildApp } = await import("../api/src/app.js");
  const app = await buildApp({ logger: false });
  vi.mocked(fetch).mockImplementation(async (url, init) => {
    if (url === "https://accounts.spotify.com/api/token") {
      expect((init!.body as URLSearchParams).get("client_id")).toBe("frog-client");
      return Response.json({ access_token: "frog-access", expires_in: 3600 });
    }
    return new Response(null, { status: 204 });
  });
  try {
    expect((await app.inject("/api/now-playing/unknown")).statusCode).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
    const response = await app.inject("/api/now-playing/frog");
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ isPlaying: false });
  } finally { await app.close(); }
});
