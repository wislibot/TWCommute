import type { Locale } from "@twc/contracts";
import { resolveLocale, resources } from "@twc/i18n";
import { getLocales } from "expo-localization";
import i18n from "i18next";
import { initReactI18next } from "react-i18next";

export function deviceLocale(): Locale {
  return resolveLocale(getLocales()[0]?.languageTag);
}

i18n.use(initReactI18next).init({
  resources,
  lng: deviceLocale(),
  fallbackLng: "en",
  interpolation: { escapeValue: false },
});

export default i18n;
