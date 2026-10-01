import { afterEach, expect, test, vi } from "vitest";
import { createCache } from "../api/src/lib/cache";
afterEach(() => vi.useRealTimers());

test("bounds entries, evicts the least recently used, and expires unused entries", () => {
  vi.useFakeTimers();
  const cache = createCache<number>(1000, { maxEntries: 2 });
  cache.set("a", 1); cache.set("b", 2);
  expect(cache.get("a")).toBe(1);
  cache.set("c", 3);
  expect(cache.get("b")).toBeUndefined();
  expect(cache.size).toBe(2);
  vi.advanceTimersByTime(1000);
  expect(cache.size).toBe(0);
  expect(vi.getTimerCount()).toBe(0);
});

test("deduplicates loaders, bounds concurrency, and does not cache failed loads", async () => {
  const cache = createCache<number>(1000, { maxInFlight: 1 });
  let resolve!: (value: number) => void;
  const loader = vi.fn(() => new Promise<number>((done) => { resolve = done; }));
  const first = cache.fetch("a", loader);
  const second = cache.fetch("a", loader);
  await expect(cache.fetch("b", loader)).rejects.toThrow("concurrency");
  expect(loader).toHaveBeenCalledTimes(1);
  resolve(1);
  expect(await Promise.all([first, second])).toEqual([1, 1]);
  await expect(cache.fetch("bad", async () => { throw new Error("failure"); })).rejects.toThrow();
  expect(await cache.fetch("bad", async () => 2)).toBe(2);
  cache.clear();
});

test("clear prevents pending loads from repopulating the cache", async () => {
  const cache = createCache<number>(1000);
  let resolve!: (value: number) => void;
  const pending = cache.fetch("a", () => new Promise<number>((done) => { resolve = done; }));
  await Promise.resolve();
  cache.clear(); resolve(1);
  await pending;
  expect(cache.size).toBe(0);
});

test("new requests after clear cannot join a stale in-flight load", async () => {
  const cache = createCache<number>(1000, { maxInFlight: 2 });
  let resolve!: (value: number) => void;
  const stale = cache.fetch("a", () => new Promise<number>((done) => { resolve = done; }));
  await Promise.resolve();
  cache.clear();
  expect(await cache.fetch("a", async () => 2)).toBe(2);
  resolve(1); await stale;
  expect(cache.get("a")).toBe(2);
  cache.clear();
});
