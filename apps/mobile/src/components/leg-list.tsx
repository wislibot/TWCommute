import type { Itinerary, Leg } from "@twc/contracts";
import { useTranslation } from "react-i18next";
import { StyleSheet, View } from "react-native";
import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";
import { formatDistance, formatTime, minutesBetween, minutesUntil } from "@/lib/format";
import { useLocale } from "@/lib/hooks";
import { legKey } from "@/lib/keys";
import { legColor } from "@/lib/modes";
import { DockRiskBadge, ModeChip, RealtimeBadge } from "./badges";
import { DurationText } from "./itinerary-card";

function LegTimes({ leg }: { leg: Leg }) {
  const locale = useLocale();
  const theme = useTheme();
  const delayed = leg.start.estimated && leg.start.estimated !== leg.start.scheduled;
  return (
    <View style={styles.timeCol}>
      <ThemedText type="smallBold" style={delayed ? { color: theme.warning } : undefined}>
        {formatTime(leg.start.estimated ?? leg.start.scheduled, locale)}
      </ThemedText>
      {delayed && (
        <ThemedText type="small" themeColor="textSecondary" style={styles.strike}>
          {formatTime(leg.start.scheduled, locale)}
        </ThemedText>
      )}
    </View>
  );
}

function LegRow({ leg }: { leg: Leg }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const color = legColor(leg.mode, leg.route?.color);
  const transit = leg.mode !== "WALK" && leg.mode !== "BICYCLE";
  return (
    <View style={styles.leg}>
      <LegTimes leg={leg} />
      <View style={[styles.rail, { backgroundColor: color, opacity: leg.mode === "WALK" ? 0.4 : 1 }]} />
      <View style={styles.body}>
        <View style={styles.headline}>
          <ModeChip mode={leg.mode} label={leg.route?.shortName} color={leg.route?.color} />
          {transit && <RealtimeBadge realtime={leg.realtime} />}
          {leg.dockRisk && <DockRiskBadge risk={leg.dockRisk} />}
        </View>
        {leg.rentedBike && leg.from.bikeStation && (
          <ThemedText type="small">{t("leg.pickUpBike", { station: leg.from.bikeStation.name })}</ThemedText>
        )}
        {transit && <ThemedText type="small">{leg.from.name}</ThemedText>}
        {leg.headsign && (
          <ThemedText type="small" themeColor="textSecondary">
            {t("leg.towards", { headsign: leg.headsign })}
          </ThemedText>
        )}
        {leg.live && leg.live.etaSeconds !== null && (
          <ThemedText type="smallBold" style={{ color: theme.success }}>
            {leg.live.etaSeconds < 60
              ? t("realtime.arriving")
              : t("realtime.arrivesIn", { minutes: minutesUntil(leg.live.etaSeconds) })}
            {leg.live.isLastBus ? ` · ${t("realtime.lastBus")}` : ""}
          </ThemedText>
        )}
        {leg.mode === "WALK" && (
          <ThemedText type="small" themeColor="textSecondary">
            {t("results.walk", { distance: formatDistance(leg.distanceMeters) })}
          </ThemedText>
        )}
        {leg.dockRisk?.reasons.map((r) => (
          <ThemedText
            key={r}
            type="small"
            style={{ color: leg.dockRisk?.level === "high" ? theme.danger : theme.warning }}
          >
            {t(`risk.${r}`)}
          </ThemedText>
        ))}
        {leg.dockRisk?.backup && (
          <ThemedText type="small">{t("risk.backup", { station: leg.dockRisk.backup.name })}</ThemedText>
        )}
        {leg.rentedBike && leg.to.bikeStation && (
          <ThemedText type="small">{t("leg.returnBike", { station: leg.to.bikeStation.name })}</ThemedText>
        )}
        <DurationText seconds={leg.durationSeconds} />
      </View>
    </View>
  );
}

function StayRow({ place, minutes }: { place: string; minutes: number }) {
  const { t } = useTranslation();
  const theme = useTheme();
  return (
    <View style={[styles.stay, { borderColor: theme.tint }]}>
      <ThemedText type="smallBold" style={{ color: theme.tint }}>
        {t("leg.stayAt", { place, minutes })}
      </ThemedText>
    </View>
  );
}

/** Step-by-step itinerary, with the user's via stays shown between legs. */
export function LegList({ itinerary }: { itinerary: Itinerary }) {
  const locale = useLocale();
  const last = itinerary.legs.at(-1);
  return (
    <View style={styles.list}>
      {itinerary.legs.map((leg, i) => {
        const next = itinerary.legs[i + 1];
        const stay =
          leg.to.viaIndex !== undefined && next ? minutesBetween(leg.end.scheduled, next.start.scheduled) : null;
        return (
          <View key={legKey(leg)}>
            <LegRow leg={leg} />
            {stay !== null && stay > 0 && <StayRow place={leg.to.name} minutes={stay} />}
          </View>
        );
      })}
      {last && (
        <View style={styles.leg}>
          <View style={styles.timeCol}>
            <ThemedText type="smallBold">{formatTime(last.end.estimated ?? last.end.scheduled, locale)}</ThemedText>
          </View>
          <View style={styles.body}>
            <ThemedText type="smallBold">{last.to.name}</ThemedText>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: 4 },
  leg: { flexDirection: "row", gap: 10, paddingVertical: 8 },
  timeCol: { width: 52, alignItems: "flex-end" },
  strike: { textDecorationLine: "line-through" },
  rail: { width: 5, borderRadius: 3 },
  body: { flex: 1, gap: 4 },
  headline: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6 },
  stay: { marginLeft: 62, marginVertical: 6, borderLeftWidth: 3, paddingLeft: 10, paddingVertical: 6 },
});
