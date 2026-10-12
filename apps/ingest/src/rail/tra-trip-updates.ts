import type { TdxTraLiveTrainDelay } from "@twc/tdx";
import GtfsRealtime from "gtfs-realtime-bindings";
import type { TraIndex, TraStop } from "../gtfs/tra-index";

const { FeedMessage } = GtfsRealtime.transit_realtime;

export interface TripUpdatesResult {
  feed: Uint8Array;
  /** Trains whose delay was placed on a stop of today's trip. */
  matched: number;
  /** …of which the reported station is not a stop of the trip (passed without stopping). */
  offPattern: number;
  /** Trains with no trip running today or yesterday night. */
  unmatchedTrains: number;
  /** Trains whose station could not be placed on the trip. */
  unmatchedStations: number;
}

/** Service date (YYYYMMDD) in Asia/Taipei for a timestamp. */
export function taipeiServiceDate(ms: number): string {
  return new Date(ms + 8 * 3600_000).toISOString().slice(0, 10).replaceAll("-", "");
}

/** Before this Taipei hour, a running train most likely started on the previous service day. */
const OVERNIGHT_UNTIL_HOUR = 4;

/**
 * Which GTFS trips a live delay refers to. TDX TRA trip_ids carry their service day
 * (`…_<YYYYMMDD>_<HHMMSS>`, one trip per day), so pick today's trip — or yesterday's for overnight
 * trains before 04:00. Feeds without dated ids get every trip, dated today (OTP ignores the ones
 * not running).
 */
export function tripsForNow(tripIds: string[], nowMs: number): Array<{ tripId: string; startDate: string }> {
  const today = taipeiServiceDate(nowMs);
  const dated = tripIds.map((tripId) => ({ tripId, date: /_(\d{8})_\d{4,6}$/.exec(tripId)?.[1] }));
  if (dated.every((d) => d.date === undefined)) return tripIds.map((tripId) => ({ tripId, startDate: today }));
  const yesterday = taipeiServiceDate(nowMs - 86_400_000);
  const hour = new Date(nowMs + 8 * 3600_000).getUTCHours();
  for (const date of hour < OVERNIGHT_UNTIL_HOUR ? [yesterday, today] : [today, yesterday]) {
    const hits = dated.filter((d) => d.date === date);
    if (hits.length) return hits.map((d) => ({ tripId: d.tripId, startDate: date }));
  }
  return [];
}

/** Midnight (ms) of a Taipei service day "YYYYMMDD". */
function serviceDayStartMs(date: string): number {
  return Date.UTC(Number(date.slice(0, 4)), Number(date.slice(4, 6)) - 1, Number(date.slice(6, 8))) - 8 * 3600_000;
}

const updatedMs = (d: TdxTraLiveTrainDelay) => {
  const t = Date.parse(d.SrcUpdateTime || d.UpdateTime || "");
  return Number.isFinite(t) ? t : Number.NEGATIVE_INFINITY;
};

/** One report per train: the most recently updated. Train numbers are trimmed strings. */
export function latestPerTrain(delays: readonly (TdxTraLiveTrainDelay | null | undefined)[]): TdxTraLiveTrainDelay[] {
  const latest = new Map<string, TdxTraLiveTrainDelay>();
  for (const d of delays) {
    if (!d) continue;
    const train = String(d.TrainNo ?? "").trim();
    const prev = latest.get(train);
    if (train && (!prev || updatedMs(d) > updatedMs(prev))) latest.set(train, d);
  }
  return [...latest.values()];
}

export type TraDelayMatch =
  | { status: "no-trip" }
  | { status: "no-station" }
  | {
      status: "matched";
      delaySeconds: number;
      /** The reported station is not one of the trip's stops; the delay is placed on the next stop. */
      offPattern: boolean;
      updates: Array<{ tripId: string; startDate: string; stopId: string; stopSequence?: number }>;
    };

/**
 * Place a TDX delay report on today's GTFS trip(s) of that train. TDX reports the last station
 * the train passed, which for an express can be a station it does not stop at; OTP rejects an
 * update for a stop that is not in the trip. So: use the reported station when the trip stops
 * there, otherwise the first stop the train has not reached yet (scheduled time + delay ≥ now).
 * Without stop patterns (stop_times not indexed) only the reported station can be used.
 */
export function matchTraDelay(d: TdxTraLiveTrainDelay, index: TraIndex, nowMs: number): TraDelayMatch {
  const trips = tripsForNow(index.tripIdsByTrainNo.get(String(d.TrainNo ?? "").trim()) ?? [], nowMs);
  if (!trips.length) return { status: "no-trip" };
  const delaySeconds = Math.max(0, Math.round(Number(d.DelayTime) * 60) || 0);
  const stationStop = index.stopIdByStationId.get(String(d.StationID ?? "").trim());
  const updates: Array<{ tripId: string; startDate: string; stopId: string; stopSequence?: number }> = [];
  let offPattern = false;
  for (const { tripId, startDate } of trips) {
    const pattern = index.stopsByTripId.get(tripId);
    if (!pattern?.length) {
      if (stationStop) updates.push({ tripId, startDate, stopId: stationStop });
      continue;
    }
    const atStation = stationStop ? pattern.find((s) => s.stopId === stationStop) : undefined;
    const stop = atStation ?? nextStop(pattern, serviceDayStartMs(startDate), delaySeconds, nowMs);
    if (!stop) continue;
    if (!atStation) offPattern = true;
    updates.push({ tripId, startDate, stopId: stop.stopId, stopSequence: stop.stopSequence });
  }
  return updates.length ? { status: "matched", delaySeconds, offPattern, updates } : { status: "no-station" };
}

/** The first stop the train has not reached yet, given its delay. */
function nextStop(pattern: readonly TraStop[], dayStartMs: number, delaySeconds: number, nowMs: number) {
  return pattern.find((s) => s.timeSecs !== null && dayStartMs + (s.timeSecs + delaySeconds) * 1000 >= nowMs);
}

/**
 * Convert TDX TRA delays into a GTFS-Realtime TripUpdates feed for OpenTripPlanner.
 * TDX reports one delay (minutes) per train; a GTFS-RT stop-time update at one of the trip's
 * stops makes OTP propagate the delay to the rest of the trip.
 */
export function buildTraTripUpdates(
  delays: TdxTraLiveTrainDelay[],
  index: TraIndex,
  nowMs = Date.now(),
): TripUpdatesResult {
  const timestamp = Math.floor(nowMs / 1000);
  const counts = { matched: 0, offPattern: 0, unmatchedTrains: 0, unmatchedStations: 0 };
  const entity: object[] = [];

  for (const d of latestPerTrain(delays)) {
    const m = matchTraDelay(d, index, nowMs);
    if (m.status === "no-trip") {
      counts.unmatchedTrains++;
      continue;
    }
    if (m.status === "no-station") {
      counts.unmatchedStations++;
      continue;
    }
    counts.matched++;
    if (m.offPattern) counts.offPattern++;
    for (const u of m.updates) {
      entity.push({
        id: `tra-${String(d.TrainNo).trim()}-${u.tripId}`,
        tripUpdate: {
          trip: { tripId: u.tripId, startDate: u.startDate, scheduleRelationship: 0 },
          stopTimeUpdate: [
            {
              stopId: u.stopId,
              ...(u.stopSequence !== undefined && Number.isFinite(u.stopSequence)
                ? { stopSequence: u.stopSequence }
                : {}),
              arrival: { delay: m.delaySeconds },
              departure: { delay: m.delaySeconds },
            },
          ],
          timestamp,
        },
      });
    }
  }

  const message = FeedMessage.fromObject({
    header: { gtfsRealtimeVersion: "2.0", incrementality: 0, timestamp },
    entity,
  });
  return { feed: FeedMessage.encode(message).finish(), ...counts };
}
