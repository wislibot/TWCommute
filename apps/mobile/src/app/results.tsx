import { router } from "expo-router";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, FlatList, StyleSheet, View } from "react-native";
import { BikeOutageNotice } from "@/components/bike-outage";
import { DataCredit } from "@/components/data-credit";
import { PrimaryButton } from "@/components/form";
import { Icon } from "@/components/icon";
import { ItineraryCard } from "@/components/itinerary-card";
import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { useTheme } from "@/hooks/use-theme";
import { errorText } from "@/lib/api";
import { bboxAround, bikesOutOfService } from "@/lib/geo";
import { useBikes, usePlan } from "@/lib/hooks";
import { useDraft } from "@/lib/store";

/** Route options as cards under a short summary of the trip. */
export default function ResultsScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const request = useDraft((s) => s.submitted);
  const plan = usePlan(request);
  // Without this, YouBike options just vanish while the stations at the start are shut (e.g. a typhoon).
  const bikes = useBikes(request && request.bikeShare !== false ? bboxAround(request.from) : null);
  const outage = bikes.data !== undefined && bikesOutOfService(bikes.data.stations);

  if (plan.isLoading) {
    return (
      <ThemedView style={styles.center}>
        <ActivityIndicator color={theme.textSecondary} />
      </ThemedView>
    );
  }
  if (plan.isError) {
    return (
      <ThemedView style={styles.center}>
        <ThemedText style={styles.centerText}>{t(errorText(plan.error))}</ThemedText>
        <PrimaryButton title={t("common.retry")} onPress={() => plan.refetch()} />
      </ThemedView>
    );
  }
  return (
    <ThemedView style={styles.flex}>
      <FlatList
        data={plan.data?.itineraries ?? []}
        keyExtractor={(it) => it.id}
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          <View style={styles.header}>
            {request && (
              <View style={[styles.summary, { backgroundColor: theme.surface }]}>
                <View style={styles.place}>
                  <Icon name="origin" size={16} color={theme.tint} />
                  <ThemedText numberOfLines={1} style={styles.flexShrink}>
                    {request.from.label ?? t("common.currentLocation")}
                  </ThemedText>
                </View>
                <View style={[styles.divider, { backgroundColor: theme.border }]} />
                <View style={styles.place}>
                  <Icon name="pin" size={16} color={theme.danger} />
                  <ThemedText numberOfLines={1} style={styles.flexShrink}>
                    {request.to.label ?? ""}
                  </ThemedText>
                </View>
              </View>
            )}
            {outage && <BikeOutageNotice />}
          </View>
        }
        ListEmptyComponent={
          <ThemedText themeColor="textSecondary" style={styles.centerText}>
            {t("results.noRoutes")}
          </ThemedText>
        }
        ListFooterComponent={<DataCredit />}
        renderItem={({ item, index }) => (
          <ItineraryCard
            itinerary={item}
            onPress={() => router.push({ pathname: "/itinerary/[index]", params: { index: String(index) } })}
          />
        )}
      />
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  flexShrink: { flexShrink: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 16, padding: 24 },
  centerText: { textAlign: "center", padding: 24 },
  list: { padding: 16, gap: 12 },
  header: { gap: 12 },
  summary: { borderRadius: 14, paddingHorizontal: 14, paddingVertical: 10, gap: 8 },
  place: { flexDirection: "row", alignItems: "center", gap: 10 },
  divider: { height: StyleSheet.hairlineWidth, marginLeft: 26 },
});
