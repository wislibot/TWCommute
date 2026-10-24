import type { Departure } from "@twc/contracts";
import { useTranslation } from "react-i18next";
import { StyleSheet, View } from "react-native";
import { ModeChip, ServiceAlertBadge } from "@/components/badges";
import { ThemedText } from "@/components/themed-text";
import { Row } from "@/components/ui";
import { useTheme } from "@/hooks/use-theme";
import { minutesFromNow } from "@/lib/departures";
import { formatTime } from "@/lib/format";
import { useLocale } from "@/lib/hooks";

/**
 * One departure, Transit-style: the route chip, where it goes, and when it leaves as large minutes
 * (green when live) or, beyond an hour, the clock time. Used on the home screen and stop boards.
 */
export function DepartureRow({ dep, now, first }: { dep: Departure; now: number; first?: boolean }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const locale = useLocale();
  const live = dep.realtime === "live";
  const minutes = minutesFromNow(dep, now);
  const when =
    minutes > 60
      ? formatTime(dep.estimated ?? dep.scheduled, locale)
      : minutes === 0 && live
        ? t("realtime.arriving")
        : t("common.minutes", { count: minutes });
  // Bus numbers fit the chip; TRA "routes" are end-to-end names (屏東-七堵) that read better as the
  // title next to a plain "Train" chip.
  const longName = dep.mode === "RAIL" || (dep.routeShortName?.length ?? 0) > 6;
  const title = dep.headsign ? t("leg.towards", { headsign: dep.headsign }) : longName ? dep.routeShortName : null;
  return (
    <Row
      first={first}
      leading={
        <View style={styles.chip}>
          <ModeChip mode={dep.mode} label={longName ? undefined : dep.routeShortName} large />
        </View>
      }
      title={
        title ? (
          <ThemedText numberOfLines={1}>{title}</ThemedText>
        ) : (
          <ThemedText themeColor="textSecondary">{t(`leg.${dep.mode}`)}</ThemedText>
        )
      }
      subtitle={dep.serviceAlert ? <ServiceAlertBadge /> : undefined}
      trailing={
        <View style={styles.when}>
          <ThemedText type="headline" style={{ color: live ? theme.success : theme.text }}>
            {when}
          </ThemedText>
          <ThemedText type="caption" themeColor="textSecondary">
            {live ? `● ${t("realtime.live")}` : t("realtime.scheduled")}
          </ThemedText>
        </View>
      }
    />
  );
}

const styles = StyleSheet.create({
  chip: { marginRight: 12, minWidth: 56 },
  when: { alignItems: "flex-end" },
});
