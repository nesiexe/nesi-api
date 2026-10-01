import { mkdtemp, readFile, writeFile, stat, readdir, chmod, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { createSpotifyTokenStore } from "../api/src/lib/spotify-token-store";

let directory: string;
beforeEach(async () => { directory = await mkdtemp(path.join(tmpdir(), "nesi-token-test-")); });
afterEach(async () => { await rm(directory, { recursive: true, force: true }); });

test("serializes atomic writes with restrictive permissions and preserves unrelated config", async () => {
  const filename = path.join(directory, "token");
  const config = path.join(directory, ".env");
  await writeFile(config, "UNRELATED=value\n");
  const store = createSpotifyTokenStore(filename);
  expect(await store.load()).toBeUndefined();
  await Promise.all([store.save("first+/="), store.save("second-token")]);
  expect(await store.load()).toBe("second-token");
  expect((await stat(filename)).mode & 0o777).toBe(0o600);
  expect(await readFile(config, "utf8")).toBe("UNRELATED=value\n");
  expect((await readdir(directory)).sort()).toEqual([".env", "token"]);
});

test("rejects invalid input without damaging the previous token", async () => {
  const store = createSpotifyTokenStore(path.join(directory, "token"));
  await store.save("valid-token");
  for (const token of ["", "token\nINJECTED=value", "x".repeat(4097)]) {
    await expect(store.save(token)).rejects.toThrow("Invalid Spotify token");
  }
  expect(await store.load()).toBe("valid-token");
});

test("refuses public files, symlinks, and writable shared directories", async () => {
  const filename = path.join(directory, "token");
  const store = createSpotifyTokenStore(filename);
  await writeFile(filename, "secret", { mode: 0o644 });
  await expect(store.load()).rejects.toThrow("Unsafe");
  await chmod(filename, 0o600);
  const link = path.join(directory, "link");
  await symlink(filename, link);
  await expect(createSpotifyTokenStore(link).load()).rejects.toThrow();
  await chmod(directory, 0o777);
  await expect(store.save("replacement")).rejects.toThrow("Unsafe");
  expect(await readFile(filename, "utf8")).toBe("secret");
  await chmod(directory, 0o700);
});
