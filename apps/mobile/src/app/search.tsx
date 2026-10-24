import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { FlatList, Pressable, StyleSheet, TextInput, View } from "react-native";
import { ModeChip } from "@/components/badges";
import { Icon } from "@/components/icon";
import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { Group, Row } from "@/components/ui";
import { useTheme } from "@/hooks/use-theme";
import { errorText } from "@/lib/api";
import { useLocale, useSearch } from "@/lib/hooks";
import { type PlaceTarget, useDraft } from "@/lib/store";

/** Place search: an iOS search field, shortcuts (current location, the map), then matching stops. */
export default function SearchScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const locale = useLocale();
  const { target = "to" } = useLocalSearchParams<{ target?: PlaceTarget }>();
  const setPlace = useDraft((s) => s.setPlace);
  const [q, setQ] = useState("");
  const results = useSearch(q, locale);
  const items = results.data?.results ?? [];

  return (
    <ThemedView style={styles.flex}>
      <View style={styles.header}>
        <View style={[styles.field, { backgroundColor: theme.fill }]}>
          <Icon name="search" size={18} color={theme.textSecondary} />
          <TextInput
            autoFocus
            value={q}
            onChangeText={setQ}
            placeholder={t("plan.toPlaceholder")}
            placeholderTextColor={theme.textSecondary}
            style={[styles.input, { color: theme.text }]}
            returnKeyType="search"
            clearButtonMode="while-editing"
            accessibilityLabel={t("common.search")}
          />
          {q.length > 0 && (
            <Pressable
              onPress={() => setQ("")}
              accessibilityRole="button"
              accessibilityLabel={t("common.cancel")}
              hitSlop={8}
            >
              <Icon name="close" size={18} color={theme.textTertiary} />
            </Pressable>
          )}
        </View>
      </View>
      <FlatList
        data={items}
        keyExtractor={(r) => r.id}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          <Group style={styles.shortcuts}>
            {target === "from" && (
              <Row
                first
                icon="locate"
                title={t("common.currentLocation")}
                titleColor={theme.tint}
                onPress={() => {
                  setPlace("from", null);
                  router.back();
                }}
              />
            )}
            <Row
              first={target !== "from"}
              icon="map"
              title={t("common.chooseOnMap")}
              titleColor={theme.tint}
              chevron
              onPress={() => router.push({ pathname: "/pick", params: { target } })}
            />
          </Group>
        }
        ListEmptyComponent={
          results.isError ? (
            <ThemedText type="small" themeColor="textSecondary" style={styles.empty}>
              {t(errorText(results.error))}
            </ThemedText>
          ) : null
        }
        renderItem={({ item, index }) => (
          <View
            style={[
              styles.result,
              { backgroundColor: theme.surface },
              index === 0 && styles.resultFirst,
              index === items.length - 1 && styles.resultLast,
            ]}
          >
            <Row
              first={index === 0}
              leading={
                item.modes[0] ? (
                  <View style={styles.chip}>
                    <ModeChip mode={item.modes[0]} />
                  </View>
                ) : undefined
              }
              title={item.name}
              onPress={() => {
                setPlace(target, { lat: item.lat, lon: item.lon, label: item.name, stopId: item.id });
                router.back();
              }}
            />
          </View>
        )}
      />
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8 },
  field: { flexDirection: "row", alignItems: "center", gap: 8, borderRadius: 10, paddingHorizontal: 10, height: 40 },
  input: { flex: 1, fontSize: 17, paddingVertical: 0, paddingHorizontal: 0 },
  list: { paddingHorizontal: 16, paddingBottom: 32 },
  shortcuts: { marginBottom: 20, marginTop: 8 },
  result: { overflow: "hidden" },
  resultFirst: { borderTopLeftRadius: 12, borderTopRightRadius: 12 },
  resultLast: { borderBottomLeftRadius: 12, borderBottomRightRadius: 12 },
  chip: { marginRight: 12 },
  empty: { padding: 16 },
});
