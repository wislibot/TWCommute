import type { ReactNode } from "react";
import { StyleSheet, useWindowDimensions, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";
import { useTheme } from "@/hooks/use-theme";

/**
 * A sheet over the map, as in Apple Maps: drag its header (grabber, search, tabs) between a low, a
 * middle and a high stop; the body below it scrolls. Stops are fractions of the screen height.
 */
export function BottomSheet({
  header,
  children,
  stops = [0.3, 0.52, 0.9],
  initial = 1,
}: {
  header: ReactNode;
  children: ReactNode;
  stops?: number[];
  initial?: number;
}) {
  const theme = useTheme();
  const { height: screen } = useWindowDimensions();
  const heights = stops.map((s) => Math.round(s * screen));
  const lowest = heights[0] ?? 0;
  const highest = heights[heights.length - 1] ?? screen;
  const height = useSharedValue(heights[initial] ?? lowest);
  const start = useSharedValue(0);

  const drag = Gesture.Pan()
    .onBegin(() => {
      start.value = height.value;
    })
    .onUpdate((e) => {
      height.value = Math.min(highest, Math.max(lowest, start.value - e.translationY));
    })
    .onEnd((e) => {
      // Where the fling would carry the sheet, then the nearest stop to that.
      const projected = height.value - e.velocityY * 0.2;
      let best = heights[0] ?? lowest;
      for (const h of heights) if (Math.abs(h - projected) < Math.abs(best - projected)) best = h;
      height.value = withSpring(best, { damping: 40, stiffness: 320, overshootClamping: true });
    });

  const animated = useAnimatedStyle(() => ({ height: height.value }));

  return (
    <Animated.View style={[styles.sheet, { backgroundColor: theme.surface }, animated]}>
      <GestureDetector gesture={drag}>
        <View style={styles.header}>
          <View style={[styles.grabber, { backgroundColor: theme.textTertiary }]} />
          {header}
        </View>
      </GestureDetector>
      <View style={styles.body}>{children}</View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  sheet: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    borderTopLeftRadius: 14,
    borderTopRightRadius: 14,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOpacity: 0.18,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: -2 },
    elevation: 16,
  },
  header: { paddingHorizontal: 16, paddingBottom: 10, gap: 10 },
  grabber: { alignSelf: "center", width: 36, height: 5, borderRadius: 3, marginTop: 6, marginBottom: 2 },
  body: { flex: 1 },
});
