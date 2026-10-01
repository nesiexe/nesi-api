export function createCache<T>(ttlMs: number, options: {
  maxEntries?: number; maxInFlight?: number; now?: () => number;
} = {}) {
  const { maxEntries = 128, maxInFlight = 32, now = () => Date.now() } = options;
  if (!Number.isFinite(ttlMs) || ttlMs <= 0 || ttlMs > 2_147_483_647 ||
      !Number.isInteger(maxEntries) || maxEntries < 1 || !Number.isInteger(maxInFlight) || maxInFlight < 1) {
    throw new Error("Invalid cache limits");
  }
  const store = new Map<string, { value: T; expiresAt: number }>();
  const inFlight = new Map<string, Promise<T>>();
  let sweep: ReturnType<typeof setInterval> | undefined;
  let generation = 0;
  let activeLoads = 0;

  const prune = () => {
    for (const [key, entry] of store) if (entry.expiresAt <= now()) store.delete(key);
    if (!store.size && sweep) { clearInterval(sweep); sweep = undefined; }
  };
  const get = (key: string): T | undefined => {
    prune();
    const entry = store.get(key);
    if (!entry) return;
    store.delete(key);
    store.set(key, entry);
    return entry.value;
  };
  const set = (key: string, value: T) => {
    prune();
    store.delete(key);
    while (store.size >= maxEntries) store.delete(store.keys().next().value!);
    store.set(key, { value, expiresAt: now() + ttlMs });
    if (!sweep) {
      sweep = setInterval(prune, Math.min(ttlMs, 60_000));
      sweep.unref();
    }
  };
  const fetch = (key: string, loader: () => Promise<T>): Promise<T> => {
    const cached = get(key);
    if (cached !== undefined) return Promise.resolve(cached);
    const existing = inFlight.get(key);
    if (existing) return existing;
    if (activeLoads >= maxInFlight) return Promise.reject(new Error("Cache concurrency limit reached"));
    const started = generation;
    activeLoads++;
    const promise = Promise.resolve().then(loader).then((value) => {
      if (generation === started) set(key, value);
      return value;
    }).finally(() => {
      activeLoads--;
      if (inFlight.get(key) === promise) inFlight.delete(key);
    });
    inFlight.set(key, promise);
    return promise;
  };
  const clear = () => {
    generation++;
    store.clear();
    inFlight.clear();
    if (sweep) clearInterval(sweep);
    sweep = undefined;
  };
  return { get, set, fetch, clear, get size() { return store.size; } };
}
