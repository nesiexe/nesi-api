export function createCache<T>(ttlMs: number) {
  const store = new Map<string, { value: T; expiresAt: number }>();

  return {
    get(key: string): T | undefined {
      const entry = store.get(key);
      if (!entry) return;
      if (Date.now() > entry.expiresAt) {
        store.delete(key);
        return;
      }
      return entry.value;
    },
    set(key: string, value: T) {
      store.set(key, { value, expiresAt: Date.now() + ttlMs });
    },
  };
}
