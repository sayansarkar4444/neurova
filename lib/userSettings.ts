export const USER_SETTINGS_STORAGE_KEY = "neural-x-user-settings";
export const USER_SETTINGS_SYNC_EVENT = "neural-x-user-settings-sync";

export type AppLanguage = "hinglish" | "english";
export type ResponseStyle = "short" | "balanced" | "detailed";
export type AppTheme = "dark" | "light";

export type UserSettings = {
  name: string;
  language: AppLanguage;
  theme: AppTheme;
  responseStyle: ResponseStyle;
  strictMode: boolean;
  dailyReminder: boolean;
};

export const DEFAULT_USER_SETTINGS: UserSettings = {
  name: "",
  language: "hinglish",
  theme: "dark",
  responseStyle: "balanced",
  strictMode: true,
  dailyReminder: false,
};

function sanitizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function normalizeUserSettings(value: unknown): UserSettings {
  if (!value || typeof value !== "object") {
    return { ...DEFAULT_USER_SETTINGS };
  }

  const candidate = value as Partial<UserSettings>;
  const name = sanitizeString(candidate.name).slice(0, 80);
  const language = candidate.language === "english" ? "english" : "hinglish";
  const theme = candidate.theme === "light" ? "light" : "dark";
  const responseStyle =
    candidate.responseStyle === "short" || candidate.responseStyle === "detailed"
      ? candidate.responseStyle
      : "balanced";

  return {
    name,
    language,
    theme,
    responseStyle,
    strictMode: Boolean(candidate.strictMode),
    dailyReminder: Boolean(candidate.dailyReminder),
  };
}
