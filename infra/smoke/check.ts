/**
 * Assertions for the end-to-end smoke test (real OTP + API + fixture ingest).
 *   tsx infra/smoke/check.ts <apiUrl> <otpGraphqlUrl>
 */
import assert from "node:assert/strict";
import type { PlanResponse } from "@twc/contracts";

const [api = "http://127.0.0.1:3998", otp = "http://127.0.0.1:8080/otp/gtfs/v1"] = process.argv.slice(2);
const tomorrow10 = `${new Date(Date.now() + 8 * 3600_000 + 86_400_000).toISOString().slice(0, 10)}T10:00:00+08:00`;
const A = { lat: 25.0305, lon: 121.5015 };
const D = { lat: 25.0485, lon: 121.5185 };
const nearB = { lat: 25.0405, lon: 121.5105, label: "Near B" };

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: { "content-type": "application/json" } });
  const body = await res.text();
  assert.ok(res.ok, `${url} → ${res.status} ${body.slice(0, 300)}`);
  return JSON.parse(body) as T;
}

const checks: Array<[string, () => Promise<void>]> = [
  [
    "OTP loaded both YouBike stations from our GBFS feed",
    async () => {
      const r = await json<{
        data: { vehicleRentalStations: Array<{ stationId: string; availableVehicles: { total: number } }> };
      }>(otp, {
        method: "POST",
        body: JSON.stringify({ query: "{ vehicleRentalStations { stationId availableVehicles { total } } }" }),
      });
      const ids = r.data.vehicleRentalStations.map((s) => s.stationId).sort();
      assert.deepEqual(ids, ["youbike2:TPE900001", "youbike2:TPE900002"].sort(), `stations: ${ids.join(", ")}`);
    },
  ],
  [
    "multi-stop plan honours the 30 min stay at the via",
    async () => {
      const plan = await json<PlanResponse>(`${api}/v1/plan`, {
        method: "POST",
        body: JSON.stringify({
          from: A,
          to: D,
          vias: [{ place: nearB, dwellMinutes: 30 }],
          time: tomorrow10,
          bikeShare: false,
        }),
      });
      assert.ok(plan.itineraries.length > 0, `no itineraries; errors: ${JSON.stringify(plan.errors)}`);
      const it = plan.itineraries[0];
      assert.ok(it);
      const arrive = it.legs.findIndex((l) => l.to.viaIndex === 0);
      assert.ok(arrive >= 0, `no leg arrives at the via: ${it.legs.map((l) => `${l.mode}→${l.to.name}`).join(" | ")}`);
      const leave = it.legs[arrive + 1];
      assert.ok(leave, "no leg after the via");
      const stayMin = (Date.parse(leave.start.scheduled) - Date.parse(it.legs[arrive]?.end.scheduled ?? "")) / 60_000;
      assert.ok(stayMin >= 30, `stay was ${stayMin} min`);
      assert.ok(
        it.legs.some((l) => l.mode === "BUS" && l.route?.shortName === "307"),
        "expected bus 307 legs",
      );
      console.log(`    ${it.legs.map((l) => l.mode).join(" → ")} (stay ${stayMin} min)`);
    },
  ],
  [
    "plan with YouBike returns rental legs with dock risk when chosen",
    async () => {
      const plan = await json<PlanResponse>(`${api}/v1/plan`, {
        method: "POST",
        body: JSON.stringify({
          from: { lat: 25.0302, lon: 121.5004 },
          to: { lat: 25.0498, lon: 121.5196 },
          time: tomorrow10,
          bikeShare: true,
        }),
      });
      assert.ok(plan.itineraries.length > 0, "no itineraries");
      const bike = plan.itineraries.flatMap((i) => i.legs).find((l) => l.rentedBike);
      if (bike) {
        assert.equal(bike.dockRisk?.level, "high", "drop-off has 0 docks → high risk");
        console.log(`    rental leg ${bike.from.name} → ${bike.to.name}, risk ${bike.dockRisk?.level}`);
      } else {
        console.log("    (router preferred non-bike options; rental station loading is checked separately)");
      }
    },
  ],
  [
    "nearby stops, search and live departures",
    async () => {
      const nearby = await json<{ stops: Array<{ id: string }> }>(
        `${api}/v1/stops/nearby?lat=${A.lat}&lon=${A.lon}&radius=500`,
      );
      assert.ok(
        nearby.stops.some((s) => s.id === "tw:TPE10001"),
        `nearby: ${JSON.stringify(nearby.stops)}`,
      );
      const search = await json<{ results: Array<{ id: string }> }>(
        `${api}/v1/search?q=${encodeURIComponent("B站")}&locale=zh-TW`,
      );
      assert.ok(
        search.results.some((r) => r.id === "tw:TPE10002"),
        `search: ${JSON.stringify(search.results)}`,
      );
      const board = await json<{ departures: Array<{ realtime: string; live?: { etaSeconds: number } }> }>(
        `${api}/v1/stops/${encodeURIComponent("tw:TPE10002")}/departures`,
      );
      // The fixture bus runs every 10 minutes around the clock; its first departure gets the live ETA
      // for sub-route TPE103070 direction 0 (300 s), not the direction-1 row (60 s).
      assert.ok(board.departures.length > 0, "no departures");
      assert.equal(board.departures[0]?.live?.etaSeconds, 300, `departures: ${JSON.stringify(board.departures[0])}`);
    },
  ],
];

let failed = 0;
for (const [name, fn] of checks) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    console.log(`  ✗ ${name}\n    ${(err as Error).message}`);
  }
}
process.exit(failed ? 1 : 0);
