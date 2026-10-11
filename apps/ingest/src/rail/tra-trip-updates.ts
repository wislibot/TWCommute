import type { TdxTraLiveTrainDelay } from "@twc/tdx";
import GtfsRealtime from "gtfs-realtime-bindings";
import type { TraIndex } from "../gtfs/tra-index";

const { FeedMessage } = GtfsRealtime.transit_realtime;

export interface TripUpdatesResult {
  feed: Uint8Array;
  matched: number;
  unmatchedTrains: number;
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

/**
 * Convert TDX TRA delays into a GTFS-Realtime TripUpdates feed for OpenTripPlanner.
 * TDX reports one delay (minutes) at the last station passed; a GTFS-RT stop-time update at
 * that stop makes OTP propagate the delay to the rest of the trip.
 */
export function buildTraTripUpdates(
  delays: TdxTraLiveTrainDelay[],
  index: TraIndex,
  nowMs = Date.now(),
): TripUpdatesResult {
  const timestamp = Math.floor(nowMs / 1000);
  let matched = 0;
  let unmatchedTrains = 0;
  let unmatchedStations = 0;
  const entity: object[] = [];

  for (const d of delays) {
    const trips = tripsForNow(index.tripIdsByTrainNo.get(String(d.TrainNo).trim()) ?? [], nowMs);
    if (!trips.length) {
      unmatchedTrains++;
      continue;
    }
    const stopId = index.stopIdByStationId.get(String(d.StationID).trim());
    if (!stopId) {
      unmatchedStations++;
      continue;
    }
    const delaySeconds = Math.max(0, Math.round(d.DelayTime * 60));
    for (const { tripId, startDate } of trips) {
      entity.push({
        id: `tra-${d.TrainNo}-${tripId}`,
        tripUpdate: {
          trip: { tripId, startDate, scheduleRelationship: 0 },
          stopTimeUpdate: [{ stopId, arrival: { delay: delaySeconds }, departure: { delay: delaySeconds } }],
          timestamp,
        },
      });
    }
    matched++;
  }

  const message = FeedMessage.fromObject({
    header: { gtfsRealtimeVersion: "2.0", incrementality: 0, timestamp },
    entity,
  });
  return { feed: FeedMessage.encode(message).finish(), matched, unmatchedTrains, unmatchedStations };
}
