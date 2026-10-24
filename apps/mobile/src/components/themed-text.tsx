import { Platform, StyleSheet, Text, type TextProps } from "react-native";

import { Fonts, type ThemeColor } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";

/**
 * iOS text styles: default = Body, title = Large Title, subtitle = Title 2, title3 = Title 3,
 * headline = Headline, small = Subheadline, footnote and caption as named.
 */
export type ThemedTextProps = TextProps & {
  type?:
    | "default"
    | "title"
    | "subtitle"
    | "title3"
    | "headline"
    | "small"
    | "smallBold"
    | "footnote"
    | "caption"
    | "link"
    | "linkPrimary"
    | "code";
  themeColor?: ThemeColor;
};

export function ThemedText({ style, type = "default", themeColor, ...rest }: ThemedTextProps) {
  const theme = useTheme();

  return <Text style={[{ color: theme[themeColor ?? "text"] }, styles[type], style]} {...rest} />;
}

const styles = StyleSheet.create({
  default: { fontSize: 17, lineHeight: 22, fontWeight: 400 },
  title: { fontSize: 34, lineHeight: 41, fontWeight: 700 },
  subtitle: { fontSize: 22, lineHeight: 28, fontWeight: 700 },
  title3: { fontSize: 20, lineHeight: 25, fontWeight: 600 },
  headline: { fontSize: 17, lineHeight: 22, fontWeight: 600 },
  small: { fontSize: 15, lineHeight: 20, fontWeight: 400 },
  smallBold: { fontSize: 15, lineHeight: 20, fontWeight: 600 },
  footnote: { fontSize: 13, lineHeight: 18, fontWeight: 400 },
  caption: { fontSize: 12, lineHeight: 16, fontWeight: 400 },
  link: {
    lineHeight: 30,
    fontSize: 14,
  },
  linkPrimary: {
    lineHeight: 30,
    fontSize: 14,
    color: "#3c87f7",
  },
  code: {
    fontFamily: Fonts.mono,
    fontWeight: Platform.select({ android: 700 }) ?? 500,
    fontSize: 12,
  },
});
