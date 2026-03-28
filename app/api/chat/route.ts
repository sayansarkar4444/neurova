import { NextResponse } from "next/server";
import Groq from "groq-sdk";

import { routeAiMessage, type ChatMessage } from "@/lib/aiRouter";
import {
  applyProfilePatch,
  EMPTY_BUSINESS_PROFILE,
  extractBusinessMemoryFromUserMessage,
  normalizeBusinessProfile,
  type BusinessProfile,
  type BusinessProfileField,
  type ProfileUpdateSuggestion,
} from "@/lib/businessProfile";
import { DEFAULT_CHAT_MODE, isChatMode, type ChatMode } from "@/lib/chatMode";
import {
  EMPTY_SHARED_BUSINESS_CONTEXT,
  type SharedBusinessContext,
  EMPTY_SHARED_TASK_STATE,
  type SharedTaskState,
} from "@/lib/sharedContext";
import {
  readBusinessProfileFromDb,
  writeBusinessProfileToDb,
} from "@/lib/profileDb";
import { getRequestUserId } from "@/lib/requestUser";
import {
  DEFAULT_USER_SETTINGS,
  normalizeUserSettings,
  type UserSettings,
} from "@/lib/userSettings";

export const runtime = "nodejs";

type ChatRequestBody = {
  messages?: unknown;
  mode?: unknown;
  sharedContext?: unknown;
  businessProfile?: unknown;
  sharedTaskState?: unknown;
  userSettings?: unknown;
};

type ChatAttachment = {
  name: string;
  type: string;
  size: number;
};

const MAX_ATTACHMENTS = 6;
const MAX_ATTACHMENT_SIZE_BYTES = 12 * 1024 * 1024;
const MAX_VISION_IMAGES = 2;
const MAX_VISION_IMAGE_SIZE_BYTES = 12 * 1024 * 1024;
const GROQ_VISION_MODELS = [
  "llama-3.2-11b-vision-preview",
  "llama-3.2-90b-vision-preview",
  "meta-llama/llama-4-scout-17b-16e-instruct",
] as const;

type VisionSummaryResult = {
  summary: string | null;
  note: string | null;
};

function normalizeForRepeatGuard(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, "");
}

function buildNonRepeatingFallback(
  latestUserMessage: string,
  repeatedReply: string
): string {
  const normalizedQuestion = latestUserMessage.trim().toLowerCase();
  const compactPrevious = repeatedReply.trim();

  const asksAllApps =
    /\b(sab|saare|all)\b/i.test(normalizedQuestion) &&
    /\b(app|apps|channel|channels)\b/i.test(normalizedQuestion);
  if (asksAllApps) {
    return [
      "Nahi, saare apps/channels use karna zaroori nahi hota.",
      "Ek primary channel choose karo jo aapke current goal ke closest ho.",
      "Goal bataoge to main exact channel + execution sequence de dunga.",
    ].join("\n");
  }

  const asksHowTo =
    /\b(kaise|how to|how do i|how should i|step by step)\b/i.test(normalizedQuestion);
  if (asksHowTo) {
    return [
      "Isko aise practical tareeke se karo:",
      "Step 1: Aaj 10 purane customers ko personal WhatsApp message bhejo with comeback offer.",
      "Step 2: Dukan ke bahar clear offer board lagao taaki walk-ins ko reason mile.",
      "Step 3: Shaam tak kitne replies/visits aaye woh note karo aur us basis par next move set karo.",
      "Chaaho to main isi case ka exact message text bhi de deta hoon.",
    ].join("\n");
  }

  return [
    "Same line repeat nahi kar raha. Aapke current question ka direct answer dete hain.",
    "Agle step me ek hi focused action complete karo aur uska result share karo.",
    `Last context considered: ${compactPrevious.slice(0, 120)}${compactPrevious.length > 120 ? "..." : ""}`,
  ].join("\n");
}

function enforceNoRepeatReply(
  reply: string,
  messages: ChatMessage[]
): string {
  const lastAssistantMessage = [...messages]
    .reverse()
    .find((message) => message.role === "assistant")?.content;
  const latestUserMessage = [...messages]
    .reverse()
    .find((message) => message.role === "user")?.content;

  if (!lastAssistantMessage || !latestUserMessage) {
    return reply;
  }

  const normalizedReply = normalizeForRepeatGuard(reply);
  const normalizedLastAssistant = normalizeForRepeatGuard(lastAssistantMessage);
  if (!normalizedReply || normalizedReply !== normalizedLastAssistant) {
    return reply;
  }

  const fallback = buildNonRepeatingFallback(latestUserMessage, lastAssistantMessage);
  if (normalizeForRepeatGuard(fallback) === normalizedLastAssistant) {
    return `${fallback}\nFocus only on one channel today.`;
  }

  return fallback;
}

function sanitizeAttachments(files: File[]): ChatAttachment[] {
  return files
    .slice(0, MAX_ATTACHMENTS)
    .map((file) => ({
      name: typeof file.name === "string" ? file.name.trim() : "",
      type: typeof file.type === "string" ? file.type.trim() : "",
      size: typeof file.size === "number" ? file.size : 0,
    }))
    .filter((item) => item.name.length > 0 && item.size > 0 && item.size <= MAX_ATTACHMENT_SIZE_BYTES);
}

async function summarizeImageAttachments(files: File[]): Promise<VisionSummaryResult> {
  const apiKey = process.env.GROQ_API_KEY?.trim();
  if (!apiKey) {
    return {
      summary: null,
      note: "Image analysis unavailable: GROQ_API_KEY missing.",
    };
  }

  const allImageFiles = files.filter(
    (file) => typeof file.type === "string" && file.type.startsWith("image/")
  );

  const imageFiles = allImageFiles
    .filter((file) => typeof file.size === "number" && file.size > 0 && file.size <= MAX_VISION_IMAGE_SIZE_BYTES)
    .slice(0, MAX_VISION_IMAGES);

  if (allImageFiles.length === 0) {
    return { summary: null, note: null };
  }
  if (imageFiles.length === 0) {
    return {
      summary: null,
      note: `Image analysis skipped: image must be <= ${Math.round(
        MAX_VISION_IMAGE_SIZE_BYTES / (1024 * 1024)
      )}MB.`,
    };
  }

  try {
    const userContent: Array<Record<string, unknown>> = [
      {
        type: "text",
        text:
          "Analyze these uploaded images for business context. Respond in up to 5 short bullets covering visible text, product/business clues, and actionable observations.",
      },
    ];

    for (const file of imageFiles) {
      const arrayBuffer = await file.arrayBuffer();
      const base64 = Buffer.from(arrayBuffer).toString("base64");
      const mimeType = file.type || "image/jpeg";
      userContent.push({
        type: "image_url",
        image_url: {
          url: `data:${mimeType};base64,${base64}`,
        },
      });
    }

    const groq = new Groq({ apiKey });
    let lastErrorMessage = "";

    for (const model of GROQ_VISION_MODELS) {
      try {
        const completion = await groq.chat.completions.create({
          model,
          temperature: 0.1,
          max_tokens: 280,
          messages: [
            {
              role: "system",
              content:
                "You are a careful visual assistant. Only mention what is actually visible. If uncertain, say uncertain.",
            },
            {
              role: "user",
              content: userContent as any,
            },
          ],
        });

        const summary = completion.choices[0]?.message?.content?.trim();
        if (summary && summary.length > 0) {
          return {
            summary,
            note: null,
          };
        }
      } catch (error) {
        lastErrorMessage =
          error instanceof Error && error.message
            ? error.message
            : "unknown provider error";
      }
    }

    return {
      summary: null,
      note: lastErrorMessage
        ? `Image analysis failed at provider step: ${lastErrorMessage}`
        : "Image analysis returned empty result.",
    };
  } catch (error) {
    console.warn("[/api/chat] Vision analysis failed:", error);
    return {
      summary: null,
      note: "Image analysis failed at provider step.",
    };
  }
}

function appendAttachmentContext(
  messages: ChatMessage[],
  attachments: ChatAttachment[],
  imageSummary: string | null,
  imageAnalysisNote: string | null
): ChatMessage[] {
  if (attachments.length === 0 && !imageSummary && !imageAnalysisNote) return messages;
  const latestUserIndex = [...messages].reverse().findIndex((item) => item.role === "user");
  if (latestUserIndex === -1) return messages;

  const targetIndex = messages.length - 1 - latestUserIndex;
  const lines = attachments.map((file) => {
    const typeLabel = file.type || "unknown-type";
    const sizeKb = Math.max(1, Math.round(file.size / 1024));
    return `- ${file.name} (${typeLabel}, ${sizeKb} KB)`;
  });
  const attachmentBlock =
    lines.length > 0
      ? `\n\nUploaded attachments:\n${lines.join("\n")}`
      : "";
  const visionBlock = imageSummary
    ? `\n\nImage analysis (visible details):\n${imageSummary}`
    : imageAnalysisNote
      ? `\n\nImage analysis note:\n${imageAnalysisNote}`
      : "";

  return messages.map((message, index) =>
    index === targetIndex
      ? {
          ...message,
          content: `${message.content}${attachmentBlock}${visionBlock}`,
        }
      : message
  );
}

const ONBOARDING_QUESTION_HINTS: Array<{
  field: BusinessProfileField;
  hints: string[];
}> = [
  { field: "ownerName", hints: ["aapka naam", "owner name", "your name"] },
  { field: "businessType", hints: ["kis type ka business", "business type"] },
  { field: "businessName", hints: ["business ka naam", "business name"] },
  { field: "cityArea", hints: ["kis city", "kis area", "city ya area"] },
  { field: "preferredLanguage", hints: ["preferred language", "kis language"] },
  { field: "offerDescription", hints: ["aap kya sell", "what do you sell", "offer description"] },
  { field: "mainGoal", hints: ["main goal", "goal abhi kya"] },
  { field: "secondaryGoal", hints: ["secondary goal"] },
  { field: "currentFocus", hints: ["current focus", "abhi focus"] },
  { field: "customerType", hints: ["customers kis type", "customer type"] },
  { field: "priceRange", hints: ["price range"] },
  { field: "businessModel", hints: ["business model", "online hai, offline hai"] },
  { field: "businessStage", hints: ["business stage", "beginner ho ya growing"] },
  { field: "budgetLevel", hints: ["budget level", "low, medium"] },
  { field: "teamSize", hints: ["team me kitne log", "team size"] },
  { field: "keyConstraint1", hints: ["sabse bada constraint"] },
  { field: "keyConstraint2", hints: ["dusra important constraint"] },
  { field: "notes", hints: ["stable business detail", "notes"] },
];

function isExplicitMainGoalStatement(userMessage: string): boolean {
  const normalized = userMessage.trim().toLowerCase();
  if (!normalized) return false;
  if (normalized.includes("?") || /\b(kya|kiya|kia|what)\b/i.test(normalized)) {
    return false;
  }

  return (
    /\b(?:mera|hamara|my|our)\s+(?:main\s+)?goal\b/i.test(normalized) ||
    /\b(?:mera|hamara|my|our)\s+(?:main\s+)?goal\s+(?:hai|is)\b/i.test(normalized) ||
    /\bgoal\s+(?:is|=)\b/i.test(normalized) ||
    /\bobjective\b/i.test(normalized) ||
    /\btarget\b/i.test(normalized)
  );
}

function detectExpectedOnboardingField(
  messages: ChatMessage[]
): BusinessProfileField | null {
  const lastAssistantMessage = messages
    .slice()
    .reverse()
    .find((message) => message.role === "assistant")?.content;
  if (!lastAssistantMessage) return null;

  const normalized = lastAssistantMessage.trim().toLowerCase();
  const wordCount = normalized.split(/\s+/).filter(Boolean).length;
  if (!normalized.includes("?") || wordCount > 36) {
    return null;
  }
  const match = ONBOARDING_QUESTION_HINTS.find((item) =>
    item.hints.some((hint) => normalized.includes(hint))
  );
  return match?.field ?? null;
}

function isLikelyDirectProfileAnswer(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  if (!normalized) return false;

  if (
    normalized.includes("?") ||
    /^(kya|kaise|kyu|kyon|can|what|why|how)\b/i.test(normalized)
  ) {
    return false;
  }

  const words = normalized.split(/\s+/).filter(Boolean);
  if (words.length > 14) return false;

  if (
    /\b(problem|issue|help|suggest|advice|plan|strategy|karo|karu|karna)\b/i.test(
      normalized
    )
  ) {
    return false;
  }

  if (
    /^(ok|okay|haan|hmm|thik|theek|thanks|thank you|matlab|mutlab|mtlb|samjha|samjhao|kya matlab)$/i.test(
      normalized
    )
  ) {
    return false;
  }

  return true;
}

function isConfusionOrFillerReply(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  if (!normalized) return true;

  return (
    /^(matlab|mutlab|mtlb|samjha|samjhao|kya matlab|samajh nahi|samjh nahi|nahi samajh|what do you mean|meaning)$/i.test(
      normalized
    ) ||
    /\b(matlab|mutlab|mtlb|samajh nahi|samjh nahi|what do you mean)\b/i.test(
      normalized
    )
  );
}

function hasStrongOtherFieldSignal(
  expectedField: BusinessProfileField,
  userMessage: string
): boolean {
  const text = userMessage.toLowerCase();
  const signals: Partial<Record<BusinessProfileField, RegExp[]>> = {
    ownerName: [/\b(?:mera|my)\s+naam\b/i, /\bmy\s+name\s+is\b/i],
    businessType: [/\brestaurant|cafe|salon|gym|agency|shop|store|clinic\b/i],
    teamSize: [/\b\d{1,3}\s+(?:log|people|staff|members?)\b/i, /\bteam\s+size\b/i],
    mainGoal: [/\b(?:mera|my)\s+(?:main\s+)?goal\b/i, /\bgoal\s+is\b/i],
    budgetLevel: [/\bbudget\b/i, /\blow|medium|high\b/i],
    cityArea: [/\blocated\b/i, /\b(?:city|area|mein|me)\b/i],
    businessName: [/\b(?:business|company)\s+name\b/i, /\bnaam\b/i],
  };

  const otherFields = Object.keys(signals).filter(
    (field) => field !== expectedField
  ) as BusinessProfileField[];

  return otherFields.some((field) =>
    (signals[field] ?? []).some((pattern) => pattern.test(text))
  );
}

function inferFieldValueFromDirectAnswer(
  field: BusinessProfileField,
  userMessage: string
): string | null {
  const text = userMessage.trim();
  const normalized = text.toLowerCase();
  if (!text) return null;
  if (isConfusionOrFillerReply(text)) return null;
  if (!isLikelyDirectProfileAnswer(text)) return null;
  if (hasStrongOtherFieldSignal(field, text)) return null;
  if (
    /\b(baad me|bad me|later|skip|abhi nahi|leave it|chodo|chhodo)\b/i.test(
      normalized
    )
  ) {
    return null;
  }

  const toTitle = (value: string) =>
    value
      .toLowerCase()
      .split(/\s+/)
      .map((part) => (part ? part[0].toUpperCase() + part.slice(1) : ""))
      .join(" ")
      .trim();

  switch (field) {
    case "ownerName": {
      if (!/^[a-zA-Z][a-zA-Z\s.'-]{1,40}$/.test(text)) return null;
      if (/\b(mera|my|naam|name|hai|is|business|goal|budget)\b/i.test(normalized)) return null;
      return toTitle(text);
    }
    case "businessType": {
      if (/restaurant|resturent|restro|cafe|eatery/i.test(normalized)) return "Restaurant";
      if (/salon/i.test(normalized)) return "Salon";
      if (/gym/i.test(normalized)) return "Gym";
      if (/clinic/i.test(normalized)) return "Clinic";
      if (/store|shop/i.test(normalized)) return "Shop";
      if (/agency/i.test(normalized)) return "Agency";
      if (/coaching|tuition/i.test(normalized)) return "Coaching";
      const singleWord = normalized.split(/\s+/).filter(Boolean);
      if (singleWord.length === 1) {
        if (
          /^(retail|wholesale|manufacturing|service|services|trading|distributor|ecommerce|e-commerce|pharmacy|kirana|bakery|boutique|grocery)$/i.test(
            normalized
          )
        ) {
          return toTitle(text);
        }
        return null;
      }
      return singleWord.length <= 3 ? toTitle(text) : null;
    }
    case "businessName": {
      if (text.length < 2 || text.length > 48) return null;
      return toTitle(text);
    }
    case "cityArea": {
      if (text.length < 2 || text.length > 48) return null;
      return toTitle(text.replace(/^(in|at)\s+/i, ""));
    }
    case "mainGoal": {
      if (text.length < 4 || text.length > 80) return null;
      if (/^\s*(?:nahi|nahin|none)\s*(?:hai|is)?\s*$/i.test(normalized)) return null;
      if (
        /\b(?:mera|my)\s+naam\b/i.test(normalized) ||
        /\b(?:team|log|staff)\b/i.test(normalized) ||
        /\b(?:restaurant|shop|store|agency|salon|gym|clinic)\b/i.test(normalized) ||
        /\b(?:city|area|location|located|based)\b/i.test(normalized)
      ) {
        return null;
      }
      if (
        !/\b(?:sales|customer|customers|lead|growth|grow|expand|profit|revenue|conversion|scale|brand|national|online|order|orders)\b/i.test(
          normalized
        )
      ) {
        return null;
      }
      return text;
    }
    case "customerType": {
      if (text.length < 3 || text.length > 80) return null;
      return text;
    }
    case "preferredLanguage": {
      if (/hinglish|hindi/i.test(normalized)) return "Hinglish";
      if (/english/i.test(normalized)) return "English";
      return null;
    }
    case "offerDescription": {
      if (text.length < 3 || text.length > 120) return null;
      return text;
    }
    case "priceRange": {
      if (text.length < 2 || text.length > 40) return null;
      if (!/[\d]|low|medium|high|cheap|premium|range/i.test(normalized)) return null;
      return text;
    }
    case "businessModel": {
      if (/both|hybrid|dono/i.test(normalized)) return "Both";
      if (/online/i.test(normalized) && /offline/i.test(normalized)) return "Both";
      if (/online/i.test(normalized)) return "Online";
      if (/offline/i.test(normalized)) return "Offline";
      return null;
    }
    case "businessStage": {
      if (/beginner|new|starting|startup/i.test(normalized)) return "Beginner";
      if (/growing|growth|mid/i.test(normalized)) return "Growing";
      if (/established|mature/i.test(normalized)) return "Established";
      return null;
    }
    case "secondaryGoal":
    case "currentFocus":
    case "keyConstraint1":
    case "keyConstraint2":
    case "notes": {
      if (text.length < 3 || text.length > 180) return null;
      return text;
    }
    case "budgetLevel": {
      if (/low|medium|high/i.test(normalized)) return toTitle(normalized.match(/low|medium|high/i)?.[0] ?? text);
      const numeric = text.match(/\d[\d,\s]*(?:k|lakh|lac|crore|rs|inr)?/i);
      return numeric ? numeric[0].trim() : null;
    }
    case "teamSize": {
      const numeric = text.match(/\d{1,3}/);
      return numeric ? numeric[0] : null;
    }
    default:
      return null;
  }
}

function sanitizeMessages(messages: unknown): ChatMessage[] {
  if (!Array.isArray(messages)) {
    return [];
  }

  return messages
    .filter((item): item is { role?: unknown; content?: unknown } => {
      return typeof item === "object" && item !== null;
    })
    .map((item) => {
      const role: ChatMessage["role"] =
        item.role === "assistant" ? "assistant" : "user";
      const content = typeof item.content === "string" ? item.content.trim() : "";

      return { role, content };
    })
    .filter((message) => message.content.length > 0);
}

function sanitizeSharedContext(sharedContext: unknown): SharedBusinessContext {
  if (!sharedContext || typeof sharedContext !== "object") {
    return EMPTY_SHARED_BUSINESS_CONTEXT;
  }

  const candidate = sharedContext as Record<string, unknown>;
  const sanitizeField = (value: unknown): string | null =>
    typeof value === "string" && value.trim().length > 0 ? value.trim() : null;

  return {
    businessType: sanitizeField(candidate.businessType),
    problemType: sanitizeField(candidate.problemType),
    businessImpact: sanitizeField(candidate.businessImpact),
    userExperienceLevel: sanitizeField(candidate.userExperienceLevel),
    confidenceLevel: sanitizeField(candidate.confidenceLevel),
    customerIssue: sanitizeField(candidate.customerIssue),
    budgetConstraint: sanitizeField(candidate.budgetConstraint),
    businessEnvironment: sanitizeField(candidate.businessEnvironment),
    currentProblem: sanitizeField(candidate.currentProblem),
    userGoal: sanitizeField(candidate.userGoal),
    conversationLanguage:
      candidate.conversationLanguage === "english" ||
      candidate.conversationLanguage === "hinglish"
        ? candidate.conversationLanguage
        : null,
  };
}

function sanitizeSharedTaskState(sharedTaskState: unknown): SharedTaskState {
  if (!sharedTaskState || typeof sharedTaskState !== "object") {
    return EMPTY_SHARED_TASK_STATE;
  }

  const candidate = sharedTaskState as Record<string, unknown>;
  const sanitizeField = (value: unknown): string | null =>
    typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
  const taskStatus = candidate.taskStatus;

  return {
    currentPriority: sanitizeField(candidate.currentPriority),
    currentTaskText: sanitizeField(candidate.currentTaskText),
    taskStatus:
      taskStatus === "pending" || taskStatus === "done" || taskStatus === "not_done"
        ? taskStatus
        : null,
    taskDate:
      typeof candidate.taskDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(candidate.taskDate)
        ? candidate.taskDate
        : null,
  };
}

function sanitizeUserSettings(userSettings: unknown): UserSettings {
  const normalized = normalizeUserSettings(userSettings);
  return {
    ...DEFAULT_USER_SETTINGS,
    ...normalized,
  };
}

function sanitizeBusinessProfile(businessProfile: unknown): BusinessProfile {
  if (!businessProfile || typeof businessProfile !== "object") {
    return EMPTY_BUSINESS_PROFILE;
  }

  return normalizeBusinessProfile(businessProfile as Partial<BusinessProfile>);
}

function mergeProfilePreferDb(
  dbProfile: BusinessProfile,
  requestProfile: BusinessProfile
): BusinessProfile {
  const nextProfile = { ...dbProfile };

  for (const [key, value] of Object.entries(requestProfile)) {
    const typedKey = key as keyof BusinessProfile;
    const incoming = typeof value === "string" ? value.trim() : "";
    const existing = (nextProfile[typedKey] ?? "").trim();

    // Trust DB first to avoid stale client profile values overwriting saved profile.
    if (!existing && incoming) {
      nextProfile[typedKey] = incoming;
    }
  }

  return nextProfile;
}

function replaceNameInMessage(
  content: string,
  staleName: string,
  canonicalName: string
): string {
  if (!staleName || !canonicalName || staleName.toLowerCase() === canonicalName.toLowerCase()) {
    return content;
  }

  const escaped = staleName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`\\b${escaped}\\b`, "gi");
  return content.replace(pattern, canonicalName);
}

function normalizeMessageOwnerName(
  messages: ChatMessage[],
  staleName: string,
  canonicalName: string
): ChatMessage[] {
  if (!staleName || !canonicalName || staleName.toLowerCase() === canonicalName.toLowerCase()) {
    return messages;
  }

  return messages.map((message) => ({
    ...message,
    content: replaceNameInMessage(message.content, staleName, canonicalName),
  }));
}

export async function POST(request: Request) {
  try {
    const userId = getRequestUserId(request);
    // Safe server-side debug log for env loading in the Next.js route.
    // This confirms the variable is available without printing the key.
    console.log("[/api/chat] DeepSeek env status:", {
      exists: Boolean(process.env.DEEPSEEK_API_KEY?.trim()),
    });

    const contentType = request.headers.get("content-type") ?? "";
    let body: ChatRequestBody = {};
    let attachments: ChatAttachment[] = [];
    let rawAttachmentFiles: File[] = [];

    if (contentType.includes("multipart/form-data")) {
      const formData = await request.formData();
      const payloadRaw = formData.get("payload");
      if (typeof payloadRaw === "string" && payloadRaw.trim().length > 0) {
        body = JSON.parse(payloadRaw) as ChatRequestBody;
      }
      const rawFiles = formData
        .getAll("attachments")
        .filter((item): item is File => item instanceof File);
      rawAttachmentFiles = rawFiles;
      attachments = sanitizeAttachments(rawFiles);
    } else {
      body = (await request.json()) as ChatRequestBody;
    }

    const visionResult = await summarizeImageAttachments(rawAttachmentFiles);
    const messages = appendAttachmentContext(
      sanitizeMessages(body.messages),
      attachments,
      visionResult.summary,
      visionResult.note
    );
    const normalizedMode = body.mode === "business_problem" ? "manager" : body.mode;
    const mode: ChatMode = isChatMode(normalizedMode) ? normalizedMode : DEFAULT_CHAT_MODE;
    const sharedContext = sanitizeSharedContext(body.sharedContext);
    const requestProfile = sanitizeBusinessProfile(body.businessProfile);
    const sharedTaskState = sanitizeSharedTaskState(body.sharedTaskState);
    const userSettings = sanitizeUserSettings(body.userSettings);

    // The API route stays thin on purpose.
    // It only validates input and forwards the work to the AI router.
    if (messages.length === 0) {
      return NextResponse.json(
        { error: "Messages zaroori hain." },
        { status: 400 }
      );
    }

    let effectiveMessages = messages;
    const dbProfile = await readBusinessProfileFromDb(userId);
    const baseProfile = mergeProfilePreferDb(dbProfile, requestProfile);
    const staleOwnerName =
      requestProfile.ownerName.trim() &&
      dbProfile.ownerName.trim() &&
      requestProfile.ownerName.trim().toLowerCase() !== dbProfile.ownerName.trim().toLowerCase()
        ? requestProfile.ownerName.trim()
        : "";
    if (staleOwnerName) {
      effectiveMessages = normalizeMessageOwnerName(
        messages,
        staleOwnerName,
        dbProfile.ownerName.trim()
      );
    }

    const latestUserMessage = effectiveMessages
      .slice()
      .reverse()
      .find((item) => item.role === "user")?.content;

    let pendingSuggestedUpdates: ProfileUpdateSuggestion[] = [];
    if (latestUserMessage) {
      console.log(`[AUTO-DETECT] raw user message = ${latestUserMessage}`);
      const extracted = extractBusinessMemoryFromUserMessage(latestUserMessage);
      const extractedFields = { ...extracted.profilePatch };
      let extractedSuggestions = [...extracted.suggestedUpdates];
      const explicitGoalStatement = isExplicitMainGoalStatement(latestUserMessage);
      if (extractedFields.mainGoal && !explicitGoalStatement) {
        delete extractedFields.mainGoal;
      }
      if (!explicitGoalStatement) {
        extractedSuggestions = extractedSuggestions.filter(
          (suggestion) => suggestion.field !== "mainGoal"
        );
      }
      const expectedField = detectExpectedOnboardingField(messages);
      const canInferExpectedField =
        expectedField !== null &&
        !extractedFields[expectedField] &&
        !baseProfile[expectedField]?.trim();

      if (canInferExpectedField) {
        const inferredValue = inferFieldValueFromDirectAnswer(
          expectedField as BusinessProfileField,
          latestUserMessage
        );
        if (inferredValue) {
          extractedFields[expectedField as BusinessProfileField] = inferredValue;
        }
      }
      console.log("[AUTO-DETECT] extracted fields =", extractedFields);

      const preSavedProfile = applyProfilePatch(baseProfile, extractedFields);
      pendingSuggestedUpdates = extractedSuggestions.reduce<ProfileUpdateSuggestion[]>(
        (acc, suggestion) => {
          const currentValue = preSavedProfile[suggestion.field]?.trim() ?? "";
          const suggestedValue =
            suggestion.suggestedValue?.trim() ?? suggestion.value.trim();
          if (!suggestedValue) return acc;
          if (currentValue.toLowerCase() === suggestedValue.toLowerCase()) {
            return acc;
          }

          acc.push({
            ...suggestion,
            currentValue: currentValue || undefined,
            suggestedValue,
            value: suggestedValue,
            status: "pending" as const,
          });

          return acc;
        },
        []
      );

      console.log("[PROFILE SAVE] updating fields =", extractedFields);
      for (const [field, value] of Object.entries(extractedFields)) {
        if (!value) continue;
        console.log(`[ONBOARDING] field = ${field} status = saved`);
      }
      await writeBusinessProfileToDb(userId, preSavedProfile);
      console.log("[PROFILE SAVE] success/failure = success");
      console.log("[PROFILE CONTEXT] refreshed profile =", preSavedProfile);
    }

    const latestDbProfile = await readBusinessProfileFromDb(userId);

    const result = await routeAiMessage({
      messages: effectiveMessages,
      mode,
      sharedContext,
      businessProfile: latestDbProfile,
      sharedTaskState,
      userSettings,
    });

    const safeBusinessProfile = normalizeBusinessProfile(
      result.businessProfile ?? EMPTY_BUSINESS_PROFILE
    );

    console.log("[PROFILE SAVE] updating fields =", safeBusinessProfile);
    await writeBusinessProfileToDb(userId, safeBusinessProfile);
    console.log("[PROFILE SAVE] success/failure = success");
    console.log("[PROFILE CONTEXT] refreshed profile =", safeBusinessProfile);

    const shouldBypassRepeatGuard =
      result.provider === "direct" ||
      result.provider === "thinking" ||
      result.provider === "decision" ||
      result.provider === "helper";
    const finalReply = shouldBypassRepeatGuard
      ? result.reply
      : enforceNoRepeatReply(result.reply, effectiveMessages);

    return NextResponse.json({
      reply: finalReply,
      provider: result.provider,
      messageType: result.messageType,
      sharedContext: result.sharedContext,
      businessProfile: safeBusinessProfile,
      suggestedProfileUpdates: pendingSuggestedUpdates,
    });
  } catch (error) {
    console.error("[/api/chat] Unexpected server error:", error);

    return NextResponse.json(
      { error: "Unexpected server error aaya." },
      { status: 500 }
    );
  }
}
