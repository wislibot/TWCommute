import { Pressable, StyleSheet, View } from "react-native";
import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";

/** iOS stepper: a grey capsule with − and + halves. */
export function Stepper({ label, onMinus, onPlus }: { label: string; onMinus: () => void; onPlus: () => void }) {
  const theme = useTheme();
  return (
    <View style={[styles.stepper, { backgroundColor: theme.fill }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label} −`}
        onPress={onMinus}
        style={({ pressed }) => [styles.stepHalf, pressed && { opacity: 0.5 }]}
      >
        <ThemedText type="title3">−</ThemedText>
      </Pressable>
      <View style={[styles.stepDivider, { backgroundColor: theme.border }]} />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label} +`}
        onPress={onPlus}
        style={({ pressed }) => [styles.stepHalf, pressed && { opacity: 0.5 }]}
      >
        <ThemedText type="title3">+</ThemedText>
      </Pressable>
    </View>
  );
}

export function PrimaryButton({
  title,
  onPress,
  disabled,
}: {
  title: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.primary,
        { backgroundColor: theme.tint, opacity: disabled ? 0.4 : pressed ? 0.85 : 1 },
      ]}
    >
      <ThemedText style={styles.primaryText}>{title}</ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  stepper: { flexDirection: "row", alignItems: "center", borderRadius: 8, height: 32 },
  stepHalf: { width: 46, height: 32, alignItems: "center", justifyContent: "center" },
  stepDivider: { width: StyleSheet.hairlineWidth, height: 18 },
  primary: { borderRadius: 14, height: 50, alignItems: "center", justifyContent: "center" },
  primaryText: { color: "#FFFFFF", fontWeight: "600", fontSize: 17 },
});
