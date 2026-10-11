import { describe, expect, it, vi } from "vitest";
import { searchStops } from "./search";

const stop = (gtfsId: string, name: string, vehicleMode: string, parent?: string) => ({
  gtfsId,
  name,
  code: null,
  lat: 25.04,
  lon: 121.51,
  vehicleMode,
  parentStation: parent ? { gtfsId: parent } : null,
});

describe("searchStops", () => {
  it("ranks stations first, drops child platforms and collapses same-name stops", async () => {
    const query = vi.fn().mockResolvedValue({
      stations: [stop("trtc:BL12", "台北車站", "SUBWAY")],
      stops: [
        stop("trtc:BL12-1", "台北車站", "SUBWAY", "trtc:BL12"),
        stop("tw:TPE1", "台北車站(忠孝)", "BUS"),
        stop("tw:TPE2", "台北車站(忠孝)", "BUS"),
        stop("tw:TPE3", "捷運台北車站", "BUS"),
      ],
    });
    const results = await searchStops("台北車站", "zh-TW", { otp: { query } });
    expect(results.map((r) => [r.id, r.kind])).toEqual([
      ["trtc:BL12", "station"],
      ["tw:TPE1", "stop"],
      ["tw:TPE3", "stop"],
    ]);
    expect(query).toHaveBeenCalledWith(expect.any(String), { q: "台北車站", lang: "zh" }, "zh-TW");
  });
});
