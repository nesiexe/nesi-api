import { z } from "zod";

const count = z.number().int().nonnegative();

export const GithubStatsResponse = z.object({
  username: z.string(),
  profileUrl: z.url(),
  memberSince: z.iso.datetime(),
  repositories: z.object({
    public: count,
    private: count,
    total: count,
  }),
  followers: count,
  contributions: z.object({
    from: z.iso.datetime(),
    to: z.iso.datetime(),
    commits: count,
    pullRequests: count,
    reviews: count,
    issues: count,
    repositoriesWithCommits: count,
    total: count,
    restricted: count,
  }),
  updatedAt: z.iso.datetime(),
});

export type GithubStatsResponse = z.infer<typeof GithubStatsResponse>;
