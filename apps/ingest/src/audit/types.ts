/**
 * Phase 0 audit report. Every metric here answers one question in docs/DATA.md; the
 * analyzers that fill it are pure functions over downloaded data so they can be unit-tested.
 */

/** A percentage 0–100, rounded to one decimal; null when the denominator is 0. */
export type Pct = number | null;

export interface Percentiles {
  count: number;
  p50: number | null;
  p90: number | null;
  max: number | null;
}

export interface GtfsProfile {
  feedId: string;
  fileName: string;
  bytes: number;
  files: string[];
  hasFrequencies: boolean;
  hasShapes: boolean;
  hasTranslations: boolean;
  hasFares: boolean;
  hasPathways: boolean;
  agencyCount: number;
  agencies: Array<{ id: string; name: string }>;
  routeCount: number;
  /** GTFS route_type → number of routes. */
  routeTypeCounts: Record<string, number>;
  tripCount: number;
  stopCount: number;
  /** stops with location_type = 1. */
  stationCount: number;
  /** Uncompressed size of stop_times.txt in bytes (read from the zip directory, not inflated). */
  stopTimesBytes: number | null;
  frequencyRows: number;
  calendar: { start: string | null; end: string | null; serviceIds: number };
  translationLanguages: string[];
  idSamples: { stop: string[]; route: string[]; trip: string[] };
  /** First three characters of stop_id → count (top 15). */
  stopIdPrefixes: Record<string, number>;
  warnings: string[];
}

/** Identifiers from all GTFS feeds, without the OTP feed prefix. */
export interface GtfsIdIndex {
  stopIds: Set<string>;
  stopCodes: Set<string>;
  routeIds: Set<string>;
  routeShortNames: Set<string>;
}

export interface BusMappingResult {
  city: string;
  tdxStops: number;
  /** TDX StopUID found among GTFS stop_id. */
  stopUidInGtfs: Pct;
  /** TDX StopID (local id) found among GTFS stop_id. */
  stopIdInGtfs: Pct;
  /** TDX StopUID or StopID found among GTFS stop_code. */
  stopInStopCode: Pct;
  tdxRoutes: number;
  routeUidInGtfs: Pct;
  /** Share of TDX sub-routes whose SubRouteUID is a GTFS route_id. */
  subRouteUidInGtfs: Pct;
  /** Share of TDX sub-routes whose `<SubRouteUID>_<Direction>` is a GTFS route_id (TDX GTFS layout). */
  subRouteDirInGtfs: Pct;
  /** ETA rows that carry a SubRouteUID. */
  etaWithSubRoute: Pct;
  etaRows: number;
  /**
   * ETA rows the production lookup can join: StopUID is a GTFS stop_id and `<SubRouteUID or
   * RouteUID>_<Direction>` (or the bare id) is a GTFS route_id.
   */
  etaJoinable: Pct;
  /** Which id scheme matches best, e.g. "StopUID=stop_id, RouteUID=route_id". */
  bestHypothesis: string;
  samples: { tdxStopUids: string[]; tdxRouteUids: string[]; unmatchedEtaKeys: string[] };
}

export interface CityPrefixResult {
  feedId: string;
  stops: number;
  /** stop_ids whose first three characters are a known TDX city code. */
  resolved: Pct;
  byCity: Record<string, number>;
  unresolvedSamples: string[];
}

export interface TraResult {
  traFeedFound: boolean;
  trainsIndexed: number;
  stationsIndexed: number;
  delays: number;
  matched: number;
  unmatchedTrains: number;
  unmatchedStations: number;
  unmatchedSamples: { trains: string[]; stations: string[] };
  tdxStations: number;
  /** TDX TRA StationIDs present in our station→stop index. */
  tdxStationsMapped: Pct;
}

export interface YouBikeResult {
  city: string;
  stations: number;
  availabilityRows: number;
  /** stations that have an availability row. */
  joined: Pct;
  serviceTypes: Record<string, number>;
  statusCounts: Record<string, number>;
  withEbikeDetail: Pct;
  zeroBikes: Pct;
  zeroDocks: Pct;
  /** now − SrcUpdateTime, seconds. */
  lagSeconds: Percentiles;
}

export interface EtaQualityResult {
  city: string;
  rows: number;
  distinctStops: number;
  distinctRoutes: number;
  /** rows with a numeric EstimateTime. */
  withEstimate: Pct;
  stopStatus: Record<string, number>;
  /** now − (SrcUpdateTime ?? UpdateTime), seconds. */
  lagSeconds: Percentiles;
}

export interface TdxUsage {
  calls: number;
  byStatus: Record<string, number>;
  /** Response headers that look like rate-limit/quota information (first value seen). */
  rateLimitHeaders: Record<string, string>;
}

export interface AuditReport {
  generatedAt: string;
  cities: string[];
  gtfs: GtfsProfile[];
  cityPrefix: CityPrefixResult[];
  busMapping: BusMappingResult[];
  eta: EtaQualityResult[];
  tra: TraResult | null;
  youbike: YouBikeResult[];
  tdx: TdxUsage;
  errors: string[];
}
