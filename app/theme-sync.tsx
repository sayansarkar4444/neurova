"use client";

import { useEffect } from "react";

import {
  getCurrentUserFromStorage,
  getScopedStorageKey,
  AUTH_SESSION_STORAGE_KEY,
} from "@/lib/auth";
import {
  DEFAULT_USER_SETTINGS,
  USER_SETTINGS_STORAGE_KEY,
  USER_SETTINGS_SYNC_EVENT,
  normalizeUserSettings,
} from "@/lib/userSettings";

function applyTheme(theme: "dark" | "light") {
  document.documentElement.setAttribute("data-theme", theme);
}

export default function ThemeSync() {
  useEffect(() => {
    const syncTheme = () => {
      const currentUser = getCurrentUserFromStorage();
      if (!currentUser) {
        applyTheme(DEFAULT_USER_SETTINGS.theme);
        return;
      }

      const settingsKey = getScopedStorageKey(USER_SETTINGS_STORAGE_KEY, currentUser.id);
      const raw = localStorage.getItem(settingsKey);
      if (!raw) {
        applyTheme(DEFAULT_USER_SETTINGS.theme);
        return;
      }

      try {
        const normalized = normalizeUserSettings(JSON.parse(raw));
        applyTheme(normalized.theme);
      } catch {
        applyTheme(DEFAULT_USER_SETTINGS.theme);
      }
    };

    syncTheme();

    const onStorage = (event: StorageEvent) => {
      if (event.key === AUTH_SESSION_STORAGE_KEY || event.key?.startsWith(USER_SETTINGS_STORAGE_KEY)) {
        syncTheme();
      }
    };

    window.addEventListener("storage", onStorage);
    window.addEventListener(USER_SETTINGS_SYNC_EVENT, syncTheme);
    window.addEventListener("focus", syncTheme);

    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(USER_SETTINGS_SYNC_EVENT, syncTheme);
      window.removeEventListener("focus", syncTheme);
    };
  }, []);

  return null;
}
