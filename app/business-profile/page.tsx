"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import {
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
  mergeBusinessProfileMetaWithSource,
  mergeSharedContextWithBusinessProfile,
  normalizeBusinessMemory,
  normalizeBusinessProfileMeta,
  normalizeBusinessProfile,
  normalizeSuggestedProfileUpdates,
  pruneSuggestedProfileUpdatesAgainstProfile,
  type BusinessMemoryItem,
  type BusinessProfileMeta,
  type BusinessProfile,
  type ProfileUpdateSuggestion,
} from "@/lib/businessProfile";
import {
  EMPTY_SHARED_BUSINESS_CONTEXT,
  SHARED_CONTEXT_STORAGE_KEY,
  type SharedBusinessContext,
} from "@/lib/sharedContext";
import {
  DEFAULT_USER_SETTINGS,
  USER_SETTINGS_STORAGE_KEY,
  USER_SETTINGS_SYNC_EVENT,
  normalizeUserSettings,
} from "@/lib/userSettings";

const PROFILE_SECTIONS: Array<{
  title: string;
  fields: Array<{ key: keyof BusinessProfile; label: string; placeholder: string }>;
}> = [
  {
    title: "Owner & Business",
    fields: [
      { key: "ownerName", label: "Owner Name", placeholder: "e.g. Ravi Kumar" },
      { key: "businessName", label: "Business Name", placeholder: "e.g. RK Foods" },
      { key: "businessType", label: "Business Type", placeholder: "e.g. Restaurant" },
      { key: "cityArea", label: "City / Area", placeholder: "e.g. Indore, Vijay Nagar" },
      { key: "preferredLanguage", label: "Preferred Language", placeholder: "e.g. English / Hinglish" },
    ],
  },
  {
    title: "Business Context",
    fields: [
      { key: "offerDescription", label: "What do you sell", placeholder: "e.g. North Indian meals" },
      { key: "customerType", label: "Customer Type", placeholder: "e.g. Local office workers" },
      { key: "priceRange", label: "Price Range", placeholder: "e.g. 120-350 INR" },
      { key: "businessModel", label: "Business Model", placeholder: "offline / online / both" },
      { key: "teamSize", label: "Team Size", placeholder: "e.g. 6" },
      { key: "businessStage", label: "Business Stage", placeholder: "e.g. Beginner / Growing" },
    ],
  },
  {
    title: "Goals",
    fields: [
      { key: "mainGoal", label: "Main Goal", placeholder: "e.g. New customers in 30 days" },
      { key: "secondaryGoal", label: "Secondary Goal", placeholder: "e.g. Better repeat rate" },
      { key: "currentFocus", label: "Current Focus", placeholder: "e.g. Improve walk-ins" },
    ],
  },
  {
    title: "Constraints",
    fields: [
      { key: "budgetLevel", label: "Budget Level", placeholder: "e.g. Low / Medium / High" },
      { key: "keyConstraint1", label: "Key Constraint 1", placeholder: "e.g. Low time bandwidth" },
      { key: "keyConstraint2", label: "Key Constraint 2", placeholder: "e.g. No designer resource" },
      { key: "notes", label: "Notes", placeholder: "Any stable context worth remembering..." },
    ],
  },
];
const PROFILE_COMPLETION_FIELDS: Array<keyof BusinessProfile> = [
  "ownerName",
  "businessName",
  "businessType",
  "cityArea",
  "customerType",
  "businessModel",
  "teamSize",
  "businessStage",
  "mainGoal",
  "budgetLevel",
];

function getSectionTitle(title: string, isEnglishUi: boolean): string {
  if (isEnglishUi) return title;
  switch (title) {
    case "Owner & Business":
      return "Owner aur Business";
    case "Business Context":
      return "Business Context";
    case "Goals":
      return "Goals";
    case "Constraints":
      return "Constraints";
    default:
      return title;
  }
}

function getFieldLabel(key: keyof BusinessProfile, isEnglishUi: boolean): string {
  if (isEnglishUi) {
    return PROFILE_SECTIONS.flatMap((section) => section.fields).find((item) => item.key === key)?.label ?? "";
  }

  switch (key) {
    case "ownerName":
      return "Owner ka naam";
    case "businessName":
      return "Business ka naam";
    case "businessType":
      return "Business type";
    case "cityArea":
      return "City / Area";
    case "preferredLanguage":
      return "Preferred Language";
    case "offerDescription":
      return "Aap kya bechte ho";
    case "customerType":
      return "Customer type";
    case "priceRange":
      return "Price range";
    case "businessModel":
      return "Business model";
    case "teamSize":
      return "Team size";
    case "businessStage":
      return "Business stage";
    case "mainGoal":
      return "Main goal";
    case "secondaryGoal":
      return "Secondary goal";
    case "currentFocus":
      return "Current focus";
    case "budgetLevel":
      return "Budget level";
    case "keyConstraint1":
      return "Main constraint 1";
    case "keyConstraint2":
      return "Main constraint 2";
    case "notes":
      return "Notes";
  }
}

function getFieldPlaceholder(key: keyof BusinessProfile, isEnglishUi: boolean): string {
  if (isEnglishUi) {
    return (
      PROFILE_SECTIONS.flatMap((section) => section.fields).find((item) => item.key === key)
        ?.placeholder ?? ""
    );
  }

  switch (key) {
    case "ownerName":
      return "jaise Ravi Kumar";
    case "businessName":
      return "jaise RK Foods";
    case "businessType":
      return "jaise Restaurant";
    case "cityArea":
      return "jaise Indore, Vijay Nagar";
    case "preferredLanguage":
      return "jaise English / Hinglish";
    case "offerDescription":
      return "jaise North Indian meals";
    case "customerType":
      return "jaise Local office workers";
    case "priceRange":
      return "jaise 120-350 INR";
    case "businessModel":
      return "offline / online / dono";
    case "teamSize":
      return "jaise 6";
    case "businessStage":
      return "jaise Beginner / Growing";
    case "mainGoal":
      return "jaise 30 din me naye customers";
    case "secondaryGoal":
      return "jaise repeat rate improve karna";
    case "currentFocus":
      return "jaise walk-ins improve karna";
    case "budgetLevel":
      return "jaise Low / Medium / High";
    case "keyConstraint1":
      return "jaise time kam hai";
    case "keyConstraint2":
      return "jaise designer resource nahi";
    case "notes":
      return "koi stable context yahan likho...";
  }
}

function getMemoryLabel(field: BusinessMemoryItem["field"], isEnglishUi: boolean): string {
  switch (field) {
    case "ownerName":
      return isEnglishUi ? "Owner Name" : "Owner Name";
    case "businessName":
      return "Business Name";
    case "businessType":
      return "Business Type";
    case "cityArea":
      return isEnglishUi ? "Location" : "Location";
    case "preferredLanguage":
      return isEnglishUi ? "Preferred Language" : "Preferred Language";
    case "offerDescription":
      return isEnglishUi ? "Offer Description" : "Offer Description";
    case "customerType":
      return isEnglishUi ? "Customer Type" : "Customer Type";
    case "priceRange":
      return isEnglishUi ? "Price Range" : "Price Range";
    case "businessModel":
      return isEnglishUi ? "Business Model" : "Business Model";
    case "teamSize":
      return isEnglishUi ? "Team Size" : "Team Size";
    case "businessStage":
      return isEnglishUi ? "Business Stage" : "Business Stage";
    case "mainGoal":
      return isEnglishUi ? "Main Goal" : "Main Goal";
    case "secondaryGoal":
      return isEnglishUi ? "Secondary Goal" : "Secondary Goal";
    case "currentFocus":
      return isEnglishUi ? "Current Focus" : "Current Focus";
    case "budgetLevel":
      return isEnglishUi ? "Budget Level" : "Budget Level";
    case "keyConstraint1":
      return isEnglishUi ? "Key Constraint 1" : "Key Constraint 1";
    case "keyConstraint2":
      return isEnglishUi ? "Key Constraint 2" : "Key Constraint 2";
    case "notes":
      return isEnglishUi ? "Notes" : "Notes";
  }
}

export default function BusinessProfilePage() {
  const router = useRouter();
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [isAuthChecked, setIsAuthChecked] = useState(false);
  const [isEnglishUi, setIsEnglishUi] = useState(
    DEFAULT_USER_SETTINGS.language === "english"
  );
  const [isLightTheme, setIsLightTheme] = useState(
    DEFAULT_USER_SETTINGS.theme === "light"
  );
  const [profile, setProfile] = useState<BusinessProfile>(EMPTY_BUSINESS_PROFILE);
  const [profileMeta, setProfileMeta] = useState<BusinessProfileMeta>({});
  const [memory, setMemory] = useState<BusinessMemoryItem[]>([]);
  const [suggestedUpdates, setSuggestedUpdates] = useState<ProfileUpdateSuggestion[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);
  const [hasPendingChanges, setHasPendingChanges] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveFeedback, setSaveFeedback] = useState<{
    type: "idle" | "saving" | "success" | "error";
    message: string;
  }>({
    type: "idle",
    message: "",
  });
  const hasAnyProfileValue = (candidate: BusinessProfile) =>
    Object.values(candidate).some((value) => value.trim().length > 0);
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

  const t = isEnglishUi
    ? {
        loading: "Loading Business Profile...",
        title: "Business Profile",
        subtitle: "Stable memory for business context. Editable anytime.",
        autoFillNote:
          "Neurova can auto-fill some details from chat. You can edit everything anytime.",
        backToChat: "Back to Chat",
        progressTitle: "Business Profile Progress",
        completeSuffix: "complete",
        completionHelp:
          "The more complete the profile is, the better decisions Neurova can provide.",
        missing: "Missing",
        allImportantDone: "Great job. Important profile fields are complete.",
        quickStart: "Quick start: fill Business Type, Main Goal, and Budget Level first.",
        excellent: "Excellent. Neurova can now give more context-aware recommendations.",
        autoDetected: "Auto-detected",
        edited: "Edited",
        memoryTitle: "Neurova Memory",
        memorySubtitle: "Auto-detected from chat",
        remove: "Remove",
        confidence: "Confidence",
        memoryEmpty: "No stable memory detected yet. Entries will auto-fill as chat continues.",
        suggestedUpdates: "Suggested Updates",
        reviewBeforeApply: "Review before apply",
        suggestionHint:
          "Neurova detected new details from chat. Review and choose what to apply.",
        current: "Current",
        notSet: "Not set",
        suggested: "Suggested",
        source: "Source",
        accept: "Accept",
        reject: "Reject",
        stableMemoryNote: "Profile data is stable memory. Task/chat data remains dynamic.",
        saving: "Saving...",
        save: "Save",
        unsaved: "Unsaved changes",
        allSaved: "All changes saved",
      }
    : {
        loading: "Business Profile load ho raha hai...",
        title: "Business Profile",
        subtitle: "Business context ke liye stable memory. Kabhi bhi edit kar sakte ho.",
        autoFillNote:
          "Neurova chat se kuch details automatically fill kar sakta hai. Aap kabhi bhi edit kar sakte ho.",
        backToChat: "Chat pe wapas",
        progressTitle: "Business Profile Progress",
        completeSuffix: "complete",
        completionHelp: "Jitna profile complete hoga, utne better decisions Neurova dega.",
        missing: "Missing",
        allImportantDone: "Great job. Important profile fields complete hain.",
        quickStart: "Quick start: pehle Business Type, Main Goal, aur Budget Level fill karo.",
        excellent: "Excellent. Ab Neurova zyada context-aware recommendation de paayega.",
        autoDetected: "Auto-detected",
        edited: "Edited",
        memoryTitle: "Neurova Memory",
        memorySubtitle: "Chat se auto-detected",
        remove: "Remove",
        confidence: "Confidence",
        memoryEmpty: "Abhi koi stable memory detect nahi hui. Chat ke saath entries auto-fill ho jayengi.",
        suggestedUpdates: "Suggested Updates",
        reviewBeforeApply: "Apply karne se pehle review karo",
        suggestionHint:
          "Neurova ne chat se kuch nayi details detect ki hain. Review karke decide karo.",
        current: "Current",
        notSet: "Not set",
        suggested: "Suggested",
        source: "Source",
        accept: "Accept",
        reject: "Reject",
        stableMemoryNote: "Profile data stable memory hai. Task/chat data dynamic rahega.",
        saving: "Saving...",
        save: "Save",
        unsaved: "Unsaved changes",
        allSaved: "All changes saved",
      };

  useEffect(() => {
    if (!currentUser) return;
    const settingsKey = userStorageKey(USER_SETTINGS_STORAGE_KEY);
    if (!settingsKey) return;

    const syncSettings = () => {
      try {
        const raw = localStorage.getItem(settingsKey);
        if (!raw) {
          setIsEnglishUi(DEFAULT_USER_SETTINGS.language === "english");
          setIsLightTheme(DEFAULT_USER_SETTINGS.theme === "light");
          return;
        }
        const normalized = normalizeUserSettings(JSON.parse(raw));
        setIsEnglishUi(normalized.language === "english");
        setIsLightTheme(normalized.theme === "light");
      } catch {
        setIsEnglishUi(DEFAULT_USER_SETTINGS.language === "english");
        setIsLightTheme(DEFAULT_USER_SETTINGS.theme === "light");
      }
    };

    syncSettings();
    const onStorage = (event: StorageEvent) => {
      if (event.key !== settingsKey) return;
      syncSettings();
    };
    const onSyncEvent = () => syncSettings();

    window.addEventListener("storage", onStorage);
    window.addEventListener(USER_SETTINGS_SYNC_EVENT, onSyncEvent);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(USER_SETTINGS_SYNC_EVENT, onSyncEvent);
    };
  }, [currentUser]);

  useEffect(() => {
    if (!currentUser) return;
    const loadLatestProfileState = () => {
      const load = async () => {
        let hasDbProfile = false;
        try {
          const response = await fetch("/api/business-profile", {
            method: "GET",
            cache: "no-store",
            headers: {
              "x-neurova-user-id": currentUser.id,
            },
          });
          if (response.ok) {
            const data = (await response.json()) as {
              profile?: Partial<BusinessProfile>;
            };
            if (data.profile) {
              const dbProfile = normalizeBusinessProfile(data.profile);
              if (hasAnyProfileValue(dbProfile)) {
                hasDbProfile = true;
                setProfile(dbProfile);
                setHasPendingChanges(false);
                setSaveFeedback({
                  type: "success",
                  message: isEnglishUi
                    ? "Profile updated from chat."
                    : "Profile chat se update ho gaya.",
                });
                const profileKey = userStorageKey(BUSINESS_PROFILE_STORAGE_KEY);
                if (!profileKey) return;
                localStorage.setItem(profileKey, JSON.stringify(dbProfile));
                console.log("[PROFILE CONTEXT] refreshed profile =", dbProfile);
              }
            }
          }
        } catch {
          // Ignore db fetch errors, local fallback below will still run.
        }

        try {
          const profileKey = userStorageKey(BUSINESS_PROFILE_STORAGE_KEY);
          const profileMetaKey = userStorageKey(BUSINESS_PROFILE_META_STORAGE_KEY);
          const memoryKey = userStorageKey(BUSINESS_MEMORY_STORAGE_KEY);
          const suggestionsKey = userStorageKey(BUSINESS_PROFILE_SUGGESTIONS_STORAGE_KEY);
          if (!profileKey || !profileMetaKey || !memoryKey || !suggestionsKey) return;

          const storedProfile = localStorage.getItem(profileKey);
          const storedProfileMeta = localStorage.getItem(profileMetaKey);
          const storedMemory = localStorage.getItem(memoryKey);
          const storedSuggestions = localStorage.getItem(suggestionsKey);

          if (storedProfile && !hasDbProfile) {
            const parsedProfile = normalizeBusinessProfile(
              JSON.parse(storedProfile) as Partial<BusinessProfile>
            );
            setProfile(parsedProfile);
            setHasPendingChanges(false);
            console.log("[PROFILE CONTEXT] refreshed profile =", parsedProfile);
          }

          if (storedProfileMeta) {
            setProfileMeta(
              normalizeBusinessProfileMeta(
                JSON.parse(storedProfileMeta) as BusinessProfileMeta
              )
            );
          }

          if (storedMemory) {
            setMemory(
              normalizeBusinessMemory(
                JSON.parse(storedMemory) as Partial<BusinessMemoryItem>[]
              )
            );
          }

          if (storedSuggestions) {
            setSuggestedUpdates(
              normalizeSuggestedProfileUpdates(
                JSON.parse(storedSuggestions) as Partial<ProfileUpdateSuggestion>[]
              )
            );
          }
        } catch {
          // Ignore invalid storage state.
        } finally {
          setIsLoaded(true);
        }
      };

      void load();
    };

    loadLatestProfileState();
  }, [currentUser, isEnglishUi]);

  useEffect(() => {
    if (!currentUser) return;
    const reloadOnExternalUpdate = () => {
      const reload = async () => {
        try {
          const response = await fetch("/api/business-profile", {
            method: "GET",
            cache: "no-store",
            headers: {
              "x-neurova-user-id": currentUser.id,
            },
          });
          if (response.ok) {
            const data = (await response.json()) as {
              profile?: Partial<BusinessProfile>;
            };
            if (data.profile) {
              const dbProfile = normalizeBusinessProfile(data.profile);
              if (hasAnyProfileValue(dbProfile)) {
                setProfile(dbProfile);
                const profileKey = userStorageKey(BUSINESS_PROFILE_STORAGE_KEY);
                if (!profileKey) return;
                localStorage.setItem(profileKey, JSON.stringify(dbProfile));
                console.log("[PROFILE CONTEXT] refreshed profile =", dbProfile);
                return;
              }
            }
          }
        } catch {
          // Ignore db refresh errors.
        }

        try {
          const profileKey = userStorageKey(BUSINESS_PROFILE_STORAGE_KEY);
          const profileMetaKey = userStorageKey(BUSINESS_PROFILE_META_STORAGE_KEY);
          if (!profileKey || !profileMetaKey) return;

          const storedProfile = localStorage.getItem(profileKey);
          const storedProfileMeta = localStorage.getItem(profileMetaKey);
          if (!storedProfile) return;
          const parsedProfile = normalizeBusinessProfile(
            JSON.parse(storedProfile) as Partial<BusinessProfile>
          );
          setProfile(parsedProfile);
          setHasPendingChanges(false);
          if (storedProfileMeta) {
            setProfileMeta(
              normalizeBusinessProfileMeta(
                JSON.parse(storedProfileMeta) as BusinessProfileMeta
              )
            );
          }
          console.log("[PROFILE CONTEXT] refreshed profile =", parsedProfile);
        } catch {
          // Ignore invalid external updates.
        }
      };

      void reload();
    };

    const onStorage = (event: StorageEvent) => {
      const profileKey = userStorageKey(BUSINESS_PROFILE_STORAGE_KEY);
      const profileMetaKey = userStorageKey(BUSINESS_PROFILE_META_STORAGE_KEY);
      const memoryKey = userStorageKey(BUSINESS_MEMORY_STORAGE_KEY);
      const suggestionsKey = userStorageKey(BUSINESS_PROFILE_SUGGESTIONS_STORAGE_KEY);
      if (
        event.key === profileKey ||
        event.key === profileMetaKey ||
        event.key === memoryKey ||
        event.key === suggestionsKey
      ) {
        reloadOnExternalUpdate();
      }
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        reloadOnExternalUpdate();
      }
    };

    const onProfileSync = () => {
      reloadOnExternalUpdate();
    };

    window.addEventListener("storage", onStorage);
    window.addEventListener("focus", reloadOnExternalUpdate);
    window.addEventListener(BUSINESS_PROFILE_SYNC_EVENT, onProfileSync);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("focus", reloadOnExternalUpdate);
      window.removeEventListener(BUSINESS_PROFILE_SYNC_EVENT, onProfileSync);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [currentUser]);

  useEffect(() => {
    if (!saveFeedback.message || saveFeedback.type === "saving") return;
    const timer = setTimeout(
      () => setSaveFeedback({ type: "idle", message: "" }),
      saveFeedback.type === "error" ? 3200 : 1800
    );
    return () => clearTimeout(timer);
  }, [saveFeedback]);

  useEffect(() => {
    const openChatPage = () => {
      router.push("/");
    };

    const handleGlobalKeyDown = (event: globalThis.KeyboardEvent) => {
      const isAltC =
        event.altKey &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.shiftKey &&
        event.code === "KeyC";
      const isCtrlAltC =
        event.ctrlKey &&
        event.altKey &&
        !event.metaKey &&
        !event.shiftKey &&
        event.code === "KeyC";

      if (isAltC || isCtrlAltC) {
        event.preventDefault();
        openChatPage();
      }
    };

    window.addEventListener("keydown", handleGlobalKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", handleGlobalKeyDown, { capture: true });
  }, [router]);

  const hasMemory = useMemo(() => memory.length > 0, [memory.length]);
  const pendingSuggestedUpdates = useMemo(
    () => suggestedUpdates.filter((item) => item.status === "pending"),
    [suggestedUpdates]
  );
  const completionSummary = useMemo(() => {
    const missingImportant = PROFILE_COMPLETION_FIELDS.filter(
      (field) => profile[field].trim().length === 0
    );
    const completedCount = PROFILE_COMPLETION_FIELDS.length - missingImportant.length;
    const percentComplete = Math.round(
      (completedCount / PROFILE_COMPLETION_FIELDS.length) * 100
    );

    return {
      missingImportant,
      completedCount,
      percentComplete,
    };
  }, [profile]);

  const updateField = (key: keyof BusinessProfile, value: string) => {
    setProfile((prevProfile) => {
      if (prevProfile[key] === value) {
        return prevProfile;
      }

      const nextProfile = {
        ...prevProfile,
        [key]: value,
      };

      setProfileMeta((prevMeta) =>
        mergeBusinessProfileMetaWithSource({
          previousProfile: prevProfile,
          nextProfile,
          previousMeta: prevMeta,
          source: "manual",
        })
      );
      setHasPendingChanges(true);

      return nextProfile;
    });
  };

  const updateMemoryValue = (index: number, value: string) => {
    setHasPendingChanges(true);
    setMemory((prev) =>
      prev.map((item, itemIndex) =>
        itemIndex === index ? { ...item, value } : item
      )
    );
  };

  const removeMemoryItem = (index: number) => {
    setHasPendingChanges(true);
    setMemory((prev) => prev.filter((_, itemIndex) => itemIndex !== index));
  };

  const saveProfile = async () => {
    if (isSaving || !hasPendingChanges) return;

    setIsSaving(true);
    setSaveFeedback({
      type: "saving",
      message: t.saving,
    });

    const prunedSuggestions = pruneSuggestedProfileUpdatesAgainstProfile(
      suggestedUpdates,
      profile
    );
    let nextProfile = profile;
    let nextProfileMeta = profileMeta;

    try {
      if (!currentUser) return;
      const response = await fetch("/api/business-profile", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-neurova-user-id": currentUser.id,
        },
        body: JSON.stringify({ profile }),
      });

      if (!response.ok) {
        throw new Error("Save failed");
      }

      const data = (await response.json()) as {
        profile?: Partial<BusinessProfile>;
      };
      if (data.profile) {
        nextProfile = normalizeBusinessProfile(data.profile);
        setProfile(nextProfile);
      }
    } catch {
      setSaveFeedback({
        type: "error",
        message: isEnglishUi ? "Save failed. Try again." : "Save fail hua. Dobara try karo.",
      });
      setIsSaving(false);
      return;
    }

    nextProfileMeta = mergeBusinessProfileMetaWithSource({
      previousProfile: profile,
      nextProfile,
      previousMeta: profileMeta,
      source: "manual",
    });
    setProfileMeta(nextProfileMeta);

    const profileKey = userStorageKey(BUSINESS_PROFILE_STORAGE_KEY);
    const profileMetaKey = userStorageKey(BUSINESS_PROFILE_META_STORAGE_KEY);
    const memoryKey = userStorageKey(BUSINESS_MEMORY_STORAGE_KEY);
    const suggestionsKey = userStorageKey(BUSINESS_PROFILE_SUGGESTIONS_STORAGE_KEY);
    if (!profileKey || !profileMetaKey || !memoryKey || !suggestionsKey) return;

    localStorage.setItem(profileKey, JSON.stringify(nextProfile));
    localStorage.setItem(profileMetaKey, JSON.stringify(nextProfileMeta));
    localStorage.setItem(memoryKey, JSON.stringify(memory));
    localStorage.setItem(suggestionsKey, JSON.stringify(prunedSuggestions));
    setSuggestedUpdates(prunedSuggestions);
    setHasPendingChanges(false);

    try {
      const sharedContextKey = userStorageKey(SHARED_CONTEXT_STORAGE_KEY);
      if (!sharedContextKey) return;

      const storedSharedContext = sessionStorage.getItem(sharedContextKey);
      const parsedSharedContext = storedSharedContext
        ? (JSON.parse(storedSharedContext) as Partial<SharedBusinessContext>)
        : EMPTY_SHARED_BUSINESS_CONTEXT;
      const normalizedSharedContext: SharedBusinessContext = {
        businessType:
          typeof parsedSharedContext.businessType === "string"
            ? parsedSharedContext.businessType
            : null,
        problemType:
          typeof parsedSharedContext.problemType === "string"
            ? parsedSharedContext.problemType
            : null,
        businessImpact:
          typeof parsedSharedContext.businessImpact === "string"
            ? parsedSharedContext.businessImpact
            : null,
        userExperienceLevel:
          typeof parsedSharedContext.userExperienceLevel === "string"
            ? parsedSharedContext.userExperienceLevel
            : null,
        confidenceLevel:
          typeof parsedSharedContext.confidenceLevel === "string"
            ? parsedSharedContext.confidenceLevel
            : null,
        customerIssue:
          typeof parsedSharedContext.customerIssue === "string"
            ? parsedSharedContext.customerIssue
            : null,
        budgetConstraint:
          typeof parsedSharedContext.budgetConstraint === "string"
            ? parsedSharedContext.budgetConstraint
            : null,
        businessEnvironment:
          typeof parsedSharedContext.businessEnvironment === "string"
            ? parsedSharedContext.businessEnvironment
            : null,
        currentProblem:
          typeof parsedSharedContext.currentProblem === "string"
            ? parsedSharedContext.currentProblem
            : null,
        userGoal:
          typeof parsedSharedContext.userGoal === "string"
            ? parsedSharedContext.userGoal
            : null,
        conversationLanguage:
          parsedSharedContext.conversationLanguage === "english" ||
          parsedSharedContext.conversationLanguage === "hinglish"
            ? parsedSharedContext.conversationLanguage
            : null,
      };

      const merged = mergeSharedContextWithBusinessProfile(
        normalizedSharedContext,
        nextProfile
      );
      sessionStorage.setItem(sharedContextKey, JSON.stringify(merged));
    } catch {
      // Ignore session sync errors.
    }

    setSaveFeedback({
      type: "success",
      message: isEnglishUi ? "Business Profile saved." : "Business Profile save ho gaya.",
    });
    setIsSaving(false);
  };

  const approveSuggestion = (index: number) => {
    setSuggestedUpdates((prev) => {
      const next = [...prev];
      const suggestion = pendingSuggestedUpdates[index];
      if (!suggestion) return prev;
      const originalIndex = next.findIndex(
        (item) =>
          item.field === suggestion.field &&
          item.value === suggestion.value &&
          item.status === "pending"
      );
      if (originalIndex === -1) return prev;

      setProfile((current) => {
        const nextProfile = {
          ...current,
          [suggestion.field]:
            suggestion.suggestedValue ?? suggestion.value,
        };
        setProfileMeta((prevMeta) =>
          mergeBusinessProfileMetaWithSource({
            previousProfile: current,
            nextProfile,
            previousMeta: prevMeta,
            source: "manual",
          })
        );
        return nextProfile;
      });
      setHasPendingChanges(true);

      next[originalIndex] = {
        ...next[originalIndex],
        status: "approved",
      };
      return next;
    });
  };

  const rejectSuggestion = (index: number) => {
    setHasPendingChanges(true);
    setSuggestedUpdates((prev) => {
      const next = [...prev];
      const suggestion = pendingSuggestedUpdates[index];
      if (!suggestion) return prev;
      const originalIndex = next.findIndex(
        (item) =>
          item.field === suggestion.field &&
          item.value === suggestion.value &&
          item.status === "pending"
      );
      if (originalIndex === -1) return prev;
      next[originalIndex] = {
        ...next[originalIndex],
        status: "rejected",
      };
      return next;
    });
  };

  const pageClass = isLightTheme ? "bg-[#f7f7f8] text-[#1f2937]" : "bg-[#0B0F2B] text-slate-100";
  const panelClass = isLightTheme
    ? "rounded-2xl border border-[#d9d9e3] bg-white p-4 shadow-[0_2px_8px_rgba(15,23,42,0.05)]"
    : "rounded-2xl border border-white/10 bg-[#0f1a35]/88 p-4 shadow-[0_12px_26px_rgba(2,8,23,0.26)]";
  const inputClass = isLightTheme
    ? "mt-1.5 h-10 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-900 placeholder:text-slate-500 focus:border-slate-400 focus:outline-none"
    : "mt-1.5 h-10 w-full rounded-xl border border-white/12 bg-white/[0.03] px-3 text-sm text-slate-100 placeholder:text-slate-400 focus:border-cyan-300/35 focus:outline-none";
  const sectionTitleClass = isLightTheme
    ? "text-sm font-semibold uppercase tracking-[0.14em] text-slate-600"
    : "text-sm font-semibold uppercase tracking-[0.14em] text-cyan-100/90";

  if (!isLoaded) {
    if (!isAuthChecked) {
      return (
        <div className={`min-h-screen px-4 py-8 ${pageClass}`} />
      );
    }

    if (!currentUser) {
      return null;
    }

    return (
      <div className={`min-h-screen px-4 py-8 ${pageClass}`}>
        <div className={`mx-auto max-w-4xl p-6 ${panelClass}`}>
          {t.loading}
        </div>
      </div>
    );
  }

  if (!isAuthChecked) {
    return (
      <div className={`min-h-screen px-4 py-8 ${pageClass}`} />
    );
  }

  if (!currentUser) {
    return null;
  }

  return (
    <div
      className={`min-h-screen px-3 py-4 ${pageClass} sm:px-5 sm:py-6`}
    >
      <div className="mx-auto w-full max-w-5xl">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <p className={`text-xs font-semibold uppercase tracking-[0.16em] ${isLightTheme ? "text-slate-500" : "text-cyan-200/85"}`}>
              Neurova
            </p>
            <h1 className={`mt-1 text-2xl font-semibold sm:text-3xl ${isLightTheme ? "text-slate-900" : "text-slate-50"}`}>
              {t.title}
            </h1>
            <p className={`mt-1 text-sm ${isLightTheme ? "text-slate-600" : "text-slate-300"}`}>
              {t.subtitle}
            </p>
            <p className={`mt-1 text-xs sm:text-[13px] ${isLightTheme ? "text-slate-500" : "text-cyan-100/80"}`}>
              {t.autoFillNote}
            </p>
          </div>
          <Link
            href="/"
            className={`rounded-full border px-3 py-1.5 text-sm font-semibold transition ${
              isLightTheme
                ? "border-slate-300 bg-white text-slate-700 hover:bg-slate-100"
                : "border-cyan-300/35 bg-cyan-300/[0.11] text-cyan-100 hover:bg-cyan-300/[0.18]"
            }`}
          >
            {t.backToChat}
          </Link>
        </div>

        <section className={`mb-4 ${panelClass}`}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className={sectionTitleClass}>
              {t.progressTitle}
            </h2>
            <span
              className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${
                completionSummary.percentComplete >= 80
                  ? isLightTheme
                    ? "border-emerald-300 bg-emerald-100 text-emerald-900"
                    : "border-emerald-300/35 bg-emerald-300/[0.1] text-emerald-100"
                  : completionSummary.percentComplete <= 30
                    ? isLightTheme
                      ? "border-amber-300 bg-amber-100 text-amber-900"
                      : "border-amber-200/35 bg-amber-200/[0.1] text-amber-100"
                    : isLightTheme
                      ? "border-slate-300 bg-slate-100 text-slate-700"
                      : "border-cyan-200/35 bg-cyan-200/[0.1] text-cyan-100"
              }`}
            >
              {t.title} {completionSummary.percentComplete}% {t.completeSuffix}
            </span>
          </div>

          <div className={`mt-3 h-2.5 w-full overflow-hidden rounded-full ${isLightTheme ? "border border-slate-300 bg-slate-100" : "border border-white/10 bg-slate-900/45"}`}>
            <div
              className={`h-full rounded-full transition-all duration-300 ${
                completionSummary.percentComplete >= 80
                  ? "bg-emerald-300/80"
                  : completionSummary.percentComplete <= 30
                    ? "bg-amber-300/80"
                    : "bg-cyan-300/85"
              }`}
              style={{ width: `${completionSummary.percentComplete}%` }}
            />
          </div>

          <p className={`mt-3 text-sm ${isLightTheme ? "text-slate-600" : "text-slate-300"}`}>
            {t.completionHelp}
          </p>

          {completionSummary.missingImportant.length > 0 ? (
            <p className={`mt-2 text-sm ${isLightTheme ? "text-slate-700" : "text-slate-200"}`}>
              {t.missing}:{" "}
              <span className={isLightTheme ? "text-slate-600" : "text-slate-300"}>
                {completionSummary.missingImportant
                  .map((field) => getMemoryLabel(field, isEnglishUi))
                  .join(", ")}
              </span>
            </p>
          ) : (
            <p className="mt-2 text-sm text-emerald-300">
              {t.allImportantDone}
            </p>
          )}

          {completionSummary.percentComplete <= 30 ? (
            <p className={`mt-1.5 text-xs ${isLightTheme ? "text-amber-800" : "text-amber-100/85"}`}>
              {t.quickStart}
            </p>
          ) : completionSummary.percentComplete >= 80 ? (
            <p className={`mt-1.5 text-xs ${isLightTheme ? "text-emerald-800" : "text-emerald-100/85"}`}>
              {t.excellent}
            </p>
          ) : null}
        </section>

        <div className="grid gap-3 sm:gap-4 lg:grid-cols-2">
          {PROFILE_SECTIONS.map((section) => (
            <section
              key={section.title}
              className={panelClass}
            >
              <h2 className={sectionTitleClass}>
                {getSectionTitle(section.title, isEnglishUi)}
              </h2>
              <div className="mt-3 space-y-3">
                {section.fields.map((field) => (
                  <label key={field.key} className="block">
                    <span className={`flex flex-wrap items-center gap-1.5 text-xs font-semibold tracking-[0.06em] ${isLightTheme ? "text-slate-700" : "text-slate-300"}`}>
                      <span>{getFieldLabel(field.key, isEnglishUi)}</span>
                      {profileMeta[field.key]?.source === "chat" &&
                      profileMeta[field.key]?.editedAfterAutoFill !== true ? (
                        <span className={`rounded-full border px-1.5 py-0.5 text-[10px] font-semibold tracking-[0.04em] ${
                          isLightTheme
                            ? "border-slate-300 bg-slate-100 text-slate-700"
                            : "border-cyan-200/30 bg-cyan-200/[0.1] text-cyan-100"
                        }`}>
                          {t.autoDetected}
                        </span>
                      ) : null}
                      {profileMeta[field.key]?.editedAfterAutoFill ? (
                        <span className={`rounded-full border px-1.5 py-0.5 text-[10px] font-semibold tracking-[0.04em] ${
                          isLightTheme
                            ? "border-emerald-300 bg-emerald-100 text-emerald-900"
                            : "border-emerald-300/25 bg-emerald-300/[0.08] text-emerald-100/90"
                        }`}>
                          {t.edited}
                        </span>
                      ) : null}
                    </span>
                    <input
                      type="text"
                      value={profile[field.key]}
                      onChange={(event) => updateField(field.key, event.target.value)}
                      placeholder={getFieldPlaceholder(field.key, isEnglishUi)}
                      className={inputClass}
                    />
                  </label>
                ))}
              </div>
            </section>
          ))}
        </div>

        <section className={`mt-4 ${panelClass}`}>
          <div className="flex items-center justify-between gap-2">
            <h2 className={sectionTitleClass}>
              {t.memoryTitle}
            </h2>
            <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${isLightTheme ? "border-slate-300 bg-slate-100 text-slate-700" : "border-cyan-200/35 bg-cyan-200/[0.1] text-cyan-100"}`}>
              {t.memorySubtitle}
            </span>
          </div>

          {hasMemory ? (
            <div className="mt-3 space-y-2.5">
              {memory.map((item, index) => (
                <div
                  key={`${item.field}-${index}`}
                  className={`rounded-xl border p-2.5 ${isLightTheme ? "border-slate-300 bg-slate-50" : "border-white/12 bg-white/[0.04]"}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className={`text-xs font-semibold uppercase tracking-[0.08em] ${isLightTheme ? "text-slate-700" : "text-slate-300"}`}>
                      {getMemoryLabel(item.field, isEnglishUi)}
                    </p>
                    <button
                      type="button"
                      onClick={() => removeMemoryItem(index)}
                      className="rounded-lg border border-rose-300/35 bg-rose-300/[0.1] px-2 py-0.5 text-xs font-semibold text-rose-100 transition hover:bg-rose-300/[0.2]"
                    >
                      {t.remove}
                    </button>
                  </div>
                  <input
                    type="text"
                    value={item.value}
                    onChange={(event) => updateMemoryValue(index, event.target.value)}
                    className={isLightTheme
                      ? "mt-1.5 h-9 w-full rounded-lg border border-slate-300 bg-white px-2.5 text-sm text-slate-900 focus:border-slate-400 focus:outline-none"
                      : "mt-1.5 h-9 w-full rounded-lg border border-white/12 bg-white/[0.03] px-2.5 text-sm text-slate-100 focus:border-cyan-300/35 focus:outline-none"}
                  />
                  <p className={`mt-1.5 text-[11px] ${isLightTheme ? "text-slate-600" : "text-cyan-100/80"}`}>
                    {t.confidence}: {(item.confidence * 100).toFixed(0)}%
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <p className={`mt-3 text-sm ${isLightTheme ? "text-slate-600" : "text-slate-300"}`}>
              {t.memoryEmpty}
            </p>
          )}
        </section>

        {pendingSuggestedUpdates.length > 0 ? (
        <section className={`mt-4 rounded-2xl border p-4 ${isLightTheme ? "border-amber-300/60 bg-amber-50" : "border-amber-200/25 bg-amber-300/[0.06]"} shadow-[0_12px_30px_rgba(2,8,23,0.24)]`}>
          <div className="flex items-center justify-between gap-2">
            <h2 className={`text-sm font-semibold uppercase tracking-[0.14em] ${isLightTheme ? "text-amber-900" : "text-amber-100/90"}`}>
              {t.suggestedUpdates}
            </h2>
            <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${
              isLightTheme
                ? "border-amber-300 bg-amber-100 text-amber-900"
                : "border-amber-200/35 bg-amber-200/[0.12] text-amber-100"
            }`}>
              {t.reviewBeforeApply}
            </span>
          </div>
          <p className={`mt-2 text-xs sm:text-[13px] ${isLightTheme ? "text-amber-800" : "text-amber-100/85"}`}>
            {t.suggestionHint}
          </p>

            <div className="mt-3 space-y-2.5">
              {pendingSuggestedUpdates.map((item, index) => (
                <div
                  key={`${item.field}-${index}`}
                  className={`rounded-xl border p-2.5 ${isLightTheme ? "border-slate-300 bg-white" : "border-white/12 bg-white/[0.04]"}`}
                >
                  <p className={`text-xs font-semibold uppercase tracking-[0.08em] ${isLightTheme ? "text-slate-700" : "text-slate-300"}`}>
                    {getMemoryLabel(item.field, isEnglishUi)}
                  </p>
                  <p className={`mt-1 text-xs ${isLightTheme ? "text-slate-500" : "text-slate-400"}`}>{t.current}</p>
                  <p className={`text-sm ${isLightTheme ? "text-slate-700" : "text-slate-200"}`}>
                    {item.currentValue?.trim() ? item.currentValue : t.notSet}
                  </p>
                  <p className={`mt-1.5 text-xs ${isLightTheme ? "text-slate-500" : "text-slate-400"}`}>{t.suggested}</p>
                  <p className={`text-sm ${isLightTheme ? "text-slate-900" : "text-slate-100"}`}>
                    {item.suggestedValue ?? item.value}
                  </p>
                  <p className={`mt-1 text-[11px] ${isLightTheme ? "text-amber-800" : "text-amber-100/80"}`}>
                    {t.source}: {item.source} | {t.confidence}: {(item.confidence * 100).toFixed(0)}%
                  </p>
                  <div className="mt-2 flex gap-2">
                    <button
                      type="button"
                      onClick={() => approveSuggestion(index)}
                      className={`rounded-lg border px-2 py-1 text-xs font-semibold transition ${
                        isLightTheme
                          ? "border-emerald-300 bg-emerald-100 text-emerald-900 hover:bg-emerald-200"
                          : "border-emerald-300/35 bg-emerald-300/[0.1] text-emerald-100 hover:bg-emerald-300/[0.2]"
                      }`}
                    >
                      {t.accept}
                    </button>
                    <button
                      type="button"
                      onClick={() => rejectSuggestion(index)}
                      className="rounded-lg border border-rose-300/35 bg-rose-300/[0.1] px-2 py-1 text-xs font-semibold text-rose-100 transition hover:bg-rose-300/[0.2]"
                    >
                      {t.reject}
                    </button>
                  </div>
                </div>
              ))}
            </div>
        </section>
        ) : null}

        <div className="mt-4 flex items-center justify-between gap-3">
          <p className={`text-xs ${isLightTheme ? "text-slate-500" : "text-slate-400"}`}>
            {t.stableMemoryNote}
          </p>
          <button
            type="button"
            onClick={() => void saveProfile()}
            disabled={!hasPendingChanges || isSaving}
            className={`rounded-xl border px-4 py-2 text-sm font-semibold transition ${
              !hasPendingChanges || isSaving
                ? "cursor-not-allowed border-cyan-300/18 bg-cyan-300/45 text-slate-900/70"
                : "border-cyan-300/35 bg-cyan-300/90 text-slate-950 hover:bg-cyan-200"
            }`}
          >
            {isSaving ? t.saving : t.save}
          </button>
        </div>
        {saveFeedback.message ? (
          <p
            className={`mt-2 text-sm ${
              saveFeedback.type === "error"
                ? isLightTheme ? "text-rose-700" : "text-rose-300"
                : saveFeedback.type === "saving"
                  ? isLightTheme ? "text-slate-700" : "text-cyan-200"
                  : isLightTheme ? "text-emerald-700" : "text-emerald-300"
            }`}
          >
            {saveFeedback.message}
          </p>
        ) : (
          <p className={`mt-2 text-sm ${isLightTheme ? "text-slate-500" : "text-slate-400"}`}>
            {hasPendingChanges ? t.unsaved : t.allSaved}
          </p>
        )}
      </div>
      </div>
  );
}
