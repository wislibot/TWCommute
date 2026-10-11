import type { Locale, LocalizedName } from "@twc/contracts";
import en from "./locales/en.json";
import ja from "./locales/ja.json";
import ko from "./locales/ko.json";
import zhTW from "./locales/zh-TW.json";

/** i18next-compatible resources: `{ [locale]: { translation } }`. */
export const resources = {
  en: { translation: en },
  "zh-TW": { translation: zhTW },
  ja: { translation: ja },
  ko: { translation: ko },
} satisfies Record<Locale, { translation: unknown }>;

export type TranslationShape = typeof en;

/** Map a device language tag (e.g. `zh-Hant-TW`, `ja-JP`) to a supported locale. */
export function resolveLocale(tag: string | null | undefined): Locale {
  const t = (tag ?? "").toLowerCase();
  if (t.startsWith("zh")) return "zh-TW";
  if (t.startsWith("ja")) return "ja";
  if (t.startsWith("ko")) return "ko";
  return "en";
}

export interface DisplayName {
  primary: string;
  /** Shown smaller underneath, so travelers can match signage. */
  secondary?: string;
}

/**
 * How stop/station names are shown per UI language. Signage in Taiwan is Chinese + English,
 * so we always keep one of those visible:
 * - zh-TW: Chinese.
 * - en: English, Chinese underneath.
 * - ja: Chinese (readable as kanji), English underneath — unless a Japanese name exists.
 * - ko: Korean if present, else English; Chinese underneath.
 */
export function displayName(name: LocalizedName, locale: Locale): DisplayName {
  const { zh, en, ja, ko } = name;
  switch (locale) {
    case "zh-TW":
      return { primary: zh };
    case "en":
      return en && en !== zh ? { primary: en, secondary: zh } : { primary: zh };
    case "ja":
      if (ja) return { primary: ja, secondary: zh };
      return en ? { primary: zh, secondary: en } : { primary: zh };
    case "ko": {
      const primary = ko ?? en;
      return primary ? { primary, secondary: zh } : { primary: zh };
    }
  }
}
