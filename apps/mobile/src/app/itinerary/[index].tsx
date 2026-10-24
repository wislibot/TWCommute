import { GeoJSONSource, Layer } from "@maplibre/maplibre-react-native";
import { useLocalSearchParams } from "expo-router";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { DataCredit } from "@/components/data-credit";
import { DurationText, LegSequence } from "@/components/itinerary-card";
import { LegList } from "@/components/leg-list";
import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { TransitMap } from "@/components/transit-map";
import { useTheme } from "@/hooks/use-theme";
import { DEFAULT_CENTER } from "@/lib/config";
import { formatTime } from "@/lib/format";
import { boundsOf, itineraryGeoJson } from "@/lib/geo";
import { useLocale, usePlan } from "@/lib/hooks";
import { useDraft } from "@/lib/store";

/** One route: the map on top, then a card with the summary and the step-by-step timeline. */
export default function ItineraryScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const locale = useLocale();
  const insets = useSafeAreaInsets();
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
        <ThemedText themeColor="textSecondary">{t("results.noRoutes")}</ThemedText>
      </ThemedView>
    );
  }
  return (
    <ThemedView style={styles.flex}>
      <View style={styles.map}>
        <TransitMap center={DEFAULT_CENTER} bounds={bounds} showUser>
          <GeoJSONSource id="route" data={geojson}>
            <Layer
              id="route-casing"
              type="line"
              layout={{ "line-cap": "round", "line-join": "round" }}
              paint={{ "line-color": "#FFFFFF", "line-width": 8 }}
            />
            <Layer
              id="route-line"
              type="line"
              layout={{ "line-cap": "round", "line-join": "round" }}
              paint={{ "line-color": ["get", "color"], "line-width": 5 }}
            />
          </GeoJSONSource>
        </TransitMap>
      </View>
      <ScrollView
        style={[styles.sheet, { backgroundColor: theme.surface }]}
        contentContainerStyle={[styles.sheetContent, { paddingBottom: insets.bottom + 16 }]}
      >
        <View style={styles.summary}>
          <View style={styles.summaryTop}>
            <ThemedText type="subtitle">
              {formatTime(itinerary.start, locale)} – {formatTime(itinerary.end, locale)}
            </ThemedText>
            <DurationText seconds={itinerary.durationSeconds} />
          </View>
          <LegSequence itinerary={itinerary} />
        </View>
        <View style={[styles.divider, { backgroundColor: theme.border }]} />
        <LegList itinerary={itinerary} />
        <DataCredit />
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  map: { height: "38%" },
  sheet: { flex: 1, marginTop: -14, borderTopLeftRadius: 14, borderTopRightRadius: 14 },
  sheetContent: { padding: 16, gap: 14 },
  summary: { gap: 10 },
  summaryTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" },
  divider: { height: StyleSheet.hairlineWidth },
});
