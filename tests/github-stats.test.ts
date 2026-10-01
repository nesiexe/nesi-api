import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { env } from "../api/src/lib/env";
import { buildApp } from "../api/src/app";
import { Logger } from "../api/src/lib/logger";
import { createGithubStatsService } from "../api/src/modules/github-stats/repositories/github-repo";

// Unit tests never load production credentials from .env.
vi.mock("../api/src/lib/env", () => ({
  env: { GITHUB_USERNAME: "", GITHUB_TOKEN: "", TRUSTED_PROXIES: "" },
}));

vi.mock("../api/src/lib/logger", () => ({ Logger: { warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

let service: ReturnType<typeof createGithubStatsService>;
const getGithubStats = () => service.getStats();
function resetService() {
  service?.close();
  service = createGithubStatsService({
    getConfig: () => ({ username: env.GITHUB_USERNAME, token: env.GITHUB_TOKEN }), logger: Logger,
    fetch: (...args) => fetch(...args),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockRejectedValue(new Error("Unexpected network call")));
  resetService();
});

afterEach(() => {
  service.close();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  env.GITHUB_USERNAME = "";
  env.GITHUB_TOKEN = "";
  env.TRUSTED_PROXIES = "";
});

function configure(token = "ghp_test") {
  env.GITHUB_USERNAME = "nesiexe";
  env.GITHUB_TOKEN = token;
}

function fixture() {
  return { data: { viewer: {
    login: "nesiexe",
    url: "https://github.com/nesiexe",
    createdAt: "2020-01-01T00:00:00Z",
    publicRepositories: { totalCount: 120 },
    privateRepositories: { totalCount: 14 },
    followers: { totalCount: 8 },
    contributionsCollection: {
      startedAt: "2025-10-01T00:00:00Z",
      endedAt: "2026-10-01T00:00:00Z",
      totalCommitContributions: 400,
      totalPullRequestContributions: 32,
      totalPullRequestReviewContributions: 20,
      totalIssueContributions: 5,
      totalRepositoriesWithContributedCommits: 12,
      restrictedContributionsCount: 0,
      contributionCalendar: { totalContributions: 470 },
    },
    privateRepositoryName: "must-not-be-exposed",
  } } };
}

async function app() {
  const server = await buildApp({ logger: false });
  return server;
}

test("returns aggregate stats, caches concurrent requests, and uses a bounded period", async () => {
  configure();
  let calls = 0;
  vi.mocked(fetch).mockImplementation(async (url, init) => {
    calls++;
    expect(url).toBe("https://api.github.com/graphql");
    const body = JSON.parse(init!.body as string);
    expect(Date.parse(body.variables.to) - Date.parse(body.variables.from)).toBe(365 * 86400000);
    expect(body.query).toMatch(/ownerAffiliations: \[OWNER\]/);
    expect(init!.signal).toBeTruthy();
    expect(init!.redirect).toBe("error");
    return Response.json(fixture());
  });
  const server = await app();
  try {
    const responses = await Promise.all(Array.from({ length: 3 }, () => server.inject("/api/github/stats")));
    for (const response of responses) {
      expect(response.statusCode).toBe(200);
      expect(response.headers["cache-control"]).toBe("no-store");
      const stats = response.json();
      expect(stats.repositories).toEqual({ public: 120, private: 14, total: 134 });
      expect(stats.contributions.commits).toBe(400);
      expect(stats.contributions.restricted).toBe(0);
      expect(stats.contributions.total).toBe(470);
      expect(!response.body.includes("must-not-be-exposed")).toBeTruthy();
      expect(!response.body.includes(env.GITHUB_TOKEN!)).toBeTruthy();
    }
    await server.inject("/api/github/stats");
    expect(calls).toBe(1);
  } finally {
    await server.close();
  }
});

test("missing configuration returns 503 without calling GitHub", async () => {
  env.GITHUB_TOKEN = "";
  vi.mocked(fetch).mockImplementation(async () => { throw new Error("must not fetch"); });
  const server = await app();
  try {
    const response = await server.inject("/api/github/stats");
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ error: "GitHub stats are not configured" });
  } finally {
    await server.close();
  }
});

test("rejects partial GraphQL data and waits before retrying failures", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  configure();
  let calls = 0;
  vi.mocked(fetch).mockImplementation(async () => {
    calls++;
    return Response.json(calls === 1
      ? { ...fixture(), errors: [{ message: "secret private repo information" }] }
      : fixture());
  });
  await expect(getGithubStats()).rejects.toMatchObject({ statusCode: 502, message: "GitHub returned an invalid or incomplete response" });
  await expect(getGithubStats()).rejects.toMatchObject({ statusCode: 502 });
  expect(calls).toBe(1);
  vi.setSystemTime(Date.now() + 60_001);
  expect((await getGithubStats()).repositories.private).toBe(14);
  expect(calls).toBe(2);
});

test("rejects a token belonging to another account", async () => {
  configure();
  const data = fixture();
  data.data.viewer.login = "someone-else";
  vi.mocked(fetch).mockImplementation(async () => Response.json(data));
  await expect(getGithubStats()).rejects.toMatchObject({ statusCode: 503 });
});

test("handles HTTP errors, malformed payloads, and timeouts without leaking details", async () => {
  for (const [response, statusCode] of [
    [() => new Response("private detail", { status: 401 }), 502],
    [() => new Response("private detail", { status: 403 }), 503],
    [() => new Response("private detail", { status: 429 }), 503],
    [() => new Response("private detail", { status: 500 }), 502],
    [() => Response.json({ data: null }), 502],
    [() => Response.json({ data: { viewer: {} } }), 502],
    [() => new Response("not json"), 502],
    [() => { throw new Error("timeout containing secret"); }, 502],
  ] as const) {
    resetService();
    configure();
    vi.mocked(fetch).mockImplementation(async () => response());
    await expect(getGithubStats()).rejects.toMatchObject({
      statusCode,
      message: expect.not.stringMatching(/private detail|secret/),
    });
  }
});

test("the endpoint is rate limited", async () => {
  env.GITHUB_TOKEN = "";
  const server = await app();
  try {
    for (let i = 0; i < 30; i++) await server.inject({ url: "/api/github/stats", headers: { "x-forwarded-for": `198.51.100.${i}` } });
    expect((await server.inject("/api/github/stats")).statusCode).toBe(429);
  } finally {
    await server.close();
  }
});

test("refreshes after one hour and discards cached stats on token rotation", async () => {
  configure();
  vi.useFakeTimers({ toFake: ["Date"] });
  let calls = 0;
  vi.mocked(fetch).mockImplementation(async () => { calls++; return Response.json(fixture()); });
  await getGithubStats();
  vi.setSystemTime(Date.now() + 3_599_999);
  await getGithubStats();
  expect(calls).toBe(1);
  vi.setSystemTime(Date.now() + 2);
  await getGithubStats();
  expect(calls).toBe(2);
  configure("ghp_rotated");
  await getGithubStats();
  expect(calls).toBe(3);
});

test("does not log bodies, GraphQL errors, credentials, or arbitrary exception messages", async () => {
  for (const response of [
    () => new Response("PRIVATE_SENTINEL", { status: 403 }),
    () => Response.json({ ...fixture(), errors: [{ message: "PRIVATE_SENTINEL" }] }),
    () => new Response("PRIVATE_SENTINEL invalid json"),
    () => { throw new Error("PRIVATE_SENTINEL"); },
  ]) {
    resetService();
    configure();
    vi.mocked(fetch).mockImplementation(async () => response());
    await expect(getGithubStats()).rejects.toBeInstanceOf(Error);
    const logs = JSON.stringify([vi.mocked(Logger.warn).mock.calls, vi.mocked(Logger.error).mock.calls, vi.mocked(Logger.debug).mock.calls]);
    expect(logs).not.toContain("PRIVATE_SENTINEL");
    expect(logs).not.toContain(env.GITHUB_TOKEN!);
    expect(logs).not.toContain("fingerprint");
  }
});

test.each(["seconds", "date", "reset"])("honors %s retry headers including GraphQL HTTP 200 limits", async (mode) => {
  configure();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-01T00:00:00Z"));
  const headers: Record<string, string> = mode === "seconds" ? { "retry-after": "3600" }
    : mode === "date" ? { "retry-after": new Date(Date.now() + 3_600_000).toUTCString() }
    : { "x-ratelimit-remaining": "0", "x-ratelimit-reset": String((Date.now() + 3_600_000) / 1000) };
  vi.mocked(fetch).mockResolvedValueOnce(Response.json({ errors: [{ type: "RATE_LIMITED" }] }, {
    status: mode === "reset" ? 200 : 429, headers,
  })).mockImplementation(async () => Response.json(fixture()));
  await expect(getGithubStats()).rejects.toMatchObject({ statusCode: 503 });
  vi.setSystemTime(Date.now() + 61_000);
  await expect(getGithubStats()).rejects.toMatchObject({ statusCode: 503 });
  expect(fetch).toHaveBeenCalledTimes(1);
  vi.setSystemTime(Date.now() + 3_539_001);
  await getGithubStats();
  expect(fetch).toHaveBeenCalledTimes(2);
});

test("backs off repeated failures and resets backoff after success", async () => {
  configure();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.mocked(fetch).mockImplementation(async () => Response.json({ errors: [{ type: "RATE_LIMITED" }] }));
  await expect(getGithubStats()).rejects.toMatchObject({ statusCode: 503 });
  vi.setSystemTime(Date.now() + 60_001);
  await expect(getGithubStats()).rejects.toMatchObject({ statusCode: 503 });
  vi.setSystemTime(Date.now() + 60_001);
  await expect(getGithubStats()).rejects.toMatchObject({ statusCode: 503 });
  expect(fetch).toHaveBeenCalledTimes(2);
  vi.setSystemTime(Date.now() + 60_001);
  vi.mocked(fetch).mockImplementation(async () => Response.json(fixture()));
  await getGithubStats();
  vi.setSystemTime(Date.now() + 3_600_001);
  vi.mocked(fetch).mockImplementation(async () => new Response(null, { status: 500 }));
  await expect(getGithubStats()).rejects.toMatchObject({ statusCode: 502 });
  vi.setSystemTime(Date.now() + 60_001);
  vi.mocked(fetch).mockImplementation(async () => Response.json(fixture()));
  await getGithubStats();
  expect(fetch).toHaveBeenCalledTimes(5);
});

test("rejects oversized upstream responses", async () => {
  configure();
  vi.mocked(fetch).mockResolvedValue(new Response("x".repeat(65_537)));
  await expect(getGithubStats()).rejects.toMatchObject({ statusCode: 502 });
});

test("trusted proxy visitors have independent rate limits", async () => {
  env.TRUSTED_PROXIES = "127.0.0.1";
  const server = await app();
  try {
    const request = (ip: string) => server.inject({ url: "/api/github/stats", remoteAddress: "127.0.0.1", headers: { "x-forwarded-for": ip } });
    for (let i = 0; i < 30; i++) await request("198.51.100.1");
    expect((await request("198.51.100.1")).statusCode).toBe(429);
    expect((await request("198.51.100.2")).statusCode).toBe(503);
  } finally { await server.close(); }
});

test("untrusted peers cannot bypass rate limits by forging forwarded addresses", async () => {
  env.TRUSTED_PROXIES = "192.0.2.1";
  const server = await app();
  try {
    for (let i = 0; i < 30; i++) await server.inject({ url: "/api/github/stats", remoteAddress: "198.51.100.1", headers: { "x-forwarded-for": `203.0.113.${i}` } });
    expect((await server.inject({ url: "/api/github/stats", remoteAddress: "198.51.100.1", headers: { "x-forwarded-for": "203.0.113.99" } })).statusCode).toBe(429);
  } finally { await server.close(); }
});

test("application error handler preserves validation errors for existing modules", async () => {
  const server = await app();
  try {
    expect((await server.inject("/api/barq/status?uuid=invalid")).statusCode).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  } finally { await server.close(); }
});


test("separate applications do not share successful caches or failure cooldowns", async () => {
  configure();
  vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 500 }))
    .mockImplementation(async () => Response.json(fixture()));
  const first = await app();
  const second = await app();
  try {
    expect((await first.inject("/api/github/stats")).statusCode).toBe(502);
    expect((await second.inject("/api/github/stats")).statusCode).toBe(200);
    expect((await first.inject("/api/github/stats")).statusCode).toBe(502);
    expect(fetch).toHaveBeenCalledTimes(2);
  } finally { await first.close(); await second.close(); }
});

test("uses one classic token for repository counts, contributions, and reviews", async () => {
  configure("ghp_legacy");
  vi.mocked(fetch).mockImplementation(async (url, init) => {
    expect(url).toBe("https://api.github.com/graphql");
    expect(new Headers(init!.headers).get("authorization")).toBe("Bearer ghp_legacy");
    const body = JSON.parse(init!.body as string);
    expect(body.query).toContain("publicRepositories");
    expect(body.query).toContain("privateRepositories");
    expect(body.query).toContain("totalPullRequestReviewContributions");
    return Response.json(fixture(), { headers: { "x-oauth-scopes": "repo, read:user" } });
  });
  const server = await app();
  try {
    const response = await server.inject("/api/github/stats");
    expect(response.statusCode).toBe(200);
    expect(response.json().repositories.total).toBe(134);
    expect(response.json().contributions).toMatchObject({ total: 470, reviews: 20 });
    expect(response.body).not.toContain("ghp_legacy");
    await server.inject("/api/github/stats");
    expect(fetch).toHaveBeenCalledTimes(1);
  } finally { await server.close(); }
});

test("reports restricted counts without double counting them in the contribution total", async () => {
  configure();
  const data = fixture();
  data.data.viewer.contributionsCollection.totalPullRequestReviewContributions = 0;
  data.data.viewer.contributionsCollection.restrictedContributionsCount = 104;
  data.data.viewer.contributionsCollection.contributionCalendar.totalContributions = 154;
  vi.mocked(fetch).mockResolvedValue(Response.json(data));
  expect((await getGithubStats()).contributions).toMatchObject({ total: 154, restricted: 104, reviews: 0 });
});
