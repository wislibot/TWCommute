import AsyncStorage from "@react-native-async-storage/async-storage";
import { type Locale, MAX_VIAS, type PlaceInput, type PlanRequestInput } from "@twc/contracts";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

interface SettingsState {
  /** null = follow the device language. */
  locale: Locale | null;
  tpassId: string | null;
  /** Backend address entered in Settings; null = the built-in API_URL. */
  apiUrl: string | null;
  /** The server's access key (API_TOKEN), when it has one. */
  apiToken: string | null;
  /** Where the user was last seen, so the map opens there instead of on Taipei. */
  lastPosition: { lat: number; lon: number } | null;
  setLocale: (locale: Locale | null) => void;
  setTpassId: (id: string | null) => void;
  setApiUrl: (url: string | null) => void;
  setApiToken: (token: string | null) => void;
  setLastPosition: (pos: { lat: number; lon: number }) => void;
}

let markLoaded: () => void = () => {};
const loaded = new Promise<void>((resolve) => {
  markLoaded = resolve;
});

/**
 * Resolves once saved settings have been read from storage (or failed to read), so the first
 * requests after launch go to the saved server.
 */
export const settingsLoaded = () => loaded;

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      locale: null,
      tpassId: null,
      apiUrl: null,
      apiToken: null,
      lastPosition: null,
      setLocale: (locale) => set({ locale }),
      setTpassId: (tpassId) => set({ tpassId }),
      setApiUrl: (apiUrl) => set({ apiUrl }),
      setApiToken: (apiToken) => set({ apiToken }),
      setLastPosition: (lastPosition) => set({ lastPosition }),
    }),
    {
      name: "twc-settings",
      storage: createJSONStorage(() => AsyncStorage),
      // The returned callback runs after loading, whether it succeeded or failed.
      onRehydrateStorage: () => () => markLoaded(),
    },
  ),
);

/** Which field a search/pick screen should fill. */
export type PlaceTarget = "from" | "to" | `via:${number}`;

export interface DraftVia {
  /** Stable key for list rendering; vias are reordered/removed by index. */
  id: string;
  place: PlaceInput | null;
  dwellMinutes: number;
}

interface DraftState {
  /** null `from` means "current location". */
  from: PlaceInput | null;
  to: PlaceInput | null;
  vias: DraftVia[];
  /** null = now. */
  time: string | null;
  arriveBy: boolean;
  bikeShare: boolean;
  /** The request behind the results screen (kept so results/itinerary share one query). */
  submitted: PlanRequestInput | null;
  submit: (req: PlanRequestInput) => void;
  setPlace: (target: PlaceTarget, place: PlaceInput | null) => void;
  addVia: () => void;
  removeVia: (index: number) => void;
  setDwell: (index: number, minutes: number) => void;
  setTime: (time: string | null) => void;
  setArriveBy: (arriveBy: boolean) => void;
  setBikeShare: (on: boolean) => void;
  swap: () => void;
}

export const DEFAULT_DWELL_MINUTES = 60;

let counter = 0;
const newId = () => `via-${Date.now().toString(36)}-${counter++}`;

export const useDraft = create<DraftState>()((set) => ({
  from: null,
  to: null,
  vias: [],
  time: null,
  arriveBy: false,
  bikeShare: true,
  submitted: null,
  submit: (submitted) => set({ submitted }),
  setPlace: (target, place) =>
    set((s) => {
      if (target === "from") return { from: place };
      if (target === "to") return { to: place };
      const i = Number(target.slice(4));
      return { vias: s.vias.map((v, j) => (j === i ? { ...v, place } : v)) };
    }),
  addVia: () =>
    set((s) =>
      s.vias.length >= MAX_VIAS
        ? s
        : { vias: [...s.vias, { id: newId(), place: null, dwellMinutes: DEFAULT_DWELL_MINUTES }] },
    ),
  removeVia: (index) => set((s) => ({ vias: s.vias.filter((_, j) => j !== index) })),
  setDwell: (index, minutes) =>
    set((s) => ({
      vias: s.vias.map((v, j) => (j === index ? { ...v, dwellMinutes: Math.max(0, Math.min(720, minutes)) } : v)),
    })),
  setTime: (time) => set({ time }),
  setArriveBy: (arriveBy) => set({ arriveBy }),
  setBikeShare: (bikeShare) => set({ bikeShare }),
  swap: () => set((s) => ({ from: s.to, to: s.from })),
}));

/** Build an API request from the draft; returns null until it is complete. */
export function draftToRequest(
  draft: Pick<DraftState, "from" | "to" | "vias" | "time" | "arriveBy" | "bikeShare">,
  current: PlaceInput | null,
  extras: { locale: Locale; tpassId: string | null },
): PlanRequestInput | null {
  const from = draft.from ?? current;
  if (!from || !draft.to) return null;
  const vias = draft.vias.flatMap((v) => (v.place ? [{ place: v.place, dwellMinutes: v.dwellMinutes }] : []));
  return {
    from,
    to: draft.to,
    vias,
    ...(draft.time ? { time: draft.time } : {}),
    arriveBy: draft.arriveBy,
    bikeShare: draft.bikeShare,
    locale: extras.locale,
    ...(extras.tpassId ? { tpassId: extras.tpassId } : {}),
  };
}
