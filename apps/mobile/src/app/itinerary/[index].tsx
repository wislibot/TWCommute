import { GeoJSONSource, Layer } from "@maplibre/maplibre-react-native";
import { useLocalSearchParams } from "expo-router";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { ScrollView, StyleSheet, View } from "react-native";
import { LegList } from "@/components/leg-list";
import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { TransitMap } from "@/components/transit-map";
import { DEFAULT_CENTER } from "@/lib/config";
import { boundsOf, itineraryGeoJson } from "@/lib/geo";
import { usePlan } from "@/lib/hooks";
import { useDraft } from "@/lib/store";

export default function ItineraryScreen() {
  const { t } = useTranslation();
  const { index } = useLocalSearchParams<{ index: string }>();
  const plan = usePlan(useDraft((s) => s.submitted));
  const itinerary = plan.data?.itineraries[Number(index)];
  const geojson = useMemo(() => (itinerary ? itineraryGeoJson(itinerary) : null), [itinerary]);
  const bounds = useMemo(
    () => boundsOf(geojson?.features.flatMap((f) => f.geometry.coordinates as [number, number][]) ?? []),
    [geojson],
  );

  if (!itinerary || !geojson) {
    return (
      <ThemedView style={styles.center}>
        <ThemedText>{t("results.noRoutes")}</ThemedText>
      </ThemedView>
    );
  }
  return (
    <ThemedView style={styles.flex}>
      <View style={styles.map}>
        <TransitMap center={DEFAULT_CENTER} bounds={bounds} showUser>
          <GeoJSONSource id="route" data={geojson}>
            <Layer
              id="route-line"
              type="line"
              layout={{ "line-cap": "round", "line-join": "round" }}
              paint={{ "line-color": ["get", "color"], "line-width": 5 }}
            />
          </GeoJSONSource>
        </TransitMap>
      </View>
      <ScrollView contentContainerStyle={styles.legs}>
        <LegList itinerary={itinerary} />
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  map: { height: "40%" },
  legs: { padding: 16 },
});
