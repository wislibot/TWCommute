import type { Pct, Percentiles } from "./types";

export function pct(part: number, whole: number): Pct {
  return whole === 0 ? null : Math.round((part / whole) * 1000) / 10;
}

/** Nearest-rank percentiles; ignores non-finite values. */
export function percentiles(values: number[]): Percentiles {
  const v = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (v.length === 0) return { count: 0, p50: null, p90: null, max: null };
  const at = (p: number) => v[Math.min(v.length - 1, Math.ceil((p / 100) * v.length) - 1)] ?? null;
  return { count: v.length, p50: at(50), p90: at(90), max: v[v.length - 1] ?? null };
}

export function countBy<T>(items: Iterable<T>, key: (item: T) => string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const item of items) {
    const k = key(item);
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

/** Keep the `n` largest buckets. */
export function topN(counts: Record<string, number>, n: number): Record<string, number> {
  return Object.fromEntries(
    Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, n),
  );
}

/** Seconds between an ISO timestamp and `nowMs`; null if unparseable. */
export function ageSeconds(iso: string | undefined | null, nowMs: number): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? Math.round((nowMs - t) / 1000) : null;
}
