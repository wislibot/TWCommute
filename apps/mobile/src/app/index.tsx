import { type CameraRef, GeoJSONSource, Layer, type ViewStateChangeEvent } from "@maplibre/maplibre-react-native";
import type { BBox } from "@twc/contracts";
import { router } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { FlatList, type NativeSyntheticEvent, Pressable, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ModeChip } from "@/components/badges";
import { BikeOutageNotice } from "@/components/bike-outage";
import { ThemedText } from "@/components/themed-text";
import { TransitMap } from "@/components/transit-map";
import { useTheme } from "@/hooks/use-theme";
import { errorText } from "@/lib/api";
import { DEFAULT_CENTER } from "@/lib/config";
import { formatDistance } from "@/lib/format";
import { bikesGeoJson, bikesOutOfService } from "@/lib/geo";
import { useBikes, useCurrentPosition, useNearbyStops } from "@/lib/hooks";
import { useSettings } from "@/lib/store";

/** Only load bike stations once zoomed in far enough for the dots to be useful. */
const MIN_BIKE_ZOOM = 14;

export default function HomeScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const camera = useRef<CameraRef>(null);
  const { pos } = useCurrentPosition();
  const [bbox, setBbox] = useState<BBox | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const bikes = useBikes(bbox);
  const { lastPosition, setLastPosition } = useSettings();
  // Until the phone's location arrives, start where the user was last seen rather than on Taipei.
  const target = pos ?? lastPosition;
  const nearby = useNearbyStops(target ?? { lat: DEFAULT_CENTER[1], lon: DEFAULT_CENTER[0] });

  // A position that arrives before the map has loaded would be dropped, leaving the map on Taipei.
  const [targetLat, targetLon] = [target?.lat, target?.lon];
  useEffect(() => {
    if (targetLat !== undefined && targetLon !== undefined && mapReady)
      camera.current?.flyTo({ center: [targetLon, targetLat], zoom: 15 });
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
        {bikes.data && (
          <GeoJSONSource id="bikes" data={bikesGeoJson(bikes.data.stations)}>
            <Layer
              id="bike-dots"
              type="circle"
              paint={{
                "circle-radius": 6,
                "circle-color": [
                  "match",
                  ["get", "level"],
                  "none",
                  "#DC2626",
                  "few",
                  "#F59E0B",
                  "ok",
                  "#16A34A",
                  "#9CA3AF",
                ],
                "circle-stroke-width": 1.5,
                "circle-stroke-color": "#FFFFFF",
              }}
            />
          </GeoJSONSource>
        )}
      </TransitMap>

      <SafeAreaView edges={["top"]} style={styles.topBar} pointerEvents="box-none">
        <Pressable
          onPress={() => router.push("/settings")}
          accessibilityRole="button"
          accessibilityLabel={t("settings.title")}
          style={[styles.roundButton, { backgroundColor: theme.background }]}
        >
          <ThemedText>⚙︎</ThemedText>
        </Pressable>
      </SafeAreaView>

      <View style={[styles.panel, { backgroundColor: theme.background }]}>
        {bikes.data && bikesOutOfService(bikes.data.stations) && <BikeOutageNotice />}
        <Pressable
          onPress={() => router.push("/plan")}
          accessibilityRole="button"
          style={[styles.whereTo, { backgroundColor: theme.backgroundElement }]}
        >
          <ThemedText themeColor="textSecondary">{t("plan.toPlaceholder")}</ThemedText>
        </Pressable>
        <FlatList
          data={nearby.data?.stops ?? []}
          keyExtractor={(s) => s.id}
          style={styles.list}
          ListEmptyComponent={
            <ThemedText type="small" themeColor="textSecondary">
              {nearby.isError ? t(errorText(nearby.error)) : nearby.isLoading ? t("common.loading") : ""}
            </ThemedText>
          }
          renderItem={({ item }) => (
            <Pressable
              onPress={() => router.push({ pathname: "/stop/[id]", params: { id: item.id } })}
              style={[styles.stopRow, { borderBottomColor: theme.border }]}
            >
              <View style={styles.stopName}>
                {item.modes[0] && <ModeChip mode={item.modes[0]} />}
                <ThemedText numberOfLines={1} style={styles.flex}>
                  {item.name}
                </ThemedText>
              </View>
              {item.distanceMeters !== undefined && (
                <ThemedText type="small" themeColor="textSecondary">
                  {formatDistance(item.distanceMeters)}
                </ThemedText>
              )}
            </Pressable>
          )}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  flex: { flex: 1 },
  topBar: { position: "absolute", top: 0, right: 0, padding: 12, alignItems: "flex-end" },
  roundButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    elevation: 3,
  },
  panel: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    maxHeight: "45%",
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    padding: 16,
    paddingBottom: 32,
    gap: 12,
  },
  whereTo: { borderRadius: 14, paddingHorizontal: 16, paddingVertical: 14 },
  list: { flexGrow: 0 },
  stopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 8,
  },
  stopName: { flexDirection: "row", alignItems: "center", gap: 8, flex: 1 },
});
