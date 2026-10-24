import { Stack, useLocalSearchParams } from "expo-router";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ModeChip } from "@/components/badges";
import { DataCredit } from "@/components/data-credit";
import { DepartureRow } from "@/components/departure-row";
import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { Group, Row } from "@/components/ui";
import { useTheme } from "@/hooks/use-theme";
import { errorText } from "@/lib/api";
import { useDepartures } from "@/lib/hooks";

/** A stop's departure board: the stop as a large title, then the next hour's departures. */
export default function StopScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const board = useDepartures(id);
  const now = Date.now();
  const stop = board.data?.stop;
  const departures = board.data?.departures ?? [];

  if (board.isLoading) {
    return (
      <ThemedView style={styles.center}>
        <ActivityIndicator color={theme.textSecondary} />
      </ThemedView>
    );
  }
  return (
    <ThemedView style={styles.flex}>
      <Stack.Screen options={{ title: "" }} />
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 16 }]}>
        <View style={styles.title}>
          <ThemedText type="title" numberOfLines={2}>
            {stop?.name ?? t("stop.departures")}
          </ThemedText>
          <View style={styles.chips}>
            {stop?.modes.map((m) => (
              <ModeChip key={m} mode={m} />
            ))}
            {stop?.code && (
              <ThemedText type="footnote" themeColor="textSecondary">
                {stop.code}
              </ThemedText>
            )}
          </View>
        </View>
        <Group header={t("stop.departures")}>
          {departures.map((d, i) => (
            <DepartureRow key={`${d.routeId}-${d.headsign}-${d.scheduled}`} dep={d} now={now} first={i === 0} />
          ))}
          {departures.length === 0 && (
            <Row
              first
              title={
                <ThemedText themeColor="textSecondary">
                  {board.isError ? t(errorText(board.error)) : t("stop.noDepartures")}
                </ThemedText>
              }
            />
          )}
        </Group>
        <DataCredit />
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  content: { padding: 16, gap: 20 },
  title: { gap: 8, paddingHorizontal: 4 },
  chips: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6 },
});
