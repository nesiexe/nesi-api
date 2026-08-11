export function createCache<T>(ttlMs: number) {
  const store = new Map<string, { value: T; expiresAt: number }>();
  const inFlight = new Map<string, Promise<T>>();

  const get = (key: string): T | undefined => {
    const entry = store.get(key);
    if (!entry) return;
    if (Date.now() > entry.expiresAt) {
      store.delete(key);
      return;
    }
    return entry.value;
  };

  const set = (key: string, value: T) => {
    store.set(key, { value, expiresAt: Date.now() + ttlMs });
  };

  const fetch = (key: string, loader: () => Promise<T>): Promise<T> => {
    const cached = get(key);
    if (cached !== undefined) return Promise.resolve(cached);

    const existing = inFlight.get(key);
    if (existing) return existing;

    const promise = loader()
      .then((value) => {
        set(key, value);
        return value;
      })
      .finally(() => {
        inFlight.delete(key);
      });

    inFlight.set(key, promise);
    return promise;
  };

  return { get, set, fetch };
}
