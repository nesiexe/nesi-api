import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { env } from "../api/src/lib/env";
import { Logger } from "../api/src/lib/logger";

vi.mock("../api/src/lib/env", () => ({ env: {
  NODE_ENV: "test", TRUSTED_PROXIES: "", SPOTIFY_CLIENT_ID: "test-id", SPOTIFY_AUTH_PASSWORD: "p".repeat(32),
  SPOTIFY_REDIRECT_URI: "http://127.0.0.1:3003/api/callback", SPOTIFY_TOKEN_FILE: "", SPOTIFY_REFRESH_TOKEN: "old-token",
} }));
vi.mock("../api/src/lib/logger", () => ({ Logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));
let directory: string;
let tokens: typeof import("../api/src/lib/spotify-tokens");
let repository: typeof import("../api/src/internal/spotify-auth/repositories/spotify-auth-repo");
beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  directory = await mkdtemp(path.join(tmpdir(), "nesi-exchange-test-"));
  env.SPOTIFY_TOKEN_FILE = path.join(directory, "token");
  env.SPOTIFY_REFRESH_TOKEN = "old-token";
  vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockRejectedValue(new Error("Unexpected network call")));
  tokens = await import("../api/src/lib/spotify-tokens.js");
  repository = await import("../api/src/internal/spotify-auth/repositories/spotify-auth-repo.js");
});
afterEach(async () => {
  vi.unstubAllGlobals();
  await rm(directory, { recursive: true, force: true });
});
const payload = { access_token: "access-token", refresh_token: "new-token+/=", expires_in: 3600 };

test("real callback exchanges the matching PKCE verifier and persists only the token", async () => {
  vi.mocked(fetch).mockResolvedValue(Response.json(payload));
  const { buildPrivateApp } = await import("../api/src/app.js");
  const app = await buildPrivateApp({ logger: false });
  const authorization = `Basic ${Buffer.from(`admin:${"p".repeat(32)}`).toString("base64")}`;
  try {
    const login = await app.inject({ url: "/login", headers: { authorization } });
    const parameters = new URL(login.headers.location!).searchParams;
    const callback = await app.inject({
      url: `/api/callback?code=test-code&state=${parameters.get("state")}`,
      headers: { authorization, cookie: String(login.headers["set-cookie"]).split(";")[0] },
    });
    expect(callback.statusCode).toBe(200);
    const [url, options] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe("https://accounts.spotify.com/api/token");
    expect(options!.redirect).toBe("error");
    expect(options!.signal).toBeTruthy();
    const body = options!.body as URLSearchParams;
    expect(body.get("client_id")).toBe("test-id");
    expect(body.get("code")).toBe("test-code");
    expect(createHash("sha256").update(body.get("code_verifier")!).digest("base64url"))
      .toBe(parameters.get("code_challenge"));
    expect(await readFile(env.SPOTIFY_TOKEN_FILE, "utf8")).toBe(payload.refresh_token);
    expect(env.SPOTIFY_REFRESH_TOKEN).toBe(payload.refresh_token);
    env.SPOTIFY_REFRESH_TOKEN = "stale";
    await tokens.initializeSpotifyToken();
    expect(env.SPOTIFY_REFRESH_TOKEN).toBe(payload.refresh_token);
    expect(await readdir(directory)).toEqual(["token"]);
    expect(callback.body).not.toContain(payload.refresh_token);
  } finally { await app.close(); }
});

test.each(["http", "json", "missing", "oversize", "timeout"])("real exchange safely rejects %s failures", async (failure) => {
  vi.mocked(fetch).mockImplementation(async () => {
    if (failure === "timeout") throw new Error("PRIVATE_SENTINEL");
    if (failure === "http") return new Response("PRIVATE_SENTINEL", { status: 400 });
    if (failure === "json") return new Response("PRIVATE_SENTINEL");
    if (failure === "oversize") return new Response("x".repeat(65_537));
    return Response.json({ access_token: "PRIVATE_SENTINEL", expires_in: 3600 });
  });
  await expect(repository.exchangeCodeForRefreshToken("code", "v".repeat(43)))
    .rejects.toThrow("Upstream service unavailable");
  expect(env.SPOTIFY_REFRESH_TOKEN).toBe("old-token");
  expect(await readdir(directory)).toEqual([]);
  expect(JSON.stringify(vi.mocked(Logger.warn).mock.calls)).not.toContain("PRIVATE_SENTINEL");
});

test("late refresh responses cannot replace a newly authorized account", async () => {
  await tokens.saveSpotifyRefreshToken("new-account");
  await expect(tokens.saveSpotifyRefreshToken("old-account-rotated", "old-token")).rejects.toThrow("authorization changed");
  expect(await readFile(env.SPOTIFY_TOKEN_FILE, "utf8")).toBe("new-account");
  expect(env.SPOTIFY_REFRESH_TOKEN).toBe("new-account");
});
