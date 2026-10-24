import type { BikeStation, StopSummary } from "@twc/contracts";
import { router } from "expo-router";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, StyleSheet, View } from "react-native";
import { DepartureRow } from "@/components/departure-row";
import { Icon, MODE_ICONS } from "@/components/icon";
import { ThemedText } from "@/components/themed-text";
import { Group, Row } from "@/components/ui";
import { useTheme } from "@/hooks/use-theme";
import { groupStopsByName, nextByRoute } from "@/lib/departures";
import { formatDistance } from "@/lib/format";
import { bikeLevel, distanceMeters } from "@/lib/geo";
import { useBoards, useLocale } from "@/lib/hooks";

/** Stop boards fetched for the home screen; stops sharing a name count once each. */
const MAX_BOARDS = 6;
const MAX_PLACES = 4;
const ROUTES_PER_PLACE = 4;

/** The places nearby, each with the next departure of its routes, nearest place first. */
export function NearbyDepartures({ stops }: { stops: readonly StopSummary[] }) {
  const { t } = useTranslation();
  const groups = useMemo(() => groupStopsByName(stops, MAX_BOARDS).slice(0, MAX_PLACES), [stops]);
  const ids = groups.flatMap((g) => g.ids);
  const boards = useBoards(ids);
  const now = Date.now();

  return (
    <>
      {groups.map((g) => {
        const results = g.ids.map((id) => boards[ids.indexOf(id)]);
        const departures = nextByRoute(
          results.flatMap((r) => r?.data?.departures ?? []),
          now,
          ROUTES_PER_PLACE,
        );
        const loading = results.some((r) => r?.isLoading);
        return (
          <Group
            key={g.name}
            raised
            header={<PlaceHeader name={g.name} distance={g.distanceMeters} stopId={g.ids[0]} mode={g.modes[0]} />}
          >
            {departures.map((d, i) => (
              <DepartureRow key={`${d.routeId}-${d.headsign}-${d.scheduled}`} dep={d} now={now} first={i === 0} />
            ))}
            {departures.length === 0 && (
              <Row
                first
                title={
                  <ThemedText themeColor="textSecondary">
                    {loading ? t("common.loading") : t("stop.noDepartures")}
                  </ThemedText>
                }
              />
            )}
          </Group>
        );
      })}
    </>
  );
}

function PlaceHeader({
  name,
  distance,
  stopId,
  mode,
}: {
  name: string;
  distance?: number;
  stopId?: string;
  mode?: StopSummary["modes"][number];
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => stopId && router.push({ pathname: "/stop/[id]", params: { id: stopId } })}
      style={({ pressed }) => [styles.placeHeader, pressed && { opacity: 0.6 }]}
    >
      {mode && <Icon name={MODE_ICONS[mode]} size={16} color={theme.textSecondary} />}
      <ThemedText type="headline" numberOfLines={1} style={styles.flexShrink}>
        {name}
      </ThemedText>
      {distance !== undefined && (
        <ThemedText type="small" themeColor="textSecondary">
          {formatDistance(distance)}
        </ThemedText>
      )}
      <Icon name="chevron" size={14} color={theme.textTertiary} />
    </Pressable>
  );
}

const LEVEL_COLORS = { none: "#FF3B30", few: "#FF9500", ok: "#34C759", unknown: "#8E8E93" } as const;

/** The nearest YouBike stations with bikes to rent and free docks. */
export function NearbyBikes({
  stations,
  from,
}: {
  stations: readonly BikeStation[] | undefined;
  from: { lat: number; lon: number } | null;
}) {
  const { t } = useTranslation();
  const locale = useLocale();
  const nearest = useMemo(() => {
    if (!stations) return [];
    return stations
      .map((s) => ({ s, d: from ? distanceMeters(from, s) : null }))
      .sort((a, b) => (a.d ?? 0) - (b.d ?? 0))
      .slice(0, 12);
  }, [stations, from]);

  if (!stations) {
    return (
      <ThemedText type="small" themeColor="textSecondary" style={styles.hint}>
        {t("bike.zoomIn")}
      </ThemedText>
    );
  }
  return (
    <Group header={t("bike.nearby")} raised>
      {nearest.map(({ s, d }, i) => {
        const level = bikeLevel(s);
        const active = s.status === "active";
        return (
          <Row
            key={s.id}
            first={i === 0}
            leading={
              <View style={[styles.bikeIcon, { backgroundColor: LEVEL_COLORS[level] }]}>
                <Icon name="bike" size={16} color="#FFFFFF" />
              </View>
            }
            title={locale === "en" ? (s.name.en ?? s.name.zh) : s.name.zh}
            subtitle={d === null ? undefined : formatDistance(d)}
            trailing={
              active ? (
                <View style={styles.counts}>
                  <Count value={s.bikes} label={t("bike.bikes")} />
                  <Count value={s.docks} label={t("bike.docks")} />
                </View>
              ) : (
                <ThemedText type="footnote" themeColor="textSecondary">
                  {t("bike.closed")}
                </ThemedText>
              )
            }
          />
        );
      })}
      {nearest.length === 0 && (
        <Row first title={<ThemedText themeColor="textSecondary">{t("bike.none")}</ThemedText>} />
      )}
    </Group>
  );
}

function Count({ value, label }: { value: number | null; label: string }) {
  return (
    <View style={styles.count}>
      <ThemedText type="headline">{value ?? "–"}</ThemedText>
      <ThemedText type="caption" themeColor="textSecondary">
        {label}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  flexShrink: { flexShrink: 1 },
  placeHeader: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 4, paddingBottom: 8 },
  hint: { textAlign: "center", padding: 16 },
  bikeIcon: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  counts: { flexDirection: "row", gap: 14 },
  count: { alignItems: "center", minWidth: 40 },
});
