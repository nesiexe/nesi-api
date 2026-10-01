import { createHash } from "node:crypto";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { buildPrivateApp } from "../api/src/app";
import { env } from "../api/src/lib/env";
import { exchangeCodeForRefreshToken } from "../api/src/internal/spotify-auth/repositories/spotify-auth-repo";

vi.mock("../api/src/lib/env", () => ({ env: {
  NODE_ENV: "test", TRUSTED_PROXIES: "", SPOTIFY_AUTH_PASSWORD: "p".repeat(32),
  SPOTIFY_REDIRECT_URI: "https://auth.example.test/api/callback", SPOTIFY_CLIENT_ID: "test-id",
} }));
vi.mock("../api/src/internal/spotify-auth/repositories/spotify-auth-repo", async (importOriginal) => ({
  ...await importOriginal<typeof import("../api/src/internal/spotify-auth/repositories/spotify-auth-repo")>(),
  exchangeCodeForRefreshToken: vi.fn().mockResolvedValue("test-refresh-token"),
}));
const authorization = `Basic ${Buffer.from(`admin:${"p".repeat(32)}`).toString("base64")}`;
beforeEach(() => { vi.clearAllMocks(); env.SPOTIFY_AUTH_PASSWORD = "p".repeat(32); env.TRUSTED_PROXIES = ""; env.SPOTIFY_REDIRECT_URI = "https://auth.example.test/api/callback"; });
afterEach(() => { vi.useRealTimers(); });

test("requires authentication and stays disabled without an admin password", async () => {
  const app = await buildPrivateApp({ logger: false });
  try {
    expect((await app.inject("/login")).statusCode).toBe(401);
    expect((await app.inject({ url: "/login", headers: { authorization: "Basic wrong" } })).statusCode).toBe(401);
    env.SPOTIFY_AUTH_PASSWORD = "";
    expect((await app.inject({ url: "/login", headers: { authorization } })).statusCode).toBe(503);
    expect(exchangeCodeForRefreshToken).not.toHaveBeenCalled();
  } finally { await app.close(); }
});

test("binds OAuth state to a cookie, consumes it once, and rejects missing state", async () => {
  const app = await buildPrivateApp({ logger: false });
  try {
    const login = await app.inject({ url: "/login", headers: { authorization } });
    expect(login.statusCode).toBe(302);
    const state = new URL(login.headers.location!).searchParams.get("state")!;
    expect(state).toMatch(/^[a-f0-9]{64}$/);
    const setCookie = String(login.headers["set-cookie"]);
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("Secure");
    expect(setCookie).toContain("SameSite=Lax");
    const cookie = setCookie.split(";")[0];
    const url = `/api/callback?code=test-code&state=${state}`;
    expect((await app.inject({ url, headers: { authorization } })).statusCode).toBe(400);
    expect((await app.inject({ url: "/api/callback?code=test-code", headers: { authorization, cookie } })).statusCode).toBe(400);
    expect(exchangeCodeForRefreshToken).not.toHaveBeenCalled();
    expect((await app.inject({ url, headers: { authorization, cookie } })).statusCode).toBe(200);
    expect(exchangeCodeForRefreshToken).toHaveBeenCalledTimes(1);
    const [sentCode, verifier] = vi.mocked(exchangeCodeForRefreshToken).mock.calls[0];
    expect(sentCode).toBe("test-code");
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const parameters = new URL(login.headers.location!).searchParams;
    expect(parameters.get("code_challenge_method")).toBe("S256");
    expect(parameters.get("code_challenge")).toBe(createHash("sha256").update(verifier).digest("base64url"));
    expect(login.headers.location).not.toContain(verifier);
    expect((await app.inject({ url, headers: { authorization, cookie } })).statusCode).toBe(400);
  } finally { await app.close(); }
});

test("rejects expired authorization state", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  const app = await buildPrivateApp({ logger: false });
  try {
    const login = await app.inject({ url: "/login", headers: { authorization } });
    const state = new URL(login.headers.location!).searchParams.get("state")!;
    const cookie = String(login.headers["set-cookie"]).split(";")[0];
    vi.setSystemTime(Date.now() + 600_001);
    expect((await app.inject({ url: `/api/callback?code=code&state=${state}`, headers: { authorization, cookie } })).statusCode).toBe(400);
    expect(exchangeCodeForRefreshToken).not.toHaveBeenCalled();
  } finally { await app.close(); }
});

test("rejects non-loopback HTTP even with valid credentials", async () => {
  const app = await buildPrivateApp({ logger: false });
  try {
    expect((await app.inject({ url: "/login", remoteAddress: "198.51.100.5", headers: { authorization, "x-forwarded-proto": "https" } })).statusCode).toBe(403);
  } finally { await app.close(); }
});


test.each([{}, { "x-forwarded-proto": "http", "x-forwarded-for": "198.51.100.5" }])(
  "rejects HTTP from trusted loopback proxies even when forwarding headers are missing: %j", async (headers) => {
    env.TRUSTED_PROXIES = "127.0.0.1";
    const app = await buildPrivateApp({ logger: false });
    try {
      const response = await app.inject({ url: "/login", remoteAddress: "127.0.0.1", headers: { authorization, ...headers } });
      expect(response.statusCode).toBe(403);
      expect(response.headers["www-authenticate"]).toBeUndefined();
    } finally { await app.close(); }
  },
);

test("accepts trusted HTTPS forwarding and rejects forwarding on the direct loopback exception", async () => {
  env.TRUSTED_PROXIES = "127.0.0.1";
  const proxyApp = await buildPrivateApp({ logger: false });
  try {
    expect((await proxyApp.inject({ url: "/login", headers: {
      authorization, "x-forwarded-proto": "https", "x-forwarded-for": "198.51.100.5",
    } })).statusCode).toBe(302);
  } finally { await proxyApp.close(); }
  env.TRUSTED_PROXIES = "";
  const directApp = await buildPrivateApp({ logger: false });
  try {
    expect((await directApp.inject({ url: "/login", headers: {
      authorization, forwarded: "for=198.51.100.5;proto=http",
    } })).statusCode).toBe(403);
  } finally { await directApp.close(); }
});

test("consumes state on exchange failure and never accepts a cookie from another flow", async () => {
  const app = await buildPrivateApp({ logger: false });
  try {
    const first = await app.inject({ url: "/login", headers: { authorization } });
    const second = await app.inject({ url: "/login", headers: { authorization } });
    const state = new URL(first.headers.location!).searchParams.get("state");
    const url = `/api/callback?code=code&state=${state}`;
    const cookie = String(first.headers["set-cookie"]).split(";")[0];
    expect((await app.inject({ url, headers: { authorization, cookie: String(second.headers["set-cookie"]).split(";")[0] } })).statusCode).toBe(400);
    vi.mocked(exchangeCodeForRefreshToken).mockRejectedValueOnce(new Error("SECRET_SENTINEL"));
    const failed = await app.inject({ url, headers: { authorization, cookie } });
    expect(failed.statusCode).toBe(500);
    expect(failed.body).not.toContain("SECRET_SENTINEL");
    expect((await app.inject({ url, headers: { authorization, cookie } })).statusCode).toBe(400);
  } finally { await app.close(); }
});


test.each([
  "http://auth.example.test/api/callback", "https://user:password@auth.example.test/api/callback",
  "https://auth.example.test/wrong-path", "https://auth.example.test/api/callback?extra=true",
  "https://auth.example.test/api/callback#fragment",
])("rejects unsafe or mismatched callback configuration: %s", async (uri) => {
  env.SPOTIFY_REDIRECT_URI = uri;
  await expect(buildPrivateApp({ logger: false })).rejects.toThrow("Spotify redirect");
});
