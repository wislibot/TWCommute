import { useTranslation } from "react-i18next";
import { StyleSheet, View } from "react-native";
import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";

/** Says why trips have no YouBike when the stations around are closed or suspended. */
export function BikeOutageNotice() {
  const { t } = useTranslation();
  const theme = useTheme();
  return (
    <View accessibilityRole="alert" style={[styles.box, { borderColor: theme.warning }]}>
      <ThemedText type="small" themeColor="warning">
        {t("bike.outage")}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8 },
});
