import { z } from "zod";

const count = z.number().int().nonnegative();
const connection = z.object({ totalCount: count });

const GithubContributionsCollection = z.object({
  startedAt: z.iso.datetime(),
  endedAt: z.iso.datetime(),
  totalCommitContributions: count,
  totalPullRequestContributions: count,
  totalPullRequestReviewContributions: count,
  totalIssueContributions: count,
  totalRepositoriesWithContributedCommits: count,
  restrictedContributionsCount: count,
  contributionCalendar: z.object({ totalContributions: count }),
});

export const GithubGraphQLResponse = z.object({
  data: z.object({
    viewer: z.object({
      login: z.string(),
      url: z.url(),
      createdAt: z.iso.datetime(),
      publicRepositories: connection,
      privateRepositories: connection,
      followers: connection,
      contributionsCollection: GithubContributionsCollection,
    }),
  }).nullable().optional(),
  // Never forward upstream messages: they may contain private information.
  errors: z.array(z.unknown()).optional(),
});
