import type { Locale, SearchResult } from "@twc/contracts";
import type { OtpClient } from "../otp/client";
import { SEARCH_INDEX_QUERY } from "../otp/queries";
import type { OtpSearchIndexData, OtpSearchStop } from "../otp/types";
import { mapMode } from "../plan/map";

export const MAX_RESULTS = 20;

/** Stop names change with timetable updates; reload them this often. */
const INDEX_REFRESH_MS = 6 * 3600_000;

/**
 * Lowercase, without spaces, punctuation or symbols, with 臺 as 台: "Tsing Hua" finds "Tsing-Hua",
 * "台北" finds "臺北", and full-width letters match half-width ones.
 */
export function normalizeName(s: string): string {
  return s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/臺/g, "台")
    .replace(/[\s\p{P}\p{S}]/gu, "");
}

interface Entry {
  id: string;
  kind: SearchResult["kind"];
  zh: string;
  en: string;
  lat: number;
  lon: number;
  modes: SearchResult["modes"];
  parent?: string;
  /** Both names, normalized. */
  keys: string[];
  /** Both names from each word on, normalized: Latin queries match from the start of a word. */
  wordStarts: string[];
}

/** "National Tsing-Hua University" → nationaltsinghuauniversity, tsinghuauniversity, huauniversity, university. */
function fromEachWord(name: string): string[] {
  const words = name
    .normalize("NFKC")
    .split(/[\s\p{P}\p{S}]+/u)
    .filter(Boolean);
  return words.map((_, i) => normalizeName(words.slice(i).join("")));
}

function toEntry(s: OtpSearchStop, kind: Entry["kind"]): Entry {
  return {
    id: s.gtfsId,
    kind,
    zh: s.zh,
    en: s.en,
    lat: s.lat,
    lon: s.lon,
    modes: s.vehicleMode ? [mapMode(s.vehicleMode)] : [],
    ...(s.parentStation ? { parent: s.parentStation.gtfsId } : {}),
    keys: [...new Set([normalizeName(s.zh), normalizeName(s.en)])],
    wordStarts: [...new Set([...fromEachWord(s.zh), ...fromEachWord(s.en)])],
  };
}

/**
 * Chinese text has no spaces, so a Chinese query matches anywhere in a name. A Latin one matches
 * from the start of a word: without spaces, "NTHU" would also hit "Mi(n Th U)niversity".
 */
function matches(e: Entry, query: string, latin: boolean): boolean {
  return latin ? e.wordStarts.some((w) => w.startsWith(query)) : e.keys.some((k) => k.includes(query));
}

/** All stations and stops with their Chinese and English names, loaded from OTP when first needed. */
export class StopIndex {
  private entries: Promise<Entry[]> | null = null;
  private loadedAt = 0;

  constructor(
    private readonly otp: Pick<OtpClient, "query">,
    private readonly now: () => number = Date.now,
  ) {}

  load(): Promise<Entry[]> {
    if (!this.entries || this.now() - this.loadedAt > INDEX_REFRESH_MS) {
      this.loadedAt = this.now();
      const loading = this.otp
        .query<OtpSearchIndexData>(SEARCH_INDEX_QUERY, {})
        .then((data) => [
          ...(data.stations ?? []).filter((s): s is OtpSearchStop => !!s).map((s) => toEntry(s, "station")),
          ...(data.stops ?? []).filter((s): s is OtpSearchStop => !!s).map((s) => toEntry(s, "stop")),
        ]);
      // A failed load is retried by the next search instead of being kept.
      loading.catch(() => {
        if (this.entries === loading) this.entries = null;
      });
      this.entries = loading;
    }
    return this.entries;
  }
}

/**
 * Search stations and stops by name in Chinese or English, whatever the app's language. Stations
 * (MRT/rail) rank first; bus stops that share a name (one per direction) collapse into one result.
 * Exact and prefix matches rank higher. Names are shown in English for English, else in Chinese
 * (the feed has no Japanese or Korean names).
 */
export async function searchStops(q: string, locale: Locale, deps: { index: StopIndex }): Promise<SearchResult[]> {
  const query = normalizeName(q);
  if (!query) return [];
  const entries = await deps.index.load();
  const latin = !/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(query);
  const hits = entries.filter((e) => matches(e, query, latin));
  // Platforms/exits of a matched station are redundant.
  const stationIds = new Set(hits.filter((e) => e.kind === "station").map((e) => e.id));

  const seen = new Set<string>();
  const results: Array<SearchResult & { score: number }> = [];
  for (const e of hits) {
    if (e.parent && stationIds.has(e.parent)) continue;
    const name = locale === "en" ? e.en : e.zh;
    // Names that differ only in spacing or punctuation are the same place to the user.
    const key = `${e.kind}:${normalizeName(name)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    results.push({
      id: e.id,
      name,
      lat: e.lat,
      lon: e.lon,
      kind: e.kind,
      modes: e.modes,
      score: (e.kind === "station" ? 0 : 10) + Math.min(...e.keys.map((k) => matchRank(k, query))),
    });
  }
  return results
    .sort((a, b) => a.score - b.score || a.name.length - b.name.length)
    .slice(0, MAX_RESULTS)
    .map(({ score: _score, ...r }) => r);
}

function matchRank(key: string, query: string): number {
  if (key === query) return 0;
  if (key.startsWith(query)) return 1;
  return key.includes(query) ? 2 : 3;
}
