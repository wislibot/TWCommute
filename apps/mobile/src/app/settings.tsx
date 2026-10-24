import { useQueryClient } from "@tanstack/react-query";
import type { Locale } from "@twc/contracts";
import { TPASS_PASSES } from "@twc/fares";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, ScrollView, StyleSheet, TextInput } from "react-native";
import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { Group, Row } from "@/components/ui";
import { useTheme } from "@/hooks/use-theme";
import { normalizeServerUrl } from "@/lib/config";
import { findServers } from "@/lib/discover";
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

/** Where the app's backend runs, e.g. a computer on the same Wi-Fi (docs/TRY_IT.md). */
function ServerSettings() {
  const { t } = useTranslation();
  const theme = useTheme();
  const queryClient = useQueryClient();
  const { apiUrl, setApiUrl, apiToken, setApiToken } = useSettings();
  const [text, setText] = useState(apiUrl ?? "");
  const [key, setKey] = useState(apiToken ?? "");
  const [status, setStatus] = useState<"saved" | "invalid" | null>(null);
  // null: not searched; undefined: searching; else the servers found.
  const [found, setFound] = useState<string[] | null | undefined>(null);

  const save = (address = text) => {
    const url = normalizeServerUrl(address);
    if (url === undefined) {
      setStatus("invalid");
      return;
    }
    setApiUrl(url);
    setApiToken(key.trim() || null);
    setText(url ?? "");
    setStatus("saved");
    // Answers (and errors) from the old server no longer apply.
    queryClient.resetQueries();
  };

  const find = async () => {
    setFound(undefined);
    setFound(await findServers().catch(() => []));
  };

  const field = (value: string, onChange: (v: string) => void, placeholder: string, label: string) => (
    <TextInput
      value={value}
      onChangeText={(v) => {
        onChange(v);
        setStatus(null);
      }}
      onSubmitEditing={() => save()}
      placeholder={placeholder}
      placeholderTextColor={theme.textSecondary}
      autoCapitalize="none"
      autoCorrect={false}
      keyboardType="url"
      returnKeyType="done"
      accessibilityLabel={label}
      style={[styles.input, { color: theme.text }]}
    />
  );

  const footer =
    status === "invalid"
      ? t("settings.serverInvalid")
      : status === "saved"
        ? t("settings.serverSaved")
        : t("settings.serverHint");

  return (
    <>
      <Group header={t("settings.server")} footer={footer}>
        <Row first title={field(text, setText, "http://192.168.1.20:3000", t("settings.server"))} />
        <Row title={field(key, setKey, t("settings.accessKey"), t("settings.accessKey"))} />
        <Row title={t("settings.serverSave")} titleColor={theme.tint} onPress={() => save()} />
      </Group>
      <Group
        footer={
          found?.length === 0 ? t("settings.noServerFound") : found === undefined ? t("settings.searching") : undefined
        }
      >
        <Row
          first
          icon="wifi"
          title={t("settings.findServer")}
          titleColor={theme.tint}
          onPress={found === undefined ? undefined : find}
          trailing={found === undefined ? <ActivityIndicator color={theme.textSecondary} /> : undefined}
        />
        {found?.map((url) => (
          <Row key={url} title={url} subtitle={t("settings.serversFound")} chevron onPress={() => save(url)} />
        ))}
      </Group>
    </>
  );
}

/** Settings as iOS inset grouped lists. */
export default function SettingsScreen() {
  const { t } = useTranslation();
  const locale = useLocale();
  const settings = useSettings();
  const nameKey = locale === "zh-TW" ? "zh" : locale;

  return (
    <ThemedView style={styles.flex}>
      <ScrollView contentContainerStyle={styles.content} contentInsetAdjustmentBehavior="automatic">
        <Group header={t("settings.language")}>
          {LANGUAGES.map((l, i) => (
            <Row
              key={l.label}
              first={i === 0}
              title={l.label}
              checked={settings.locale === l.value}
              onPress={() => settings.setLocale(l.value)}
            />
          ))}
        </Group>

        <Group header={t("settings.tpassPass")}>
          <Row
            first
            title={t("tpass.none")}
            checked={settings.tpassId === null}
            onPress={() => settings.setTpassId(null)}
          />
          {TPASS_PASSES.map((p) => (
            <Row
              key={p.id}
              title={p.name[nameKey]}
              subtitle={`NT$${p.priceTwd}${p.residentPriceTwd ? ` / NT$${p.residentPriceTwd}` : ""}`}
              checked={settings.tpassId === p.id}
              onPress={() => settings.setTpassId(p.id)}
            />
          ))}
        </Group>

        <ServerSettings />

        <Group header={t("settings.about")}>
          <Row first title={<ThemedText type="footnote">{t("settings.dataSource")}</ThemedText>} />
        </Group>
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: 16, gap: 28, paddingBottom: 48 },
  input: { fontSize: 17, paddingVertical: 0, paddingHorizontal: 0, minHeight: 22 },
});
