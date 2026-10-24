import type { Itinerary } from "@twc/contracts";
import { Fragment } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, StyleSheet, View } from "react-native";
import { Icon } from "@/components/icon";
import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";
import { durationMinutes, formatDistance, formatTime, splitDuration } from "@/lib/format";
import { useLocale } from "@/lib/hooks";
import { legKey } from "@/lib/keys";
import { DockRiskBadge, ModeChip, RealtimeBadge, ServiceAlertBadge, TpassBadge } from "./badges";

export function DurationText({ seconds, type = "headline" }: { seconds: number; type?: "headline" | "footnote" }) {
  const { t } = useTranslation();
  const { hours, minutes } = splitDuration(seconds);
  return (
    <ThemedText type={type} themeColor={type === "footnote" ? "textSecondary" : "text"}>
      {hours > 0 ? `${hours} h ` : ""}
      {t("common.minutes", { count: minutes })}
    </ThemedText>
  );
}

/** The trip as a row of steps: walking minutes, then route chips, joined by chevrons. */
export function LegSequence({ itinerary }: { itinerary: Itinerary }) {
  const theme = useTheme();
  const steps = itinerary.legs.filter((l) => l.mode !== "WALK" || l.durationSeconds >= 60);
  return (
    <View style={styles.sequence}>
      {steps.map((leg, i) => (
        <Fragment key={legKey(leg)}>
          {i > 0 && <Icon name="chevron" size={12} color={theme.textTertiary} />}
          {leg.mode === "WALK" ? (
            <View style={styles.walk}>
              <Icon name="walk" size={16} color={theme.textSecondary} />
              <ThemedText type="footnote" themeColor="textSecondary">
                {durationMinutes(leg.durationSeconds)}
              </ThemedText>
            </View>
          ) : (
            <ModeChip mode={leg.mode} label={leg.route?.shortName} color={leg.route?.color} />
          )}
        </Fragment>
      ))}
    </View>
  );
}

/**
 * One route option: times and duration, the steps, where it starts, and quiet status pills
 * (live or timetable, may not run, TPASS, dock risk).
 */
export function ItineraryCard({ itinerary, onPress }: { itinerary: Itinerary; onPress?: () => void }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const locale = useLocale();
  const live = itinerary.legs.some((l) => l.realtime === "live");
  const risk = itinerary.legs.find((l) => l.dockRisk && l.dockRisk.level !== "low")?.dockRisk;
  const firstRide = itinerary.legs.find((l) => l.mode !== "WALK");
  const walked = itinerary.walkDistanceMeters;
  const details = [
    firstRide &&
      t("results.leavesFrom", { time: formatTime(firstRide.start.scheduled, locale), place: firstRide.from.name }),
    t("results.transfers", { count: itinerary.transfers }),
    walked >= 50 ? t("results.walk", { distance: formatDistance(walked) }) : null,
  ].filter(Boolean);

  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? "button" : undefined}
      style={({ pressed }) => [styles.card, { backgroundColor: theme.surface, opacity: pressed ? 0.75 : 1 }]}
    >
      <View style={styles.top}>
        <ThemedText type="title3">
          {formatTime(itinerary.start, locale)} – {formatTime(itinerary.end, locale)}
        </ThemedText>
        <DurationText seconds={itinerary.durationSeconds} />
      </View>
      <LegSequence itinerary={itinerary} />
      <ThemedText type="footnote" themeColor="textSecondary" numberOfLines={2}>
        {details.join(" · ")}
      </ThemedText>
      <View style={styles.badges}>
        <RealtimeBadge realtime={live ? "live" : "scheduled"} />
        {itinerary.legs.some((l) => l.serviceAlert) && <ServiceAlertBadge />}
        {itinerary.tpass && <TpassBadge tpass={itinerary.tpass} />}
        {risk && <DockRiskBadge risk={risk} />}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 14, padding: 16, gap: 10 },
  top: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", gap: 8 },
  sequence: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6 },
  walk: { flexDirection: "row", alignItems: "center", gap: 1 },
  badges: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6 },
});
