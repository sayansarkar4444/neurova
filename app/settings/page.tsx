"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import {
  clearSession,
  getCurrentUserFromStorage,
  getScopedStorageKey,
  type AuthUser,
} from "@/lib/auth";
import {
  BUSINESS_MEMORY_STORAGE_KEY,
  BUSINESS_PROFILE_META_STORAGE_KEY,
  BUSINESS_PROFILE_STORAGE_KEY,
  BUSINESS_PROFILE_SUGGESTIONS_STORAGE_KEY,
  BUSINESS_PROFILE_SYNC_EVENT,
  EMPTY_BUSINESS_PROFILE,
} from "@/lib/businessProfile";
import { SHARED_CONTEXT_STORAGE_KEY } from "@/lib/sharedContext";
import {
  DEFAULT_USER_SETTINGS,
  USER_SETTINGS_STORAGE_KEY,
  USER_SETTINGS_SYNC_EVENT,
  normalizeUserSettings,
  type ResponseStyle,
  type UserSettings,
} from "@/lib/userSettings";

const CHAT_SESSIONS_STORAGE_KEY = "neural-x-chat-sessions";
const ACTIVE_CHAT_SESSION_ID_KEY = "neural-x-active-chat-session-id";
const TASK_STORAGE_KEY = "neural-x-task-history";
const MODE_STORAGE_KEY = "neural-x-mode";

function Toggle({
  checked,
  onChange,
  label,
  description,
  isLightTheme,
}: {
  checked: boolean;
  onChange: () => void;
  label: string;
  description: string;
  isLightTheme: boolean;
}) {
  return (
    <div
      className={`flex items-center justify-between gap-3 rounded-xl px-3 py-2.5 ${
        isLightTheme
          ? "border border-[#d9d9e3] bg-white"
          : "border border-white/10 bg-white/[0.02]"
      }`}
    >
      <div className="min-w-0">
        <p className={`text-[13px] font-semibold ${isLightTheme ? "text-slate-800" : "text-slate-100"}`}>{label}</p>
        <p className={`text-[11px] ${isLightTheme ? "text-slate-500" : "text-slate-400"}`}>{description}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={onChange}
        className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full border transition ${
          checked
            ? isLightTheme
              ? "border-slate-400 bg-slate-200"
              : "border-cyan-300/45 bg-cyan-300/25"
            : isLightTheme
              ? "border-slate-300 bg-slate-100"
              : "border-white/18 bg-white/[0.06]"
        }`}
      >
        <span
          className={`inline-block h-4.5 w-4.5 rounded-full transition ${
            isLightTheme ? "bg-slate-700" : "bg-white"
          } ${
            checked ? "translate-x-5" : "translate-x-1"
          }`}
        />
      </button>
    </div>
  );
}

export default function SettingsPage() {
  const router = useRouter();
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [isAuthChecked, setIsAuthChecked] = useState(false);
  const [settings, setSettings] = useState<UserSettings>(DEFAULT_USER_SETTINGS);
  const [isLoaded, setIsLoaded] = useState(false);
  const [feedback, setFeedback] = useState<string>("");
  const [isBusy, setIsBusy] = useState(false);
  const userStorageKey = (baseKey: string) =>
    currentUser ? getScopedStorageKey(baseKey, currentUser.id) : null;

  useEffect(() => {
    const user = getCurrentUserFromStorage();
    if (!user) {
      router.replace("/auth");
      setIsAuthChecked(true);
      return;
    }
    setCurrentUser(user);
    setIsAuthChecked(true);
  }, [router]);

  const isEnglishUi = settings.language === "english";
  const t = isEnglishUi
    ? {
        saved: "Saved",
        chatHistoryCleared: "Chat history cleared",
        profileReset: "Business profile reset",
        clearChatConfirm: "Clear all chats and task history?",
        resetProfileConfirm: "Reset entire Business Profile data?",
        chatBack: "Chat",
        settingsTitle: "Neurova Settings",
        profile: "Profile",
        name: "Name",
        namePlaceholder: "e.g. Ravi",
        language: "Language",
        theme: "Theme",
        dark: "Dark",
        light: "Light",
        aiBehavior: "AI Behavior",
        shortResponses: "Short responses",
        balancedResponses: "Balanced responses",
        detailedResponses: "Detailed responses",
        short: "Short",
        balanced: "Balanced",
        detailed: "Detailed",
        managerMode: "Manager Mode",
        strictMode: "Strict Mode",
        strictDesc: "Decisive manager tone with direct actions.",
        notifications: "Notifications",
        dailyReminder: "Daily Reminder",
        dailyReminderDesc: "Store reminder preference for future reminder feature.",
        dataControl: "Data Control",
        clearChat: "Clear Chat",
        resetBusinessProfile: "Reset Business Profile",
        openBusinessProfile: "Open Business Profile",
        logout: "Logout",
      }
    : {
        saved: "Save ho gaya",
        chatHistoryCleared: "Chat history clear ho gayi",
        profileReset: "Business profile reset ho gaya",
        clearChatConfirm: "Saari chat aur task history clear karni hai?",
        resetProfileConfirm: "Pura Business Profile reset karna hai?",
        chatBack: "Chat",
        settingsTitle: "Neurova Settings",
        profile: "Profile",
        name: "Naam",
        namePlaceholder: "jaise Ravi",
        language: "Language",
        theme: "Theme",
        dark: "Dark",
        light: "Light",
        aiBehavior: "AI Behavior",
        shortResponses: "Short responses",
        balancedResponses: "Balanced responses",
        detailedResponses: "Detailed responses",
        short: "Short",
        balanced: "Balanced",
        detailed: "Detailed",
        managerMode: "Manager Mode",
        strictMode: "Strict Mode",
        strictDesc: "Direct manager tone aur clear actions.",
        notifications: "Notifications",
        dailyReminder: "Daily Reminder",
        dailyReminderDesc: "Future reminder feature ke liye preference store karega.",
        dataControl: "Data Control",
        clearChat: "Clear Chat",
        resetBusinessProfile: "Reset Business Profile",
        openBusinessProfile: "Open Business Profile",
        logout: "Logout",
      };

  useEffect(() => {
    if (!currentUser) return;
    const settingsKey = userStorageKey(USER_SETTINGS_STORAGE_KEY);
    if (!settingsKey) return;

    try {
      const stored = localStorage.getItem(settingsKey);
      if (stored) {
        setSettings(normalizeUserSettings(JSON.parse(stored)));
      }
    } catch {
      setSettings(DEFAULT_USER_SETTINGS);
    } finally {
      setIsLoaded(true);
    }
  }, [currentUser]);

  useEffect(() => {
    if (!currentUser) return;
    if (!isLoaded) return;
    const settingsKey = userStorageKey(USER_SETTINGS_STORAGE_KEY);
    if (!settingsKey) return;

    localStorage.setItem(settingsKey, JSON.stringify(settings));
    window.dispatchEvent(new Event(USER_SETTINGS_SYNC_EVENT));
    setFeedback(t.saved);
    const timer = window.setTimeout(() => setFeedback(""), 900);
    return () => window.clearTimeout(timer);
  }, [currentUser, settings, isLoaded, t.saved]);

  const responseStyleLabel = useMemo(() => {
    switch (settings.responseStyle) {
      case "short":
        return t.shortResponses;
      case "detailed":
        return t.detailedResponses;
      default:
        return t.balancedResponses;
    }
  }, [settings.responseStyle, t.balancedResponses, t.detailedResponses, t.shortResponses]);
  const isLightTheme = settings.theme === "light";
  const pageClass = isLightTheme ? "bg-[#f7f7f8] text-[#1f2937]" : "bg-[#0B0F2B] text-slate-100";
  const headerClass = isLightTheme
    ? "border-b border-[#e5e7eb] bg-[#f7f7f8]/95"
    : "border-b border-white/10 bg-[#0B0F2B]/92";
  const cardClass = isLightTheme
    ? "rounded-2xl border border-[#d9d9e3] bg-white p-3 shadow-[0_2px_8px_rgba(15,23,42,0.05)] sm:p-3.5"
    : "rounded-2xl border border-white/12 bg-white/[0.03] p-3 sm:p-3.5";
  const labelClass = isLightTheme ? "mb-1 block text-[11px] text-slate-600" : "mb-1 block text-[11px] text-slate-300";
  const inputClass = isLightTheme
    ? "h-9 w-full rounded-xl border border-slate-300 bg-white px-3 text-[13px] text-slate-900 outline-none transition focus:border-slate-400"
    : "h-9 w-full rounded-xl border border-white/12 bg-white/[0.025] px-3 text-[13px] text-slate-100 outline-none transition focus:border-cyan-300/40";
  const sectionTitleClass = isLightTheme
    ? "text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-600"
    : "text-[11px] font-semibold uppercase tracking-[0.12em] text-cyan-200/90";

  const handleClearChat = () => {
    const ok = window.confirm(t.clearChatConfirm);
    if (!ok) return;
    if (!currentUser) return;

    const chatSessionsKey = userStorageKey(CHAT_SESSIONS_STORAGE_KEY);
    const activeChatSessionIdKey = userStorageKey(ACTIVE_CHAT_SESSION_ID_KEY);
    const taskHistoryKey = userStorageKey(TASK_STORAGE_KEY);
    const modeKey = userStorageKey(MODE_STORAGE_KEY);
    if (!chatSessionsKey || !activeChatSessionIdKey || !taskHistoryKey || !modeKey) return;

    localStorage.removeItem(chatSessionsKey);
    localStorage.removeItem(activeChatSessionIdKey);
    localStorage.removeItem(taskHistoryKey);
    sessionStorage.removeItem(modeKey);
    setFeedback(t.chatHistoryCleared);
  };

  const handleResetBusinessProfile = async () => {
    const ok = window.confirm(t.resetProfileConfirm);
    if (!ok) return;
    setIsBusy(true);

    try {
      if (!currentUser) return;
      const businessProfileKey = userStorageKey(BUSINESS_PROFILE_STORAGE_KEY);
      const businessProfileMetaKey = userStorageKey(BUSINESS_PROFILE_META_STORAGE_KEY);
      const businessMemoryKey = userStorageKey(BUSINESS_MEMORY_STORAGE_KEY);
      const suggestionsKey = userStorageKey(BUSINESS_PROFILE_SUGGESTIONS_STORAGE_KEY);
      const sharedContextKey = userStorageKey(SHARED_CONTEXT_STORAGE_KEY);
      if (
        !businessProfileKey ||
        !businessProfileMetaKey ||
        !businessMemoryKey ||
        !suggestionsKey ||
        !sharedContextKey
      ) {
        return;
      }

      localStorage.setItem(businessProfileKey, JSON.stringify(EMPTY_BUSINESS_PROFILE));
      localStorage.removeItem(businessProfileMetaKey);
      localStorage.removeItem(businessMemoryKey);
      localStorage.removeItem(suggestionsKey);
      sessionStorage.removeItem(sharedContextKey);
      window.dispatchEvent(
        new CustomEvent(BUSINESS_PROFILE_SYNC_EVENT, {
          detail: EMPTY_BUSINESS_PROFILE,
        })
      );

      await fetch("/api/business-profile", {
        method: "DELETE",
        headers: {
          "x-neurova-user-id": currentUser.id,
        },
      });

      setFeedback(t.profileReset);
    } finally {
      setIsBusy(false);
    }
  };

  const setResponseStyle = (value: ResponseStyle) => {
    setSettings((prev) => ({ ...prev, responseStyle: value }));
  };

  const handleLogout = () => {
    clearSession();
    router.replace("/auth");
  };

  if (!isAuthChecked) {
    return (
      <div className={`min-h-screen ${pageClass}`} />
    );
  }

  if (!currentUser) {
    return null;
  }

  return (
    <div className={`min-h-screen ${pageClass}`}>
      <div className="mx-auto flex w-full max-w-[72rem] flex-col px-3 pb-6 pt-4 sm:px-5 sm:pb-8 sm:pt-5">
        <header
          className={`sticky top-0 z-20 pb-2 pt-1 backdrop-blur ${headerClass}`}
        >
          <div className="flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => router.push("/")}
              className={`inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-[11px] transition ${
                isLightTheme
                  ? "border-slate-300 bg-white text-slate-700 hover:bg-slate-100"
                  : "border-white/12 bg-white/[0.03] text-slate-300 hover:bg-white/[0.08] hover:text-cyan-100"
              }`}
            >
              {"<"} {t.chatBack}
            </button>
            <h1 className={`text-[15px] font-semibold sm:text-[16px] ${isLightTheme ? "text-slate-900" : "text-slate-100"}`}>
              {t.settingsTitle}
            </h1>
            <span className={`min-w-[48px] text-right text-[11px] ${isLightTheme ? "text-slate-500" : "text-cyan-200/90"}`}>{feedback}</span>
          </div>
        </header>

        <main className="mt-3 grid gap-3 sm:mt-4 sm:grid-cols-2">
          <section className={cardClass}>
            <h2 className={sectionTitleClass}>
              {t.profile}
            </h2>
            <div className="mt-2.5 space-y-2">
              <label className="block">
                <span className={labelClass}>{t.name}</span>
                <input
                  value={settings.name}
                  onChange={(event) =>
                    setSettings((prev) => ({ ...prev, name: event.target.value.slice(0, 80) }))
                  }
                  placeholder={t.namePlaceholder}
                  className={inputClass}
                />
              </label>
              <label className="block">
                <span className={labelClass}>{t.language}</span>
                <select
                  value={settings.language}
                  onChange={(event) =>
                    setSettings((prev) => ({
                      ...prev,
                      language: event.target.value === "english" ? "english" : "hinglish",
                    }))
                  }
                  className={inputClass}
                >
                  <option value="hinglish" style={{ color: "#0f172a" }}>
                    Hinglish
                  </option>
                  <option value="english" style={{ color: "#0f172a" }}>
                    English
                  </option>
                </select>
              </label>
              <label className="block">
                <span className={labelClass}>{t.theme}</span>
                <select
                  value={settings.theme}
                  onChange={(event) =>
                    setSettings((prev) => ({
                      ...prev,
                      theme: event.target.value === "light" ? "light" : "dark",
                    }))
                  }
                  className={inputClass}
                >
                  <option value="dark" style={{ color: "#0f172a" }}>
                    {t.dark}
                  </option>
                  <option value="light" style={{ color: "#0f172a" }}>
                    {t.light}
                  </option>
                </select>
              </label>
            </div>
          </section>

          <section className={cardClass}>
            <h2 className={sectionTitleClass}>
              {t.aiBehavior}
            </h2>
            <p className={`mt-2 text-[11px] ${isLightTheme ? "text-slate-500" : "text-slate-400"}`}>{responseStyleLabel}</p>
            <div className="mt-2.5 grid grid-cols-3 gap-1.5">
              {(["short", "balanced", "detailed"] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setResponseStyle(option)}
                  className={`rounded-lg border px-2 py-2 text-[11px] font-semibold transition ${
                    settings.responseStyle === option
                      ? isLightTheme
                        ? "border-slate-400 bg-slate-100 text-slate-900"
                        : "border-cyan-300/40 bg-cyan-300/[0.16] text-cyan-100"
                      : isLightTheme
                        ? "border-slate-300 bg-white text-slate-700 hover:bg-slate-100"
                        : "border-white/12 bg-white/[0.02] text-slate-300 hover:bg-white/[0.07]"
                  }`}
                >
                  {option === "short" ? t.short : option === "balanced" ? t.balanced : t.detailed}
                </button>
              ))}
            </div>
          </section>

          <section className={cardClass}>
            <h2 className={sectionTitleClass}>
              {t.managerMode}
            </h2>
            <div className="mt-2.5">
              <Toggle
                checked={settings.strictMode}
                onChange={() =>
                  setSettings((prev) => ({ ...prev, strictMode: !prev.strictMode }))
                }
                label={t.strictMode}
                description={t.strictDesc}
                isLightTheme={isLightTheme}
              />
            </div>
          </section>

          <section className={cardClass}>
            <h2 className={sectionTitleClass}>
              {t.notifications}
            </h2>
            <div className="mt-2.5">
              <Toggle
                checked={settings.dailyReminder}
                onChange={() =>
                  setSettings((prev) => ({ ...prev, dailyReminder: !prev.dailyReminder }))
                }
                label={t.dailyReminder}
                description={t.dailyReminderDesc}
                isLightTheme={isLightTheme}
              />
            </div>
          </section>

          <section className={`${cardClass} sm:col-span-2`}>
            <h2 className={sectionTitleClass}>
              {t.dataControl}
            </h2>
            <div className="mt-2.5 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={handleClearChat}
                className={`inline-flex h-9 items-center rounded-lg border px-3 text-[12px] font-semibold transition ${
                  isLightTheme
                    ? "border-amber-300 bg-amber-100 text-amber-900 hover:bg-amber-200"
                    : "border-amber-300/35 bg-amber-300/[0.12] text-amber-100 hover:bg-amber-300/[0.2]"
                }`}
              >
                {t.clearChat}
              </button>
              <button
                type="button"
                disabled={isBusy}
                onClick={() => void handleResetBusinessProfile()}
                className={`inline-flex h-9 items-center rounded-lg border px-3 text-[12px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-70 ${
                  isLightTheme
                    ? "border-rose-300 bg-rose-100 text-rose-900 hover:bg-rose-200"
                    : "border-rose-300/40 bg-rose-300/[0.12] text-rose-100 hover:bg-rose-300/[0.22]"
                }`}
              >
                {t.resetBusinessProfile}
              </button>
              <Link
                href="/business-profile"
                className={`inline-flex h-9 items-center rounded-lg border px-3 text-[12px] font-semibold transition ${
                  isLightTheme
                    ? "border-slate-300 bg-white text-slate-700 hover:bg-slate-100"
                    : "border-white/12 bg-white/[0.03] text-slate-200 hover:bg-white/[0.08]"
                }`}
              >
                {t.openBusinessProfile}
              </Link>
              <button
                type="button"
                onClick={handleLogout}
                className={`inline-flex h-9 items-center rounded-lg border px-3 text-[12px] font-semibold transition ${
                  isLightTheme
                    ? "border-slate-300 bg-white text-slate-700 hover:bg-slate-100"
                    : "border-white/16 bg-white/[0.03] text-slate-200 hover:bg-white/[0.08]"
                }`}
              >
                {t.logout}
              </button>
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}
