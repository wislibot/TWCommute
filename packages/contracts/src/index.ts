/**
 * Request/response contracts shared by the API service and the mobile app.
 * The API validates inbound requests with these schemas; the app uses the
 * inferred types (and may validate responses in development builds).
 */
import { z } from "zod";

export const LOCALES = ["zh-TW", "en", "ja", "ko"] as const;
export const Locale = z.enum(LOCALES);
export type Locale = z.infer<typeof Locale>;

/** A localized string. `zh` is always present; other languages are optional. */
export const LocalizedName = z.object({
  zh: z.string(),
  en: z.string().optional(),
  ja: z.string().optional(),
  ko: z.string().optional(),
});
export type LocalizedName = z.infer<typeof LocalizedName>;

const Latitude = z.number().min(-90).max(90);
const Longitude = z.number().min(-180).max(180);

/** A place the user typed or picked: a coordinate, optionally pinned to a stop/station. */
export const PlaceInput = z.object({
  lat: Latitude,
  lon: Longitude,
  label: z.string().max(200).optional(),
  /** OTP stop/station id (`FeedId:StopId`) when the user picked a stop. */
  stopId: z.string().max(200).optional(),
});
export type PlaceInput = z.infer<typeof PlaceInput>;

export const MAX_VIAS = 5;
export const MAX_DWELL_MINUTES = 12 * 60;

export const ViaInput = z.object({
  place: PlaceInput,
  /** How long the user stays at this stop before continuing. */
  dwellMinutes: z.number().int().min(0).max(MAX_DWELL_MINUTES),
});
export type ViaInput = z.infer<typeof ViaInput>;

export const TRANSIT_MODES = ["SUBWAY", "RAIL", "BUS", "COACH", "TRAM", "FERRY", "GONDOLA", "AIRPLANE"] as const;
export const TransitMode = z.enum(TRANSIT_MODES);
export type TransitMode = z.infer<typeof TransitMode>;

export const PlanRequest = z.object({
  from: PlaceInput,
  to: PlaceInput,
  vias: z.array(ViaInput).max(MAX_VIAS).default([]),
  /** ISO-8601 with offset. Defaults to "now" on the server. */
  time: z.iso.datetime({ offset: true }).optional(),
  arriveBy: z.boolean().default(false),
  transitModes: z.array(TransitMode).min(1).optional(),
  /** Allow YouBike for first/last mile and direct trips. */
  bikeShare: z.boolean().default(true),
  /** Selected TPASS pass id (see @twc/fares) to evaluate coverage. */
  tpassId: z.string().max(64).optional(),
  locale: Locale.default("en"),
  /** Pagination cursor from a previous response. */
  cursor: z.string().max(2000).optional(),
});
export type PlanRequest = z.infer<typeof PlanRequest>;
export type PlanRequestInput = z.input<typeof PlanRequest>;

export const LEG_MODES = ["WALK", "BICYCLE", ...TRANSIT_MODES, "OTHER"] as const;
export const LegMode = z.enum(LEG_MODES);
export type LegMode = z.infer<typeof LegMode>;

export const LegTime = z.object({
  scheduled: z.string(),
  /** Present when a live prediction is applied to this time. */
  estimated: z.string().optional(),
  delaySeconds: z.number().int().optional(),
});
export type LegTime = z.infer<typeof LegTime>;

export const DockInfo = z.object({
  stationId: z.string(),
  name: z.string(),
  lat: z.number(),
  lon: z.number(),
  bikesAvailable: z.number().int().nullable(),
  docksAvailable: z.number().int().nullable(),
});
export type DockInfo = z.infer<typeof DockInfo>;

export const RiskLevel = z.enum(["low", "medium", "high"]);
export type RiskLevel = z.infer<typeof RiskLevel>;

export const DockRisk = z.object({
  level: RiskLevel,
  /** Machine-readable reasons; the app maps these to localized text. */
  reasons: z.array(
    z.enum([
      "few_bikes_at_pickup",
      "no_bikes_at_pickup",
      "few_docks_at_dropoff",
      "no_docks_at_dropoff",
      "long_lead_time",
      "no_realtime",
    ]),
  ),
  backup: DockInfo.optional(),
});
export type DockRisk = z.infer<typeof DockRisk>;

/**
 * "live": times include a real-time prediction (GTFS-RT in the router, or a TDX ETA overlay).
 * "scheduled": timetable only; the app must label it as such.
 */
export const Realtime = z.enum(["live", "scheduled"]);
export type Realtime = z.infer<typeof Realtime>;

export const LegPlace = z.object({
  name: z.string(),
  lat: z.number(),
  lon: z.number(),
  stopId: z.string().optional(),
  stopCode: z.string().optional(),
  /** Set when this place is one of the user's via stops. */
  viaIndex: z.number().int().optional(),
  bikeStation: DockInfo.optional(),
});
export type LegPlace = z.infer<typeof LegPlace>;

export const RouteInfo = z.object({
  id: z.string(),
  shortName: z.string().optional(),
  longName: z.string().optional(),
  color: z.string().optional(),
  textColor: z.string().optional(),
  agencyName: z.string().optional(),
});
export type RouteInfo = z.infer<typeof RouteInfo>;

export const LiveArrival = z.object({
  /** Seconds until the vehicle reaches the boarding stop, as of `asOf`. */
  etaSeconds: z.number().int().nullable(),
  asOf: z.string(),
  source: z.enum(["tdx-eta", "gtfs-rt"]),
  isLastBus: z.boolean().optional(),
});
export type LiveArrival = z.infer<typeof LiveArrival>;

export const Leg = z.object({
  mode: LegMode,
  from: LegPlace,
  to: LegPlace,
  start: LegTime,
  end: LegTime,
  durationSeconds: z.number(),
  distanceMeters: z.number(),
  /** Google encoded polyline (precision 5). */
  geometry: z.string().optional(),
  route: RouteInfo.optional(),
  headsign: z.string().optional(),
  tripId: z.string().optional(),
  realtime: Realtime,
  live: LiveArrival.optional(),
  rentedBike: z.boolean().default(false),
  dockRisk: DockRisk.optional(),
});
export type Leg = z.infer<typeof Leg>;

export const TpassCoverage = z.object({
  passId: z.string(),
  coverage: z.enum(["covered", "partial", "not_covered", "unknown"]),
});
export type TpassCoverage = z.infer<typeof TpassCoverage>;

export const Itinerary = z.object({
  id: z.string(),
  start: z.string(),
  end: z.string(),
  durationSeconds: z.number(),
  transfers: z.number().int(),
  walkDistanceMeters: z.number(),
  legs: z.array(Leg),
  tpass: TpassCoverage.optional(),
});
export type Itinerary = z.infer<typeof Itinerary>;

export const PlanError = z.object({
  code: z.string(),
  message: z.string(),
});
export type PlanError = z.infer<typeof PlanError>;

export const PlanResponse = z.object({
  itineraries: z.array(Itinerary),
  errors: z.array(PlanError),
  nextCursor: z.string().optional(),
  previousCursor: z.string().optional(),
});
export type PlanResponse = z.infer<typeof PlanResponse>;

export const StopSummary = z.object({
  id: z.string(),
  name: z.string(),
  code: z.string().optional(),
  lat: z.number(),
  lon: z.number(),
  distanceMeters: z.number().optional(),
  modes: z.array(LegMode).default([]),
});
export type StopSummary = z.infer<typeof StopSummary>;

export const Departure = z.object({
  routeId: z.string(),
  routeShortName: z.string().optional(),
  mode: LegMode,
  headsign: z.string().optional(),
  /**
   * Timetabled time. For a bus with no timetabled departure in the board's window (headway
   * trips, or a timetable that misses buses TDX tracks) it is the predicted time, as `estimated`.
   */
  scheduled: z.string(),
  estimated: z.string().optional(),
  realtime: Realtime,
  live: LiveArrival.optional(),
});
export type Departure = z.infer<typeof Departure>;

export const DepartureBoard = z.object({
  stop: StopSummary,
  departures: z.array(Departure),
});
export type DepartureBoard = z.infer<typeof DepartureBoard>;

export const BIKE_SERVICE_TYPES = ["youbike1", "youbike2", "moovo"] as const;
export const BikeServiceType = z.enum(BIKE_SERVICE_TYPES);
export type BikeServiceType = z.infer<typeof BikeServiceType>;

export const BikeStation = z.object({
  id: z.string(),
  name: LocalizedName,
  lat: z.number(),
  lon: z.number(),
  serviceType: BikeServiceType,
  capacity: z.number().int().nullable(),
  bikes: z.number().int().nullable(),
  /** Electric-assist (YouBike 2.0E) bikes, a subset of `bikes`. */
  ebikes: z.number().int().nullable(),
  docks: z.number().int().nullable(),
  status: z.enum(["active", "suspended", "closed", "unknown"]),
  updatedAt: z.string().nullable(),
});
export type BikeStation = z.infer<typeof BikeStation>;

export const BBox = z.object({
  minLat: Latitude,
  minLon: Longitude,
  maxLat: Latitude,
  maxLon: Longitude,
});
export type BBox = z.infer<typeof BBox>;

export const FeedHealth = z.object({
  feed: z.string(),
  lastSuccessAt: z.string().nullable(),
  lastError: z.string().nullable(),
  ageSeconds: z.number().nullable(),
  healthy: z.boolean(),
});
export type FeedHealth = z.infer<typeof FeedHealth>;

export const HealthResponse = z.object({
  status: z.enum(["ok", "degraded"]),
  feeds: z.array(FeedHealth),
});
export type HealthResponse = z.infer<typeof HealthResponse>;

export const SearchResult = z.object({
  id: z.string(),
  name: z.string(),
  lat: z.number(),
  lon: z.number(),
  kind: z.enum(["station", "stop"]),
  modes: z.array(LegMode).default([]),
});
export type SearchResult = z.infer<typeof SearchResult>;

export const SearchResponse = z.object({ results: z.array(SearchResult) });
export type SearchResponse = z.infer<typeof SearchResponse>;
