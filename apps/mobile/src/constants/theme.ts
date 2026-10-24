/**
 * Below are the colors that are used in the app. The colors are defined in the light and dark mode.
 * There are many other ways to style your app. For example, [Nativewind](https://www.nativewind.dev/), [Tamagui](https://tamagui.dev/), [unistyles](https://reactnativeunistyles.vercel.app), etc.
 */

import "@/global.css";

import { Platform } from "react-native";

/**
 * iOS system colors (Human Interface Guidelines), so the app reads as native on iPhone and calm on
 * Android. `background` is the grouped background behind inset cards, `surface` the cards and sheets,
 * `fill` the search fields and segmented controls.
 */
export const Colors = {
  light: {
    text: "#000000",
    textSecondary: "#3C3C4399",
    textTertiary: "#3C3C434D",
    background: "#F2F2F7",
    surface: "#FFFFFF",
    /** Cards inside a sheet, which is itself `surface`. */
    surfaceRaised: "#F2F2F7",
    backgroundElement: "#FFFFFF",
    backgroundSelected: "#E5E5EA",
    fill: "#7676801F",
    border: "#C6C6C8",
    tint: "#007AFF",
    success: "#248A3D",
    warning: "#C93400",
    danger: "#FF3B30",
    notice: "#FF9500",
  },
  dark: {
    text: "#FFFFFF",
    textSecondary: "#EBEBF599",
    textTertiary: "#EBEBF54D",
    background: "#000000",
    surface: "#1C1C1E",
    surfaceRaised: "#2C2C2E",
    backgroundElement: "#1C1C1E",
    backgroundSelected: "#2C2C2E",
    fill: "#7676803D",
    border: "#38383A",
    tint: "#0A84FF",
    success: "#30D158",
    warning: "#FF9F0A",
    danger: "#FF453A",
    notice: "#FF9F0A",
  },
} as const;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;

export const Fonts = Platform.select({
  ios: {
    /** iOS `UIFontDescriptorSystemDesignDefault` */
    sans: "system-ui",
    /** iOS `UIFontDescriptorSystemDesignSerif` */
    serif: "ui-serif",
    /** iOS `UIFontDescriptorSystemDesignRounded` */
    rounded: "ui-rounded",
    /** iOS `UIFontDescriptorSystemDesignMonospaced` */
    mono: "ui-monospace",
  },
  default: {
    sans: "normal",
    serif: "serif",
    rounded: "normal",
    mono: "monospace",
  },
  web: {
    sans: "var(--font-display)",
    serif: "var(--font-serif)",
    rounded: "var(--font-rounded)",
    mono: "var(--font-mono)",
  },
});

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

export const BottomTabInset = Platform.select({ ios: 50, android: 80 }) ?? 0;
export const MaxContentWidth = 800;
