import type { TdxTraLiveTrainDelay, TdxTraStation } from "@twc/tdx";
import type { TraIndex } from "../gtfs/tra-index";
import { latestPerTrain, matchTraDelay } from "../rail/tra-trip-updates";
import { pct } from "./stats";
import type { TraResult } from "./types";

const SAMPLES = 10;

const normId = (value: unknown): string => (value === undefined || value === null ? "" : String(value).trim());

/**
 * Can TDX TRA live delays (train number + last station) be mapped onto today's GTFS trips? Runs
 * the production matcher (`matchTraDelay`, used by buildTraTripUpdates) at `nowMs`.
 */
export function analyzeTra(
  index: TraIndex | null,
  delays: TdxTraLiveTrainDelay[],
  stations: TdxTraStation[],
  nowMs: number,
): TraResult {
  const stationIds = new Set(stations.map((s) => normId(s?.StationID)).filter(Boolean));
  const latest = latestPerTrain(delays);
  let matched = 0;
  let offPattern = 0;
  const badTrains: string[] = [];
  const badStations: string[] = [];
  for (const d of latest) {
    const m = index ? matchTraDelay(d, index, nowMs) : { status: "no-trip" as const };
    if (m.status === "no-trip") badTrains.push(normId(d.TrainNo));
    else if (m.status === "no-station") badStations.push(normId(d.StationID));
    else {
      matched++;
      if (m.offPattern) offPattern++;
    }
  }
  const mapped = index ? [...stationIds].filter((id) => index.stopIdByStationId.has(id)).length : 0;
  return {
    traFeedFound: index !== null && index.tripIdsByTrainNo.size > 0,
    trainsIndexed: index?.tripIdsByTrainNo.size ?? 0,
    stationsIndexed: index?.stopIdByStationId.size ?? 0,
    tripsWithStops: index?.stopsByTripId.size ?? 0,
    delays: latest.length,
    matched,
    offPattern,
    unmatchedTrains: badTrains.length,
    unmatchedStations: badStations.length,
    unmatchedSamples: { trains: badTrains.slice(0, SAMPLES), stations: [...new Set(badStations)].slice(0, SAMPLES) },
    tdxStations: stationIds.size,
    tdxStationsMapped: index ? pct(mapped, stationIds.size) : null,
  };
}
