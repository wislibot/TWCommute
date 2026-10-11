import { type CameraRef, GeoJSONSource, Layer, type ViewStateChangeEvent } from "@maplibre/maplibre-react-native";
import type { BBox } from "@twc/contracts";
import { router } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { FlatList, type NativeSyntheticEvent, Pressable, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ModeChip } from "@/components/badges";
import { ThemedText } from "@/components/themed-text";
import { TransitMap } from "@/components/transit-map";
import { useTheme } from "@/hooks/use-theme";
import { DEFAULT_CENTER } from "@/lib/config";
import { formatDistance } from "@/lib/format";
import { bikesGeoJson } from "@/lib/geo";
import { useBikes, useCurrentPosition, useNearbyStops } from "@/lib/hooks";

/** Only load bike stations once zoomed in far enough for the dots to be useful. */
const MIN_BIKE_ZOOM = 14;

export default function HomeScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const camera = useRef<CameraRef>(null);
  const { pos } = useCurrentPosition();
  const [bbox, setBbox] = useState<BBox | null>(null);
  const bikes = useBikes(bbox);
  const nearby = useNearbyStops(pos ?? { lat: DEFAULT_CENTER[1], lon: DEFAULT_CENTER[0] });

  useEffect(() => {
    if (pos) camera.current?.flyTo({ center: [pos.lon, pos.lat], zoom: 15 });
  }, [pos]);

  const onRegionDidChange = (e: NativeSyntheticEvent<ViewStateChangeEvent>) => {
    const { zoom, bounds } = e.nativeEvent;
    if (zoom < MIN_BIKE_ZOOM) return setBbox(null);
    const [minLon, minLat, maxLon, maxLat] = bounds;
    setBbox({ minLon, minLat, maxLon, maxLat });
  };

  return (
    <View style={styles.container}>
      <TransitMap center={DEFAULT_CENTER} cameraRef={camera} showUser onRegionDidChange={onRegionDidChange}>
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
              {nearby.isError ? t("errors.network") : nearby.isLoading ? t("common.loading") : ""}
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
