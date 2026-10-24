import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, StyleSheet } from "react-native";
import { Icon } from "@/components/icon";
import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";

/**
 * Says why trips have no YouBike when the stations around are closed or suspended: one quiet line
 * that opens to the full explanation, so it never outweighs the search field.
 */
export function BikeOutageNotice() {
  const { t } = useTranslation();
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ expanded: open }}
      onPress={() => setOpen((o) => !o)}
      style={[styles.notice, { backgroundColor: `${theme.notice}1F` }]}
    >
      <Icon name="warning" size={16} color={theme.notice} style={styles.icon} />
      <ThemedText type="footnote" style={styles.text} numberOfLines={open ? undefined : 1}>
        {open ? t("bike.outage") : t("bike.outageShort")}
      </ThemedText>
      {!open && (
        <ThemedText type="footnote" style={{ color: theme.tint }}>
          {t("common.details")}
        </ThemedText>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  notice: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  icon: { marginTop: 1 },
  text: { flex: 1 },
});
