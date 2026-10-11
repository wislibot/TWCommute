import type { TdxTraLiveTrainDelay, TdxTraStation } from "@twc/tdx";
import type { TraIndex } from "../gtfs/tra-index";
import { pct } from "./stats";
import type { TraResult } from "./types";

const SAMPLES = 10;

/** Same key normalization as buildTraTripUpdates: String(x).trim(). */
const normId = (value: unknown): string => (value === undefined || value === null ? "" : String(value).trim());

function updatedMs(d: TdxTraLiveTrainDelay): number {
  const t = Date.parse(d.SrcUpdateTime || d.UpdateTime || "");
  return Number.isFinite(t) ? t : Number.NEGATIVE_INFINITY;
}

/**
 * Can TDX TRA live delays (train number + last station) be mapped onto GTFS trips and stops by
 * our index? Uses the same lookups and precedence as apps/ingest/src/rail/tra-trip-updates.ts.
 */
export function analyzeTra(
  index: TraIndex | null,
  delays: TdxTraLiveTrainDelay[],
  stations: TdxTraStation[],
): TraResult {
  const latest = new Map<string, TdxTraLiveTrainDelay>();
  for (const d of delays) {
    if (!d) continue;
    const train = normId(d.TrainNo);
    const prev = latest.get(train);
    if (train && (!prev || updatedMs(d) > updatedMs(prev))) latest.set(train, d);
  }
  const stationIds = new Set(stations.map((s) => normId(s?.StationID)).filter(Boolean));

  let matched = 0;
  const badTrains: string[] = [];
  const badStations: string[] = [];
  for (const [train, d] of latest) {
    if (!index?.tripIdsByTrainNo.get(train)?.length) badTrains.push(train);
    else if (!index.stopIdByStationId.get(normId(d.StationID))) badStations.push(normId(d.StationID));
    else matched++;
  }
  const mapped = index ? [...stationIds].filter((id) => index.stopIdByStationId.has(id)).length : 0;
  return {
    traFeedFound: index !== null && index.tripIdsByTrainNo.size > 0,
    trainsIndexed: index?.tripIdsByTrainNo.size ?? 0,
    stationsIndexed: index?.stopIdByStationId.size ?? 0,
    delays: latest.size,
    matched,
    unmatchedTrains: badTrains.length,
    unmatchedStations: badStations.length,
    unmatchedSamples: { trains: badTrains.slice(0, SAMPLES), stations: [...new Set(badStations)].slice(0, SAMPLES) },
    tdxStations: stationIds.size,
    tdxStationsMapped: index ? pct(mapped, stationIds.size) : null,
  };
}
