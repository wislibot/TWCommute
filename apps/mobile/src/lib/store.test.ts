import { describe, expect, it, vi } from "vitest";

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: { getItem: vi.fn(), setItem: vi.fn(), removeItem: vi.fn() },
}));

const { draftToRequest, useDraft } = await import("./store");

describe("draft", () => {
  const here = { lat: 25.0478, lon: 121.517 };
  const there = { lat: 25.1677, lon: 121.4456, label: "Tamsui" };

  it("needs a destination", () => {
    expect(
      draftToRequest({ from: null, to: null, vias: [], time: null, arriveBy: false, bikeShare: true }, here, {
        locale: "en",
        tpassId: null,
      }),
    ).toBeNull();
  });

  it("uses the current location and skips empty vias", () => {
    const req = draftToRequest(
      {
        from: null,
        to: there,
        vias: [
          { id: "a", place: null, dwellMinutes: 30 },
          { id: "b", place: here, dwellMinutes: 90 },
        ],
        time: null,
        arriveBy: false,
        bikeShare: true,
      },
      here,
      { locale: "ja", tpassId: "kpntp" },
    );
    expect(req).toMatchObject({
      from: here,
      to: there,
      vias: [{ place: here, dwellMinutes: 90 }],
      locale: "ja",
      tpassId: "kpntp",
    });
  });

  it("caps vias and clamps dwell time", () => {
    const s = useDraft.getState();
    for (let i = 0; i < 7; i++) s.addVia();
    expect(useDraft.getState().vias).toHaveLength(5);
    useDraft.getState().setDwell(0, 9999);
    expect(useDraft.getState().vias[0]?.dwellMinutes).toBe(720);
    useDraft.getState().setPlace("via:1", here);
    expect(useDraft.getState().vias[1]?.place).toEqual(here);
  });
});
