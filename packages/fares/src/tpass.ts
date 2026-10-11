import type { City } from "./cities";

/**
 * Modes a TPASS pass can cover. `tra_local` = TRA local/fast-local trains only;
 * TPASS never covers THSR.
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
  notes?: string;
  sources: string[];
  /**
   * Date coverage/prices were checked against an official MOTC/city source.
   * null = compiled from secondary sources; must be verified before launch.
   */
  verifiedAt: string | null;
}

/**
 * Inter-city TPASS 1.0 monthly passes for the main living circles (2026).
 * Compiled from secondary summaries; prices and operator lists change, so every entry
 * stays `verifiedAt: null` until checked against the official TPASS pages.
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
  {
    id: "tchhm",
    name: { zh: "桃竹竹苗", en: "Taoyuan–Hsinchu–Miaoli", ja: "桃竹竹苗", ko: "타오위안·신주·먀오리" },
    priceTwd: 1200,
    cities: ["Taoyuan", "Hsinchu", "HsinchuCounty", "MiaoliCounty"],
    modes: ["metro", "city_bus", "intercity_bus", "tra_local"],
    notes: "Airport MRT only at some stations; intercity coaches only when both ends are inside the region.",
    sources: ["https://blog.104.com.tw/tpass-taiwan/"],
    verifiedAt: null,
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
