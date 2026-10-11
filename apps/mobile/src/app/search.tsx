import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { FlatList, Pressable, StyleSheet, TextInput, View } from "react-native";
import { ModeChip } from "@/components/badges";
import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { useTheme } from "@/hooks/use-theme";
import { useLocale, useSearch } from "@/lib/hooks";
import { type PlaceTarget, useDraft } from "@/lib/store";

export default function SearchScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const locale = useLocale();
  const { target = "to" } = useLocalSearchParams<{ target?: PlaceTarget }>();
  const setPlace = useDraft((s) => s.setPlace);
  const [q, setQ] = useState("");
  const results = useSearch(q, locale);

  return (
    <ThemedView style={styles.flex}>
      <View style={styles.header}>
        <TextInput
          autoFocus
          value={q}
          onChangeText={setQ}
          placeholder={t("plan.toPlaceholder")}
          placeholderTextColor={theme.textSecondary}
          style={[styles.input, { backgroundColor: theme.backgroundElement, color: theme.text }]}
          returnKeyType="search"
          accessibilityLabel={t("common.search")}
        />
        {target === "from" && (
          <Pressable
            onPress={() => {
              setPlace("from", null);
              router.back();
            }}
          >
            <ThemedText style={{ color: theme.tint }}>📍 {t("common.currentLocation")}</ThemedText>
          </Pressable>
        )}
        <Pressable onPress={() => router.push({ pathname: "/pick", params: { target } })}>
          <ThemedText style={{ color: theme.tint }}>🗺 {t("common.search")} · Map</ThemedText>
        </Pressable>
      </View>
      <FlatList
        data={results.data?.results ?? []}
        keyExtractor={(r) => r.id}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={
          results.isError ? (
            <ThemedText type="small" themeColor="textSecondary" style={styles.empty}>
              {t("errors.network")}
            </ThemedText>
          ) : null
        }
        renderItem={({ item }) => (
          <Pressable
            style={[styles.row, { borderBottomColor: theme.border }]}
            onPress={() => {
              setPlace(target, { lat: item.lat, lon: item.lon, label: item.name, stopId: item.id });
              router.back();
            }}
          >
            {item.modes[0] && <ModeChip mode={item.modes[0]} />}
            <ThemedText numberOfLines={1} style={styles.flex}>
              {item.name}
            </ThemedText>
          </Pressable>
        )}
      />
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: { padding: 16, gap: 12 },
  input: { borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  empty: { padding: 16 },
});
