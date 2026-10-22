// pg-proxy has no db.batch(). Production uses neon-http, where db.batch() sends
// the queries as one transaction. This stand-in runs them in order and records
// how many went in each batch, so tests can check what was grouped together.
export function withBatch<T extends object>(db: T, batches: number[] = []): T & { batch: (qs: readonly PromiseLike<unknown>[]) => Promise<unknown[]> } {
  return Object.assign(db, {
    batch: async (qs: readonly PromiseLike<unknown>[]) => {
      batches.push(qs.length);
      const out: unknown[] = [];
      for (const q of qs) out.push(await q);
      return out;
    },
  });
}
