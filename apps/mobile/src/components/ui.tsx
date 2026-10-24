import type { ReactNode } from "react";
import { Pressable, type StyleProp, StyleSheet, View, type ViewStyle } from "react-native";
import { Icon, type IconName } from "@/components/icon";
import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";

/**
 * iOS building blocks: inset grouped lists (Settings-style cards), search fields, segmented controls
 * and round buttons. Screens compose these instead of styling rows one by one.
 */

/**
 * An inset grouped section: optional header above, rounded card, optional footer below. `raised`
 * cards sit inside a sheet, which already has the card color.
 */
export function Group({
  header,
  footer,
  children,
  style,
  raised,
}: {
  header?: ReactNode;
  footer?: string;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  raised?: boolean;
}) {
  const theme = useTheme();
  return (
    <View style={style}>
      {typeof header === "string" ? <GroupHeader title={header} /> : header}
      <View style={[styles.group, { backgroundColor: raised ? theme.surfaceRaised : theme.surface }]}>{children}</View>
      {footer && (
        <ThemedText type="footnote" themeColor="textSecondary" style={styles.groupFooter}>
          {footer}
        </ThemedText>
      )}
    </View>
  );
}

export function GroupHeader({ title, trailing }: { title: string; trailing?: ReactNode }) {
  return (
    <View style={styles.groupHeader}>
      <ThemedText type="footnote" themeColor="textSecondary" style={styles.groupHeaderText} numberOfLines={1}>
        {title.toLocaleUpperCase()}
      </ThemedText>
      {trailing}
    </View>
  );
}

/**
 * A list row: leading icon or element, title and subtitle, trailing value or element, and a
 * chevron when it navigates. Rows after the first draw a hairline separator inset past the icon.
 */
export function Row({
  title,
  subtitle,
  icon,
  iconColor,
  leading,
  trailing,
  chevron,
  checked,
  first,
  onPress,
  titleColor,
  accessibilityLabel,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  icon?: IconName;
  iconColor?: string;
  leading?: ReactNode;
  trailing?: ReactNode;
  chevron?: boolean;
  checked?: boolean;
  first?: boolean;
  onPress?: () => void;
  titleColor?: string;
  accessibilityLabel?: string;
}) {
  const theme = useTheme();
  const body = (
    <View style={styles.row}>
      {icon && <Icon name={icon} size={22} color={iconColor ?? theme.tint} style={styles.rowIcon} />}
      {leading}
      <View
        style={[styles.rowMain, !first && { borderTopColor: theme.border, borderTopWidth: StyleSheet.hairlineWidth }]}
      >
        <View style={styles.rowText}>
          {typeof title === "string" ? (
            <ThemedText numberOfLines={2} style={titleColor ? { color: titleColor } : undefined}>
              {title}
            </ThemedText>
          ) : (
            title
          )}
          {typeof subtitle === "string" ? (
            <ThemedText type="footnote" themeColor="textSecondary" numberOfLines={2}>
              {subtitle}
            </ThemedText>
          ) : (
            subtitle
          )}
        </View>
        {typeof trailing === "string" ? (
          <ThemedText themeColor="textSecondary" numberOfLines={1}>
            {trailing}
          </ThemedText>
        ) : (
          trailing
        )}
        {checked && <Icon name="check" size={18} color={theme.tint} />}
        {chevron && <Icon name="chevron" size={16} color={theme.textTertiary} />}
      </View>
    </View>
  );
  if (!onPress) return body;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole={checked === undefined ? "button" : "radio"}
      accessibilityState={checked === undefined ? undefined : { selected: checked }}
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => pressed && { backgroundColor: theme.backgroundSelected }}
    >
      {body}
    </Pressable>
  );
}

/** The rounded grey search field; pressable, it opens the search screen. */
export function SearchField({ placeholder, onPress }: { placeholder: string; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="search"
      accessibilityLabel={placeholder}
      style={({ pressed }) => [styles.search, { backgroundColor: theme.fill, opacity: pressed ? 0.7 : 1 }]}
    >
      <Icon name="search" size={18} color={theme.textSecondary} />
      <ThemedText themeColor="textSecondary" numberOfLines={1} style={styles.flex}>
        {placeholder}
      </ThemedText>
    </Pressable>
  );
}

/** iOS segmented control: a grey track with the chosen segment raised. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: Array<{ value: T; label: string }>;
  value: T;
  onChange: (value: T) => void;
}) {
  const theme = useTheme();
  return (
    <View style={[styles.segmented, { backgroundColor: theme.fill }]} accessibilityRole="tablist">
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <Pressable
            key={o.value}
            onPress={() => onChange(o.value)}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            style={[styles.segment, selected && [styles.segmentSelected, { backgroundColor: theme.surface }]]}
          >
            <ThemedText type={selected ? "smallBold" : "small"} numberOfLines={1}>
              {o.label}
            </ThemedText>
          </Pressable>
        );
      })}
    </View>
  );
}

/** A small round grey button with an icon, as in sheet headers. */
export function CircleButton({
  icon,
  onPress,
  accessibilityLabel,
}: {
  icon: IconName;
  onPress: () => void;
  accessibilityLabel: string;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      hitSlop={8}
      style={({ pressed }) => [styles.circle, { backgroundColor: theme.fill, opacity: pressed ? 0.6 : 1 }]}
    >
      <Icon name={icon} size={18} color={theme.textSecondary} />
    </Pressable>
  );
}

/** A floating map control: a rounded square on the map's surface color with a soft shadow. */
export function MapButton({
  icon,
  onPress,
  accessibilityLabel,
}: {
  icon: IconName;
  onPress: () => void;
  accessibilityLabel: string;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => [styles.mapButton, { backgroundColor: theme.surface, opacity: pressed ? 0.7 : 1 }]}
    >
      <Icon name={icon} size={20} color={theme.tint} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  group: { borderRadius: 12, overflow: "hidden" },
  groupHeader: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 6,
    gap: 8,
  },
  groupHeaderText: { flexShrink: 1 },
  groupFooter: { paddingHorizontal: 16, paddingTop: 6 },
  row: { flexDirection: "row", alignItems: "center", paddingLeft: 16, minHeight: 44 },
  rowIcon: { marginRight: 12 },
  rowMain: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 11,
    paddingRight: 16,
    minHeight: 44,
  },
  rowText: { flex: 1, gap: 2 },
  search: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: 10,
    paddingHorizontal: 10,
    height: 40,
  },
  segmented: { flexDirection: "row", borderRadius: 9, padding: 2 },
  segment: { flex: 1, alignItems: "center", justifyContent: "center", paddingVertical: 6, borderRadius: 7 },
  segmentSelected: {
    shadowColor: "#000",
    shadowOpacity: 0.12,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
    elevation: 2,
  },
  circle: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  mapButton: {
    width: 44,
    height: 44,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOpacity: 0.15,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
});
