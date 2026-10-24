import { router } from "expo-router";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, FlatList, StyleSheet } from "react-native";
import { BikeOutageNotice } from "@/components/bike-outage";
import { DataCredit } from "@/components/data-credit";
import { PrimaryButton } from "@/components/form";
import { ItineraryCard } from "@/components/itinerary-card";
import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { errorText } from "@/lib/api";
import { bboxAround, bikesOutOfService } from "@/lib/geo";
import { useBikes, usePlan } from "@/lib/hooks";
import { useDraft } from "@/lib/store";

export default function ResultsScreen() {
  const { t } = useTranslation();
  const request = useDraft((s) => s.submitted);
  const plan = usePlan(request);
  // Without this, YouBike options just vanish while the stations at the start are shut (e.g. a typhoon).
  const bikes = useBikes(request && request.bikeShare !== false ? bboxAround(request.from) : null);
  const outage = bikes.data !== undefined && bikesOutOfService(bikes.data.stations);

  if (plan.isLoading) {
    return (
      <ThemedView style={styles.center}>
        <ActivityIndicator />
      </ThemedView>
    );
  }
  if (plan.isError) {
    return (
      <ThemedView style={styles.center}>
        <ThemedText>{t(errorText(plan.error))}</ThemedText>
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
        ListHeaderComponent={outage ? <BikeOutageNotice /> : null}
        ListEmptyComponent={<ThemedText style={styles.empty}>{t("results.noRoutes")}</ThemedText>}
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
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 16, padding: 24 },
  list: { padding: 16, gap: 12 },
  empty: { textAlign: "center", padding: 24 },
});
