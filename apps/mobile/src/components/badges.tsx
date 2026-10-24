import type { DockRisk, LegMode, Realtime, TpassCoverage } from "@twc/contracts";
import { useTranslation } from "react-i18next";
import { StyleSheet, Text, View } from "react-native";
import { Icon, MODE_ICONS } from "@/components/icon";
import { useTheme } from "@/hooks/use-theme";
import { legColor, textOn } from "@/lib/modes";

/** A route chip in the mode's (or route's own) color: mode icon plus route name. */
export function ModeChip({
  mode,
  label,
  color,
  large,
}: {
  mode: LegMode;
  label?: string;
  color?: string;
  large?: boolean;
}) {
  const { t } = useTranslation();
  const bg = legColor(mode, color);
  const fg = textOn(bg);
  return (
    <View style={[styles.chip, large && styles.chipLarge, { backgroundColor: bg }]}>
      <Icon name={MODE_ICONS[mode]} size={large ? 16 : 13} color={fg} />
      <Text style={[styles.chipText, large && styles.chipTextLarge, { color: fg }]} numberOfLines={1}>
        {label ?? t(`leg.${mode}`)}
      </Text>
    </View>
  );
}

/** A quiet tinted pill, the iOS way of labelling status without boxes. */
function Pill({ text, color }: { text: string; color: string }) {
  return (
    <View style={[styles.pill, { backgroundColor: `${color.slice(0, 7)}1F` }]}>
      <Text style={[styles.pillText, { color }]} numberOfLines={1}>
        {text}
      </Text>
    </View>
  );
}

/** Every time shown in the app says whether it is live or from the timetable. */
export function RealtimeBadge({ realtime }: { realtime: Realtime }) {
  const { t } = useTranslation();
  const theme = useTheme();
  return realtime === "live" ? (
    <Pill text={`● ${t("realtime.live")}`} color={theme.success} />
  ) : (
    <Text style={[styles.plain, { color: theme.textSecondary }]}>{t("realtime.scheduled")}</Text>
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
  return <Pill text={t(`tpass.${tpass.coverage}`)} color={color} />;
}

/** The timetable lists this bus, but live data says it may not run (see ServiceAlert). */
export function ServiceAlertBadge() {
  const { t } = useTranslation();
  const theme = useTheme();
  return <Pill text={t("alert.mayNotRun")} color={theme.warning} />;
}

export function DockRiskBadge({ risk }: { risk: DockRisk }) {
  const { t } = useTranslation();
  const theme = useTheme();
  if (risk.level === "low") return null;
  return <Pill text={t(`risk.${risk.level}`)} color={risk.level === "high" ? theme.danger : theme.warning} />;
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    maxWidth: 150,
  },
  chipLarge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, gap: 4 },
  chipText: { fontSize: 13, lineHeight: 17, fontWeight: "700" },
  chipTextLarge: { fontSize: 16, lineHeight: 20 },
  pill: { alignSelf: "flex-start", borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
  pillText: { fontSize: 12, lineHeight: 16, fontWeight: "600" },
  plain: { fontSize: 12, lineHeight: 16, fontWeight: "500" },
});
