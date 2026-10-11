import { router } from "expo-router";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, FlatList, StyleSheet } from "react-native";
import { PrimaryButton } from "@/components/form";
import { ItineraryCard } from "@/components/itinerary-card";
import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { usePlan } from "@/lib/hooks";
import { useDraft } from "@/lib/store";

export default function ResultsScreen() {
  const { t } = useTranslation();
  const request = useDraft((s) => s.submitted);
  const plan = usePlan(request);

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
        <ThemedText>{t("errors.network")}</ThemedText>
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
        ListEmptyComponent={<ThemedText style={styles.empty}>{t("results.noRoutes")}</ThemedText>}
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
