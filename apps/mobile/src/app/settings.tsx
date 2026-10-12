import { useQueryClient } from "@tanstack/react-query";
import type { Locale } from "@twc/contracts";
import { TPASS_PASSES } from "@twc/fares";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, ScrollView, StyleSheet, TextInput, View } from "react-native";
import { PrimaryButton } from "@/components/form";
import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { useTheme } from "@/hooks/use-theme";
import { normalizeServerUrl } from "@/lib/config";
import { useLocale } from "@/lib/hooks";
import { useSettings } from "@/lib/store";

/** Language names are shown in their own script so anyone can find theirs. */
const LANGUAGES: Array<{ value: Locale | null; label: string }> = [
  { value: null, label: "Auto" },
  { value: "zh-TW", label: "繁體中文" },
  { value: "en", label: "English" },
  { value: "ja", label: "日本語" },
  { value: "ko", label: "한국어" },
];

function Option({
  label,
  detail,
  selected,
  onPress,
}: {
  label: string;
  detail?: string;
  selected: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      style={[styles.option, { borderBottomColor: theme.border }]}
    >
      <View style={styles.flex}>
        <ThemedText>{label}</ThemedText>
        {detail && (
          <ThemedText type="small" themeColor="textSecondary">
            {detail}
          </ThemedText>
        )}
      </View>
      {selected && <ThemedText style={{ color: theme.tint }}>✓</ThemedText>}
    </Pressable>
  );
}

/** Where the app's backend runs, e.g. a computer on the same Wi-Fi (docs/TRY_IT.md). */
function ServerSetting() {
  const { t } = useTranslation();
  const theme = useTheme();
  const queryClient = useQueryClient();
  const { apiUrl, setApiUrl } = useSettings();
  const [text, setText] = useState(apiUrl ?? "");
  const [status, setStatus] = useState<"saved" | "invalid" | null>(null);

  const save = () => {
    const url = normalizeServerUrl(text);
    if (url === undefined) {
      setStatus("invalid");
      return;
    }
    setApiUrl(url);
    setText(url ?? "");
    setStatus("saved");
    // Answers (and errors) from the old server no longer apply.
    queryClient.resetQueries();
  };

  return (
    <View style={styles.server}>
      <TextInput
        value={text}
        onChangeText={(v) => {
          setText(v);
          setStatus(null);
        }}
        onSubmitEditing={save}
        placeholder="http://192.168.1.20:3000"
        placeholderTextColor={theme.textSecondary}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        returnKeyType="done"
        accessibilityLabel={t("settings.server")}
        style={[styles.input, { backgroundColor: theme.backgroundElement, color: theme.text }]}
      />
      <ThemedText type="small" themeColor="textSecondary">
        {t("settings.serverHint")}
      </ThemedText>
      {status && (
        <ThemedText type="small" style={{ color: status === "invalid" ? theme.danger : theme.tint }}>
          {status === "invalid" ? t("settings.serverInvalid") : t("settings.serverSaved")}
        </ThemedText>
      )}
      <PrimaryButton title={t("settings.serverSave")} onPress={save} />
    </View>
  );
}

export default function SettingsScreen() {
  const { t } = useTranslation();
  const locale = useLocale();
  const settings = useSettings();
  const nameKey = locale === "zh-TW" ? "zh" : locale;

  return (
    <ThemedView style={styles.flex}>
      <ScrollView contentContainerStyle={styles.content}>
        <ThemedText type="smallBold">{t("settings.language")}</ThemedText>
        {LANGUAGES.map((l) => (
          <Option
            key={l.label}
            label={l.label}
            selected={settings.locale === l.value}
            onPress={() => settings.setLocale(l.value)}
          />
        ))}

        <ThemedText type="smallBold" style={styles.section}>
          {t("settings.tpassPass")}
        </ThemedText>
        <Option
          label={t("tpass.none")}
          selected={settings.tpassId === null}
          onPress={() => settings.setTpassId(null)}
        />
        {TPASS_PASSES.map((p) => (
          <Option
            key={p.id}
            label={p.name[nameKey]}
            detail={`NT$${p.priceTwd}${p.residentPriceTwd ? ` / NT$${p.residentPriceTwd}` : ""}`}
            selected={settings.tpassId === p.id}
            onPress={() => settings.setTpassId(p.id)}
          />
        ))}

        <ThemedText type="smallBold" style={styles.section}>
          {t("settings.server")}
        </ThemedText>
        <ServerSetting />

        <ThemedText type="smallBold" style={styles.section}>
          {t("settings.about")}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {t("settings.dataSource")}
        </ThemedText>
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: 16, gap: 4 },
  section: { marginTop: 20 },
  option: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  server: { gap: 8, paddingTop: 8 },
  input: { borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16 },
});
