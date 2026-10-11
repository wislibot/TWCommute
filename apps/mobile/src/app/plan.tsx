import { MAX_VIAS } from "@twc/contracts";
import { router } from "expo-router";
import { useTranslation } from "react-i18next";
import { Pressable, ScrollView, StyleSheet, Switch, View } from "react-native";
import { PlaceField, PrimaryButton, Stepper } from "@/components/form";
import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { useTheme } from "@/hooks/use-theme";
import { formatTime } from "@/lib/format";
import { useCurrentPosition, useLocale } from "@/lib/hooks";
import { draftToRequest, type PlaceTarget, useDraft, useSettings } from "@/lib/store";
import { toTaipeiIso } from "@/lib/time";

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

  return (
    <ThemedView style={styles.flex}>
      <ScrollView contentContainerStyle={styles.content}>
        <PlaceField
          label={t("common.from")}
          value={draft.from?.label ?? t("common.currentLocation")}
          onPress={() => pick("from")}
        />

        {draft.vias.map((via, i) => (
          <View key={via.id} style={[styles.via, { borderColor: theme.border }]}>
            <PlaceField
              label={`${t("plan.addStop")} ${i + 1}`}
              value={via.place?.label}
              placeholder={t("plan.addStop")}
              onPress={() => pick(`via:${i}`)}
            />
            <Stepper
              label={t("plan.stayFor")}
              value={via.dwellMinutes}
              step={15}
              format={(m) => t("common.minutes", { count: m })}
              onChange={(m) => draft.setDwell(i, m)}
            />
            <Pressable onPress={() => draft.removeVia(i)} accessibilityRole="button">
              <ThemedText type="small" style={{ color: theme.danger }}>
                {t("plan.removeStop")}
              </ThemedText>
            </Pressable>
          </View>
        ))}
        {draft.vias.length < MAX_VIAS ? (
          <Pressable onPress={draft.addVia} accessibilityRole="button">
            <ThemedText style={{ color: theme.tint }}>+ {t("plan.addStop")}</ThemedText>
          </Pressable>
        ) : (
          <ThemedText type="small" themeColor="textSecondary">
            {t("plan.maxStops", { count: MAX_VIAS })}
          </ThemedText>
        )}

        <PlaceField
          label={t("common.to")}
          value={draft.to?.label}
          placeholder={t("plan.toPlaceholder")}
          onPress={() => pick("to")}
        />

        <View style={styles.row}>
          <Pressable onPress={() => draft.setArriveBy(!draft.arriveBy)} accessibilityRole="button">
            <ThemedText type="smallBold" style={{ color: theme.tint }}>
              {draft.arriveBy ? t("plan.arriveBy") : t("plan.departAt")}
            </ThemedText>
          </Pressable>
          <View style={styles.row}>
            <Pressable onPress={() => shiftTime(-15)} accessibilityLabel="−15">
              <ThemedText>−15</ThemedText>
            </Pressable>
            <ThemedText type="smallBold">{draft.time ? formatTime(draft.time, locale) : t("common.now")}</ThemedText>
            <Pressable onPress={() => shiftTime(15)} accessibilityLabel="+15">
              <ThemedText>+15</ThemedText>
            </Pressable>
            {draft.time && (
              <Pressable onPress={() => draft.setTime(null)}>
                <ThemedText type="small" style={{ color: theme.tint }}>
                  {t("common.now")}
                </ThemedText>
              </Pressable>
            )}
          </View>
        </View>

        <View style={styles.row}>
          <ThemedText>{t("plan.useYouBike")}</ThemedText>
          <Switch value={draft.bikeShare} onValueChange={draft.setBikeShare} />
        </View>

        <PrimaryButton
          title={t("plan.go")}
          disabled={!request}
          onPress={() => {
            if (!request) return;
            draft.submit(request);
            router.push("/results");
          }}
        />
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: 16, gap: 14 },
  via: { borderLeftWidth: 3, paddingLeft: 10, gap: 8 },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
});
