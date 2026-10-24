import { describe, expect, it, vi } from "vitest";
import { normalizeName, StopIndex, searchStops } from "./search";

const stop = (gtfsId: string, zh: string, vehicleMode: string, en = zh, parent?: string) => ({
  gtfsId,
  zh,
  en,
  lat: 25.04,
  lon: 121.51,
  vehicleMode,
  parentStation: parent ? { gtfsId: parent } : null,
});

function index(data: object) {
  const query = vi.fn().mockResolvedValue(data);
  return { query, index: new StopIndex({ query }) };
}

describe("searchStops", () => {
  it("ranks stations first, drops child platforms and collapses same-name stops", async () => {
    const { index: idx } = index({
      stations: [stop("trtc:BL12", "台北車站", "SUBWAY", "Taipei Main Station")],
      stops: [
        stop("trtc:BL12-1", "台北車站", "SUBWAY", "Taipei Main Station", "trtc:BL12"),
        stop("tw:TPE1", "台北車站(忠孝)", "BUS"),
        stop("tw:TPE2", "台北車站(忠孝)", "BUS"),
        stop("tw:TPE3", "捷運台北車站", "BUS"),
      ],
    });
    const results = await searchStops("臺北車站", "zh-TW", { index: idx });
    expect(results.map((r) => [r.id, r.kind])).toEqual([
      ["trtc:BL12", "station"],
      ["tw:TPE1", "stop"],
      ["tw:TPE3", "stop"],
    ]);
  });

  it("finds Chinese and English names in any language, ignoring spaces and hyphens", async () => {
    const { query, index: idx } = index({
      stations: [],
      stops: [stop("tw:HSZ291242", "清華大學", "BUS", "National Tsing-Hua University")],
    });
    expect((await searchStops("Tsing Hua", "en", { index: idx })).map((r) => r.name)).toEqual([
      "National Tsing-Hua University",
    ]);
    expect((await searchStops("清華", "en", { index: idx })).map((r) => r.name)).toEqual([
      "National Tsing-Hua University",
    ]);
    expect((await searchStops("tsinghua", "ja", { index: idx })).map((r) => r.name)).toEqual(["清華大學"]);
    // The index is loaded once.
    expect(query).toHaveBeenCalledTimes(1);
  });

  it("matches Latin text from the start of a word, and collapses names that differ in spacing", async () => {
    const { index: idx } = index({
      stations: [],
      stops: [
        stop("tw:HSZ1", "清大南大校區", "BUS", "NTHU Nanda Campus"),
        stop("tw:HSZ2", "明新科大", "BUS", "Min Th University"),
        stop("tw:HSZ3", "清華大學", "BUS", "National Tsing Hua University"),
        stop("tw:HSZ4", "清華大學", "BUS", "National Tsing Hua  University"),
      ],
    });
    expect((await searchStops("NTHU", "en", { index: idx })).map((r) => r.id)).toEqual(["tw:HSZ1"]);
    expect((await searchStops("hua univ", "en", { index: idx })).map((r) => r.id)).toEqual(["tw:HSZ3"]);
    // Chinese has no word breaks: anywhere in the name.
    expect((await searchStops("南大", "en", { index: idx })).map((r) => r.id)).toEqual(["tw:HSZ1"]);
  });

  it("retries a failed index load", async () => {
    const query = vi.fn().mockRejectedValueOnce(new Error("down")).mockResolvedValue({ stations: [], stops: [] });
    const idx = new StopIndex({ query });
    await expect(searchStops("新竹", "zh-TW", { index: idx })).rejects.toThrow("down");
    expect(await searchStops("新竹", "zh-TW", { index: idx })).toEqual([]);
  });

  it("normalizes names", () => {
    expect(normalizeName("Ｔsing-Hua Univ.")).toBe("tsinghuauniv");
    expect(normalizeName("臺北 車站")).toBe("台北車站");
  });
});
