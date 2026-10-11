/** TDX city names, used across TDX APIs (e.g. `/v2/Bus/.../City/{City}`). */
export const CITIES = [
  "Taipei",
  "NewTaipei",
  "Keelung",
  "Taoyuan",
  "Hsinchu",
  "HsinchuCounty",
  "MiaoliCounty",
  "Taichung",
  "ChanghuaCounty",
  "NantouCounty",
  "YunlinCounty",
  "Chiayi",
  "ChiayiCounty",
  "Tainan",
  "Kaohsiung",
  "PingtungCounty",
  "YilanCounty",
  "HualienCounty",
  "TaitungCounty",
  "PenghuCounty",
  "KinmenCounty",
  "LienchiangCounty",
] as const;
export type City = (typeof CITIES)[number];

/** TDX authority/city codes that prefix city-bus StopUIDs and RouteUIDs (e.g. `TPE12345`). */
export const CITY_BY_CODE: Record<string, City> = {
  TPE: "Taipei",
  NWT: "NewTaipei",
  KEE: "Keelung",
  TAO: "Taoyuan",
  HSZ: "Hsinchu",
  HSQ: "HsinchuCounty",
  MIA: "MiaoliCounty",
  TXG: "Taichung",
  CHA: "ChanghuaCounty",
  NAN: "NantouCounty",
  YUN: "YunlinCounty",
  CYI: "Chiayi",
  CYQ: "ChiayiCounty",
  TNN: "Tainan",
  KHH: "Kaohsiung",
  PIF: "PingtungCounty",
  ILA: "YilanCounty",
  HUA: "HualienCounty",
  TTT: "TaitungCounty",
  PEN: "PenghuCounty",
  KIN: "KinmenCounty",
  LIE: "LienchiangCounty",
};

/**
 * Best-effort city lookup from a TDX-style UID (`TPE12345`) or an OTP id (`feed:TPE12345`).
 * Returns null when the id carries no city code (rail stations, intercity stops); callers
 * then report coverage as "unknown" rather than guessing.
 */
export function cityFromUid(id: string | undefined | null): City | null {
  if (!id) return null;
  const local = id.includes(":") ? id.slice(id.indexOf(":") + 1) : id;
  const code = local.slice(0, 3).toUpperCase();
  return CITY_BY_CODE[code] ?? null;
}
