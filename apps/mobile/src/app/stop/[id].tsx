import { Stack, useLocalSearchParams } from "expo-router";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, FlatList, StyleSheet, View } from "react-native";
import { ModeChip, RealtimeBadge } from "@/components/badges";
import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { useTheme } from "@/hooks/use-theme";
import { formatTime, minutesUntil } from "@/lib/format";
import { useDepartures, useLocale } from "@/lib/hooks";

export default function StopScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const locale = useLocale();
  const { id } = useLocalSearchParams<{ id: string }>();
  const board = useDepartures(id);

  if (board.isLoading) {
    return (
      <ThemedView style={styles.center}>
        <ActivityIndicator />
      </ThemedView>
    );
  }
  return (
    <ThemedView style={styles.flex}>
      <Stack.Screen options={{ title: board.data?.stop.name ?? t("stop.departures") }} />
      <FlatList
        data={board.data?.departures ?? []}
        keyExtractor={(d, i) => `${d.routeId}-${d.scheduled}-${i}`}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <ThemedText themeColor="textSecondary" style={styles.empty}>
            {board.isError ? t("errors.network") : t("stop.noDepartures")}
          </ThemedText>
        }
        renderItem={({ item }) => (
          <View style={[styles.row, { borderBottomColor: theme.border }]}>
            <ModeChip mode={item.mode} label={item.routeShortName} />
            <View style={styles.flex}>
              {item.headsign && (
                <ThemedText numberOfLines={1}>{t("leg.towards", { headsign: item.headsign })}</ThemedText>
              )}
              <RealtimeBadge realtime={item.realtime} />
            </View>
            <View style={styles.time}>
              {item.live && item.live.etaSeconds !== null ? (
                <ThemedText type="smallBold" style={{ color: theme.success }}>
                  {item.live.etaSeconds < 60
                    ? t("realtime.arriving")
                    : t("realtime.arrivesIn", { minutes: minutesUntil(item.live.etaSeconds) })}
                </ThemedText>
              ) : (
                <ThemedText type="smallBold">{formatTime(item.estimated ?? item.scheduled, locale)}</ThemedText>
              )}
            </View>
          </View>
        )}
      />
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  list: { padding: 16 },
  empty: { textAlign: "center", padding: 24 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  time: { alignItems: "flex-end", minWidth: 80 },
});
