import type { Itinerary, Leg } from "@twc/contracts";
import { useTranslation } from "react-i18next";
import { StyleSheet, View } from "react-native";
import { Icon } from "@/components/icon";
import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";
import { durationMinutes, formatDistance, formatTime, minutesBetween, minutesUntil } from "@/lib/format";
import { useLocale } from "@/lib/hooks";
import { legKey } from "@/lib/keys";
import { legColor } from "@/lib/modes";
import { DockRiskBadge, ModeChip, RealtimeBadge, ServiceAlertBadge } from "./badges";

function LegTime({ leg }: { leg: Leg }) {
  const locale = useLocale();
  const theme = useTheme();
  const delayed = leg.start.estimated && leg.start.estimated !== leg.start.scheduled;
  return (
    <View style={styles.timeCol}>
      <ThemedText
        type={leg.mode === "WALK" ? "footnote" : "headline"}
        themeColor={leg.mode === "WALK" ? "textSecondary" : "text"}
        style={delayed ? { color: theme.warning } : undefined}
      >
        {formatTime(leg.start.estimated ?? leg.start.scheduled, locale)}
      </ThemedText>
      {delayed && (
        <ThemedText type="caption" themeColor="textSecondary" style={styles.strike}>
          {formatTime(leg.start.scheduled, locale)}
        </ThemedText>
      )}
    </View>
  );
}

/** The colored line down the left: solid while riding, faint while walking, a dot at each stop. */
function Rail({ leg }: { leg: Leg }) {
  const theme = useTheme();
  const color = legColor(leg.mode, leg.route?.color);
  const walk = leg.mode === "WALK";
  return (
    <View style={styles.railCol}>
      <View style={[styles.node, { borderColor: walk ? theme.textTertiary : color, backgroundColor: theme.surface }]} />
      <View style={[styles.rail, { backgroundColor: walk ? theme.textTertiary : color, width: walk ? 2 : 5 }]} />
    </View>
  );
}

function LegRow({ leg }: { leg: Leg }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const transit = leg.mode !== "WALK" && leg.mode !== "BICYCLE";
  return (
    <View style={styles.leg}>
      <LegTime leg={leg} />
      <Rail leg={leg} />
      <View style={styles.body}>
        {leg.mode === "WALK" ? (
          <View style={styles.inline}>
            <Icon name="walk" size={16} color={theme.textSecondary} />
            <ThemedText type="small" themeColor="textSecondary">
              {t("results.walk", { distance: formatDistance(leg.distanceMeters) })} ·{" "}
              {t("common.minutes", { count: durationMinutes(leg.durationSeconds) })}
            </ThemedText>
          </View>
        ) : (
          <>
            <ThemedText type="headline">
              {leg.rentedBike && leg.from.bikeStation ? leg.from.bikeStation.name : leg.from.name}
            </ThemedText>
            <View style={styles.inline}>
              <ModeChip mode={leg.mode} label={leg.route?.shortName} color={leg.route?.color} />
              {leg.headsign && (
                <ThemedText type="small" themeColor="textSecondary" numberOfLines={1} style={styles.flexShrink}>
                  {t("leg.towards", { headsign: leg.headsign })}
                </ThemedText>
              )}
            </View>
            {leg.rentedBike && leg.from.bikeStation && (
              <ThemedText type="small">{t("leg.pickUpBike", { station: leg.from.bikeStation.name })}</ThemedText>
            )}
            <View style={styles.inline}>
              {transit && <RealtimeBadge realtime={leg.realtime} />}
              {leg.serviceAlert && <ServiceAlertBadge />}
              {leg.dockRisk && <DockRiskBadge risk={leg.dockRisk} />}
            </View>
            {leg.live && leg.live.etaSeconds !== null && (
              <ThemedText type="smallBold" style={{ color: theme.success }}>
                {leg.live.etaSeconds < 60
                  ? t("realtime.arriving")
                  : t("realtime.arrivesIn", { minutes: minutesUntil(leg.live.etaSeconds) })}
                {leg.live.isLastBus ? ` · ${t("realtime.lastBus")}` : ""}
              </ThemedText>
            )}
            {leg.serviceAlert && (
              <ThemedText type="footnote" style={{ color: theme.warning }}>
                {t(`alert.${leg.serviceAlert}`)}
              </ThemedText>
            )}
            {leg.dockRisk?.reasons.map((r) => (
              <ThemedText
                key={r}
                type="footnote"
                style={{ color: leg.dockRisk?.level === "high" ? theme.danger : theme.warning }}
              >
                {t(`risk.${r}`)}
              </ThemedText>
            ))}
            {leg.dockRisk?.backup && (
              <ThemedText type="footnote">{t("risk.backup", { station: leg.dockRisk.backup.name })}</ThemedText>
            )}
            {leg.rentedBike && leg.to.bikeStation && (
              <ThemedText type="small">{t("leg.returnBike", { station: leg.to.bikeStation.name })}</ThemedText>
            )}
            <ThemedText type="footnote" themeColor="textSecondary">
              {t("common.minutes", { count: durationMinutes(leg.durationSeconds) })}
              {transit ? ` · ${t("leg.getOffAt", { place: leg.to.name })}` : ""}
            </ThemedText>
          </>
        )}
      </View>
    </View>
  );
}

function StayRow({ place, minutes }: { place: string; minutes: number }) {
  const { t } = useTranslation();
  const theme = useTheme();
  return (
    <View style={[styles.stay, { backgroundColor: `${theme.tint.slice(0, 7)}1A` }]}>
      <Icon name="clock" size={16} color={theme.tint} />
      <ThemedText type="smallBold" style={{ color: theme.tint }}>
        {t("leg.stayAt", { place, minutes })}
      </ThemedText>
    </View>
  );
}

/** Step-by-step itinerary as a timeline, with the user's via stays shown between legs. */
export function LegList({ itinerary }: { itinerary: Itinerary }) {
  const locale = useLocale();
  const theme = useTheme();
  const last = itinerary.legs.at(-1);
  return (
    <View style={styles.list}>
      {itinerary.legs.map((leg, i) => {
        const next = itinerary.legs[i + 1];
        // Live times when known, so the stay matches the times shown on the rows.
        const stay =
          leg.to.viaIndex !== undefined && next
            ? minutesBetween(leg.end.estimated ?? leg.end.scheduled, next.start.estimated ?? next.start.scheduled)
            : null;
        return (
          <View key={legKey(leg)}>
            {/* A transfer inside one station is a "walk" of a few meters: not worth a step. */}
            {(leg.mode !== "WALK" || leg.distanceMeters >= 20) && <LegRow leg={leg} />}
            {stay !== null && stay > 0 && <StayRow place={leg.to.name} minutes={stay} />}
          </View>
        );
      })}
      {last && (
        <View style={styles.leg}>
          <View style={styles.timeCol}>
            <ThemedText type="headline">{formatTime(last.end.estimated ?? last.end.scheduled, locale)}</ThemedText>
          </View>
          <View style={styles.railCol}>
            <Icon name="pin" size={20} color={theme.danger} />
          </View>
          <View style={styles.body}>
            <ThemedText type="headline">{last.to.name}</ThemedText>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { paddingVertical: 4 },
  leg: { flexDirection: "row", gap: 10, minHeight: 56 },
  timeCol: { width: 52, alignItems: "flex-end", paddingTop: 1 },
  strike: { textDecorationLine: "line-through" },
  railCol: { width: 20, alignItems: "center" },
  node: { width: 14, height: 14, borderRadius: 7, borderWidth: 3, marginTop: 4 },
  rail: { flex: 1, borderRadius: 3, marginVertical: 2 },
  body: { flex: 1, gap: 4, paddingBottom: 18 },
  inline: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6 },
  flexShrink: { flexShrink: 1 },
  stay: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginLeft: 82,
    marginBottom: 14,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
});
