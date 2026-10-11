import {
  type BikeCity,
  type BusCity,
  getBikeAvailability,
  getBikeStations,
  getBusEta,
  getBusRoutes,
  getTraLiveTrainDelay,
  type TdxClient,
} from "@twc/tdx";
import type { BikeStore } from "./bike/store";
import type { BusEtaStore } from "./bus/eta-store";
import type { Config } from "./config";
import type { TraIndex } from "./gtfs/tra-index";
import type { Job, Logger } from "./lib/scheduler";
import { buildTraTripUpdates } from "./rail/tra-trip-updates";

export interface State {
  bikes: BikeStore;
  busEta: BusEtaStore;
  traIndex: TraIndex;
  /** Latest encoded GTFS-RT TripUpdates for TRA, served to OTP. */
  traTripUpdates: Uint8Array | null;
}

/** Route lists change rarely; refresh twice a day (1 request per city per 12 h). */
const BUS_ROUTES_INTERVAL_MS = 12 * 3600_000;

/** All polling jobs, with start offsets so cities are spread across the interval. */
export function buildJobs(
  config: Config,
  tdx: TdxClient,
  state: State,
  log: Logger,
): Array<{ job: Job; delayMs: number }> {
  const jobs: Array<{ job: Job; delayMs: number }> = [];
  const spread = (i: number, n: number, intervalMs: number) => Math.floor((i / Math.max(1, n)) * intervalMs);

  config.BIKE_CITIES.forEach((city: BikeCity, i) => {
    jobs.push({
      delayMs: spread(i, config.BIKE_CITIES.length, 5_000),
      job: {
        name: `bike-stations:${city}`,
        intervalMs: config.BIKE_STATIONS_INTERVAL_S * 1000,
        run: async () => state.bikes.setStations(city, await getBikeStations(tdx, city)),
      },
    });
    const availabilityMs = config.BIKE_AVAILABILITY_INTERVAL_S * 1000;
    jobs.push({
      // Start after station lists have had a chance to load.
      delayMs: 5_000 + spread(i, config.BIKE_CITIES.length, availabilityMs),
      job: {
        name: `bike-availability:${city}`,
        intervalMs: availabilityMs,
        run: async () => state.bikes.setAvailability(city, await getBikeAvailability(tdx, city)),
      },
    });
  });

  const busFeeds: Array<BusCity | "InterCity"> = [
    ...config.BUS_CITIES,
    ...(config.BUS_INTERCITY ? (["InterCity"] as const) : []),
  ];
  const busMs = config.BUS_ETA_INTERVAL_S * 1000;
  busFeeds.forEach((feed, i) => {
    jobs.push({
      delayMs: spread(i, busFeeds.length, 10_000),
      job: {
        name: `bus-routes:${feed}`,
        intervalMs: BUS_ROUTES_INTERVAL_MS,
        run: async () => {
          state.busEta.setRoutes(feed, await getBusRoutes(tdx, feed));
        },
      },
    });
    jobs.push({
      delayMs: spread(i, busFeeds.length, busMs),
      job: {
        name: `bus-eta:${feed}`,
        intervalMs: busMs,
        run: async () => {
          state.busEta.replace(feed, await getBusEta(tdx, feed));
        },
      },
    });
  });

  jobs.push({
    delayMs: 0,
    job: {
      name: "tra-delay",
      intervalMs: config.TRA_DELAY_INTERVAL_S * 1000,
      run: async () => {
        const delays = await getTraLiveTrainDelay(tdx);
        const result = buildTraTripUpdates(delays, state.traIndex);
        state.traTripUpdates = result.feed;
        if (result.unmatchedTrains + result.unmatchedStations > 0) {
          log.info(
            {
              matched: result.matched,
              unmatchedTrains: result.unmatchedTrains,
              unmatchedStations: result.unmatchedStations,
            },
            "tra delays mapped to GTFS",
          );
        }
      },
    },
  });

  return jobs;
}
