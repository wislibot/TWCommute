import type { Itinerary } from "@twc/contracts";
import { useTranslation } from "react-i18next";
import { Pressable, StyleSheet, View } from "react-native";
import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";
import { formatTime, splitDuration } from "@/lib/format";
import { useLocale } from "@/lib/hooks";
import { legKey } from "@/lib/keys";
import { DockRiskBadge, ModeChip, RealtimeBadge, TpassBadge } from "./badges";

export function DurationText({ seconds }: { seconds: number }) {
  const { t } = useTranslation();
  const { hours, minutes } = splitDuration(seconds);
  return (
    <ThemedText type="smallBold">
      {hours > 0 ? `${hours} h ` : ""}
      {t("common.minutes", { count: minutes })}
    </ThemedText>
  );
}

export function ItineraryCard({ itinerary, onPress }: { itinerary: Itinerary; onPress: () => void }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const locale = useLocale();
  const transit = itinerary.legs.filter((l) => l.mode !== "WALK");
  const live = itinerary.legs.some((l) => l.realtime === "live");
  const risk = itinerary.legs.find((l) => l.dockRisk && l.dockRisk.level !== "low")?.dockRisk;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [styles.card, { backgroundColor: theme.backgroundElement, opacity: pressed ? 0.8 : 1 }]}
    >
      <View style={styles.row}>
        <ThemedText type="subtitle" style={styles.times}>
          {formatTime(itinerary.start, locale)}–{formatTime(itinerary.end, locale)}
        </ThemedText>
        <DurationText seconds={itinerary.durationSeconds} />
      </View>
      <View style={styles.chips}>
        {transit.map((leg) => (
          <ModeChip key={legKey(leg)} mode={leg.mode} label={leg.route?.shortName} color={leg.route?.color} />
        ))}
      </View>
      <View style={styles.row}>
        <ThemedText type="small" themeColor="textSecondary">
          {t("results.transfers", { count: itinerary.transfers })}
        </ThemedText>
        <View style={styles.badges}>
          <RealtimeBadge realtime={live ? "live" : "scheduled"} />
          {itinerary.tpass && <TpassBadge tpass={itinerary.tpass} />}
          {risk && <DockRiskBadge risk={risk} />}
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 14, padding: 14, gap: 10 },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 },
  times: { fontSize: 22, lineHeight: 28 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  badges: { flexDirection: "row", flexWrap: "wrap", gap: 6, justifyContent: "flex-end", flexShrink: 1 },
});
