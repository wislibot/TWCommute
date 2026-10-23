import {
  Camera,
  type CameraRef,
  Map as MapLibreMap,
  type MapRef,
  UserLocation,
  type ViewStateChangeEvent,
} from "@maplibre/maplibre-react-native";
import type { ReactNode, Ref } from "react";
import { type NativeSyntheticEvent, StyleSheet } from "react-native";
import { MAP_STYLE_URL } from "@/lib/config";

interface Props {
  center: [number, number];
  zoom?: number;
  bounds?: [number, number, number, number] | null;
  cameraRef?: Ref<CameraRef>;
  mapRef?: Ref<MapRef>;
  showUser?: boolean;
  onRegionDidChange?: (e: NativeSyntheticEvent<ViewStateChangeEvent>) => void;
  /** The map has loaded; camera moves requested before this are dropped. */
  onReady?: () => void;
  children?: ReactNode;
}

/** MapLibre map with our style and attribution on (required by OpenStreetMap). */
export function TransitMap({
  center,
  zoom = 15,
  bounds,
  cameraRef,
  mapRef,
  showUser,
  onRegionDidChange,
  onReady,
  children,
}: Props) {
  return (
    <MapLibreMap
      ref={mapRef}
      style={StyleSheet.absoluteFill}
      mapStyle={MAP_STYLE_URL}
      attribution
      logo={false}
      onRegionDidChange={onRegionDidChange}
      onDidFinishLoadingMap={onReady}
    >
      <Camera
        ref={cameraRef}
        initialViewState={bounds ? { bounds, padding: { top: 60, bottom: 60, left: 40, right: 40 } } : { center, zoom }}
      />
      {showUser && <UserLocation />}
      {children}
    </MapLibreMap>
  );
}
