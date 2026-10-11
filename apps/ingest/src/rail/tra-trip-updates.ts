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
  const startDate = taipeiServiceDate(nowMs);
  const timestamp = Math.floor(nowMs / 1000);
  let matched = 0;
  let unmatchedTrains = 0;
  let unmatchedStations = 0;
  const entity: object[] = [];

  for (const d of delays) {
    const tripIds = index.tripIdsByTrainNo.get(String(d.TrainNo).trim());
    if (!tripIds?.length) {
      unmatchedTrains++;
      continue;
    }
    const stopId = index.stopIdByStationId.get(String(d.StationID).trim());
    if (!stopId) {
      unmatchedStations++;
      continue;
    }
    const delaySeconds = Math.max(0, Math.round(d.DelayTime * 60));
    // A train number can map to several trip_ids (calendar variants); OTP ignores the ones
    // not running on startDate.
    for (const tripId of tripIds) {
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
