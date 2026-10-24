import { type CameraRef, GeoJSONSource, Layer, type ViewStateChangeEvent } from "@maplibre/maplibre-react-native";
import type { BBox, StopSummary } from "@twc/contracts";
import { router } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { type NativeSyntheticEvent, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { BikeOutageNotice } from "@/components/bike-outage";
import { DataCredit } from "@/components/data-credit";
import { NearbyBikes, NearbyDepartures } from "@/components/nearby";
import { BottomSheet } from "@/components/sheet";
import { ThemedText } from "@/components/themed-text";
import { TransitMap } from "@/components/transit-map";
import { CircleButton, MapButton, SearchField, Segmented } from "@/components/ui";
import { useTheme } from "@/hooks/use-theme";
import { errorText } from "@/lib/api";
import { DEFAULT_CENTER } from "@/lib/config";
import { bikesGeoJson, bikesOutOfService } from "@/lib/geo";
import { useBikes, useCurrentPosition, useNearbyStops } from "@/lib/hooks";
import { MODE_COLORS } from "@/lib/modes";
import { useSettings } from "@/lib/store";

/** Only load bike stations once zoomed in far enough for the dots to be useful. */
const MIN_BIKE_ZOOM = 14;

type Tab = "departures" | "bikes";

function stopsGeoJson(stops: readonly StopSummary[]): GeoJSON.FeatureCollection<GeoJSON.Point> {
  return {
    type: "FeatureCollection",
    features: stops.map((s) => ({
      type: "Feature",
      id: s.id,
      properties: { color: MODE_COLORS[s.modes[0] ?? "OTHER"] },
      geometry: { type: "Point", coordinates: [s.lon, s.lat] },
    })),
  };
}

/**
 * The map with a sheet over it, as in Apple Maps: search and settings at the top of the sheet, then
 * a Departures / YouBike switch that changes both the list and the dots on the map.
 */
export default function HomeScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const camera = useRef<CameraRef>(null);
  const { pos } = useCurrentPosition();
  const [bbox, setBbox] = useState<BBox | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [tab, setTab] = useState<Tab>("departures");
  const bikes = useBikes(bbox);
  const { lastPosition, setLastPosition } = useSettings();
  // Until the phone's location arrives, start where the user was last seen rather than on Taipei.
  const target = pos ?? lastPosition;
  const nearby = useNearbyStops(target ?? { lat: DEFAULT_CENTER[1], lon: DEFAULT_CENTER[0] });
  const stops = nearby.data?.stops ?? [];

  // A position that arrives before the map has loaded would be dropped, leaving the map on Taipei.
  const [targetLat, targetLon] = [target?.lat, target?.lon];
  const recenter = () => {
    if (targetLat !== undefined && targetLon !== undefined)
      camera.current?.flyTo({ center: [targetLon, targetLat], zoom: 15 });
  };
  // biome-ignore lint/correctness/useExhaustiveDependencies: recenter reads exactly these values.
  useEffect(() => {
    if (mapReady) recenter();
  }, [targetLat, targetLon, mapReady]);

  // Remember the position to about 100 m, so GPS jitter does not rewrite storage.
  useEffect(() => {
    if (!pos) return;
    const rounded = { lat: Math.round(pos.lat * 1000) / 1000, lon: Math.round(pos.lon * 1000) / 1000 };
    if (rounded.lat !== lastPosition?.lat || rounded.lon !== lastPosition?.lon) setLastPosition(rounded);
  }, [pos, lastPosition, setLastPosition]);

  const onRegionDidChange = (e: NativeSyntheticEvent<ViewStateChangeEvent>) => {
    const { zoom, bounds } = e.nativeEvent;
    if (zoom < MIN_BIKE_ZOOM) return setBbox(null);
    const [minLon, minLat, maxLon, maxLat] = bounds;
    setBbox({ minLon, minLat, maxLon, maxLat });
  };

  return (
    <View style={styles.container}>
      <TransitMap
        center={DEFAULT_CENTER}
        cameraRef={camera}
        showUser
        onRegionDidChange={onRegionDidChange}
        onReady={() => setMapReady(true)}
      >
        {tab === "bikes" && bikes.data && (
          <GeoJSONSource id="bikes" data={bikesGeoJson(bikes.data.stations)}>
            <Layer
              id="bike-dots"
              type="circle"
              paint={{
                "circle-radius": 7,
                "circle-color": [
                  "match",
                  ["get", "level"],
                  "none",
                  "#FF3B30",
                  "few",
                  "#FF9500",
                  "ok",
                  "#34C759",
                  "#8E8E93",
                ],
                "circle-stroke-width": 2,
                "circle-stroke-color": "#FFFFFF",
              }}
            />
          </GeoJSONSource>
        )}
        {tab === "departures" && stops.length > 0 && (
          <GeoJSONSource id="stops" data={stopsGeoJson(stops)}>
            <Layer
              id="stop-dots"
              type="circle"
              paint={{
                "circle-radius": 6,
                "circle-color": ["get", "color"],
                "circle-stroke-width": 2,
                "circle-stroke-color": "#FFFFFF",
              }}
            />
          </GeoJSONSource>
        )}
      </TransitMap>

      {/* A soft band under the status bar, so the clock never sits on top of map labels. */}
      <View
        pointerEvents="none"
        style={[styles.statusBand, { height: insets.top, backgroundColor: `${theme.surface}CC` }]}
      />

      <SafeAreaView edges={["top"]} style={styles.controls} pointerEvents="box-none">
        <MapButton icon="locate" onPress={recenter} accessibilityLabel={t("home.locate")} />
      </SafeAreaView>

      <BottomSheet
        header={
          <>
            <View style={styles.searchRow}>
              <View style={styles.flex}>
                <SearchField placeholder={t("plan.toPlaceholder")} onPress={() => router.push("/plan")} />
              </View>
              <CircleButton
                icon="settings"
                onPress={() => router.push("/settings")}
                accessibilityLabel={t("settings.title")}
              />
            </View>
            {bikes.data && bikesOutOfService(bikes.data.stations) && <BikeOutageNotice />}
            <Segmented<Tab>
              value={tab}
              onChange={setTab}
              options={[
                { value: "departures", label: t("home.departures") },
                { value: "bikes", label: t("leg.BICYCLE") },
              ]}
            />
          </>
        }
      >
        <ScrollView contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + 16 }]}>
          {tab === "departures" ? (
            stops.length > 0 ? (
              <NearbyDepartures stops={stops} />
            ) : (
              <ThemedText type="small" themeColor="textSecondary" style={styles.hint}>
                {nearby.isError
                  ? t(errorText(nearby.error))
                  : nearby.isLoading
                    ? t("common.loading")
                    : t("home.noStops")}
              </ThemedText>
            )
          ) : (
            <NearbyBikes stations={bikes.data?.stations} from={target} />
          )}
          <DataCredit />
        </ScrollView>
      </BottomSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  flex: { flex: 1 },
  controls: { position: "absolute", top: 0, right: 0, paddingTop: 8, paddingRight: 12, alignItems: "flex-end" },
  statusBand: { position: "absolute", top: 0, left: 0, right: 0 },
  searchRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  body: { paddingHorizontal: 16, paddingTop: 4, gap: 20 },
  hint: { textAlign: "center", padding: 16 },
});
