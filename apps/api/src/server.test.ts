import { describe, expect, it, vi } from "vitest";
import { OtpError } from "./otp/client";
import { itineraryWithVia } from "./otp/fixtures";
import { createServer } from "./server";

function deps(overrides: Record<string, unknown> = {}) {
  return {
    otp: {
      query: vi.fn().mockResolvedValue({
        planConnection: {
          routingErrors: [],
          pageInfo: { startCursor: "s", endCursor: "e", hasNextPage: true, hasPreviousPage: false },
          edges: [{ node: itineraryWithVia }],
        },
      }),
    },
    ingest: {
      busEta: vi.fn().mockResolvedValue([]),
      busEtaAtStop: vi.fn().mockResolvedValue([]),
      bikesNearby: vi.fn().mockResolvedValue([]),
      bikesInBBox: vi.fn().mockResolvedValue([]),
      health: vi.fn().mockResolvedValue({ status: "ok", feeds: [] }),
    },
    liveWindowMinutes: 45,
    planRateLimitPerMin: 2,
    now: () => new Date("2026-10-11T08:55:00+08:00"),
    ...overrides,
  };
}

const body = { from: { lat: 25.026, lon: 121.543 }, to: { lat: 25.0569, lon: 121.508 }, tpassId: "kpntp" };

describe("API server", () => {
  it("plans a trip and returns enriched itineraries", async () => {
    const app = await createServer(deps());
    const res = await app.inject({ method: "POST", url: "/v1/plan", payload: body });
    expect(res.statusCode).toBe(200);
    const json = res.json();
    expect(json.itineraries).toHaveLength(1);
    expect(json.itineraries[0].tpass.coverage).toBe("covered");
    expect(json.itineraries[0].legs[0].dockRisk.level).toBe("high");
    expect(json.nextCursor).toBe("next:e");
  });

  it("rejects invalid requests", async () => {
    const app = await createServer(deps());
    const res = await app.inject({ method: "POST", url: "/v1/plan", payload: { from: { lat: 999 } } });
    expect(res.statusCode).toBe(400);
  });

  it("returns 503 when the router is down", async () => {
    const app = await createServer(deps({ otp: { query: vi.fn().mockRejectedValue(new OtpError("down", null)) } }));
    const res = await app.inject({ method: "POST", url: "/v1/plan", payload: body });
    expect(res.statusCode).toBe(503);
  });

  it("rate-limits planning per client", async () => {
    const app = await createServer(deps());
    const codes = [];
    for (let i = 0; i < 3; i++)
      codes.push((await app.inject({ method: "POST", url: "/v1/plan", payload: body })).statusCode);
    expect(codes).toEqual([200, 200, 429]);
  });

  it("validates bike bbox and lists TPASS passes", async () => {
    const app = await createServer(deps());
    expect((await app.inject("/v1/bikes?minLat=25&minLon=121.5&maxLat=25.05&maxLon=121.55")).statusCode).toBe(200);
    expect((await app.inject("/v1/bikes?minLat=22&minLon=120&maxLat=25.05&maxLon=121.55")).statusCode).toBe(400);
    const passes = (await app.inject("/v1/tpass/passes")).json().passes;
    expect(passes.map((p: { id: string }) => p.id)).toContain("kpntp");
  });
});
