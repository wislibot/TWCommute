import { Pressable, StyleSheet, View } from "react-native";
import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";

export function PlaceField({
  label,
  value,
  placeholder,
  onPress,
}: {
  label: string;
  value?: string;
  placeholder?: string;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${value ?? placeholder ?? ""}`}
      style={[styles.field, { backgroundColor: theme.backgroundElement }]}
    >
      <ThemedText type="small" themeColor="textSecondary" style={styles.label}>
        {label}
      </ThemedText>
      <ThemedText numberOfLines={1} style={[styles.value, !value && { color: theme.textSecondary }]}>
        {value ?? placeholder}
      </ThemedText>
    </Pressable>
  );
}

export function Stepper({
  label,
  value,
  step,
  format,
  onChange,
}: {
  label: string;
  value: number;
  step: number;
  format: (v: number) => string;
  onChange: (v: number) => void;
}) {
  const theme = useTheme();
  return (
    <View style={styles.stepper}>
      <ThemedText type="small" themeColor="textSecondary">
        {label}
      </ThemedText>
      <View style={styles.stepperControls}>
        <Pressable
          accessibilityLabel="−"
          onPress={() => onChange(value - step)}
          style={[styles.stepButton, { borderColor: theme.border }]}
        >
          <ThemedText>−</ThemedText>
        </Pressable>
        <ThemedText type="smallBold" style={styles.stepValue}>
          {format(value)}
        </ThemedText>
        <Pressable
          accessibilityLabel="+"
          onPress={() => onChange(value + step)}
          style={[styles.stepButton, { borderColor: theme.border }]}
        >
          <ThemedText>+</ThemedText>
        </Pressable>
      </View>
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
  field: { borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10 },
  label: { fontSize: 12, lineHeight: 16 },
  value: { fontSize: 16 },
  stepper: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 4 },
  stepperControls: { flexDirection: "row", alignItems: "center", gap: 10 },
  stepButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  stepValue: { minWidth: 70, textAlign: "center" },
  primary: { borderRadius: 14, paddingVertical: 14, alignItems: "center" },
  primaryText: { color: "#FFFFFF", fontWeight: "700" },
});
