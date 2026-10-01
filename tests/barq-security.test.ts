import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { env } from "../api/src/lib/env";
import { Logger } from "../api/src/lib/logger";

vi.mock("../api/src/lib/env", () => ({ env: {
  NODE_ENV: "test", TRUSTED_PROXIES: "", BARQ_API_KEY: "server-secret", BARQ_ALLOWED_UUIDS: "", BARQ_DEFAULT_UUID: "",
} }));
vi.mock("../api/src/lib/logger", () => ({ Logger: { warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
const allowed = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks();
  env.BARQ_ALLOWED_UUIDS = ""; env.BARQ_DEFAULT_UUID = allowed;
  vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockRejectedValue(new Error("Unexpected network")));
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

test("empty allowlists deny explicit and default UUIDs before contacting BARQ", async () => {
  const { buildApp } = await import("../api/src/app.js");
  const app = await buildApp({ logger: false });
  try {
    for (const url of ["/api/barq/status", `/api/barq/status?uuid=${allowed}`]) {
      expect((await app.inject(url)).statusCode).toBe(404);
    }
    expect(fetch).not.toHaveBeenCalled();
    env.BARQ_ALLOWED_UUIDS = allowed;
    expect((await app.inject(`/api/barq/status?uuid=${other}`)).statusCode).toBe(404);
    expect(fetch).not.toHaveBeenCalled();
  } finally { await app.close(); }
});

test.each(["status", "user-count"])("sanitizes %s errors and applies a shared cooldown", async (route) => {
  env.BARQ_ALLOWED_UUIDS = allowed;
  vi.mocked(fetch).mockResolvedValue(new Response("PRIVATE_SENTINEL", { status: 500 }));
  const { buildApp } = await import("../api/src/app.js");
  const app = await buildApp({ logger: false });
  try {
    for (let i = 0; i < 2; i++) {
      const response = await app.inject(`/api/barq/${route}`);
      expect(response.statusCode).toBe(502);
      expect(response.json()).toEqual({ error: "Upstream service unavailable" });
    }
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(vi.mocked(Logger.warn).mock.calls)).not.toContain("PRIVATE_SENTINEL");
  } finally { await app.close(); }
});

test("permitted profiles are cached, but expired statuses disappear and permission removal takes effect", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  env.BARQ_ALLOWED_UUIDS = allowed;
  vi.mocked(fetch).mockImplementation(async () => Response.json({ profile: {
    displayName: "allowed", temporaryStatus: { status: "hi", expiredAt: new Date(Date.now() + 1000).toISOString() },
  } }));
  const { getBarqStatusForUuid } = await import("../api/src/modules/barq-status/repositories/barq-repo.js");
  expect((await getBarqStatusForUuid()).status).toBe("hi");
  vi.setSystemTime(Date.now() + 1001);
  expect((await getBarqStatusForUuid()).status).toBeNull();
  expect(fetch).toHaveBeenCalledTimes(1);
  env.BARQ_ALLOWED_UUIDS = "";
  await expect(getBarqStatusForUuid()).rejects.toMatchObject({ statusCode: 404 });
});

test("rejects incomplete provider JSON instead of treating it as an empty profile", async () => {
  env.BARQ_ALLOWED_UUIDS = allowed;
  vi.mocked(fetch).mockResolvedValue(Response.json({ error: "PRIVATE_SENTINEL" }));
  const { getBarqStatusForUuid } = await import("../api/src/modules/barq-status/repositories/barq-repo.js");
  await expect(getBarqStatusForUuid()).rejects.toMatchObject({ statusCode: 502 });
});

test("reads the nested profile response without matching the wrong union branch", async () => {
  env.BARQ_ALLOWED_UUIDS = allowed;
  vi.mocked(fetch).mockResolvedValue(Response.json({ data: { profile: { displayName: "nested" } } }));
  const { getBarqStatusForUuid } = await import("../api/src/modules/barq-status/repositories/barq-repo.js");
  expect((await getBarqStatusForUuid()).username).toBe("nested");
});
