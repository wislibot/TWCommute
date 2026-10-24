import { MAX_VIAS } from "@twc/contracts";
import { router } from "expo-router";
import { useTranslation } from "react-i18next";
import { Pressable, ScrollView, StyleSheet, Switch, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { PrimaryButton, Stepper } from "@/components/form";
import { Icon } from "@/components/icon";
import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { CircleButton, Group, GroupHeader, Row, Segmented } from "@/components/ui";
import { useTheme } from "@/hooks/use-theme";
import { formatTime } from "@/lib/format";
import { useCurrentPosition, useLocale } from "@/lib/hooks";
import { draftToRequest, type PlaceTarget, useDraft, useSettings } from "@/lib/store";
import { toTaipeiIso } from "@/lib/time";

/** Trip planner, laid out like an iOS form: the trip, when, options, then one button. */
export default function PlanScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const locale = useLocale();
  const draft = useDraft();
  const tpassId = useSettings((s) => s.tpassId);
  const { pos } = useCurrentPosition();
  const current = pos ? { lat: pos.lat, lon: pos.lon, label: t("common.currentLocation") } : null;
  const request = draftToRequest(draft, current, { locale, tpassId });

  const pick = (target: PlaceTarget) => router.push({ pathname: "/search", params: { target } });
  const shiftTime = (minutes: number) => {
    const base = draft.time ? Date.parse(draft.time) : Date.now();
    draft.setTime(toTaipeiIso(new Date(base + minutes * 60_000)));
  };
  const placeTitle = (label: string | undefined, placeholder: string) => (
    <ThemedText numberOfLines={1} themeColor={label ? "text" : "textSecondary"}>
      {label ?? placeholder}
    </ThemedText>
  );

  return (
    <ThemedView style={styles.flex}>
      <ScrollView contentContainerStyle={styles.content}>
        <Group
          header={
            <GroupHeader
              title={t("plan.trip")}
              trailing={<CircleButton icon="swap" onPress={draft.swap} accessibilityLabel={t("plan.swap")} />}
            />
          }
        >
          <Row
            first
            icon="origin"
            title={placeTitle(draft.from?.label ?? t("common.currentLocation"), "")}
            chevron
            onPress={() => pick("from")}
            accessibilityLabel={t("common.from")}
          />
          {draft.vias.map((via, i) => (
            <Row
              key={via.id}
              icon="origin"
              iconColor={theme.textSecondary}
              title={placeTitle(via.place?.label, t("plan.addStop"))}
              subtitle={`${t("plan.stayFor")} ${t("common.minutes", { count: via.dwellMinutes })}`}
              onPress={() => pick(`via:${i}`)}
              trailing={
                <View style={styles.viaControls}>
                  <Stepper
                    label={t("plan.stayFor")}
                    onMinus={() => draft.setDwell(i, via.dwellMinutes - 15)}
                    onPlus={() => draft.setDwell(i, via.dwellMinutes + 15)}
                  />
                  <Pressable
                    onPress={() => draft.removeVia(i)}
                    accessibilityRole="button"
                    accessibilityLabel={t("plan.removeStop")}
                    hitSlop={8}
                  >
                    <Icon name="minus" size={22} color={theme.danger} />
                  </Pressable>
                </View>
              }
            />
          ))}
          <Row
            icon="pin"
            iconColor={theme.danger}
            title={placeTitle(draft.to?.label, t("plan.toPlaceholder"))}
            chevron
            onPress={() => pick("to")}
            accessibilityLabel={t("common.to")}
          />
          {draft.vias.length < MAX_VIAS ? (
            <Row icon="plus" title={t("plan.addStop")} titleColor={theme.tint} onPress={draft.addVia} />
          ) : (
            <Row
              title={<ThemedText themeColor="textSecondary">{t("plan.maxStops", { count: MAX_VIAS })}</ThemedText>}
            />
          )}
        </Group>

        <Group header={t("plan.when")}>
          <View style={styles.padded}>
            <Segmented
              value={draft.arriveBy ? "arrive" : "depart"}
              onChange={(v) => draft.setArriveBy(v === "arrive")}
              options={[
                { value: "depart", label: t("plan.departAt") },
                { value: "arrive", label: t("plan.arriveBy") },
              ]}
            />
          </View>
          <Row
            icon="clock"
            title={
              <ThemedText type="headline">{draft.time ? formatTime(draft.time, locale) : t("common.now")}</ThemedText>
            }
            trailing={
              <View style={styles.viaControls}>
                {draft.time && (
                  <Pressable onPress={() => draft.setTime(null)} accessibilityRole="button" hitSlop={8}>
                    <ThemedText style={{ color: theme.tint }}>{t("common.now")}</ThemedText>
                  </Pressable>
                )}
                <Stepper label={t("plan.departAt")} onMinus={() => shiftTime(-15)} onPlus={() => shiftTime(15)} />
              </View>
            }
          />
        </Group>

        <Group header={t("plan.options")}>
          <Row
            first
            icon="bike"
            iconColor="#FF9500"
            title={t("plan.useYouBike")}
            trailing={
              <Switch
                value={draft.bikeShare}
                onValueChange={draft.setBikeShare}
                trackColor={{ true: "#34C759", false: theme.fill }}
                thumbColor="#FFFFFF"
              />
            }
          />
        </Group>
      </ScrollView>

      <SafeAreaView edges={["bottom"]} style={[styles.footer, { borderTopColor: theme.border }]}>
        <PrimaryButton
          title={t("plan.go")}
          disabled={!request}
          onPress={() => {
            if (!request) return;
            draft.submit(request);
            router.push("/results");
          }}
        />
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: 16, gap: 24 },
  padded: { paddingHorizontal: 16, paddingVertical: 10 },
  viaControls: { flexDirection: "row", alignItems: "center", gap: 10 },
  footer: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 10, borderTopWidth: StyleSheet.hairlineWidth },
});
