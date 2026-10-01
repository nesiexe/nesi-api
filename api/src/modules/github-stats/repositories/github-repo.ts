import { createHash } from "node:crypto";
import { createCache } from "../../../lib/cache";
import { env } from "../../../lib/env";
import { Logger } from "../../../lib/logger";
import { GithubStatsResponse } from "../dtos/github-dto";
import { GithubGraphQLResponse } from "../dtos/github-response-dto";
import { requestJson, getRetryAt, UpstreamError } from "../../../lib/upstream";

function createStatsState(fingerprint: string, now: () => number) {
  return {
    fingerprint,
    cache: createCache<GithubStatsResponse>(60 * 60 * 1000, { maxEntries: 1, now }),
    failures: 0,
    failure: undefined as { error: GithubStatsError; retryAt: number } | undefined,
  };
}


export class GithubStatsError extends Error {
  constructor(message: string, public readonly statusCode: 502 | 503) {
    super(message);
  }
}

// Counts only: no private repository names, URLs, or commit messages are fetched.
const query = `query PortfolioStats($from: DateTime!, $to: DateTime!) {
  viewer {
    login
    url
    createdAt
    publicRepositories: repositories(privacy: PUBLIC, ownerAffiliations: [OWNER]) {
      totalCount
    }
    privateRepositories: repositories(privacy: PRIVATE, ownerAffiliations: [OWNER]) {
      totalCount
    }
    followers { totalCount }
    contributionsCollection(from: $from, to: $to) {
      startedAt
      endedAt
      totalCommitContributions
      totalPullRequestContributions
      totalPullRequestReviewContributions
      totalIssueContributions
      totalRepositoriesWithContributedCommits
      restrictedContributionsCount
      contributionCalendar { totalContributions }
    }
  }
}`;

export function createGithubStatsService(dependencies: {
  getConfig?: () => { username?: string; token?: string };
  logger?: { warn: (details: unknown, message: string) => void };
  fetch?: typeof fetch;
  now?: () => number;
} = {}) {
  const getConfig = dependencies.getConfig ?? (() => ({
    username: env.GITHUB_USERNAME, token: env.GITHUB_TOKEN,
  }));
  const logger = dependencies.logger ?? Logger;
  const now = dependencies.now ?? (() => Date.now());
  let statsState = createStatsState("", now);
  async function getStats(): Promise<GithubStatsResponse> {
    const { username, token } = getConfig();
    if (!username || !token) {
      statsState.cache.clear();
      statsState = createStatsState("", now);
      throw new GithubStatsError("GitHub stats are not configured", 503);
    }

    // Keep one bounded cache, discard it on credential rotation, and retain no raw token keys.
    const fingerprint = createHash("sha256").update(JSON.stringify([username.toLowerCase(), token])).digest("hex");
    if (statsState.fingerprint !== fingerprint) {
      statsState.cache.clear();
      statsState = createStatsState(fingerprint, now);
    }
    const state = statsState;
    return state.cache.fetch("stats", async () => {
      if (state.failure && now() < state.failure.retryAt) throw state.failure.error;
      const to = new Date(now());
      const from = new Date(to.getTime() - 365 * 24 * 60 * 60 * 1000);
      let upstreamStatus: number | undefined;
      let retryAt = 0;
      let category = "transport_error";
      try {
        const response = await requestJson("https://api.github.com/graphql", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
            "User-Agent": "nesi-api",
          },
          body: JSON.stringify({
            query,
            variables: { from: from.toISOString(), to: to.toISOString() },
          }),
        }, { fetch: dependencies.fetch, now });

        upstreamStatus = response.status;
        retryAt = getRetryAt(response.headers, now());
        const raw = response.data;
        const parsed = GithubGraphQLResponse.safeParse(raw);
        if (!parsed.success || parsed.data.errors?.length || !parsed.data.data) {
          const limited = retryAt > now() || hasRateLimitError(raw);
          category = limited ? "rate_limited" : "invalid_response";
          throw new GithubStatsError("GitHub returned an invalid or incomplete response", limited ? 503 : 502);
        }
        const viewer = parsed.data.data.viewer;
        if (viewer.login.toLowerCase() !== username.toLowerCase()) {
          category = "account_mismatch";
          throw new GithubStatsError("GitHub stats account configuration does not match", 503);
        }
        const contributions = viewer.contributionsCollection;
        const result = GithubStatsResponse.parse({
          username: viewer.login,
          profileUrl: viewer.url,
          memberSince: viewer.createdAt,
          repositories: {
            public: viewer.publicRepositories.totalCount,
            private: viewer.privateRepositories.totalCount,
            total: viewer.publicRepositories.totalCount + viewer.privateRepositories.totalCount,
          },
          followers: viewer.followers.totalCount,
          contributions: {
            from: contributions.startedAt,
            to: contributions.endedAt,
            commits: contributions.totalCommitContributions,
            pullRequests: contributions.totalPullRequestContributions,
            reviews: contributions.totalPullRequestReviewContributions,
            issues: contributions.totalIssueContributions,
            repositoriesWithCommits: contributions.totalRepositoriesWithContributedCommits,
            // The calendar already includes whatever restricted activity GitHub exposes.
            total: contributions.contributionCalendar.totalContributions,
            restricted: contributions.restrictedContributionsCount,
          },
          updatedAt: to.toISOString(),
        });
        state.failures = 0;
        state.failure = undefined;
        return result;
      } catch (error) {
        if (error instanceof UpstreamError) {
          upstreamStatus = error.upstreamStatus;
          retryAt = error.retryAt;
          category = error.category;
        }
        // Avoid exposing fetch errors, upstream payloads, or credentials.
        const safeError = error instanceof GithubStatsError
          ? error
          : new GithubStatsError("Could not retrieve GitHub stats", error instanceof UpstreamError ? error.statusCode : 502);
        // Shared across clients: an outage must not turn every request into a GitHub call.
        state.failures = Math.min(state.failures + 1, 7);
        const backoff = Math.min(60_000 * 2 ** (state.failures - 1), 3_600_000);
        state.failure = { error: safeError, retryAt: Math.max(retryAt, now() + backoff) };
        logger.warn({ category, upstreamStatus }, "GitHub stats request failed");
        throw safeError;
      }
    });
  }

  return { getStats, close: () => statsState.cache.clear() };
}

function hasRateLimitError(raw: unknown): boolean {
  if (!raw || typeof raw !== "object" || !("errors" in raw) || !Array.isArray(raw.errors)) return false;
  return raw.errors.some((error: unknown) => {
    if (!error || typeof error !== "object") return false;
    return ("type" in error && error.type === "RATE_LIMITED") ||
      ("message" in error && typeof error.message === "string" && /rate limit/i.test(error.message));
  });
}
