# PR Code Review: `nesi-api`

## Overall Score: 5.5 / 10

The repo has a solid architectural foundation — clean module structure, Zod validation, centralized error handling. But there are several correctness bugs, inconsistencies, and production-readiness gaps that need addressing.

---

## Critical / High Severity

### 1. Type safety bypass — `as` cast defeats Zod validation
`api/src/modules/barq-status/index.ts:10`

```ts
const { uuid } = req.query as { uuid?: string };
```

You set up `schema: { querystring: BarqQuerystring }` with `fastify-type-provider-zod` so Fastify auto-validates and types `req.query`. The `as` cast completely bypasses this. The correct approach:

```ts
async (req: { Querystring: BarqQuerystring }) => {
  const { uuid } = req.query;
```

Or since the type provider is globally registered, just use `req.query` — it should already be typed.

### 2. Spotify token refresh failure silently sends `Bearer null`
`api/src/modules/now-playing/repositories/spotify-repo.ts:45-56`

```ts
await refreshPromise;
// accessToken is still null if refresh failed!
const res = await fetch("...", {
  headers: { Authorization: `Bearer ${accessToken}` }, // "Bearer null"
});
```

If `refreshAccessToken()` throws, `accessToken` stays `null`. The code proceeds to call the Spotify API with an invalid token. Fix:

```ts
await refreshPromise;
if (!accessToken) throw new Error("Failed to obtain access token");
```

### 3. Inconsistent error handling between modules
`api/src/modules/now-playing/index.ts:5-12` has a manual try/catch:
```ts
try {
  const data = await getCurrentlyPlaying();
  return data ?? { isPlaying: false };
} catch (err) {
  fastify.log.error(err);
  return reply.status(500).send({ error: "Failed to fetch currently playing" });
}
```

But `barq-status/index.ts` has **no** try/catch and relies on the centralized error handler in `errors.ts`. Pick one pattern and use it everywhere. The centralized handler is the right choice — remove the try/catch from `now-playing`.

### 4. Zero tests
No test files, no test framework, no test scripts in `package.json`. For an API that handles OAuth tokens and external service integration, this is a significant risk. Add at minimum `vitest` or `jest` with unit tests for the repos/use-cases.

---

## Medium Severity

### 5. Error messages leak internal API details to clients
`api/src/modules/barq-status/repositories/barq-repo.ts:93`

```ts
throw new BadRequestError(`Barq API error: ${fetched.error}${fetched.detail ? ` - ${fetched.detail}` : ""}`);
```

The `detail` (raw response text from Barq's API) is passed through to the client via the error handler at `errors.ts:30`. This could leak internal details, stack traces, or sensitive data. Sanitize or use a generic message:

```ts
throw new BadRequestError("Unable to fetch Barq status");
// log the detail server-side only
```

### 6. 422 misinterpreted as rate limit
`api/src/modules/barq-status/repositories/barq-repo.ts:44-46`

```ts
if (res.status === 422) {
  return { ok: false, error: "rate_limited" };
}
```

HTTP 422 is **Unprocessable Entity** (validation error), not rate limiting. Rate limiting is 429. If Barq actually returns 422 for invalid input, this mislabels the error. If you meant to catch 429, fix the status code.

### 7. Unused database connection pool
`api/src/lib/postgres.ts` creates a Knex connection, and `index.ts:27` calls `db.destroy()` on shutdown — but **no module uses the database**. This creates an unnecessary connection pool on every startup. Either remove it or add a comment about planned future use.

### 8. Dead DTO code
`api/src/modules/now-playing/dtos/now-playing-dto.ts` defines `NowPlayingQuery` (an empty object schema), but it's never imported or used anywhere. The `now-playing/index.ts` route doesn't set up schema validation at all.

### 9. Unbounded cache size
`api/src/lib/cache.ts` uses a plain `Map` with no max-size limit. While fine for current usage (1 key for Spotify, UUID-based for Barq), the generic `createCache` should ideally have a `maxSize` option to prevent unbounded growth if more modules are added.

### 10. No API rate limiting
No `@fastify/rate-limit` or equivalent. If this API is public-facing, it's vulnerable to abuse and could amplify the cost of external API calls.

---

## Low Severity

### 11. Empty `fastify.d.ts` placeholder
`api/src/types/fastify.d.ts` has an empty `FastifyRequest` interface. Remove it or populate it with actual type augmentations.

### 12. No `.env.example`
The `.gitignore` references `!.env.example` but no such file exists. New developers have no documentation of required environment variables.

### 13. GraphQL query is an inline string
`api/src/modules/barq-status/repositories/barq-repo.ts:40` — the GraphQL query is a long inline string. Hard to read and maintain. Consider a `.graphql` file or a properly formatted template literal.

### 14. No health check endpoint
No `/health` or `/ready` endpoint for orchestration (Docker, Kubernetes, load balancers).

### 15. Module-level state not testable
`barq-repo.ts:6-10` and `spotify-repo.ts:6-8` parse env vars and create caches at module scope. This makes unit testing difficult since you can't reset state between tests.

### 16. CJS module format
`tsconfig.json` uses `"module": "commonjs"` for a Node.js 22 project. ESM (`"module": "nodenext"`) would be more idiomatic and enables features like top-level await.

---

## What's Good

- **Clean architecture** — Route -> Use-Case -> Repository -> External API separation is well-structured
- **Zod everywhere** — Env validation, request DTOs, and external API response parsing all use Zod
- **Centralized error handler** — Custom error classes with status codes + a Fastify plugin is a solid pattern
- **Graceful shutdown** — SIGTERM/SIGINT handling with proper cleanup
- **CORS config** — Properly gated behind `CORS_ORIGIN`
- **Token refresh deduplication** — The `refreshPromise` guard in `spotify-repo.ts` prevents concurrent refresh calls

---

## Summary of Fixes (Priority Order)

| # | Fix | Severity |
|---|-----|----------|
| 1 | Add `await refreshPromise` null-check after token refresh | High |
| 2 | Remove `as` cast in barq-status route handler | High |
| 3 | Remove try/catch from now-playing, use centralized handler | High |
| 4 | Add tests (vitest + supertest) | High |
| 5 | Sanitize error messages before sending to clients | Medium |
| 6 | Fix 422 -> 429 if you mean rate limit | Medium |
| 7 | Remove unused postgres module or mark as intentional | Medium |
| 8 | Add `maxSize` to cache or document the assumption | Medium |
| 9 | Add `@fastify/rate-limit` | Medium |
| 10 | Add `.env.example`, health endpoint, remove dead code | Low |
