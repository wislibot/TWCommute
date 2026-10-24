import type { City } from "./cities";

/**
 * Modes a TPASS pass can cover. `tra_local` = TRA trains except the classes TPASS excludes (Taroko,
 * Puyuma, EMU3000, tour and group trains); TPASS never covers THSR.
 */
export type TpassMode = "metro" | "light_rail" | "city_bus" | "intercity_bus" | "tra_local" | "ferry" | "bike_share";

export interface TpassPass {
  id: string;
  name: { zh: string; en: string; ja: string; ko: string };
  /** Price of a 30-day pass in TWD (general price; some regions have cheaper resident prices). */
  priceTwd: number;
  residentPriceTwd?: number;
  cities: City[];
  modes: TpassMode[];
  /**
   * YouBike: the pass makes the first minutes of a ride free, by the city of the pickup station. A
   * longer ride costs the usual fare for the rest. Cities missing here have no free minutes.
   */
  bikeFreeMinutes?: Partial<Record<City, number>>;
  notes?: string;
  sources: string[];
  /**
   * Date coverage/prices were checked against an official MOTC/city source.
   * null = compiled from secondary sources; must be verified before launch.
   */
  verifiedAt: string | null;
}

/** Hsinchu City's official 桃竹竹苗 Q&A (updated 2023-09-23): passes, prices, TRA ranges, YouBike. */
const HCCG_QA =
  "https://dep-traffic.hccg.gov.tw/userfiles/1305/files/%E6%A1%83%E7%AB%B9%E7%AB%B9%E8%8B%97%E5%85%AC%E5%85%B1%E9%81%8B%E8%BC%B8%E5%AE%9A%E6%9C%9F%E7%A5%A8Q_A_0923%E6%9B%B4%E6%96%B0.pdf";

/**
 * Inter-city TPASS 1.0 monthly passes for the main living circles (2026).
 * Entries with `verifiedAt: null` were compiled from secondary summaries; prices and operator lists
 * change, so they must be checked against the official pages before launch.
 */
export const TPASS_PASSES: TpassPass[] = [
  {
    id: "kpntp",
    name: {
      zh: "基北北桃",
      en: "Keelung–Taipei–New Taipei–Taoyuan",
      ja: "基北北桃",
      ko: "지룽·타이베이·신베이·타오위안",
    },
    priceTwd: 1200,
    cities: ["Keelung", "Taipei", "NewTaipei", "Taoyuan"],
    modes: ["metro", "light_rail", "city_bus", "intercity_bus", "tra_local", "bike_share"],
    notes: "YouBike: first 30 minutes free in Taipei/New Taipei.",
    sources: ["https://blog.104.com.tw/tpass-taiwan/", "https://www.gov.tw/News_Content_37_817176"],
    verifiedAt: null,
  },
  // The 桃竹竹苗 family: four passes, each covering its cities' TRA stations (e.g. 竹竹: 北湖–香山,
  // 六家線, 內灣線), city buses, intercity buses with both ends inside, YouBike rented inside (first
  // 30 minutes free in Hsinchu and Miaoli, 60 in Taoyuan) and, with Taoyuan, Airport MRT A7–A22.
  {
    id: "tchhm",
    name: { zh: "桃竹竹苗", en: "Taoyuan–Hsinchu–Miaoli", ja: "桃竹竹苗", ko: "타오위안·신주·먀오리" },
    priceTwd: 1200,
    cities: ["Taoyuan", "Hsinchu", "HsinchuCounty", "MiaoliCounty"],
    modes: ["metro", "city_bus", "intercity_bus", "tra_local", "bike_share"],
    bikeFreeMinutes: { Taoyuan: 60, Hsinchu: 30, HsinchuCounty: 30, MiaoliCounty: 30 },
    notes: "Airport MRT only at A7–A22.",
    sources: [HCCG_QA],
    verifiedAt: "2026-10-24",
  },
  {
    id: "thc",
    name: { zh: "桃竹竹", en: "Taoyuan–Hsinchu", ja: "桃竹竹", ko: "타오위안·신주" },
    priceTwd: 799,
    cities: ["Taoyuan", "Hsinchu", "HsinchuCounty"],
    modes: ["metro", "city_bus", "intercity_bus", "tra_local", "bike_share"],
    bikeFreeMinutes: { Taoyuan: 60, Hsinchu: 30, HsinchuCounty: 30 },
    notes: "Airport MRT only at A7–A22.",
    sources: [HCCG_QA],
    verifiedAt: "2026-10-24",
  },
  {
    id: "hcm",
    name: { zh: "竹竹苗", en: "Hsinchu–Miaoli", ja: "竹竹苗", ko: "신주·먀오리" },
    priceTwd: 699,
    cities: ["Hsinchu", "HsinchuCounty", "MiaoliCounty"],
    modes: ["city_bus", "intercity_bus", "tra_local", "bike_share"],
    bikeFreeMinutes: { Hsinchu: 30, HsinchuCounty: 30, MiaoliCounty: 30 },
    sources: [HCCG_QA],
    verifiedAt: "2026-10-24",
  },
  {
    id: "hc",
    name: { zh: "竹竹", en: "Hsinchu City & County", ja: "竹竹", ko: "신주시·신주현" },
    priceTwd: 288,
    cities: ["Hsinchu", "HsinchuCounty"],
    modes: ["city_bus", "intercity_bus", "tra_local", "bike_share"],
    bikeFreeMinutes: { Hsinchu: 30, HsinchuCounty: 30 },
    sources: [HCCG_QA],
    verifiedAt: "2026-10-24",
  },
  {
    id: "tcmn",
    name: { zh: "中彰投苗", en: "Taichung–Changhua–Nantou–Miaoli", ja: "中彰投苗", ko: "타이중·장화·난터우·먀오리" },
    priceTwd: 999,
    residentPriceTwd: 699,
    cities: ["Taichung", "ChanghuaCounty", "NantouCounty", "MiaoliCounty"],
    modes: ["metro", "city_bus", "intercity_bus", "tra_local", "bike_share"],
    notes: "NT$699 for Taichung residents.",
    sources: ["https://www.shoppingdesign.com.tw/post/view/9077", "https://blog.104.com.tw/tpass-taiwan/"],
    verifiedAt: null,
  },
  {
    id: "nkp",
    name: { zh: "南高屏", en: "Tainan–Kaohsiung–Pingtung", ja: "南高屏", ko: "타이난·가오슝·핑둥" },
    priceTwd: 999,
    cities: ["Tainan", "Kaohsiung", "PingtungCounty"],
    modes: ["metro", "light_rail", "city_bus", "intercity_bus", "tra_local", "ferry", "bike_share"],
    sources: ["https://www.businessweekly.com.tw/focus/blog/3012666", "https://www.twneed.org/post/61.html"],
    verifiedAt: null,
  },
];

export function findPass(id: string): TpassPass | undefined {
  return TPASS_PASSES.find((p) => p.id === id);
}
