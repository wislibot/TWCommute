import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native";
import { ThemedText } from "@/components/themed-text";

/**
 * Source credit required by the TDX data license (資料授權利用條款 §5-2): wherever TDX data is
 * shown, name 「交通部運輸資料流通服務平臺」. Without it the data counts as unlicensed.
 */
export function DataCredit() {
  const { t } = useTranslation();
  return (
    <ThemedText type="small" themeColor="textSecondary" style={styles.credit}>
      {t("common.dataCredit")}
    </ThemedText>
  );
}

const styles = StyleSheet.create({
  credit: { fontSize: 11, lineHeight: 16, textAlign: "center", paddingVertical: 12 },
});
