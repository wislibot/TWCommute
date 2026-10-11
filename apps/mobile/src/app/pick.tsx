import type { MapRef } from "@maplibre/maplibre-react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { PrimaryButton } from "@/components/form";
import { ThemedText } from "@/components/themed-text";
import { TransitMap } from "@/components/transit-map";
import { DEFAULT_CENTER } from "@/lib/config";
import { useCurrentPosition } from "@/lib/hooks";
import { type PlaceTarget, useDraft } from "@/lib/store";

/** Pick a point by moving the map under a fixed crosshair. */
export default function PickScreen() {
  const { t } = useTranslation();
  const { target = "to" } = useLocalSearchParams<{ target?: PlaceTarget }>();
  const setPlace = useDraft((s) => s.setPlace);
  const map = useRef<MapRef>(null);
  const { pos } = useCurrentPosition();
  const center: [number, number] = pos ? [pos.lon, pos.lat] : DEFAULT_CENTER;

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
      <View pointerEvents="none" style={styles.crosshair}>
        <ThemedText style={styles.cross}>✛</ThemedText>
      </View>
      <SafeAreaView edges={["bottom"]} style={styles.footer}>
        <PrimaryButton title={t("common.done")} onPress={confirm} />
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  crosshair: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  cross: { fontSize: 36, lineHeight: 40 },
  footer: { position: "absolute", left: 16, right: 16, bottom: 16 },
});
