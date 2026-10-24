import type { LegMode } from "@twc/contracts";
import { type AndroidSymbol, type SFSymbol, SymbolView } from "expo-symbols";
import type { ColorValue, StyleProp, ViewStyle } from "react-native";

/** SF Symbols on iOS, the matching Material Symbols on Android. */
const ICONS = {
  search: ["magnifyingglass", "search"],
  settings: ["gearshape.fill", "settings"],
  locate: ["location.fill", "near_me"],
  chevron: ["chevron.right", "chevron_right"],
  swap: ["arrow.up.arrow.down", "swap_vert"],
  plus: ["plus.circle.fill", "add_circle"],
  minus: ["minus.circle.fill", "do_not_disturb_on"],
  close: ["xmark.circle.fill", "cancel"],
  warning: ["exclamationmark.triangle.fill", "warning"],
  clock: ["clock", "schedule"],
  origin: ["circle.circle.fill", "trip_origin"],
  pin: ["mappin.circle.fill", "location_on"],
  map: ["map", "map"],
  check: ["checkmark", "check"],
  wifi: ["wifi", "wifi"],
  walk: ["figure.walk", "directions_walk"],
  bike: ["bicycle", "pedal_bike"],
  bus: ["bus.fill", "directions_bus"],
  coach: ["bus.doubledecker.fill", "airport_shuttle"],
  rail: ["tram.fill", "train"],
  subway: ["tram.fill.tunnel", "subway"],
  tram: ["cablecar.fill", "tram"],
  ferry: ["ferry.fill", "directions_boat"],
  plane: ["airplane", "flight"],
  transit: ["arrow.triangle.turn.up.right.circle.fill", "directions_transit"],
} as const satisfies Record<string, readonly [SFSymbol, AndroidSymbol]>;

export type IconName = keyof typeof ICONS;

export const MODE_ICONS: Record<LegMode, IconName> = {
  WALK: "walk",
  BICYCLE: "bike",
  SUBWAY: "subway",
  RAIL: "rail",
  BUS: "bus",
  COACH: "coach",
  TRAM: "tram",
  FERRY: "ferry",
  GONDOLA: "tram",
  AIRPLANE: "plane",
  OTHER: "transit",
};

export function Icon({
  name,
  size = 20,
  color,
  style,
}: {
  name: IconName;
  size?: number;
  color: ColorValue;
  style?: StyleProp<ViewStyle>;
}) {
  const [ios, android] = ICONS[name];
  return <SymbolView name={{ ios, android }} size={size} tintColor={color} style={style} />;
}
