"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChangeEvent, FormEvent, KeyboardEvent, useEffect, useRef, useState } from "react";

import {
  clearSession,
  getCurrentUserFromStorage,
  getScopedStorageKey,
  type AuthUser,
} from "@/lib/auth";
import {
  CHAT_MODE_OPTIONS,
  DEFAULT_CHAT_MODE,
  type ChatMode,
} from "@/lib/chatMode";
import {
  BUSINESS_MEMORY_STORAGE_KEY,
  BUSINESS_PROFILE_META_STORAGE_KEY,
  BUSINESS_PROFILE_STORAGE_KEY,
  BUSINESS_PROFILE_SUGGESTIONS_STORAGE_KEY,
  BUSINESS_PROFILE_SYNC_EVENT,
  EMPTY_BUSINESS_PROFILE,
  getBusinessProfileState,
  getMissingImportantFields,
  mergeSharedContextWithBusinessProfile,
  normalizeBusinessMemory,
  normalizeBusinessProfileMeta,
  normalizeBusinessProfile,
  mergeSuggestedProfileUpdates,
  normalizeSuggestedProfileUpdates,
  pruneSuggestedProfileUpdatesAgainstProfile,
  mergeBusinessProfileMetaWithSource,
  type BusinessMemoryItem,
  type BusinessProfileMeta,
  type BusinessProfile,
  type ProfileUpdateSuggestion,
} from "@/lib/businessProfile";
import {
  EMPTY_SHARED_BUSINESS_CONTEXT,
  SHARED_CONTEXT_STORAGE_KEY,
  type SharedBusinessContext,
  type SharedTaskState,
} from "@/lib/sharedContext";
import {
  DEFAULT_USER_SETTINGS,
  USER_SETTINGS_STORAGE_KEY,
  USER_SETTINGS_SYNC_EVENT,
  normalizeUserSettings,
  type UserSettings,
} from "@/lib/userSettings";

const MANAGER_SECTION_TITLES = [
  "Situation",
  "Manager Insight",
  "Decision",
  "Today's Priority",
  "Action Steps",
  "Watch",
] as const;

type Message = {
  id: number;
  role: "user" | "assistant";
  text: string;
  attachments?: MessageAttachment[];
  kind?: "thinking";
  renderMode?: "plain" | "structured";
};

type ChatSession = {
  id: string;
  title: string;
  messages: Message[];
  createdAt: string;
  updatedAt: string;
};

type ChatApiMessage = {
  role: "user" | "assistant";
  content: string;
};

type AssistantApiProvider =
  | "advisor"
  | "chat"
  | "helper"
  | "thinking"
  | "decision"
  | "direct"
  | "deepseek-reasoning"
  | "content";
type AssistantApiMessageType =
  | "conversation"
  | "business_strategy"
  | "seasonal_strategy"
  | "calculation"
  | "marketing_content";

type PendingAttachment = {
  id: string;
  file: File;
  previewUrl?: string;
};

type MessageAttachment = {
  id: string;
  name: string;
  type: string;
  size: number;
  previewUrl?: string;
};

const MAX_IMAGE_UPLOAD_SIZE_BYTES = 3 * 1024 * 1024;
const MAX_IMAGE_DIMENSION = 1600;

async function optimizeImageForUpload(file: File): Promise<File> {
  if (typeof window === "undefined") return file;
  if (!file.type.startsWith("image/")) return file;
  if (file.size <= MAX_IMAGE_UPLOAD_SIZE_BYTES) return file;

  return new Promise((resolve) => {
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();

    img.onload = () => {
      const width = img.naturalWidth;
      const height = img.naturalHeight;
      const scale = Math.min(1, MAX_IMAGE_DIMENSION / Math.max(width, height));
      const targetWidth = Math.max(1, Math.round(width * scale));
      const targetHeight = Math.max(1, Math.round(height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = targetWidth;
      canvas.height = targetHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        URL.revokeObjectURL(objectUrl);
        resolve(file);
        return;
      }
      ctx.drawImage(img, 0, 0, targetWidth, targetHeight);
      canvas.toBlob(
        (blob) => {
          URL.revokeObjectURL(objectUrl);
          if (!blob) {
            resolve(file);
            return;
          }
          if (blob.size >= file.size) {
            resolve(file);
            return;
          }
          const baseName = file.name.replace(/\.[^.]+$/, "");
          resolve(
            new File([blob], `${baseName}.jpg`, {
              type: "image/jpeg",
              lastModified: Date.now(),
            })
          );
        },
        "image/jpeg",
        0.82
      );
    };

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(file);
    };

    img.src = objectUrl;
  });
}

type TaskStatus = "pending" | "done" | "not_done";
type TaskOutcome = "done" | "not_done";

type TaskRecord = {
  text: string;
  status: TaskStatus;
  date: string;
};

type ManagerReaction = {
  immediateText: string;
  followupPrompt: string;
  fallbackPriority: string;
  memoryEvent: {
    source: "task_status";
    outcome: TaskOutcome;
    taskText: string;
    date: string;
  };
};

const INITIAL_MESSAGES: Message[] = [
  // Empty initial state so we can show a proper guided first-screen experience.
];

const THINKING_WAVE_STEPS = 3;
const THINKING_INTERVAL_MS = 320;
const ENABLE_THINKING_DEBUG = false;

const CHAT_SESSIONS_STORAGE_KEY = "neural-x-chat-sessions";
const ACTIVE_CHAT_SESSION_ID_KEY = "neural-x-active-chat-session-id";
const MODE_STORAGE_KEY = "neural-x-mode";
const TASK_STORAGE_KEY = "neural-x-task-history";
const SIDEBAR_COLLAPSED_KEY = "neural-x-sidebar-collapsed";
const BUSINESS_CONTEXT_COLLAPSED_KEY = "neural-x-business-context-collapsed";
const DEFAULT_PRIORITY_TEXT = "Restaurant ke bahar visible menu board lagao";
const CHAT_PROFILE_SUMMARY_FIELDS: Array<{
  key: keyof BusinessProfile;
  label: string;
}> = [
  { key: "ownerName", label: "Owner Name" },
  { key: "businessName", label: "Business Name" },
  { key: "businessType", label: "Business Type" },
  { key: "mainGoal", label: "Main Goal" },
  { key: "budgetLevel", label: "Budget Level" },
  { key: "teamSize", label: "Team Size" },
];

type ParsedManagerSection = {
  title: string;
  content: string;
};

type StructuredReplySection = {
  title:
    | "Situation"
    | "Manager Insight"
    | "Decision"
    | "Today's Priority"
    | "Action Steps"
    | "Watch"
    | "Short Answer"
    | "Why"
    | "Next Step";
  content: string;
  variant?: "text" | "steps";
};

function formatStructuredSectionTitle(title: StructuredReplySection["title"]): string {
  if (title === "Situation") return "🧠 Situation";
  if (title === "Manager Insight") return "⚡ Manager Insight";
  if (title === "Decision") return "🎯 Decision";
  if (title === "Today's Priority") return "📌 Today's Priority";
  if (title === "Action Steps") return "✅ Action Steps";
  if (title === "Watch") return "👀 Watch";
  return title;
}

function normalizeSharedContext(
  candidate: Partial<SharedBusinessContext> | null | undefined
): SharedBusinessContext {
  const sanitize = (value: unknown): string | null =>
    typeof value === "string" && value.trim().length > 0 ? value.trim() : null;

  return {
    businessType: sanitize(candidate?.businessType),
    problemType: sanitize(candidate?.problemType),
    businessImpact: sanitize(candidate?.businessImpact),
    userExperienceLevel: sanitize(candidate?.userExperienceLevel),
    confidenceLevel: sanitize(candidate?.confidenceLevel),
    customerIssue: sanitize(candidate?.customerIssue),
    budgetConstraint: sanitize(candidate?.budgetConstraint),
    businessEnvironment: sanitize(candidate?.businessEnvironment),
    currentProblem: sanitize(candidate?.currentProblem),
    userGoal: sanitize(candidate?.userGoal),
    conversationLanguage:
      candidate?.conversationLanguage === "english" ||
      candidate?.conversationLanguage === "hinglish"
        ? candidate.conversationLanguage
        : null,
  };
}

function parseManagerSections(text: string): ParsedManagerSection[] | null {
  const sections: ParsedManagerSection[] = [];
  let currentSection: ParsedManagerSection | null = null;

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    const normalizedHeading = trimmed.replace(/\s*[:\-]\s*$/, "");

    if (!trimmed) {
      if (currentSection) {
        currentSection.content += currentSection.content ? "\n" : "";
      }
      continue;
    }

    if (
      MANAGER_SECTION_TITLES.includes(
        normalizedHeading as (typeof MANAGER_SECTION_TITLES)[number]
      )
    ) {
      if (currentSection) {
        currentSection.content = currentSection.content.trim();
        sections.push(currentSection);
      }

      currentSection = {
        title: normalizedHeading,
        content: "",
      };
      continue;
    }

    if (!currentSection) {
      return null;
    }

    currentSection.content += `${currentSection.content ? "\n" : ""}${trimmed}`;
  }

  if (currentSection) {
    currentSection.content = currentSection.content.trim();
    sections.push(currentSection);
  }

  return sections.length > 0 ? sections : null;
}

function extractStepLines(content: string): string[] {
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => /^\d+[\).\s-]|^[-*•]\s+/.test(line))
    .map((line) => line.replace(/^\d+[\).\s-]*|^[-*•]\s+/, "").trim())
    .filter(Boolean);
}

function buildStructuredFromManagerSections(
  sections: ParsedManagerSection[]
): StructuredReplySection[] | null {
  const byTitle = new Map(sections.map((item) => [item.title, item.content.trim()]));
  const structured: StructuredReplySection[] = [];

  for (const title of MANAGER_SECTION_TITLES) {
    const content = byTitle.get(title)?.trim();
    if (!content) continue;

    if (title === "Action Steps") {
      const steps = extractStepLines(content);
      structured.push({
        title,
        content: steps.length > 0 ? steps.join("\n") : content,
        variant: steps.length > 0 ? "steps" : "text",
      });
      continue;
    }

    structured.push({
      title,
      content,
      variant: "text",
    });
  }

  return structured.length >= 2 ? structured : null;
}

function parseStructuredReplySections(text: string): StructuredReplySection[] | null {
  const managerSections = parseManagerSections(text);
  if (managerSections) {
    return buildStructuredFromManagerSections(managerSections);
  }

  const normalized = text.trim();
  if (!normalized) return null;

  const stepLines = extractStepLines(normalized);
  const paragraphs = normalized
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean);
  const isActionable = stepLines.length >= 2 || normalized.length >= 260;
  if (!isActionable) return null;

  const shortAnswer = paragraphs[0] ?? "";
  const why = paragraphs[1] ?? "";
  const nextStep = stepLines.length > 0 ? stepLines.join("\n") : paragraphs[2] ?? "";
  const watchParagraph = paragraphs.find((item) => /\b(watch|monitor|track)\b/i.test(item)) ?? "";

  const structured: StructuredReplySection[] = [];
  if (shortAnswer) structured.push({ title: "Short Answer", content: shortAnswer, variant: "text" });
  if (why) structured.push({ title: "Why", content: why, variant: "text" });
  if (nextStep) {
    structured.push({
      title: "Next Step",
      content: nextStep,
      variant: stepLines.length > 0 ? "steps" : "text",
    });
  }
  if (watchParagraph) structured.push({ title: "Watch", content: watchParagraph, variant: "text" });

  return structured.length >= 2 ? structured : null;
}

function extractPriorityFromReply(text: string): string | null {
  const normalized = text.trim();
  if (!normalized) return null;

  const managerSections = parseManagerSections(normalized);
  const managerPriority = managerSections
    ?.find((section) => section.title === "Today's Priority")
    ?.content?.trim();
  if (managerPriority) return managerPriority;

  const structuredSections = parseStructuredReplySections(normalized);
  const structuredPriority = structuredSections
    ?.find((section) => section.title === "Next Step")
    ?.content?.split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  if (structuredPriority) return structuredPriority;

  const isSectionHeading = (line: string) =>
    /^(situation|manager insight|decision|today'?s priority|action steps|watch|short answer|why|next step)\s*[:\-]?$/i.test(
      line.trim()
    );

  const lines = normalized.split(/\r?\n/).map((line) => line.trim());
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const headingMatch = line.match(/^today'?s priority\s*[:\-]?\s*(.*)$/i);
    if (!headingMatch) continue;

    const inlineValue = headingMatch[1]?.trim();
    if (inlineValue) return inlineValue;

    for (let nextIndex = index + 1; nextIndex < lines.length; nextIndex += 1) {
      const candidate = lines[nextIndex];
      if (!candidate) continue;
      if (isSectionHeading(candidate)) break;
      return candidate;
    }
  }

  const labelPatterns = [
    /today'?s priority\s*[:\-]\s*(.+)/i,
    /today priority\s*[:\-]\s*(.+)/i,
    /next step\s*[:\-]\s*(.+)/i,
    /priority\s*[:\-]\s*(.+)/i,
  ];
  for (const line of normalized.split(/\r?\n/).map((item) => item.trim()).filter(Boolean)) {
    for (const pattern of labelPatterns) {
      const match = line.match(pattern);
      if (match?.[1]?.trim()) {
        return match[1].trim();
      }
    }
  }

  const firstContentLine = normalized
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => {
      if (!line) return false;
      if (MANAGER_SECTION_TITLES.includes(line as (typeof MANAGER_SECTION_TITLES)[number])) {
        return false;
      }
      return !/^(situation|manager insight|decision|action steps|watch)\s*[:\-]?$/i.test(line);
    });

  return firstContentLine ?? null;
}

function getLocalDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function syncMemoryWithProfile(
  memory: BusinessMemoryItem[],
  profile: BusinessProfile
): BusinessMemoryItem[] {
  return memory.filter((item) => {
    const profileValue = profile[item.field]?.trim();
    if (!profileValue) return true;
    return profileValue.toLowerCase() === item.value.trim().toLowerCase();
  });
}

function createManagerReaction(
  outcome: TaskOutcome,
  taskText: string,
  date: string
): ManagerReaction {
  const anchoredTaskText = taskText.trim();

  if (outcome === "done") {
    return {
      immediateText: `Thik hai. Aaj ka task "${anchoredTaskText}" complete ho gaya. Ab next step define karte hain.`,
      followupPrompt:
        `Task done ho gaya: "${anchoredTaskText}". Ab momentum maintain karne ke liye next practical priority do.`,
      fallbackPriority: "Aaj 1 naya lead ko direct call karke conversion push karo.",
      memoryEvent: {
        source: "task_status",
        outcome,
        taskText,
        date,
      },
    };
  }

  return {
    immediateText: `Thik hai. Aaj ka task "${anchoredTaskText}" tha. Kya issue aaya: time, clarity, ya materials?`,
    followupPrompt:
      `Task not done raha: "${anchoredTaskText}". Ab recovery ke liye ek short, practical next priority do jo blockage clear kare.`,
    fallbackPriority:
      "15 min me blocker identify karo aur ek clear fix action decide karke execute karo.",
    memoryEvent: {
      source: "task_status",
      outcome,
      taskText,
      date,
    },
  };
}

export default function Home() {
  const router = useRouter();
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [isAuthChecked, setIsAuthChecked] = useState(false);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [thinkingWaveStep, setThinkingWaveStep] = useState(0);
  const [chatSessions, setChatSessions] = useState<ChatSession[]>([]);
  const [activeChatSessionId, setActiveChatSessionId] = useState<string | null>(null);
  const [mode, setMode] = useState<ChatMode>(DEFAULT_CHAT_MODE);
  const [sharedContext, setSharedContext] = useState<SharedBusinessContext>(
    EMPTY_SHARED_BUSINESS_CONTEXT
  );
  const [businessProfile, setBusinessProfile] = useState<BusinessProfile>(
    EMPTY_BUSINESS_PROFILE
  );
  const [businessMemory, setBusinessMemory] = useState<BusinessMemoryItem[]>([]);
  const [suggestedProfileUpdates, setSuggestedProfileUpdates] = useState<
    ProfileUpdateSuggestion[]
  >([]);
  const [isBusinessProfileLoaded, setIsBusinessProfileLoaded] = useState(false);
  const [taskHistory, setTaskHistory] = useState<TaskRecord[]>([]);
  const [isTaskReactionLoading, setIsTaskReactionLoading] = useState(false);
  const [profileHelperNote, setProfileHelperNote] = useState<string | null>(null);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isBusinessContextCollapsed, setIsBusinessContextCollapsed] = useState(false);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>([]);
  const [userSettings, setUserSettings] = useState<UserSettings>(DEFAULT_USER_SETTINGS);
  const [copiedMessageId, setCopiedMessageId] = useState<number | null>(null);
  const [editingMessageId, setEditingMessageId] = useState<number | null>(null);
  const userStorageKey = (baseKey: string) =>
    currentUser ? getScopedStorageKey(baseKey, currentUser.id) : null;
  const messageEndRef = useRef<HTMLDivElement | null>(null);
  const chatContainerRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const attachmentInputRef = useRef<HTMLInputElement | null>(null);
  const chatFormRef = useRef<HTMLFormElement | null>(null);
  const wasLoadingRef = useRef(false);
  const submitLockRef = useRef(false);
  const copiedFeedbackTimerRef = useRef<number | null>(null);

  const createId = () => Date.now() + Math.floor(Math.random() * 1000);
  const createSessionId = () => `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
  const activeChatSession =
    chatSessions.find((session) => session.id === activeChatSessionId) ?? null;
  const messages = activeChatSession?.messages ?? INITIAL_MESSAGES;
  const latestUserMessageId =
    [...messages].reverse().find((message) => message.role === "user")?.id ?? null;
  const chatMessages = messages.filter((message) => message.kind !== "thinking");
  const hasConversationStarted = chatMessages.length > 0;
  const hasOnlyFewShortMessages =
    chatMessages.length > 0 &&
    chatMessages.length <= 2 &&
    chatMessages.every((message) => message.text.trim().length <= 90);
  const todayDateKey = getLocalDateKey(new Date());
  const todayTask =
    [...taskHistory].reverse().find((task) => task.date === todayDateKey) ??
    ({
      text: DEFAULT_PRIORITY_TEXT,
      status: "pending",
      date: todayDateKey,
    } satisfies TaskRecord);
  const hasTaskForToday = taskHistory.some(
    (task) => task.date === todayDateKey && task.text.trim().length > 0
  );
  const hasMeaningfulConversation =
    chatMessages.length > 2 ||
    chatMessages.some((message) => message.text.trim().length > 120);
  const hasMeaningfulSession =
    hasTaskForToday || hasMeaningfulConversation || taskHistory.length > 0;
  const showWelcomeBlock = !hasConversationStarted && !hasTaskForToday && !hasMeaningfulSession;
  const showStarterChips =
    !hasTaskForToday && !hasMeaningfulSession && (chatMessages.length === 0 || hasOnlyFewShortMessages);
  const sharedTaskState: SharedTaskState = {
    currentPriority: todayTask.text,
    currentTaskText: todayTask.text,
    taskStatus: todayTask.status,
    taskDate: todayTask.date,
  };
  const profileSummaryItems = CHAT_PROFILE_SUMMARY_FIELDS.map((field) => {
    const value = businessProfile[field.key]?.trim() ?? "";
    return {
      ...field,
      value,
      isMissing: value.length === 0,
    };
  });
  const sidebarContextItems = profileSummaryItems.filter((item) =>
    item.key === "ownerName" ||
    item.key === "businessType" ||
    item.key === "mainGoal" ||
    item.key === "teamSize" ||
    item.key === "budgetLevel"
  );
  const sidebarContextSetCount = sidebarContextItems.filter((item) => !item.isMissing).length;
  const recentChatSessions = [...chatSessions]
    .filter((session) =>
      session.messages.some(
        (message) => message.role === "user" && message.text.trim().length > 0
      )
    )
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  const formatSidebarTime = (isoValue: string) => {
    const date = new Date(isoValue);
    if (Number.isNaN(date.getTime())) return "";
    return date.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
  };
  const toSessionTitle = (message: string): string => {
    const trimmed = message.trim();
    if (!trimmed) return "New Chat";
    return trimmed.length > 42 ? `${trimmed.slice(0, 42).trim()}...` : trimmed;
  };
  const createEmptyChatSession = (): ChatSession => {
    const now = new Date().toISOString();
    return {
      id: createSessionId(),
      title: "New Chat",
      messages: [],
      createdAt: now,
      updatedAt: now,
    };
  };
  const upsertSessionMessages = (sessionId: string, updater: (prev: Message[]) => Message[]) => {
    setChatSessions((prev) =>
      prev.map((session) => {
        if (session.id !== sessionId) return session;
        const nextMessages = updater(session.messages);
        const firstUser = nextMessages.find((message) => message.role === "user");
        const nextTitle =
          session.title === "New Chat" && firstUser ? toSessionTitle(firstUser.text) : session.title;

        return {
          ...session,
          messages: nextMessages,
          title: nextTitle,
          updatedAt: new Date().toISOString(),
        };
      })
    );
  };
  const ensureActiveSessionId = () => {
    if (activeChatSessionId) return activeChatSessionId;
    const created = createEmptyChatSession();
    setChatSessions((prev) => [created, ...prev]);
    setActiveChatSessionId(created.id);
    return created.id;
  };
  const getLatestBusinessProfileSnapshot = (): BusinessProfile => {
    const profileKey = userStorageKey(BUSINESS_PROFILE_STORAGE_KEY);
    if (!profileKey) return businessProfile;
    try {
      const storedProfile = localStorage.getItem(profileKey);
      if (!storedProfile) return businessProfile;

      return normalizeBusinessProfile(
        JSON.parse(storedProfile) as Partial<BusinessProfile>
      );
    } catch {
      return businessProfile;
    }
  };

  const upsertTask = (payload: TaskRecord) => {
    const normalizedText = payload.text.trim();
    if (!normalizedText) return;

    setTaskHistory((prev) => {
      const existingIndex = prev.map((task) => task.date).lastIndexOf(payload.date);
      const nextRecord: TaskRecord = {
        text: normalizedText,
        status: payload.status,
        date: payload.date,
      };

      if (existingIndex === -1) {
        return [...prev, nextRecord];
      }

      const existing = prev[existingIndex];
      const shouldKeepExistingStatus =
        existing.text === nextRecord.text && payload.status === "pending";

      const updatedRecord: TaskRecord = {
        ...nextRecord,
        status: shouldKeepExistingStatus ? existing.status : nextRecord.status,
      };

      return prev.map((task, index) => (index === existingIndex ? updatedRecord : task));
    });
  };

  const appendAssistantMessage = (text: string) => {
    const sessionId = ensureActiveSessionId();
    upsertSessionMessages(sessionId, (prev) => [
      ...prev,
      {
        id: createId(),
        role: "assistant",
        text,
        renderMode: "plain",
      },
    ]);
  };

  const getNextPriorityFromReply = (reply: string, fallbackPriority: string) => {
    const extracted = extractPriorityFromReply(reply);
    if (!extracted) return fallbackPriority;
    return extracted;
  };

  const handleTaskStatusUpdate = async (status: TaskStatus) => {
    if (!currentUser) return;
    if (isTaskReactionLoading) return;

    upsertTask({
      text: todayTask.text,
      status,
      date: todayDateKey,
    });

    if (status !== "done" && status !== "not_done") return;

    const reaction = createManagerReaction(status, todayTask.text, todayDateKey);
    appendAssistantMessage(reaction.immediateText);
    setIsTaskReactionLoading(true);

    try {
      const managerPrompt = [
        "Task tracking update:",
        `Date: ${reaction.memoryEvent.date}`,
        `Current task: ${reaction.memoryEvent.taskText}`,
        `Status: ${reaction.memoryEvent.outcome}`,
        `Manager note: ${reaction.followupPrompt}`,
        "Return ONLY next task text in one short practical line.",
        "No headings. No explanation.",
      ].join("\n");

      const response = await fetch("/api/chat", {
        body: (() => {
          const latestProfile = getLatestBusinessProfileSnapshot();
          const resolvedContext = mergeSharedContextWithBusinessProfile(
            sharedContext,
            latestProfile
          );
          const contextWithLanguage: SharedBusinessContext = {
            ...resolvedContext,
            conversationLanguage: userSettings.language,
          };

          return JSON.stringify({
            messages: [{ role: "user", content: managerPrompt }],
            mode: "manager",
            sharedContext: contextWithLanguage,
            businessProfile: latestProfile,
            sharedTaskState: {
              ...sharedTaskState,
              taskStatus: status,
            },
            userSettings,
          });
        })(),
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-neurova-user-id": currentUser.id,
        },
      });

      if (!response.ok) {
        throw new Error("Failed to generate next priority.");
      }

      const data = (await response.json()) as {
        reply?: string;
        sharedContext?: Partial<SharedBusinessContext>;
      };
      const nextPriority = getNextPriorityFromReply(
        data.reply ?? "",
        reaction.fallbackPriority
      );

      if (data.sharedContext) {
        const normalizedSharedContext = normalizeSharedContext(data.sharedContext);
        setSharedContext(normalizedSharedContext);
      }

      upsertTask({
        text: nextPriority,
        status: "pending",
        date: todayDateKey,
      });
    } catch {
      upsertTask({
        text: reaction.fallbackPriority,
        status: "pending",
        date: todayDateKey,
      });
    } finally {
      setIsTaskReactionLoading(false);
    }
  };

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

  useEffect(() => {
    if (!currentUser) return;
    try {
      const chatSessionsKey = userStorageKey(CHAT_SESSIONS_STORAGE_KEY);
      const activeSessionIdKey = userStorageKey(ACTIVE_CHAT_SESSION_ID_KEY);
      if (!chatSessionsKey || !activeSessionIdKey) return;

      const storedSessionsRaw = localStorage.getItem(chatSessionsKey);
      const storedActiveSessionId = localStorage.getItem(activeSessionIdKey);
      if (!storedSessionsRaw) return;

      const parsedSessions = JSON.parse(storedSessionsRaw) as ChatSession[];
      if (!Array.isArray(parsedSessions) || parsedSessions.length === 0) return;

      const validSessions = parsedSessions
        .filter((session) => typeof session?.id === "string")
        .map((session) => {
          const validMessages = Array.isArray(session.messages)
            ? session.messages
                .filter(
                  (item) =>
                  typeof item?.id === "number" &&
                  (item?.role === "user" || item?.role === "assistant") &&
                  typeof item?.text === "string" &&
                  item?.kind !== "thinking"
                )
                .map((item) => {
                  const normalizedAttachments = Array.isArray(item.attachments)
                    ? item.attachments
                        .filter(
                          (attachment) =>
                            typeof attachment?.id === "string" &&
                            typeof attachment?.name === "string" &&
                            typeof attachment?.type === "string" &&
                            typeof attachment?.size === "number"
                        )
                        .map((attachment) => ({
                          id: attachment.id,
                          name: attachment.name,
                          type: attachment.type,
                          size: attachment.size,
                        }))
                    : undefined;

                  return {
                    ...item,
                    attachments:
                      normalizedAttachments && normalizedAttachments.length > 0
                        ? normalizedAttachments
                        : undefined,
                  };
                })
            : [];

          return {
            id: session.id,
            title:
              typeof session.title === "string" && session.title.trim().length > 0
                ? session.title.trim()
                : "New Chat",
            messages: validMessages,
            createdAt:
              typeof session.createdAt === "string" && session.createdAt.trim().length > 0
                ? session.createdAt
                : new Date().toISOString(),
            updatedAt:
              typeof session.updatedAt === "string" && session.updatedAt.trim().length > 0
                ? session.updatedAt
                : new Date().toISOString(),
          };
        });

      if (validSessions.length > 0) {
        setChatSessions(validSessions);
        if (storedActiveSessionId && validSessions.some((s) => s.id === storedActiveSessionId)) {
          setActiveChatSessionId(storedActiveSessionId);
        } else {
          setActiveChatSessionId(validSessions[0].id);
        }
      }
    } catch {
      // Ignore invalid chat session data.
    }
  }, [currentUser]);

  useEffect(() => {
    if (!currentUser) return;
    try {
      const sharedContextKey = userStorageKey(SHARED_CONTEXT_STORAGE_KEY);
      if (!sharedContextKey) return;

      const storedContext = sessionStorage.getItem(sharedContextKey);
      if (!storedContext) return;

      const parsed = JSON.parse(storedContext) as Partial<SharedBusinessContext>;
      setSharedContext(normalizeSharedContext(parsed));
    } catch {
      // Ignore invalid session data.
    }
  }, [currentUser]);

  useEffect(() => {
    if (!currentUser) return;
    const loadProfileState = async () => {
      try {
        const profileKey = userStorageKey(BUSINESS_PROFILE_STORAGE_KEY);
        const memoryKey = userStorageKey(BUSINESS_MEMORY_STORAGE_KEY);
        const suggestionsKey = userStorageKey(BUSINESS_PROFILE_SUGGESTIONS_STORAGE_KEY);
        if (!profileKey || !memoryKey || !suggestionsKey) return;

        const storedProfile = localStorage.getItem(profileKey);
        const storedMemory = localStorage.getItem(memoryKey);
        const storedSuggestions = localStorage.getItem(suggestionsKey);
        let localProfileSnapshot: BusinessProfile | null = null;

        if (storedProfile) {
          localProfileSnapshot = normalizeBusinessProfile(
            JSON.parse(storedProfile) as Partial<BusinessProfile>
          );
          setBusinessProfile(localProfileSnapshot);
        }

        if (storedMemory) {
          setBusinessMemory(
            normalizeBusinessMemory(
              JSON.parse(storedMemory) as Partial<BusinessMemoryItem>[]
            )
          );
        }

        if (storedSuggestions) {
          setSuggestedProfileUpdates(
            normalizeSuggestedProfileUpdates(
              JSON.parse(storedSuggestions) as Partial<ProfileUpdateSuggestion>[]
            )
          );
        }

        const response = await fetch("/api/business-profile", {
          method: "GET",
          cache: "no-store",
          headers: {
            "x-neurova-user-id": currentUser.id,
          },
        });
        if (!response.ok) return;

        const data = (await response.json()) as {
          profile?: Partial<BusinessProfile>;
        };
        if (data.profile) {
          const dbProfile = normalizeBusinessProfile(data.profile);
          const dbProfileState = getBusinessProfileState(dbProfile);
          const localProfileState = localProfileSnapshot
            ? getBusinessProfileState(localProfileSnapshot)
            : "empty";
          const shouldApplyDbProfile =
            dbProfileState !== "empty" || localProfileState === "empty";

          if (shouldApplyDbProfile) {
            setBusinessProfile(dbProfile);
          }
        }
      } catch {
        // Ignore invalid profile storage.
      } finally {
        setIsBusinessProfileLoaded(true);
      }
    };

    void loadProfileState();
  }, [currentUser]);

  useEffect(() => {
    if (!currentUser) return;
    try {
      const modeKey = userStorageKey(MODE_STORAGE_KEY);
      if (!modeKey) return;

      const storedMode = sessionStorage.getItem(modeKey);

      if (storedMode === "chat" || storedMode === "manager") {
        setMode(storedMode);
      } else if (storedMode === "business_problem") {
        // Backward compatibility for older sessions.
        setMode("manager");
      }
    } catch {
      // Ignore invalid session data.
    }
  }, [currentUser]);

  useEffect(() => {
    if (!currentUser) return;
    try {
      const settingsKey = userStorageKey(USER_SETTINGS_STORAGE_KEY);
      if (!settingsKey) return;

      const storedSettings = localStorage.getItem(settingsKey);
      if (!storedSettings) return;
      setUserSettings(normalizeUserSettings(JSON.parse(storedSettings)));
    } catch {
      // Ignore invalid settings storage.
    }
  }, [currentUser]);

  useEffect(() => {
    if (!currentUser) return;
    const settingsKey = userStorageKey(USER_SETTINGS_STORAGE_KEY);
    if (!settingsKey) return;

    const syncSettings = () => {
      try {
        const storedSettings = localStorage.getItem(settingsKey);
        if (!storedSettings) {
          setUserSettings(DEFAULT_USER_SETTINGS);
          return;
        }
        setUserSettings(normalizeUserSettings(JSON.parse(storedSettings)));
      } catch {
        setUserSettings(DEFAULT_USER_SETTINGS);
      }
    };

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
    try {
      const sidebarCollapsedKey = userStorageKey(SIDEBAR_COLLAPSED_KEY);
      if (!sidebarCollapsedKey) return;

      const stored = sessionStorage.getItem(sidebarCollapsedKey);
      if (stored === "1") {
        setIsSidebarCollapsed(true);
      }
    } catch {
      // Ignore invalid session data.
    }
  }, [currentUser]);

  useEffect(() => {
    if (!currentUser) return;
    try {
      const businessContextCollapsedKey = userStorageKey(BUSINESS_CONTEXT_COLLAPSED_KEY);
      if (!businessContextCollapsedKey) return;

      const stored = localStorage.getItem(businessContextCollapsedKey);
      if (stored === "1") {
        setIsBusinessContextCollapsed(true);
        return;
      }
      if (stored === "0") {
        setIsBusinessContextCollapsed(false);
        return;
      }

      const isMobileViewport = window.matchMedia("(max-width: 1023px)").matches;
      setIsBusinessContextCollapsed(isMobileViewport);
    } catch {
      // Ignore invalid local storage state.
    }
  }, [currentUser]);

  useEffect(() => {
    if (!currentUser) return;
    const chatSessionsKey = userStorageKey(CHAT_SESSIONS_STORAGE_KEY);
    if (!chatSessionsKey) return;

    const persistedSessions = chatSessions.map((session) => ({
      ...session,
      messages: session.messages
        .filter((message) => message.kind !== "thinking")
        .map((message) => ({
          ...message,
          attachments: message.attachments?.map((attachment) => ({
            id: attachment.id,
            name: attachment.name,
            type: attachment.type,
            size: attachment.size,
          })),
        })),
    }));
    localStorage.setItem(chatSessionsKey, JSON.stringify(persistedSessions));
  }, [chatSessions, currentUser]);

  useEffect(() => {
    if (!currentUser) return;
    const activeSessionIdKey = userStorageKey(ACTIVE_CHAT_SESSION_ID_KEY);
    if (!activeSessionIdKey) return;
    if (!activeChatSessionId) {
      localStorage.removeItem(activeSessionIdKey);
      return;
    }
    localStorage.setItem(activeSessionIdKey, activeChatSessionId);
  }, [activeChatSessionId, currentUser]);

  useEffect(() => {
    if (!currentUser) return;
    const modeKey = userStorageKey(MODE_STORAGE_KEY);
    if (!modeKey) return;
    sessionStorage.setItem(modeKey, mode);
  }, [mode, currentUser]);

  useEffect(() => {
    if (!currentUser) return;
    const sidebarCollapsedKey = userStorageKey(SIDEBAR_COLLAPSED_KEY);
    if (!sidebarCollapsedKey) return;
    sessionStorage.setItem(sidebarCollapsedKey, isSidebarCollapsed ? "1" : "0");
  }, [isSidebarCollapsed, currentUser]);

  useEffect(() => {
    if (!currentUser) return;
    try {
      const businessContextCollapsedKey = userStorageKey(BUSINESS_CONTEXT_COLLAPSED_KEY);
      if (!businessContextCollapsedKey) return;

      localStorage.setItem(businessContextCollapsedKey, isBusinessContextCollapsed ? "1" : "0");
    } catch {
      // Ignore unavailable storage.
    }
  }, [isBusinessContextCollapsed, currentUser]);

  useEffect(() => {
    if (!currentUser) return;
    const sharedContextKey = userStorageKey(SHARED_CONTEXT_STORAGE_KEY);
    if (!sharedContextKey) return;
    sessionStorage.setItem(sharedContextKey, JSON.stringify(sharedContext));
  }, [sharedContext, currentUser]);

  useEffect(() => {
    if (!currentUser) return;
    if (!isBusinessProfileLoaded) return;

    try {
      const profileKey = userStorageKey(BUSINESS_PROFILE_STORAGE_KEY);
      if (!profileKey) return;
      localStorage.setItem(profileKey, JSON.stringify(businessProfile));
      console.log("[PROFILE SAVE] success/failure = success");
    } catch (error) {
      console.error("[PROFILE SAVE] success/failure = failure", error);
    }
  }, [businessProfile, isBusinessProfileLoaded, currentUser]);

  useEffect(() => {
    if (!isBusinessProfileLoaded) return;

    setSharedContext((prev) => mergeSharedContextWithBusinessProfile(prev, businessProfile));
    setBusinessMemory((prev) => syncMemoryWithProfile(prev, businessProfile));
    setSuggestedProfileUpdates((prev) =>
      pruneSuggestedProfileUpdatesAgainstProfile(prev, businessProfile)
    );
    console.log("[PROFILE CONTEXT] refreshed profile =", businessProfile);

    const profileState = getBusinessProfileState(businessProfile);
    const missingImportantFields = getMissingImportantFields(businessProfile);
    if (profileState === "partial" && missingImportantFields.length > 0) {
      setProfileHelperNote(
        userSettings.language === "english"
          ? `Some important Business Profile details are missing: ${missingImportantFields
              .slice(0, 3)
              .join(", ")}${missingImportantFields.length > 3 ? "..." : ""}`
          : `Business Profile me kuch important details missing hain: ${missingImportantFields
              .slice(0, 3)
              .join(", ")}${missingImportantFields.length > 3 ? "..." : ""}`
      );
      return;
    }

    if (profileState === "empty") {
      setProfileHelperNote(
        userSettings.language === "english"
          ? "Do you want to start Business Profile setup? I will ask step-by-step questions."
          : "Business Profile setup start karein? Main step by step questions puchunga."
      );
      return;
    }

    setProfileHelperNote(null);
  }, [businessProfile, isBusinessProfileLoaded, userSettings.language]);

  useEffect(() => {
    if (!currentUser) return;
    const profileKey = userStorageKey(BUSINESS_PROFILE_STORAGE_KEY);
    if (!profileKey) return;

    const onStorage = (event: StorageEvent) => {
      if (event.key !== profileKey || !event.newValue) return;

      try {
        const nextProfile = normalizeBusinessProfile(
          JSON.parse(event.newValue) as Partial<BusinessProfile>
        );
        setBusinessProfile(nextProfile);
      } catch {
        // Ignore invalid storage updates.
      }
    };

    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [currentUser]);

  useEffect(() => {
    if (!currentUser) return;
    if (!isBusinessProfileLoaded) return;

    const memoryKey = userStorageKey(BUSINESS_MEMORY_STORAGE_KEY);
    if (!memoryKey) return;
    localStorage.setItem(memoryKey, JSON.stringify(businessMemory));
  }, [businessMemory, isBusinessProfileLoaded, currentUser]);

  useEffect(() => {
    if (!currentUser) return;
    if (!isBusinessProfileLoaded) return;

    const suggestionsKey = userStorageKey(BUSINESS_PROFILE_SUGGESTIONS_STORAGE_KEY);
    if (!suggestionsKey) return;
    localStorage.setItem(suggestionsKey, JSON.stringify(suggestedProfileUpdates));
  }, [suggestedProfileUpdates, isBusinessProfileLoaded, currentUser]);

  useEffect(() => {
    if (!currentUser) return;
    try {
      const taskHistoryKey = userStorageKey(TASK_STORAGE_KEY);
      if (!taskHistoryKey) return;
      const storedTasks = localStorage.getItem(taskHistoryKey);
      if (!storedTasks) return;

      const parsed = JSON.parse(storedTasks) as TaskRecord[];
      if (!Array.isArray(parsed)) return;

      const validTasks = parsed
        .filter((task) => {
          return (
            typeof task?.text === "string" &&
            task.text.trim().length > 0 &&
            typeof task?.date === "string" &&
            /^\d{4}-\d{2}-\d{2}$/.test(task.date) &&
            (task?.status === "pending" ||
              task?.status === "done" ||
              task?.status === "not_done")
          );
        })
        .map((task) => ({
          text: task.text.trim(),
          status: task.status,
          date: task.date,
        }));

      if (validTasks.length > 0) {
        const latestByDate = new Map<string, TaskRecord>();
        validTasks.forEach((task) => {
          latestByDate.set(task.date, task);
        });
        const dedupedTasks = Array.from(latestByDate.values()).sort((a, b) =>
          a.date.localeCompare(b.date)
        );
        setTaskHistory(dedupedTasks);
      }
    } catch {
      // Ignore invalid local task history.
    }
  }, [currentUser]);

  useEffect(() => {
    if (!currentUser) return;
    const taskHistoryKey = userStorageKey(TASK_STORAGE_KEY);
    if (!taskHistoryKey) return;
    localStorage.setItem(taskHistoryKey, JSON.stringify(taskHistory));
  }, [taskHistory, currentUser]);

  const scrollToBottom = () => {
    if (!messageEndRef.current) return;
    messageEndRef.current.scrollIntoView({
      behavior: "smooth",
      block: "end",
    });
  };

  const handleStarterChipClick = (value: string) => {
    setInput(value);
    requestAnimationFrame(() => {
      inputRef.current?.focus({ preventScroll: true });
      scrollToBottom();
    });
  };

  const handleNewChat = () => {
    const created = createEmptyChatSession();
    setChatSessions((prev) => [created, ...prev]);
    setActiveChatSessionId(created.id);
    setInput("");
    setPendingAttachments([]);
    setEditingMessageId(null);
    setIsMobileSidebarOpen(false);
  };

  const handleDeleteChatSession = (sessionId: string) => {
    setChatSessions((prev) => {
      const remaining = prev.filter((session) => session.id !== sessionId);
      setActiveChatSessionId((current) => {
        if (current !== sessionId) return current;
        if (remaining.length === 0) return null;
        const mostRecent = [...remaining].sort(
          (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
        )[0];
        return mostRecent?.id ?? remaining[0].id;
      });
      return remaining;
    });

    setEditingMessageId(null);
    setInput("");
    setPendingAttachments((prev) => {
      prev.forEach((item) => {
        if (item.previewUrl?.startsWith("blob:")) {
          URL.revokeObjectURL(item.previewUrl);
        }
      });
      return [];
    });
  };

  const focusChatComposer = () => {
    setMode("chat");
    setIsMobileSidebarOpen(false);
    requestAnimationFrame(() => {
      chatFormRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "end",
      });
      inputRef.current?.focus({ preventScroll: true });
    });
  };

  const openBusinessProfilePage = () => {
    setIsMobileSidebarOpen(false);
    router.push("/business-profile");
  };

  const openLeftSidebarPanel = () => {
    setIsMobileSidebarOpen(true);
  };

  const openAttachmentPicker = () => {
    if (isLoading) return;
    attachmentInputRef.current?.click();
  };

  const handleAttachmentSelection = async (event: ChangeEvent<HTMLInputElement>) => {
    const pickedFiles = Array.from(event.target.files ?? []);
    if (pickedFiles.length === 0) return;
    const normalizedFiles = await Promise.all(
      pickedFiles.map((file) => optimizeImageForUpload(file))
    );

    setPendingAttachments((prev) => {
      const seen = new Set(prev.map((item) => `${item.file.name}-${item.file.size}-${item.file.lastModified}`));
      const next = [...prev];

      for (const file of normalizedFiles) {
        const fileKey = `${file.name}-${file.size}-${file.lastModified}`;
        if (seen.has(fileKey)) continue;
        seen.add(fileKey);
        next.push({
          id: createSessionId(),
          file,
          previewUrl: file.type.startsWith("image/") ? URL.createObjectURL(file) : undefined,
        });
      }

      return next;
    });

    event.target.value = "";
  };

  const removePendingAttachment = (id: string) => {
    setPendingAttachments((prev) => {
      const target = prev.find((item) => item.id === id);
      if (target?.previewUrl?.startsWith("blob:")) {
        URL.revokeObjectURL(target.previewUrl);
      }
      return prev.filter((item) => item.id !== id);
    });
  };

  const getEditableTextFromMessage = (text: string) =>
    text
      .replace(/\n{2,}Attached files:\n(?:- .+\n?)*/i, "")
      .trim();

  const handleCopyMessage = async (messageId: number, text: string) => {
    const value = text.trim();
    if (!value) return;

    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
      } else {
        const tempInput = document.createElement("textarea");
        tempInput.value = value;
        tempInput.setAttribute("readonly", "true");
        tempInput.style.position = "absolute";
        tempInput.style.left = "-9999px";
        document.body.appendChild(tempInput);
        tempInput.select();
        document.execCommand("copy");
        document.body.removeChild(tempInput);
      }
      setCopiedMessageId(messageId);
      if (copiedFeedbackTimerRef.current) {
        window.clearTimeout(copiedFeedbackTimerRef.current);
      }
      copiedFeedbackTimerRef.current = window.setTimeout(() => {
        setCopiedMessageId((current) => (current === messageId ? null : current));
      }, 1300);
    } catch {
      setCopiedMessageId(null);
    }
  };

  const handleEditMessage = (message: Message) => {
    if (message.role !== "user") return;
    setEditingMessageId(message.id);
    setInput(getEditableTextFromMessage(message.text));
    requestAnimationFrame(() => {
      chatFormRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "end",
      });
      inputRef.current?.focus({ preventScroll: true });
    });
  };

  const handleComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      inputRef.current?.blur();
      return;
    }

    if (event.key !== "Enter") return;

    if (event.shiftKey) return;

    event.preventDefault();
    if ((input.trim().length === 0 && pendingAttachments.length === 0) || isLoading || submitLockRef.current) return;
    chatFormRef.current?.requestSubmit();
  };

  useEffect(() => {
    return () => {
      if (copiedFeedbackTimerRef.current) {
        window.clearTimeout(copiedFeedbackTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      scrollToBottom();
    });

    return () => cancelAnimationFrame(frame);
  }, [messages, isLoading]);

  useEffect(() => {
    const finishedLoading = wasLoadingRef.current && !isLoading;
    wasLoadingRef.current = isLoading;

    if (!finishedLoading) return;

    const frame = requestAnimationFrame(() => {
      inputRef.current?.focus({ preventScroll: true });
      scrollToBottom();
    });

    return () => cancelAnimationFrame(frame);
  }, [isLoading]);

  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;

    const handleViewportChange = () => {
      if (document.activeElement !== inputRef.current) return;
      requestAnimationFrame(() => {
        scrollToBottom();
      });
    };

    viewport.addEventListener("resize", handleViewportChange);
    viewport.addEventListener("scroll", handleViewportChange);

    return () => {
      viewport.removeEventListener("resize", handleViewportChange);
      viewport.removeEventListener("scroll", handleViewportChange);
    };
  }, []);

  useEffect(() => {
    const handleGlobalKeyDown = (event: globalThis.KeyboardEvent) => {
      const isAltB =
        event.altKey &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.shiftKey &&
        event.code === "KeyB";
      const isCtrlAltB =
        event.ctrlKey &&
        event.altKey &&
        !event.metaKey &&
        !event.shiftKey &&
        event.code === "KeyB";
      const isAltS =
        event.altKey &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.shiftKey &&
        event.code === "KeyS";
      const isCtrlAltS =
        event.ctrlKey &&
        event.altKey &&
        !event.metaKey &&
        !event.shiftKey &&
        event.code === "KeyS";

      if (isAltB || isCtrlAltB) {
        event.preventDefault();
        openBusinessProfilePage();
        return;
      }

      if (isAltS || isCtrlAltS) {
        event.preventDefault();
        openLeftSidebarPanel();
      }
    };

    window.addEventListener("keydown", handleGlobalKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", handleGlobalKeyDown, { capture: true });
  }, [router]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!window.matchMedia("(pointer: fine)").matches) return;
    if (document.visibilityState !== "visible") return;

    const frame = requestAnimationFrame(() => {
      inputRef.current?.focus({ preventScroll: true });
    });

    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    const textarea = inputRef.current;
    if (!textarea) return;

    const maxHeight = 148;
    textarea.style.height = "auto";

    const nextHeight = Math.min(textarea.scrollHeight, maxHeight);
    textarea.style.height = `${nextHeight}px`;
    textarea.style.overflowY = textarea.scrollHeight > maxHeight ? "auto" : "hidden";
  }, [input]);

  useEffect(() => {
    if (!isLoading) {
      setThinkingWaveStep(0);
      return;
    }

    setThinkingWaveStep(0);

    const intervalId = window.setInterval(() => {
      setThinkingWaveStep((prev) => {
        const nextStep = (prev + 1) % THINKING_WAVE_STEPS;
        if (ENABLE_THINKING_DEBUG && process.env.NODE_ENV !== "production") {
          console.debug("[thinking] wave step:", nextStep);
        }
        return nextStep;
      });

    }, THINKING_INTERVAL_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [isLoading]);

  const renderThinkingWave = (variant: "chat" | "button") => (
    <span
      aria-hidden="true"
      className={`thinking-wave ${variant === "button" ? "button-thinking-wave" : ""}`}
    >
      {Array.from({ length: THINKING_WAVE_STEPS }).map((_, index) => {
        const trailingIndex = (thinkingWaveStep + THINKING_WAVE_STEPS - 1) % THINKING_WAVE_STEPS;
        const stateClass =
          index === thinkingWaveStep
            ? "is-active"
            : index === trailingIndex
              ? "is-trailing"
              : "";

        return (
          <span
            key={`${variant}-wave-dot-${index}`}
            className={`thinking-wave-dot ${stateClass}`}
          />
        );
      })}
    </span>
  );

  const renderMessageParagraphs = (text: string) => {
    const paragraphs = text
      .split(/\n{2,}/)
      .map((part) => part.trim())
      .filter(Boolean);

    if (paragraphs.length === 0) {
      return <p className="whitespace-pre-wrap">{text}</p>;
    }

    return paragraphs.map((paragraph, index) => (
      <p
        key={`${index}-${paragraph.slice(0, 24)}`}
        className={`${index > 0 ? "mt-2.5" : ""} whitespace-pre-wrap break-words`}
      >
        {paragraph}
      </p>
    ));
  };

  const renderMinimalAssistantContent = (text: string) => {
    const blocks = text
      .split(/\n{2,}/)
      .map((part) => part.trim())
      .filter(Boolean);

    if (blocks.length === 0) {
      return <p className="whitespace-pre-wrap break-words">{text}</p>;
    }

    return blocks.map((block, index) => {
      const lines = block
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
      const listLines = lines
        .filter((line) => /^[-*•]\s+|^\d+[.)]\s+/.test(line))
        .map((line) => line.replace(/^[-*•]\s+|^\d+[.)]\s+/, "").trim())
        .filter(Boolean);
      const isListBlock = lines.length > 0 && listLines.length === lines.length;

      if (isListBlock) {
        return (
          <ul key={`list-${index}`} className={`${index > 0 ? "mt-2.5" : ""} space-y-1.5`}>
            {listLines.map((line, listIndex) => (
              <li key={`li-${index}-${listIndex}`} className="flex items-start gap-2">
                <span className="mt-[0.45rem] inline-block h-1.5 w-1.5 rounded-full bg-current opacity-75" />
                <span className="whitespace-pre-wrap break-words">{line}</span>
              </li>
            ))}
          </ul>
        );
      }

      return (
        <p
          key={`p-${index}-${block.slice(0, 24)}`}
          className={`${index > 0 ? "mt-2.5" : ""} whitespace-pre-wrap break-words`}
        >
          {block}
        </p>
      );
    });
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    if (!currentUser) return;
    event.preventDefault();
    const trimmed = input.trim();
    const hasAttachments = pendingAttachments.length > 0;
    if ((!trimmed && !hasAttachments) || isLoading || submitLockRef.current) return;
    submitLockRef.current = true;
    const editingTargetId = editingMessageId;

    const attachmentSnapshot = [...pendingAttachments];
    const attachmentLines = attachmentSnapshot.map((item) => `- ${item.file.name}`);
    const messageText =
      trimmed.length > 0
        ? trimmed
        : "Please review the attached photo/file and help me with this.";
    const userText =
      attachmentLines.length > 0
        ? `${messageText}\n\nAttached files:\n${attachmentLines.join("\n")}`
        : messageText;

    const sessionId = ensureActiveSessionId();
    const activeMessagesSnapshot =
      chatSessions.find((session) => session.id === sessionId)?.messages ?? [];
    const baseMessagesSnapshot =
      editingTargetId !== null
        ? (() => {
            const indexToEdit = activeMessagesSnapshot.findIndex(
              (message) => message.id === editingTargetId && message.role === "user"
            );
            return indexToEdit >= 0
              ? activeMessagesSnapshot.slice(0, indexToEdit)
              : activeMessagesSnapshot;
          })()
        : activeMessagesSnapshot;

    const messageAttachments: MessageAttachment[] = attachmentSnapshot.map((item) => ({
      id: item.id,
      name: item.file.name,
      type: item.file.type,
      size: item.file.size,
      previewUrl: item.previewUrl,
    }));

    const userMessage: Message = {
      id: createId(),
      role: "user",
      text: userText,
      attachments: messageAttachments.length > 0 ? messageAttachments : undefined,
    };
    const thinkingMessageId = createId();
    const thinkingMessage: Message = {
      id: thinkingMessageId,
      role: "assistant",
      text: "Neurova is thinking",
      kind: "thinking",
    };
    console.log(`[AUTO-DETECT] raw user message = ${userText}`);

    const payloadMessages: ChatApiMessage[] = [...baseMessagesSnapshot, userMessage].map(
      (message) => ({
        role: message.role,
        content: message.text,
      })
    );
    const profileForCurrentRequest = getLatestBusinessProfileSnapshot();

    upsertSessionMessages(sessionId, (prev) => {
      const baseMessages =
        editingTargetId !== null
          ? (() => {
              const indexToEdit = prev.findIndex(
                (message) => message.id === editingTargetId && message.role === "user"
              );
              return indexToEdit >= 0 ? prev.slice(0, indexToEdit) : prev;
            })()
          : prev;

      return [...baseMessages, userMessage, thinkingMessage];
    });
    setInput("");
    setPendingAttachments([]);
    setEditingMessageId(null);
    setIsLoading(true);

    try {
      const resolvedContext = mergeSharedContextWithBusinessProfile(
        sharedContext,
        profileForCurrentRequest
      );
      const contextWithLanguage: SharedBusinessContext = {
        ...resolvedContext,
        conversationLanguage: userSettings.language,
      };
      const requestPayload = {
        messages: payloadMessages,
        mode,
        sharedContext: contextWithLanguage,
        businessProfile: profileForCurrentRequest,
        sharedTaskState,
        userSettings,
      };
      const requestInit: RequestInit =
        attachmentSnapshot.length > 0
          ? (() => {
              const formData = new FormData();
              formData.append("payload", JSON.stringify(requestPayload));
              attachmentSnapshot.forEach((item) => {
                formData.append("attachments", item.file, item.file.name);
              });
              return {
                method: "POST",
                body: formData,
              };
            })()
          : {
              method: "POST",
              body: JSON.stringify(requestPayload),
              headers: {
                "Content-Type": "application/json",
                "x-neurova-user-id": currentUser.id,
              },
            };

      const requestHeaders = new Headers(requestInit.headers ?? {});
      requestHeaders.set("x-neurova-user-id", currentUser.id);
      const response = await fetch("/api/chat", {
        ...requestInit,
        headers: requestHeaders,
      });

      if (!response.ok) {
        throw new Error("Failed to get AI response.");
      }

      const data = (await response.json()) as {
        reply?: string;
        provider?: AssistantApiProvider;
        messageType?: AssistantApiMessageType;
        sharedContext?: Partial<SharedBusinessContext>;
        businessProfile?: Partial<BusinessProfile>;
        suggestedProfileUpdates?: Partial<ProfileUpdateSuggestion>[];
      };
      const aiText =
        data.reply?.trim() || "Main abhi proper reply generate nahi kar paya.";
      const assistantRenderMode: Message["renderMode"] =
        data.provider === "helper"
          ? "plain"
          : data.messageType === "business_strategy" ||
              data.messageType === "seasonal_strategy" ||
              data.messageType === "calculation" ||
              data.messageType === "marketing_content"
            ? "structured"
            : "plain";
      const extractedPriority = extractPriorityFromReply(aiText);

      if (extractedPriority) {
        upsertTask({
          text: extractedPriority,
          status: "pending",
          date: todayDateKey,
        });
      }

      if (data.sharedContext) {
        const normalizedSharedContext = normalizeSharedContext(data.sharedContext);
        setSharedContext(normalizedSharedContext);
      }

      if (data.businessProfile) {
        console.log("[PROFILE SAVE] updating fields =", data.businessProfile);
        const previousProfile = getLatestBusinessProfileSnapshot();
        let previousMeta: BusinessProfileMeta = {};
        try {
          const profileMetaKey = userStorageKey(BUSINESS_PROFILE_META_STORAGE_KEY);
          if (!profileMetaKey) {
            throw new Error("Missing profile meta key");
          }
          const storedMetaRaw = localStorage.getItem(profileMetaKey);
          previousMeta = normalizeBusinessProfileMeta(
            storedMetaRaw
              ? (JSON.parse(storedMetaRaw) as BusinessProfileMeta)
              : null
          );
        } catch {
          previousMeta = {};
        }
        const normalizedProfile = normalizeBusinessProfile(data.businessProfile);
        const nextMeta = mergeBusinessProfileMetaWithSource({
          previousProfile,
          nextProfile: normalizedProfile,
          previousMeta,
          source: "chat",
        });
        setBusinessProfile(normalizedProfile);
        const profileKey = userStorageKey(BUSINESS_PROFILE_STORAGE_KEY);
        const profileMetaKey = userStorageKey(BUSINESS_PROFILE_META_STORAGE_KEY);
        if (profileKey && profileMetaKey) {
          localStorage.setItem(profileKey, JSON.stringify(normalizedProfile));
          localStorage.setItem(profileMetaKey, JSON.stringify(nextMeta));
        }
        window.dispatchEvent(
          new CustomEvent(BUSINESS_PROFILE_SYNC_EVENT, {
            detail: normalizedProfile,
          })
        );
      } else {
        console.log("[PROFILE SAVE] success/failure = failure");
      }

      if (data.suggestedProfileUpdates) {
        const normalizedIncomingSuggestions = normalizeSuggestedProfileUpdates(
          data.suggestedProfileUpdates
        );
        if (normalizedIncomingSuggestions.length > 0) {
          setSuggestedProfileUpdates((prev) =>
            mergeSuggestedProfileUpdates(prev, normalizedIncomingSuggestions)
          );
        }
      }

      const aiMessage: Message = {
        id: createId(),
        role: "assistant",
        text: aiText,
        renderMode: assistantRenderMode,
      };

      upsertSessionMessages(sessionId, (prev) => [
        ...prev.filter((message) => message.id !== thinkingMessageId),
        aiMessage,
      ]);
    } catch {
      const errorMessage: Message = {
        id: createId(),
        role: "assistant",
        text: "Neurova abhi connect nahi ho paaya. Thodi der baad phir try karo.",
        renderMode: "plain",
      };

      upsertSessionMessages(sessionId, (prev) => [
        ...prev.filter((message) => message.id !== thinkingMessageId),
        errorMessage,
      ]);
    } finally {
      setIsLoading(false);
      submitLockRef.current = false;
    }
  };

  const canSend = (input.trim().length > 0 || pendingAttachments.length > 0) && !isLoading;
  const isEnglishUi = userSettings.language === "english";
  const isLightTheme = userSettings.theme === "light";
  const uiText = isEnglishUi
    ? {
        newChat: "New Chat",
        chat: "Chat",
        businessProfile: "Business Profile",
        settings: "Settings",
        businessContext: "Business Context",
        show: "Show",
        hide: "Hide",
        edit: "Edit",
        fieldsSet: "fields set",
        missing: "Missing",
        recentChats: "Recent Chats",
        noRecentChats: "No recent chats yet",
        deleteChat: "Delete chat",
        badge: "AI Business Manager",
        welcomeTitle: "Neurova - AI Business Manager",
        welcomeDesc:
          "Write your business issue, goal, or daily challenge. Neurova will give a clear decision and next action.",
        chatModeHint: "Chat = normal conversation | Business Problem = structured business help",
        quickStart: "Quick start",
        copy: "Copy",
        copied: "Copied",
        editMessage: "Edit",
        editingPrevious: "Editing previous message",
        cancel: "Cancel",
        addAttachment: "Add photo or file",
        composerPlaceholder: "Write today's business problem or goal...",
        thinking: "Neurova thinking",
        send: "Send",
        modeChatHint: "Chat = Normal conversation",
        modeManagerHint: "Business Problem = Structured business help",
        logout: "Logout",
      }
    : {
        newChat: "Naya Chat",
        chat: "Chat",
        businessProfile: "Business Profile",
        settings: "Settings",
        businessContext: "Business Context",
        show: "Dikhao",
        hide: "Chhupao",
        edit: "Edit",
        fieldsSet: "fields set",
        missing: "Missing",
        recentChats: "Recent Chats",
        noRecentChats: "Abhi recent chats nahi hain",
        deleteChat: "Delete chat",
        badge: "AI Business Manager",
        welcomeTitle: "Neurova - AI Business Manager",
        welcomeDesc:
          "Apna business issue, goal, ya daily challenge likho. Neurova tumhe clear decision aur next action dega.",
        chatModeHint: "Chat = normal conversation | Business Problem = structured business help",
        quickStart: "Quick start",
        copy: "Copy",
        copied: "Copied",
        editMessage: "Edit",
        editingPrevious: "Pichla message edit ho raha hai",
        cancel: "Cancel",
        addAttachment: "Photo ya file add karo",
        composerPlaceholder: "Aaj ka business problem ya goal likho...",
        thinking: "Neurova soch raha hai",
        send: "Send",
        modeChatHint: "Chat = Normal conversation",
        modeManagerHint: "Business Problem = Structured business help",
        logout: "Logout",
      };

  const handleLogout = () => {
    clearSession();
    router.replace("/auth");
  };

  if (!isAuthChecked) {
    return (
      <div
        className={`min-h-[100dvh] overflow-x-hidden ${isLightTheme ? "bg-[#edf4ff] text-slate-900" : "bg-[#0B0F2B] text-slate-100"}`}
      />
    );
  }

  if (!currentUser) {
    return null;
  }
  const quickPrompts = isEnglishUi
    ? [
        "Sales are dropping",
        "Need new customers",
        "Complete business profile",
        "What should I focus on today?",
      ]
    : [
        "Sales down ho raha hai",
        "Naye customer chahiye",
        "Business profile complete karo",
        "Aaj kya focus karun?",
      ];

  return (
    <div
      className={`min-h-[100dvh] overflow-x-hidden ${isLightTheme ? "bg-[#f7f7f8] text-[#1f2937]" : "bg-[#0B0F2B] text-slate-100"}`}
    >
      {isMobileSidebarOpen ? (
        <button
          type="button"
          aria-label="Close sidebar overlay"
          onClick={() => setIsMobileSidebarOpen(false)}
          className="fixed inset-0 z-40 bg-slate-950/55 lg:hidden"
        />
      ) : null}
      {!isMobileSidebarOpen ? (
        <button
          type="button"
          aria-label="Open sidebar"
          onClick={() => setIsMobileSidebarOpen(true)}
          className={`fixed left-2 top-1/2 z-40 inline-flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full border text-sm shadow-lg backdrop-blur-md transition lg:hidden ${
            isLightTheme
              ? "border-slate-300/90 bg-white/95 text-slate-700 shadow-slate-300/25 hover:bg-slate-100"
              : "border-white/15 bg-[#0D142E]/90 text-slate-200 shadow-black/25 hover:bg-[#111a3a]"
          }`}
        >
          |||
        </button>
      ) : null}

      <aside
        className={`fixed bottom-0 left-0 top-0 z-50 backdrop-blur-md transition-all duration-200 ${
          isLightTheme
            ? "border-r border-[#d9d9e3] bg-[#ececf1]"
            : "border-r border-white/10 bg-[#0D142E]/95"
        } ${
          isSidebarCollapsed ? "w-[4.1rem]" : "w-[14.5rem]"
        } ${isMobileSidebarOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"}`}
      >
        <div className="flex h-full flex-col px-2 py-1.5">
          <div
            className={`flex items-center justify-between gap-2 pb-1.5 ${
              isLightTheme ? "border-b border-[#d9d9e3]" : "border-b border-white/10"
            }`}
          >
            <div className="flex min-w-0 items-center gap-2">
              <span className="h-1.5 w-1.5 rounded-full bg-cyan-300/80" />
              {!isSidebarCollapsed ? (
                <p className={`truncate text-[13px] font-semibold ${isLightTheme ? "text-black" : "text-slate-100"}`}>Neurova</p>
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => setIsSidebarCollapsed((prev) => !prev)}
              className={`hidden h-7 w-7 items-center justify-center rounded-md border text-[11px] transition lg:inline-flex ${
                isLightTheme
                  ? "border-slate-300/90 bg-white/80 text-slate-700 hover:bg-slate-100"
                  : "border-white/12 bg-white/[0.03] text-slate-300 hover:bg-white/[0.07]"
              }`}
            >
              {isSidebarCollapsed ? ">" : "<"}
            </button>
            <button
              type="button"
              onClick={() => setIsMobileSidebarOpen(false)}
              className={`inline-flex h-7 w-7 items-center justify-center rounded-md border text-[11px] transition lg:hidden ${
                isLightTheme
                  ? "border-slate-300/90 bg-white/80 text-slate-700 hover:bg-slate-100"
                  : "border-white/12 bg-white/[0.03] text-slate-300 hover:bg-white/[0.07]"
              }`}
            >
              x
            </button>
          </div>

          <nav className="mt-1.5 space-y-1">
            <button
              type="button"
              onClick={handleNewChat}
              className={`flex w-full items-center gap-1.5 rounded-lg border px-2 py-1 text-left text-[11px] font-semibold transition ${
                isSidebarCollapsed
                  ? "justify-center"
                  : ""
              } ${
                isLightTheme
                  ? "border-slate-300 bg-white text-slate-800 hover:bg-slate-50"
                  : "border-cyan-300/30 bg-cyan-300/[0.11] text-cyan-100 hover:bg-cyan-300/[0.18]"
              }`}
            >
              <span className="text-[12px]">+</span>
              {!isSidebarCollapsed ? <span>{uiText.newChat}</span> : null}
            </button>

            <button
              type="button"
              onClick={focusChatComposer}
              className={`flex w-full items-center gap-1.5 rounded-lg border border-cyan-300/24 px-2 py-1 text-left text-[11px] font-semibold ${
                isSidebarCollapsed
                  ? "justify-center"
                  : ""
              } transition ${
                isLightTheme
                  ? "border-slate-300 bg-white text-slate-800 hover:bg-slate-50"
                  : "bg-cyan-300/[0.09] text-cyan-100 hover:bg-cyan-300/[0.15]"
              }`}
            >
              <span className="text-[12px]">#</span>
              {!isSidebarCollapsed ? <span className="ml-2">{uiText.chat}</span> : null}
            </button>

            <Link
              href="/business-profile"
              onClick={openBusinessProfilePage}
              className={`flex items-center gap-1.5 rounded-lg border border-white/12 bg-white/[0.03] px-2 py-1 text-[11px] font-semibold text-slate-300 transition hover:bg-white/[0.07] hover:text-cyan-100 ${
                isSidebarCollapsed ? "justify-center" : ""
              } ${
                isLightTheme
                  ? "border-slate-300/70 bg-transparent text-slate-700 hover:bg-white/70 hover:text-slate-900"
                  : ""
              }`}
            >
              <span className="text-[12px]">@</span>
              {!isSidebarCollapsed ? <span>{uiText.businessProfile}</span> : null}
            </Link>

            <Link
              href="/settings"
              className={`flex items-center gap-1.5 rounded-lg border border-white/12 bg-white/[0.03] px-2 py-1 text-[11px] font-semibold text-slate-300 transition hover:bg-white/[0.07] hover:text-cyan-100 ${
                isSidebarCollapsed ? "justify-center" : ""
              } ${
                isLightTheme
                  ? "border-slate-300/70 bg-transparent text-slate-700 hover:bg-white/70 hover:text-slate-900"
                  : ""
              }`}
            >
              <span
                aria-hidden="true"
                className={`inline-flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-bold ${
                  isLightTheme ? "bg-slate-800 text-white" : "bg-slate-100 text-slate-900"
                }`}
              >
                ⚙
              </span>
              {!isSidebarCollapsed ? <span>{uiText.settings}</span> : null}
            </Link>

            <button
              type="button"
              onClick={handleLogout}
              className={`flex w-full items-center gap-1.5 rounded-lg border border-white/12 bg-white/[0.03] px-2 py-1 text-left text-[11px] font-semibold text-slate-300 transition hover:bg-white/[0.07] hover:text-cyan-100 ${
                isSidebarCollapsed ? "justify-center" : ""
              } ${
                isLightTheme
                  ? "border-slate-300/70 bg-transparent text-slate-700 hover:bg-white/70 hover:text-slate-900"
                  : ""
              }`}
            >
              <span className="text-[12px]">!</span>
              {!isSidebarCollapsed ? <span>{uiText.logout}</span> : null}
            </button>
          </nav>

          {!isSidebarCollapsed ? (
            <div
              className={`mt-2.5 rounded-lg p-1.5 ${
                isLightTheme
                  ? "border border-[#d9d9e3] bg-[#f7f7f8]"
                  : "border border-white/10 bg-white/[0.015]"
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <p className={`text-[10px] font-semibold uppercase tracking-[0.1em] ${isLightTheme ? "text-slate-500" : "text-slate-400"}`}>
                  {uiText.businessContext}
                </p>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setIsBusinessContextCollapsed((prev) => !prev)}
                    className={`inline-flex h-5 items-center justify-center rounded-md border px-1.5 text-[10px] font-semibold transition ${
                      isLightTheme
                        ? "border-slate-300/80 bg-white text-slate-700 hover:bg-slate-100"
                        : "border-white/12 bg-white/[0.025] text-slate-300 hover:bg-white/[0.08] hover:text-slate-100"
                    }`}
                  >
                    {isBusinessContextCollapsed ? uiText.show : uiText.hide}
                  </button>
                  <Link
                    href="/business-profile"
                    onClick={openBusinessProfilePage}
                    className={`inline-flex h-5 items-center justify-center rounded-md border px-1.5 text-[10px] font-semibold transition ${
                      isLightTheme
                        ? "border-slate-300/80 bg-white text-slate-700 hover:bg-slate-100"
                        : "border-white/12 bg-white/[0.025] text-slate-300 hover:bg-white/[0.08] hover:text-slate-100"
                    }`}
                  >
                    {uiText.edit}
                  </Link>
                </div>
              </div>
              {isBusinessContextCollapsed ? (
                <p className={`mt-1 text-[10px] ${isLightTheme ? "text-slate-500" : "text-slate-400"}`}>
                  {uiText.businessContext} ({sidebarContextSetCount} {uiText.fieldsSet})
                </p>
              ) : (
                <div className="mt-1 space-y-0.5">
                  {sidebarContextItems.map((item) => (
                    <div
                      key={item.key}
                      className={`rounded-md border px-1.5 py-0.5 ${
                        isLightTheme ? "border-slate-200/90 bg-white/70" : "border-white/8 bg-white/[0.02]"
                      }`}
                    >
                      <p className={`text-[9px] uppercase tracking-[0.08em] ${isLightTheme ? "text-slate-500" : "text-slate-500"}`}>
                        {item.label}
                      </p>
                      <p className={`truncate text-[10px] ${item.isMissing ? "text-slate-500" : isLightTheme ? "text-slate-700" : "text-slate-300"}`}>
                        {item.isMissing ? uiText.missing : item.value}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : null}

          {!isSidebarCollapsed ? (
            <div className={`mt-2 rounded-lg p-1.5 ${isLightTheme ? "border border-[#d9d9e3] bg-[#f7f7f8]" : "border border-white/10 bg-white/[0.015]"}`}>
              <p className={`text-[10px] font-semibold uppercase tracking-[0.1em] ${isLightTheme ? "text-slate-500" : "text-slate-400"}`}>
                {uiText.recentChats}
              </p>
              {recentChatSessions.length > 0 ? (
                <div className="mt-1 max-h-40 space-y-0.5 overflow-y-auto pr-0.5">
                  {recentChatSessions.map((session) => {
                    const isActiveSession = session.id === activeChatSessionId;
                    return (
                      <div
                        key={session.id}
                        className={`group flex items-start gap-1 rounded-md border px-1 py-0.5 transition ${
                          isActiveSession
                            ? isLightTheme
                              ? "border-slate-400 bg-white text-slate-900"
                              : "border-cyan-300/30 bg-cyan-300/[0.12] text-cyan-100"
                            : isLightTheme
                              ? "border-slate-200 bg-transparent text-slate-700 hover:bg-white/70"
                              : "border-white/8 bg-white/[0.02] text-slate-300 hover:bg-white/[0.05]"
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => {
                            setActiveChatSessionId(session.id);
                            setEditingMessageId(null);
                            setIsMobileSidebarOpen(false);
                          }}
                          className="min-w-0 flex-1 text-left"
                        >
                          <p className="truncate text-[10px] font-medium">{session.title}</p>
                          <p className={`mt-0.5 text-[9px] ${isLightTheme ? "text-slate-500" : "text-slate-500"}`}>
                            {formatSidebarTime(session.updatedAt)}
                          </p>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteChatSession(session.id)}
                          className={`inline-flex h-5 w-5 flex-shrink-0 items-center justify-center rounded border text-[10px] font-semibold text-black opacity-0 pointer-events-none transition duration-150 group-hover:opacity-100 group-hover:pointer-events-auto focus-visible:opacity-100 focus-visible:pointer-events-auto ${
                            isLightTheme
                              ? "border-slate-300 bg-white hover:bg-slate-100"
                              : "border-white/25 bg-white/90 hover:bg-white"
                          }`}
                          aria-label={uiText.deleteChat}
                          title={uiText.deleteChat}
                        >
                          x
                        </button>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="mt-1.5 text-[11px] text-slate-500">{uiText.noRecentChats}</p>
              )}
            </div>
          ) : null}
        </div>
      </aside>

      <div
        className={`transition-[padding] duration-200 ${
          isSidebarCollapsed ? "lg:pl-[4.1rem]" : "lg:pl-[14.5rem]"
        }`}
      >
      <div className="mx-auto flex h-[100dvh] min-h-0 w-full max-w-[80rem] flex-col px-2 pb-2 pt-2 sm:px-4 sm:pb-4 lg:px-6">
        <header
          className={`sticky top-0 z-30 shrink-0 py-0.5 backdrop-blur-md ${
            isLightTheme
              ? "border-b border-[#e5e7eb] bg-[#f7f7f8]/95"
              : "border-b border-white/8 bg-[#0B0F2B]/90"
          }`}
        >
          <div className="flex min-w-0 items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              <button
                type="button"
                onClick={() => setIsMobileSidebarOpen(true)}
                className={`inline-flex h-7 w-7 items-center justify-center rounded-md border text-[11px] transition lg:hidden ${
                  isLightTheme
                    ? "border-slate-300/80 bg-white text-slate-700 hover:bg-slate-100"
                    : "border-white/12 bg-white/[0.03] text-slate-300 hover:bg-white/[0.06]"
                }`}
              >
                ==
              </button>
              <div className="-ml-2 mr-2 flex h-[40px] w-auto flex-shrink-0 items-center justify-center overflow-hidden rounded-[10px] bg-black px-0.5 sm:h-[46px] sm:rounded-[12px] sm:px-0.5">
                <img
                  src="/neurova-logo-transparent.png"
                  alt="Neurova logo"
                  className="h-[40px] w-auto scale-[1.56] object-contain brightness-110 contrast-125 sm:h-[46px] sm:scale-[1.6]"
                  loading="eager"
                  decoding="async"
                />
              </div>
              <h1 className="sr-only">Neurova</h1>
              <span
                className={`hidden rounded-md px-1.5 py-0.5 text-[10px] font-medium tracking-[0.01em] sm:inline-flex ${
                  isLightTheme
                    ? "border border-slate-300/70 bg-white/80 text-slate-700"
                    : "border border-white/12 bg-white/[0.025] text-slate-300"
                }`}
              >
                {uiText.badge}
              </span>
            </div>

            <div className="flex items-center gap-2.5 sm:gap-3">
              <div className={`flex-shrink-0 rounded-full p-0.5 ${isLightTheme ? "border border-slate-300/80 bg-white" : "border border-white/12 bg-white/[0.03]"}`}>
                <div className="grid grid-cols-2 gap-0.5">
                  {CHAT_MODE_OPTIONS.map((option) => {
                    const isActive = option.value === mode;

                    return (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => setMode(option.value)}
                        className={`min-w-[4.5rem] rounded-full px-2 py-1.5 text-center transition-all duration-200 sm:min-w-[6.6rem] sm:px-2.5 ${
                          isActive
                            ? isLightTheme
                              ? "border border-slate-300 bg-slate-100 text-slate-900"
                              : "border border-cyan-300/30 bg-gradient-to-b from-cyan-300/[0.16] to-cyan-300/[0.09] text-cyan-50 shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_0_0_1px_rgba(56,189,248,0.06)]"
                            : isLightTheme
                              ? "border border-transparent bg-transparent text-slate-500 hover:bg-slate-100 hover:text-slate-800"
                              : "border border-transparent bg-transparent text-slate-400 hover:bg-white/[0.04] hover:text-slate-200"
                        }`}
                      >
                        <span className="block text-[11px] font-medium leading-none sm:text-[12px]">
                          {option.label}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </header>

        <main className="flex min-h-0 flex-1 flex-col pt-1 sm:pt-1.5">
          {profileHelperNote ? (
            <div className="mx-auto mt-1 w-full px-1 sm:px-3">
              <div
                className={`rounded-xl border px-3 py-2 text-[12px] sm:text-[13px] ${
                  isLightTheme
                    ? "border-amber-500/30 bg-amber-100/80 text-amber-900"
                    : "border-amber-200/30 bg-amber-200/[0.08] text-amber-100"
                }`}
              >
                {profileHelperNote}
              </div>
            </div>
          ) : null}
          <section className="relative min-h-0 flex-1 overflow-hidden">
            <div className={`pointer-events-none absolute left-1/2 top-0 h-56 w-56 -translate-x-1/2 rounded-full blur-3xl ${isLightTheme ? "bg-slate-300/20" : "bg-cyan-400/10"}`} />
            <div className="relative mx-auto flex h-full min-h-0 w-full flex-col">
              <div
                ref={chatContainerRef}
                className="chat-scrollbar flex flex-1 flex-col overflow-y-auto px-2 pb-24 pt-2.5 sm:px-5 sm:pb-28 sm:pt-3 lg:px-8"
              >
                {showWelcomeBlock ? (
                  <div className="flex min-h-full items-center justify-center px-1 py-6 sm:px-2 sm:py-8">
                    <div
                      className={`w-full max-w-[36rem] rounded-[18px] px-4 py-4 text-center sm:px-5 sm:py-5 ${
                        isLightTheme
                          ? "border border-slate-300/70 bg-white/86 shadow-[0_10px_28px_rgba(15,23,42,0.12)]"
                          : "border border-white/10 bg-white/[0.025] shadow-[0_10px_28px_rgba(3,8,23,0.24)]"
                      }`}
                    >
                      <h2
                        className={`text-[20px] font-semibold leading-tight sm:text-[22px] ${
                          isLightTheme ? "text-slate-900" : "text-slate-100"
                        }`}
                      >
                        {uiText.welcomeTitle}
                      </h2>
                      <p
                        className={`mt-2 text-[14px] leading-6 sm:text-[15px] ${
                          isLightTheme ? "text-slate-700" : "text-slate-300"
                        }`}
                      >
                        {uiText.welcomeDesc}
                      </p>

                      <div className="mt-4 flex flex-wrap justify-center gap-2">
                        {quickPrompts.map((prompt) => (
                          <button
                            key={prompt}
                            type="button"
                            onClick={() => handleStarterChipClick(prompt)}
                            className={`rounded-[12px] border px-3 py-1.5 text-[13px] transition sm:text-[14px] ${
                              isLightTheme
                                ? "border-slate-300/60 bg-white/90 text-slate-800 hover:border-cyan-500/40 hover:bg-cyan-100 hover:text-cyan-900"
                                : "border-white/12 bg-white/[0.03] text-slate-200 hover:border-cyan-300/35 hover:bg-cyan-300/[0.09] hover:text-cyan-100"
                            }`}
                          >
                            {prompt}
                          </button>
                        ))}
                      </div>

                      <p className={`mt-3 text-xs ${isLightTheme ? "text-slate-600" : "text-slate-400"}`}>
                        {uiText.chatModeHint}
                      </p>
                    </div>
                  </div>
                ) : null}

                <div
                  className={`px-2 pt-1 transition-all duration-300 ease-out sm:px-3 ${
                    hasConversationStarted && showStarterChips
                      ? "max-h-40 translate-y-0 opacity-100"
                      : "pointer-events-none max-h-0 -translate-y-1 opacity-0"
                  }`}
                >
                  <div className={`rounded-2xl px-2 py-2 sm:px-2.5 ${isLightTheme ? "border border-slate-300/80 bg-white/90 shadow-[0_6px_20px_rgba(15,23,42,0.08)]" : "border border-white/10 bg-white/[0.02] shadow-[0_8px_22px_rgba(2,8,23,0.18)]"}`}>
                    <p className={`px-1 text-[11px] font-medium tracking-[0.015em] sm:text-xs ${isLightTheme ? "text-slate-700" : "text-slate-300"}`}>
                      {uiText.quickStart}
                    </p>
                    <div className="mt-1.5 flex flex-wrap gap-1.5 sm:gap-2">
                      {quickPrompts.map((chip) => (
                        <button
                          key={chip}
                          type="button"
                          onClick={() => handleStarterChipClick(chip)}
                            className={`inline-flex min-h-8 items-center rounded-full border px-3 py-1 text-left text-[12px] font-medium transition-all duration-200 active:scale-[0.985] sm:text-[13px] ${
                              isLightTheme
                                ? "border-slate-300 bg-white text-slate-800 hover:bg-slate-100"
                                : "border-cyan-200/22 bg-cyan-300/[0.07] text-cyan-50 hover:border-cyan-200/38 hover:bg-cyan-300/[0.16]"
                            }`}
                        >
                          {chip}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {messages.map((message, index) => {
                  const previousRole = index > 0 ? messages[index - 1].role : null;
                  const isGroupedWithPrevious = previousRole === message.role;

                  return (
                    <div
                      key={message.id}
                      className={`flex px-2 sm:px-3 ${
                        isGroupedWithPrevious ? "mt-3 sm:mt-3.5" : "mt-3.5 sm:mt-4"
                      } ${index === 0 ? "!mt-0" : ""} ${
                        message.role === "user" ? "justify-end" : "justify-start"
                      } message-enter`}
                    >
                      {message.role === "user" ? (
                        <div className="group flex w-full max-w-[88%] flex-col items-end sm:max-w-[84%] md:max-w-[60%]">
                          <div
                            className={`w-full rounded-[24px] rounded-br-md border px-4 py-3 text-[15px] leading-[1.62] shadow-[0_8px_24px_rgba(6,182,212,0.12)] ${
                              isLightTheme
                                ? "border-slate-300 bg-[#ececf1] text-slate-900 shadow-[0_4px_12px_rgba(15,23,42,0.06)]"
                                : "border-cyan-200/36 bg-cyan-300/[0.22] text-cyan-50"
                            }`}
                          >
                            {renderMessageParagraphs(message.text)}
                            {message.attachments && message.attachments.length > 0 ? (
                              <div className="mt-3 space-y-2">
                                {message.attachments.map((attachment) => {
                                  const isImage = attachment.type.startsWith("image/");
                                  return (
                                    <div
                                      key={attachment.id}
                                      className={`rounded-2xl border p-2 ${
                                        isLightTheme
                                          ? "border-cyan-700/20 bg-cyan-50"
                                          : "border-cyan-100/30 bg-[#0b1633]/45"
                                      }`}
                                    >
                                      {isImage && attachment.previewUrl ? (
                                        <img
                                          src={attachment.previewUrl}
                                          alt={attachment.name}
                                          className="max-h-56 w-full rounded-xl object-contain"
                                        />
                                      ) : null}
                                      <p
                                        className={`mt-1.5 truncate text-[12px] ${
                                          isLightTheme ? "text-cyan-900" : "text-cyan-100/95"
                                        }`}
                                      >
                                        {attachment.name}
                                      </p>
                                    </div>
                                  );
                                })}
                              </div>
                            ) : null}
                          </div>
                          <div className="mt-1 flex items-center gap-1 opacity-100 transition sm:pointer-events-none sm:opacity-0 sm:group-hover:pointer-events-auto sm:group-hover:opacity-100">
                            <button
                              type="button"
                              onClick={() => void handleCopyMessage(message.id, message.text)}
                              className={`inline-flex h-6 items-center gap-1 rounded-full border px-2 text-[10px] font-medium transition ${
                                isLightTheme
                                  ? "border-slate-300 bg-white text-black hover:bg-slate-100"
                                  : "border-white/12 bg-white/[0.04] text-slate-300 hover:bg-white/[0.1] hover:text-white"
                              }`}
                              aria-label="Copy message"
                            >
                              {copiedMessageId === message.id ? uiText.copied : uiText.copy}
                            </button>
                            {message.id === latestUserMessageId ? (
                              <button
                                type="button"
                                onClick={() => handleEditMessage(message)}
                                className={`inline-flex h-6 items-center gap-1 rounded-full border px-2 text-[10px] font-medium transition ${
                                  isLightTheme
                                    ? "border-slate-300 bg-white text-black hover:bg-slate-100"
                                    : "border-white/12 bg-white/[0.04] text-slate-300 hover:bg-white/[0.1] hover:text-white"
                                }`}
                                aria-label="Edit message"
                              >
                                {uiText.editMessage}
                              </button>
                            ) : null}
                          </div>
                        </div>
                      ) : message.kind === "thinking" ? (
                        <div className={`thinking-message w-full max-w-[88%] rounded-[24px] rounded-tl-md border px-4 py-3 sm:max-w-[84%] md:max-w-[65%] ${
                          isLightTheme ? "border-slate-300 bg-white" : "border-white/14 bg-slate-900/52"
                        }`}>
                          <p className="thinking-label text-[15px] leading-[1.62]">
                            {message.text}
                            {renderThinkingWave("chat")}
                          </p>
                        </div>
                      ) : (
                        (() => {
                          const structuredSections = parseStructuredReplySections(message.text);
                          const shouldUseStructured =
                            message.renderMode !== "plain" && Boolean(structuredSections);

                          if (!shouldUseStructured || !structuredSections) {
                            return (
                              <div className="group flex w-full max-w-[88%] flex-col items-start sm:max-w-[84%] md:max-w-[65%]">
                                <div className={`w-full rounded-[20px] rounded-tl-md border px-4 py-3 text-[15px] font-medium leading-[1.62] ${
                                  isLightTheme
                                    ? "border-slate-300 bg-white text-slate-800 shadow-[0_2px_8px_rgba(15,23,42,0.06)]"
                                    : "border-white/14 bg-slate-900/58 text-slate-100"
                                }`}>
                                  {renderMinimalAssistantContent(message.text)}
                                </div>
                                <div className="mt-1 flex items-center gap-1 opacity-100 transition sm:pointer-events-none sm:opacity-0 sm:group-hover:pointer-events-auto sm:group-hover:opacity-100">
                                  <button
                                    type="button"
                                    onClick={() => void handleCopyMessage(message.id, message.text)}
                                    className={`inline-flex h-6 items-center gap-1 rounded-full border px-2 text-[10px] font-medium transition ${
                                      isLightTheme
                                        ? "border-slate-300 bg-white text-black hover:bg-slate-100"
                                        : "border-white/12 bg-white/[0.04] text-slate-300 hover:bg-white/[0.1] hover:text-white"
                                    }`}
                                    aria-label="Copy message"
                                  >
                                    {copiedMessageId === message.id ? uiText.copied : uiText.copy}
                                  </button>
                                </div>
                              </div>
                            );
                          }

                          return (
                            <div className="group flex w-full max-w-[88%] flex-col items-start sm:max-w-[84%] md:max-w-[65%]">
                              <div className={`manager-card manager-enter w-full rounded-[22px] border px-4 py-3 backdrop-blur-sm ${
                                isLightTheme
                                  ? "border-slate-300 bg-white shadow-[0_4px_12px_rgba(15,23,42,0.08)]"
                                  : "border-white/12 bg-[#0f1936]/82 shadow-[0_10px_24px_rgba(3,8,23,0.3)]"
                              }`}>
                                <div className="flex flex-col">
                                  {structuredSections.map((section, index) => (
                                    <section
                                      key={`${message.id}-structured-${section.title}-${index}`}
                                      className={`w-full ${
                                        index > 0 ? "mt-2.5 border-t border-white/10 pt-2.5 sm:mt-3 sm:pt-3" : ""
                                      }`}
                                    >
                                      <h2
                                        className={`text-[11px] font-bold uppercase tracking-[0.15em] sm:text-[12px] ${
                                          isLightTheme ? "text-slate-500" : "text-cyan-200/88"
                                        }`}
                                      >
                                        {formatStructuredSectionTitle(section.title)}
                                      </h2>
                                      {section.variant === "steps" ? (
                                        <ol className="mt-2 space-y-2">
                                          {section.content
                                            .split(/\r?\n/)
                                            .map((line) => line.trim())
                                            .filter(Boolean)
                                            .map((line, stepIndex) => (
                                              <li
                                                key={`${message.id}-step-${index}-${stepIndex}`}
                                                className={`flex items-start gap-2 rounded-xl border px-2.5 py-2 ${
                                                  isLightTheme
                                                    ? "border-slate-200 bg-slate-50"
                                                    : "border-white/10 bg-white/[0.03]"
                                                }`}
                                              >
                                                <span className={`mt-0.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full border text-[11px] font-semibold ${
                                                  isLightTheme
                                                    ? "border-slate-300 bg-white text-slate-700"
                                                    : "border-cyan-300/35 bg-cyan-300/[0.14] text-cyan-100"
                                                }`}>
                                                  {stepIndex + 1}
                                                </span>
                                                <span className={`text-[14px] font-medium leading-6 sm:text-[15px] ${isLightTheme ? "text-slate-800" : "text-slate-100"}`}>
                                                  {line}
                                                </span>
                                              </li>
                                            ))}
                                        </ol>
                                      ) : (
                                        <p
                                          className={`mt-1.5 whitespace-pre-line text-[14px] font-medium leading-[1.62] sm:text-[15px] ${
                                            section.title === "Short Answer"
                                              ? isLightTheme
                                                ? "font-semibold text-slate-900"
                                                : "font-semibold text-cyan-50"
                                              : isLightTheme
                                                ? "text-slate-800"
                                                : "text-slate-100"
                                          }`}
                                        >
                                          {section.content}
                                        </p>
                                      )}
                                    </section>
                                  ))}
                                </div>
                              </div>
                              <div className="mt-1 flex items-center gap-1 opacity-100 transition sm:pointer-events-none sm:opacity-0 sm:group-hover:pointer-events-auto sm:group-hover:opacity-100">
                                <button
                                  type="button"
                                  onClick={() => void handleCopyMessage(message.id, message.text)}
                                  className={`inline-flex h-6 items-center gap-1 rounded-full border px-2 text-[10px] font-medium transition ${
                                    isLightTheme
                                      ? "border-slate-300 bg-white text-black hover:bg-slate-100"
                                      : "border-white/12 bg-white/[0.04] text-slate-300 hover:bg-white/[0.1] hover:text-white"
                                  }`}
                                  aria-label="Copy message"
                                >
                                  {copiedMessageId === message.id ? uiText.copied : uiText.copy}
                                </button>
                              </div>
                            </div>
                          );
                        })()
                      )}
                    </div>
                  );
                })}
                <div ref={messageEndRef} aria-hidden="true" className="h-px w-full" />
              </div>
            </div>
          </section>

          <div className="z-20 mx-auto mt-1 w-full shrink-0 pb-[max(0.55rem,env(safe-area-inset-bottom))] pt-2.5 sm:pt-3">
            <div className="mb-1.5 px-2 sm:px-3">
              <p className={`text-xs ${isLightTheme ? "text-slate-500" : "text-slate-400"}`}>
                {mode === "chat"
                  ? uiText.modeChatHint
                  : uiText.modeManagerHint}
              </p>
            </div>
            <form ref={chatFormRef} onSubmit={handleSubmit}>
              <input
                ref={attachmentInputRef}
                type="file"
                accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.txt"
                multiple
                className="hidden"
                onChange={handleAttachmentSelection}
              />
              {pendingAttachments.length > 0 ? (
                <div className="mb-1.5 flex flex-wrap gap-1.5 px-2 sm:px-3">
                  {pendingAttachments.map((item) => (
                    <span
                      key={item.id}
                      className="inline-flex items-center gap-1 rounded-full border border-cyan-200/28 bg-cyan-300/[0.1] px-2 py-0.5 text-[11px] text-cyan-50"
                    >
                      <span className="max-w-[10rem] truncate sm:max-w-[14rem]">{item.file.name}</span>
                      <button
                        type="button"
                        onClick={() => removePendingAttachment(item.id)}
                        className="rounded-full border border-cyan-100/20 px-1 text-[10px] leading-none text-cyan-100/90 transition hover:bg-cyan-200/15"
                        aria-label={`Remove ${item.file.name}`}
                      >
                        x
                      </button>
                    </span>
                  ))}
                </div>
              ) : null}
              {editingMessageId !== null ? (
                <div className="mb-1.5 flex items-center justify-between gap-2 px-2 sm:px-3">
                  <p className="text-[11px] text-cyan-200/85">{uiText.editingPrevious}</p>
                  <button
                    type="button"
                    onClick={() => setEditingMessageId(null)}
                    className="inline-flex h-6 items-center rounded-full border border-white/12 bg-white/[0.03] px-2 text-[10px] font-medium text-slate-300 transition hover:bg-white/[0.1] hover:text-white"
                  >
                    {uiText.cancel}
                  </button>
                </div>
              ) : null}
              <div
                className={`flex items-end gap-2 rounded-[26px] px-2.5 py-2 backdrop-blur-xl transition-all duration-200 sm:gap-2.5 sm:px-3 sm:py-2.5 ${
                  isLightTheme
                    ? "border border-[#d1d5db] bg-white shadow-[0_1px_2px_rgba(0,0,0,0.06)] focus-within:border-slate-400 focus-within:shadow-[0_0_0_3px_rgba(148,163,184,0.22)]"
                    : "border border-white/14 bg-[linear-gradient(160deg,rgba(20,32,62,0.96),rgba(10,16,36,0.94))] shadow-[0_10px_34px_rgba(1,7,20,0.42),inset_0_1px_0_rgba(255,255,255,0.04)] focus-within:border-cyan-300/55 focus-within:shadow-[0_14px_36px_rgba(1,9,28,0.52),0_0_0_3px_rgba(34,211,238,0.16)]"
                }`}
              >
                <button
                  type="button"
                  onClick={openAttachmentPicker}
                  disabled={isLoading}
                  className={`inline-flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full border text-lg font-semibold transition-all duration-200 sm:h-[44px] sm:w-[44px] ${
                    isLoading
                      ? isLightTheme
                        ? "cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400"
                        : "cursor-not-allowed border-white/10 bg-white/[0.03] text-slate-500"
                      : isLightTheme
                        ? "border-slate-300 bg-slate-50 text-slate-700 hover:-translate-y-[1px] hover:bg-slate-100"
                        : "border-white/18 bg-white/[0.06] text-slate-100 hover:-translate-y-[1px] hover:bg-white/[0.13]"
                  }`}
                  aria-label={uiText.addAttachment}
                  title={uiText.addAttachment}
                >
                  +
                </button>
                <textarea
                  ref={inputRef}
                  rows={1}
                  placeholder={uiText.composerPlaceholder}
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                  onKeyDown={handleComposerKeyDown}
                  onFocus={scrollToBottom}
                  disabled={isLoading}
                  className={`max-h-[148px] min-h-[42px] w-full resize-none rounded-2xl border px-3.5 py-2.5 text-[15px] leading-6 transition-colors duration-200 focus:outline-none sm:min-h-[44px] sm:text-[15px] ${
                    isLightTheme
                      ? "border-transparent bg-transparent text-slate-900 placeholder:text-slate-500 focus:border-slate-300 focus:bg-slate-50"
                      : "border-transparent bg-white/[0.03] text-white placeholder:text-slate-300/72 focus:border-cyan-300/30 focus:bg-white/[0.06]"
                  }`}
                />
                <button
                  type="submit"
                  disabled={!canSend}
                  className={`group inline-flex h-10 min-w-[3rem] items-center justify-center gap-1 rounded-full border px-3 text-[13px] font-semibold transition-all duration-200 active:scale-[0.98] sm:h-[44px] sm:min-w-[5.2rem] sm:px-3.5 sm:text-[14px] ${
                    canSend
                      ? "border-cyan-200/50 bg-cyan-300/92 text-slate-950 shadow-[0_0_0_1px_rgba(103,232,249,0.14),0_0_24px_rgba(34,211,238,0.32)] hover:-translate-y-[1px] hover:bg-cyan-200"
                      : "cursor-not-allowed border-cyan-300/15 bg-cyan-300/45 text-slate-900/70"
                  }`}
                >
                  {isLoading ? (
                    <span className="inline-flex items-center text-[12px] sm:text-[13px]">
                      {uiText.thinking}
                      {renderThinkingWave("button")}
                    </span>
                  ) : (
                    <>
                      <svg
                        viewBox="0 0 24 24"
                        aria-hidden="true"
                        className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-[1px]"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M22 2L11 13" />
                        <path d="M22 2L15 22L11 13L2 9L22 2Z" />
                      </svg>
                      <span className="hidden sm:inline">{uiText.send}</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </main>
      </div>
    </div>
    </div>
  );
}


