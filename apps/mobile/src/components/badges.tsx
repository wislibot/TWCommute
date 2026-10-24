import type { DockRisk, LegMode, Realtime, TpassCoverage } from "@twc/contracts";
import { useTranslation } from "react-i18next";
import { StyleSheet, Text, View } from "react-native";
import { useTheme } from "@/hooks/use-theme";
import { legColor, textOn } from "@/lib/modes";

export function ModeChip({ mode, label, color }: { mode: LegMode; label?: string; color?: string }) {
  const { t } = useTranslation();
  const bg = legColor(mode, color);
  return (
    <View style={[styles.chip, { backgroundColor: bg }]}>
      <Text style={[styles.chipText, { color: textOn(bg) }]} numberOfLines={1}>
        {label ?? t(`leg.${mode}`)}
      </Text>
    </View>
  );
}

/** Every time shown in the app says whether it is live or from the timetable. */
export function RealtimeBadge({ realtime }: { realtime: Realtime }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const live = realtime === "live";
  return (
    <Text
      style={[
        styles.badge,
        { color: live ? theme.success : theme.textSecondary, borderColor: live ? theme.success : theme.border },
      ]}
    >
      {live ? `● ${t("realtime.live")}` : t("realtime.scheduled")}
    </Text>
  );
}

export function TpassBadge({ tpass }: { tpass: TpassCoverage }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const color = {
    covered: theme.success,
    partial: theme.warning,
    not_covered: theme.textSecondary,
    unknown: theme.textSecondary,
  }[tpass.coverage];
  return <Text style={[styles.badge, { color, borderColor: color }]}>{t(`tpass.${tpass.coverage}`)}</Text>;
}

/** The timetable lists this bus, but live data says it may not run (see ServiceAlert). */
export function ServiceAlertBadge() {
  const { t } = useTranslation();
  const theme = useTheme();
  return (
    <Text style={[styles.badge, { color: theme.warning, borderColor: theme.warning }]}>{t("alert.mayNotRun")}</Text>
  );
}

export function DockRiskBadge({ risk }: { risk: DockRisk }) {
  const { t } = useTranslation();
  const theme = useTheme();
  if (risk.level === "low") return null;
  const color = risk.level === "high" ? theme.danger : theme.warning;
  return <Text style={[styles.badge, { color, borderColor: color }]}>{t(`risk.${risk.level}`)}</Text>;
}

const styles = StyleSheet.create({
  chip: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, maxWidth: 140 },
  chipText: { fontSize: 13, fontWeight: "700" },
  badge: {
    fontSize: 12,
    fontWeight: "600",
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
    overflow: "hidden",
  },
});
