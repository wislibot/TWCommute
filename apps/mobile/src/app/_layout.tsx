import "@/lib/i18n";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useColorScheme } from "react-native";
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

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider value={colorScheme === "dark" ? DarkTheme : DefaultTheme}>
        <Stack>
          <Stack.Screen name="index" options={{ headerShown: false, title: t("app.name") }} />
          <Stack.Screen name="plan" options={{ title: t("plan.title") }} />
          <Stack.Screen name="search" options={{ presentation: "modal", title: t("common.search") }} />
          <Stack.Screen name="pick" options={{ title: t("common.search") }} />
          <Stack.Screen name="results" options={{ title: t("results.title") }} />
          <Stack.Screen name="itinerary/[index]" options={{ title: t("results.title") }} />
          <Stack.Screen name="stop/[id]" options={{ title: t("stop.departures") }} />
          <Stack.Screen name="settings" options={{ title: t("settings.title") }} />
        </Stack>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
