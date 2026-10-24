import { readFileSync } from "node:fs";
import type { City } from "@twc/fares";

/**
 * Which city or county a point lies in, for TPASS: TRA stations and intercity bus stops carry no
 * city in their ids. Borders: taiwan-counties.topo.json, the Ministry of the Interior's county
 * boundaries as pre-built TopoJSON by taiwan-atlas 2021.9.20 (MIT; counties-10t.json). Checked
 * against TRA's station addresses: all 245 stations with an address land in the right city (八斗子
 * is listed under New Taipei but sits on the Keelung side; both are in the same TPASS pass).
 */

const CITY_BY_NAME: Record<string, City> = {
  "Taipei City": "Taipei",
  "New Taipei City": "NewTaipei",
  "Keelung City": "Keelung",
  "Taoyuan City": "Taoyuan",
  "Hsinchu City": "Hsinchu",
  "Hsinchu County": "HsinchuCounty",
  "Miaoli County": "MiaoliCounty",
  "Taichung City": "Taichung",
  "Changhua County": "ChanghuaCounty",
  "Nantou County": "NantouCounty",
  "Yunlin County": "YunlinCounty",
  "Chiayi City": "Chiayi",
  "Chiayi County": "ChiayiCounty",
  "Tainan City": "Tainan",
  "Kaohsiung City": "Kaohsiung",
  "Pingtung County": "PingtungCounty",
  "Yilan County": "YilanCounty",
  "Hualien County": "HualienCounty",
  "Taitung County": "TaitungCounty",
  "Penghu County": "PenghuCounty",
  "Kinmen County": "KinmenCounty",
  "Lienchiang County": "LienchiangCounty",
};

type Ring = Array<[number, number]>;
interface Area {
  city: City;
  /** Each polygon: outer ring, then holes. */
  polygons: Ring[][];
  bbox: [number, number, number, number];
}

interface Topology {
  transform: { scale: [number, number]; translate: [number, number] };
  arcs: Array<Array<[number, number]>>;
  objects: {
    counties: {
      geometries: Array<
        | { type: "Polygon"; arcs: number[][]; properties: { COUNTYENG: string } }
        | { type: "MultiPolygon"; arcs: number[][][]; properties: { COUNTYENG: string } }
      >;
    };
  };
}

/** TopoJSON → rings: arcs are delta-encoded and quantized; a negative index means the arc reversed. */
export function decodeAreas(topo: Topology): Area[] {
  const { scale, translate } = topo.transform;
  const arcs = topo.arcs.map((arc) => {
    let x = 0;
    let y = 0;
    return arc.map(([dx, dy]): [number, number] => {
      x += dx;
      y += dy;
      return [x * scale[0] + translate[0], y * scale[1] + translate[1]];
    });
  });
  const ring = (ids: number[]): Ring =>
    ids.flatMap((id, k) => {
      const arc = id < 0 ? [...(arcs[~id] ?? [])].reverse() : (arcs[id] ?? []);
      return k === 0 ? arc : arc.slice(1);
    });
  return topo.objects.counties.geometries.flatMap((g) => {
    const city = CITY_BY_NAME[g.properties.COUNTYENG];
    if (!city) return [];
    const polygons = (g.type === "Polygon" ? [g.arcs] : g.arcs).map((p) => p.map(ring));
    const points = polygons.flatMap((p) => p[0] ?? []);
    const bbox: Area["bbox"] = [
      Math.min(...points.map((p) => p[0])),
      Math.min(...points.map((p) => p[1])),
      Math.max(...points.map((p) => p[0])),
      Math.max(...points.map((p) => p[1])),
    ];
    return [{ city, polygons, bbox }];
  });
}

function inRing(lon: number, lat: number, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i] as [number, number];
    const [xj, yj] = ring[j] as [number, number];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

let areas: Area[] | null = null;

/** The city or county at a point; null at sea or outside Taiwan. */
export function cityAt(lat: number, lon: number): City | null {
  areas ??= decodeAreas(
    JSON.parse(readFileSync(new URL("./taiwan-counties.topo.json", import.meta.url), "utf8")) as Topology,
  );
  for (const a of areas) {
    const [w, s, e, n] = a.bbox;
    if (lon < w || lon > e || lat < s || lat > n) continue;
    if (
      a.polygons.some(
        ([outer, ...holes]) => outer && inRing(lon, lat, outer) && !holes.some((h) => inRing(lon, lat, h)),
      )
    )
      return a.city;
  }
  return null;
}
