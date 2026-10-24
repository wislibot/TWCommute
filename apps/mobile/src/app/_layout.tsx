import "@/lib/i18n";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useColorScheme } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { Colors } from "@/constants/theme";
import { deviceLocale } from "@/lib/i18n";
import { useSettings } from "@/lib/store";

SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1 } } });

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const { t, i18n } = useTranslation();
  const locale = useSettings((s) => s.locale);

  useEffect(() => {
    i18n.changeLanguage(locale ?? deviceLocale());
  }, [i18n, locale]);

  useEffect(() => {
    SplashScreen.hideAsync();
  }, []);

  const dark = colorScheme === "dark";
  const colors = Colors[dark ? "dark" : "light"];
  const navTheme = dark ? DarkTheme : DefaultTheme;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      {/* Dark clock and icons on light screens, light ones on dark screens. */}
      <StatusBar style={dark ? "light" : "dark"} />
      <QueryClientProvider client={queryClient}>
        <ThemeProvider
          value={{
            ...navTheme,
            colors: {
              ...navTheme.colors,
              primary: colors.tint,
              background: colors.background,
              card: colors.background,
            },
          }}
        >
          {/* iOS navigation bars: no hairline, the grouped background, large titles on list screens. */}
          <Stack
            screenOptions={{
              headerShadowVisible: false,
              headerStyle: { backgroundColor: colors.background },
              headerTintColor: colors.tint,
              headerTitleStyle: { color: colors.text },
              headerBackButtonDisplayMode: "minimal",
              contentStyle: { backgroundColor: colors.background },
            }}
          >
            <Stack.Screen name="index" options={{ headerShown: false, title: t("app.name") }} />
            <Stack.Screen name="plan" options={{ title: t("plan.title") }} />
            <Stack.Screen name="search" options={{ presentation: "modal", title: t("common.search") }} />
            <Stack.Screen name="pick" options={{ title: t("common.chooseOnMap") }} />
            <Stack.Screen name="results" options={{ title: t("results.title") }} />
            <Stack.Screen name="itinerary/[index]" options={{ title: t("results.details") }} />
            <Stack.Screen name="stop/[id]" options={{ title: t("stop.departures") }} />
            <Stack.Screen name="settings" options={{ title: t("settings.title"), headerLargeTitle: true }} />
          </Stack>
        </ThemeProvider>
      </QueryClientProvider>
    </GestureHandlerRootView>
  );
}
