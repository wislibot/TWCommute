import type { MapRef } from "@maplibre/maplibre-react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { PrimaryButton } from "@/components/form";
import { Icon } from "@/components/icon";
import { ThemedText } from "@/components/themed-text";
import { TransitMap } from "@/components/transit-map";
import { useTheme } from "@/hooks/use-theme";
import { DEFAULT_CENTER } from "@/lib/config";
import { useCurrentPosition } from "@/lib/hooks";
import { type PlaceTarget, useDraft, useSettings } from "@/lib/store";

/** Pick a point by moving the map under a fixed pin. */
export default function PickScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const { target = "to" } = useLocalSearchParams<{ target?: PlaceTarget }>();
  const setPlace = useDraft((s) => s.setPlace);
  const map = useRef<MapRef>(null);
  const { pos } = useCurrentPosition();
  const last = useSettings((s) => s.lastPosition);
  const start = pos ?? last;
  const center: [number, number] = start ? [start.lon, start.lat] : DEFAULT_CENTER;

  const confirm = async () => {
    const c = await map.current?.getCenter();
    if (!c) return;
    const [lon, lat] = c;
    setPlace(target, { lat, lon, label: `${lat.toFixed(5)}, ${lon.toFixed(5)}` });
    router.dismissTo("/plan");
  };

  return (
    <View style={styles.flex}>
      <TransitMap center={center} mapRef={map} showUser />
      {/* The pin's tip marks the map center. */}
      <View pointerEvents="none" style={styles.pinLayer}>
        <Icon name="pin" size={44} color={theme.danger} style={styles.pin} />
      </View>
      <SafeAreaView edges={["bottom"]} style={styles.footer} pointerEvents="box-none">
        <View style={[styles.card, { backgroundColor: theme.surface }]}>
          <ThemedText type="footnote" themeColor="textSecondary" style={styles.hint}>
            {t("pick.hint")}
          </ThemedText>
          <PrimaryButton title={t("common.done")} onPress={confirm} />
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  pinLayer: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  pin: { marginBottom: 44 },
  footer: { position: "absolute", left: 16, right: 16, bottom: 16 },
  card: {
    borderRadius: 16,
    padding: 12,
    gap: 10,
    shadowColor: "#000",
    shadowOpacity: 0.15,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 2 },
    elevation: 6,
  },
  hint: { textAlign: "center" },
});
