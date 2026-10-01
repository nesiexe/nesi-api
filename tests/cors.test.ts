import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { buildApp } from "../api/src/app";
import { env } from "../api/src/lib/env";

// Never load local credentials or contact providers in these HTTP policy tests.
vi.mock("../api/src/lib/env", () => ({ env: {
  NODE_ENV: "production", TRUSTED_PROXIES: "", CORS_ORIGINS: "",
} }));
vi.mock("../api/src/lib/logger", () => ({ Logger: { warn: vi.fn(), error: vi.fn() } }));
vi.mock("../api/src/modules/now-playing/repositories/spotify-repo", () => ({
  fetchCurrentlyPlaying: vi.fn().mockResolvedValue(null),
}));

beforeEach(() => {
  env.CORS_ORIGINS = "https://nesiexe.xyz, https://card.nesiexe.xyz,https://peterwoz.pl";
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Unexpected network request")));
});
afterEach(() => { vi.unstubAllGlobals(); });

test.each(["https://nesiexe.xyz", "https://card.nesiexe.xyz", "https://peterwoz.pl"])(
  "allows GET and preflight for configured origin %s", async (origin) => {
    const app = await buildApp({ logger: false });
    try {
      const response = await app.inject({ url: "/api/now-playing", headers: { origin } });
      expect(response.statusCode).toBe(200);
      expect(response.headers["access-control-allow-origin"]).toBe(origin);
      expect(response.headers.vary).toContain("Origin");
      const preflight = await app.inject({ method: "OPTIONS", url: "/api/now-playing", headers: {
        origin, "access-control-request-method": "GET", "access-control-request-headers": "content-type",
      } });
      expect(preflight.statusCode).toBe(204);
      expect(preflight.headers["access-control-allow-origin"]).toBe(origin);
      expect(preflight.headers["access-control-allow-methods"]).toContain("GET");
      expect(preflight.headers["access-control-allow-headers"]).toBe("content-type");
      expect(fetch).not.toHaveBeenCalled();
    } finally { await app.close(); }
  },
);

test.each(["https://unknown.example", "https://card.nesiexe.xyz.evil.example", "http://card.nesiexe.xyz", "null"])(
  "does not grant browser access to unlisted origin %s", async (origin) => {
    const app = await buildApp({ logger: false });
    try {
      for (const method of ["GET", "OPTIONS"] as const) {
        const response = await app.inject({ method, url: "/api/now-playing", headers: {
          origin, ...(method === "OPTIONS" ? { "access-control-request-method": "GET" } : {}),
        } });
        expect(response.headers["access-control-allow-origin"]).toBeUndefined();
        expect(response.headers["access-control-allow-credentials"]).toBeUndefined();
      }
    } finally { await app.close(); }
  },
);

test("retains CORS headers on API errors for an allowed origin", async () => {
  const app = await buildApp({ logger: false });
  try {
    const response = await app.inject({ url: "/api/github/stats", headers: { origin: "https://card.nesiexe.xyz" } });
    expect(response.statusCode).toBe(503);
    expect(response.headers["access-control-allow-origin"]).toBe("https://card.nesiexe.xyz");
  } finally { await app.close(); }
});

test("an empty allowlist disables CORS including preflight", async () => {
  env.CORS_ORIGINS = "";
  const app = await buildApp({ logger: false });
  try {
    const headers = { origin: "https://card.nesiexe.xyz", "access-control-request-method": "GET" };
    const response = await app.inject({ url: "/api/now-playing", headers });
    expect(response.headers["access-control-allow-origin"]).toBeUndefined();
    const preflight = await app.inject({ method: "OPTIONS", url: "/api/now-playing", headers });
    expect(preflight.statusCode).toBe(404);
    expect(preflight.headers["access-control-allow-origin"]).toBeUndefined();
  } finally { await app.close(); }
});

test("the screenshot's root trailing slash does not prevent Card from matching", async () => {
  env.CORS_ORIGINS = "https://nesiexe.xyz/, https://card.nesiexe.xyz";
  const app = await buildApp({ logger: false });
  try {
    const response = await app.inject({ url: "/api/now-playing", headers: { origin: "https://card.nesiexe.xyz" } });
    expect(response.headers["access-control-allow-origin"]).toBe("https://card.nesiexe.xyz");
  } finally { await app.close(); }
});
