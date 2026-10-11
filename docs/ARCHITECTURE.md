# Architecture

```
 Mobile app (Expo / React Native)            ┌─────────────── TDX (MOTC) ───────────────┐
   │  HTTPS JSON                              │ GTFS static (Beta) · Bus ETA · YouBike   │
   ▼                                          │ TRA delays                               │
 api  (Fastify, TS) ──GraphQL──▶ OpenTripPlanner 2.10 ◀── GBFS + GTFS-RT ── ingest (Node, TS)
   │  (live ETAs, bikes, health)                ▲                              ▲ polls on a
   └──────────────────────────────────────────── ingest ◀───────── OAuth ──────┘ fixed schedule
 OSM (Geofabrik) ─▶ OTP graph build (street graph once, transit nightly)
 Map tiles: OpenFreeMap (no key) — swappable for MapTiler/Protomaps
```

## Components

| Path | Role |
| --- | --- |
| `apps/ingest` | The only TDX client. Polls YouBike (60s), bus ETAs per city (30s) and TRA delays (60s). Serves **GBFS 2.3** (`/gbfs/{youbike2,youbike1}/…`) and **GTFS-RT TripUpdates for TRA** (`/rt/tra-trip-updates.pb`) to OTP, plus internal JSON routes for the API. Also downloads GTFS and prepares the OTP directory. |
| `infra/otp` | OTP 2.10 config templates and the GTFS GraphQL schema the API is tested against. |
| `apps/api` | Public API for the app. Calls OTP `planConnection` and enriches results with live bus ETAs, dock risk and TPASS coverage. Rate-limited. |
| `apps/mobile` | Expo SDK 57 app: map (MapLibre), search, multi-stop planner, results, itinerary, stop boards, settings. |
| `packages/contracts` | zod schemas shared by API and app. |
| `packages/tdx` | TDX OAuth client (token cache, single-flight refresh, rate limiter, retries) and typed endpoints. |
| `packages/fares` | TPASS pass data and coverage evaluator. |
| `packages/i18n` | UI strings (zh-TW, en, ja, ko) and the stop-name display strategy. |

## Key decisions

**Only the server talks to TDX.** The app calls our API; the ingest service polls TDX on fixed intervals. TDX usage (≈1 call/s with all cities enabled; logged at startup) is the same for 10 users or 100,000.

**Routing in OpenTripPlanner, not custom code.** OTP 2.10's RAPTOR router handles multimodal routing, bike rental (via GBFS) and stops along the way (`via.visit.minimumWaitTime`). Our API only adds what OTP can't know.

**Live data without GTFS-RT for buses.** TDX's GTFS-Realtime feed isn't released yet, so:
- *Rail (TRA):* ingest converts `LiveTrainDelay` (train number + last station + minutes late) into GTFS-RT TripUpdates. OTP propagates the delay and re-routes on it.
- *Buses:* OTP routes on timetables. For bus legs leaving within 45 min, the API attaches TDX's live "next bus at this stop" ETA, and the app shows "Live: arrives in 6 min" next to the scheduled time. When TDX publishes GTFS-RT, ingest can relay it to OTP instead.

**Honest labels.** Every leg and departure is `live` or `scheduled`; dock availability is `null` when no live data exists; TPASS coverage is `unknown` when a leg can't be placed in a city.

**YouBike via GBFS.** One GBFS system per docked service type (2.0 incl. 2.0E e-bikes, and 1.0), so OTP never routes a 2.0 bike into a 1.0 dock. Moovo (e-fence, no docks) is excluded for now.

**Stable OTP feed ids.** `prepare-otp` splits TDX bundles into one zip per feed with readable ids (`tra`, `trtc`, …), because feed ids appear in every OTP id the app stores.

## API (v1)

| Endpoint | Purpose |
| --- | --- |
| `POST /v1/plan` | Plan with up to 5 stops along the way (dwell minutes each), depart-at/arrive-by, transit modes, YouBike on/off, TPASS pass, locale, paging cursor. |
| `GET /v1/search?q=&locale=` | Stations and stops by name (MVP; a POI geocoder comes later). |
| `GET /v1/stops/nearby?lat=&lon=` | Stops near a point. |
| `GET /v1/stops/:id/departures` | Next departures with live ETAs. |
| `GET /v1/bikes?minLat=…` | YouBike stations in a small bounding box. |
| `GET /v1/tpass/passes` | Supported TPASS passes. |
| `GET /v1/health` | Router status and data-feed freshness. |

## Hosting and cost

One VM in or near Taiwan (GCP `asia-east1`, or Hetzner Singapore) running `infra/docker-compose.yml`. All of Taiwan needs ~32 GB RAM for the OTP build (serving needs less); a Greater Taipei extract fits in ~8 GB. Rough budget: US$60–200/month for the VM, plus the TDX tier and map tiles if we leave OpenFreeMap.

## Scaling path

- API is stateless: run more instances behind a load balancer.
- Move ingest's in-memory stores to Redis once there is more than one ingest/API pair.
- Postgres/PostGIS arrives with dock-risk v2 (bike availability history).
