# Data sources and the Phase 0 audit

Nothing in this file has been run against live TDX data yet: it needs a TDX API key. The code ships with unit tests on synthetic fixtures; the checks below decide whether its assumptions hold.

## Sources

| Data | Source | Notes |
| --- | --- | --- |
| GTFS static (bus, TRA, THSR, metros, ferries, domestic flights) | TDX `GET https://tdx.transportdata.tw/api/gtfs/V3/Map/GTFS/Static` | Beta, free, updated daily. |
| Taipei Metro GTFS | TDX `…/V3/Map/GTFS/Static/Rail/TRTC` | Produced by Taipei Metro separately. |
| Bus ETAs (N1) | TDX `/v2/Bus/EstimatedTimeOfArrival/City/{City}` and `/InterCity` | `$select` keeps payloads small. |
| YouBike stations / availability | TDX `/v2/Bike/Station/City/{City}`, `/v2/Bike/Availability/City/{City}` | 15 cities; `ServiceType` 1/2/3 = YouBike 1.0/2.0/Moovo. |
| TRA live delays | TDX `/v2/Rail/TRA/LiveTrainDelay` | Minutes late at the last station passed. |
| Streets | OpenStreetMap via Geofabrik `asia/taiwan-latest.osm.pbf` | ODbL; attribution required. |
| Map tiles | OpenFreeMap (`EXPO_PUBLIC_MAP_STYLE_URL`) | OSM-based; attribution shown on the map. |

TDX GTFS-Realtime is documented but its delivery is "in progress" (TDX GTFS docs, 資料更新與上架), which is why live data comes from the native APIs above.

## Phase 0 checklist

Run with real credentials (`.env`), then record results here.

1. **Download and inspect GTFS.** Run `pnpm --filter @twc/ingest fetch-gtfs`, read `data/gtfs/manifest.json`: is the national file one feed or a zip of zips? Then run `prepare-otp`: which feed ids come out, and is the TRA feed detected?
2. **Validate GTFS** with the MobilityData validator. Note errors that block OTP (missing `stop_times`, `frequencies.txt` use for buses, calendar coverage).
3. **Build the graph.** First a Greater Taipei extract (`BBOX=121.28,24.85,121.80,25.30 infra/scripts/fetch-data.sh`), then all of Taiwan on a 32 GB machine. Record memory and time.
4. **Check id mapping assumptions** (code depends on these):
   - Bus `stop_id` / `route_id` in TDX GTFS equal TDX `StopUID` / `RouteUID` (`apps/api/src/plan/live-overlay.ts`). Measure: % of bus legs that get a live ETA.
   - TDX city codes prefix bus `stop_id`s (`TPE…`, `NWT…`) (`packages/fares/src/cities.ts`). Measure: % of TPASS results that are `unknown`.
   - TRA `trip_short_name` is the train number and stations map by `stop_code` / trailing digits (`apps/ingest/src/gtfs/tra-index.ts`). Ingest logs matched vs unmatched delays every poll.
   - OTP `vehicleRentalStation.stationId` carries the TDX `StationUID` (used for TPASS city lookup).
5. **Live data quality per city:** ETA freshness (`SrcUpdateTime` lag), share of stops with predictions, ghost buses.
6. **TDX plan and terms:** confirm the tier for ≈1 call/s (all cities: 23 bus feeds every 30s + 15 bike cities every 60s + TRA every 60s ≈ 2.7M calls/month). Reduce with `BUS_CITIES` / intervals if needed, and check the streaming ETA endpoints. Confirm commercial-use and attribution wording, and apply for the academic/public-interest discount if eligible.
7. **TPASS data:** verify every pass in `packages/fares/src/tpass.ts` against official pages and set `verifiedAt`.

## Results

_To be filled in during Phase 0._
