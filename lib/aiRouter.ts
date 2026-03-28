// This file is the central router for AI requests.
// It keeps the overall flow easy to follow:
// 1. read the latest user message
// 2. look at recent conversation context
// 3. classify the current intent
// 4. choose the correct provider

import {
  classifyMessage,
  detectResponseMode,
  detectMessageTypes,
  isBusinessProblemIntent,
  isGreetingMessage,
  isHelperModeIntent,
  isThinkingModeIntent,
  isFollowUpMessage,
  isVagueBusinessMessage,
  type MessageType,
} from "./classifyMessage";
import { DEFAULT_CHAT_MODE, type ChatMode } from "./chatMode";
import { buildConversationContext, type ConversationContext } from "./contextBuilder";
import {
  applyProfilePatch,
  EMPTY_BUSINESS_PROFILE,
  extractProfileUpdates,
  getAnsweredImportantFields,
  getBusinessProfileState,
  getMissingImportantFields,
  mergeSharedContextWithBusinessProfile,
  normalizeBusinessProfile,
  type BusinessProfile,
  type BusinessProfileField,
} from "./businessProfile";
import { normalizeManagerReply } from "./managerResponse";
import {
  runAdvisorProvider,
  runChatProvider,
  runDecisionProvider,
  runDirectProvider,
  runHelperProvider,
  runThinkingProvider,
} from "./providers/groq";
import { runDeepseekReasoning } from "./providers/deepseekReasoning";
import { contentProvider } from "./providers/placeholderContent";
import {
  EMPTY_SHARED_BUSINESS_CONTEXT,
  type SharedBusinessContext,
  EMPTY_SHARED_TASK_STATE,
  type SharedTaskState,
} from "./sharedContext";
import { DEFAULT_USER_SETTINGS, type UserSettings } from "./userSettings";

export type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

type RouteAiMessageParams = {
  messages: ChatMessage[];
  mode?: ChatMode;
  sharedContext?: SharedBusinessContext;
  businessProfile?: BusinessProfile;
  sharedTaskState?: SharedTaskState;
  userSettings?: UserSettings;
};

type ProviderName =
  | "chat"
  | "advisor"
  | "deepseek-reasoning"
  | "content"
  | "helper"
  | "thinking"
  | "decision"
  | "direct";

type RouteMode = "chat" | "manager" | "helper" | "thinking" | "decision" | "direct";
type AnswerType = "decision" | "risk" | "execution" | "strategy" | "other";

type HelperExecutionState = {
  currentStep: number;
  explainedStep: number;
  completedStep: number;
  waitingForUserConfirmation: boolean;
  explainedStepText: string | null;
  latestUserAskedNextWithoutConfirmation: boolean;
};

type RouteAiMessageResult = {
  reply: string;
  messageType: MessageType;
  provider: ProviderName;
  sharedContext: SharedBusinessContext;
  businessProfile: BusinessProfile;
};

const HINGLISH_HINT_WORDS = [
  "kya",
  "kaise",
  "kyu",
  "kyon",
  "hai",
  "haan",
  "nahi",
  "nahin",
  "aap",
  "tum",
  "mera",
  "main",
  "hoon",
  "thik",
  "theek",
  "kar",
  "chahiye",
];

function shouldReplyInEnglish(
  latestUserMessage: string,
  conversationLanguage?: "english" | "hinglish" | null,
  preferredLanguage?: string | null
): boolean {
  const normalizedMessage = normalizeText(latestUserMessage);
  const hintMatches = HINGLISH_HINT_WORDS.filter((word) =>
    new RegExp(`\\b${word}\\b`, "i").test(normalizedMessage)
  ).length;
  if (hintMatches > 0) {
    return false;
  }

  if (conversationLanguage === "hinglish") {
    return false;
  }
  if (conversationLanguage === "english") {
    return true;
  }

  // If user message looks neutral/ambiguous, use profile preference as fallback.
  const normalizedPreference = normalizeText(preferredLanguage ?? "");
  if (normalizedPreference.includes("hinglish") || normalizedPreference.includes("hindi")) {
    return false;
  }
  if (normalizedPreference.includes("english")) {
    return true;
  }

  return true;
}

function buildNormalChatReply(
  latestUserMessage: string,
  conversationLanguage?: "english" | "hinglish" | null,
  preferredLanguage?: string | null
): string {
  const normalized = normalizeText(latestUserMessage);
  const useEnglish = shouldReplyInEnglish(
    latestUserMessage,
    conversationLanguage,
    preferredLanguage
  );

  if (isIdentityQuestion(normalized)) {
    return useEnglish
      ? "I am Neurova, your Business Manager."
      : "Main Neurova hoon, aapka Business Manager.";
  }

  if (isEverythingFineMessage(normalized)) {
    return useEnglish
      ? "Great. Do you want to explore something new today, or just checking in?"
      : "Achha hai. Aaj aap kuch naya explore karna chahte ho ya bas check in kar rahe ho?";
  }

  if (normalized.includes("thanks") || normalized.includes("thank")) {
    return useEnglish
      ? "Anytime. If you want to ask something, tell me."
      : "Anytime. Agar kuch poochna ho toh batao.";
  }

  if (normalized === "ok" || normalized === "okay") {
    return useEnglish ? "Alright." : "Theek hai.";
  }
  if (normalized === "all right" || normalized === "alright") {
    return useEnglish ? "Alright." : "Theek hai.";
  }

  if (isGreetingMessage(normalized)) {
    return useEnglish ? "Hi. How can I help?" : "Hi. Kaise help kar sakta hoon?";
  }

  return useEnglish
    ? "Alright. If you want, I can help you clarify this step by step."
    : "Theek hai. Aap chahein toh main isko step by step clear karne me help karta hoon.";
}

function buildSettingsInstructionBlock(settings: UserSettings): string {
  const responseStyleInstruction =
    settings.responseStyle === "short"
      ? "Response Style: Short. Keep answers concise. Prefer 60-110 words in manager mode."
      : settings.responseStyle === "detailed"
        ? "Response Style: Detailed. Add slightly more context and explanation. Prefer 160-260 words in manager mode."
        : "Response Style: Balanced. Keep answers practical and moderately concise (100-180 words in manager mode).";

  const strictModeInstruction = settings.strictMode
    ? "Manager Mode: Strict ON. Use decisive manager tone and avoid hedging."
    : "Manager Mode: Strict OFF. Keep tone practical but slightly coaching-friendly.";

  const languageInstruction =
    settings.language === "english"
      ? "Preferred UI Language: English. Use English only when latest message language is ambiguous."
      : "Preferred UI Language: Hinglish. Use Hinglish only when latest message language is ambiguous.";

  const displayNameInstruction = settings.name.trim()
    ? `User Display Name: ${settings.name.trim()}. Use only when natural and occasional.`
    : "User Display Name: not set.";

  return [
    "Runtime user settings:",
    responseStyleInstruction,
    strictModeInstruction,
    languageInstruction,
    displayNameInstruction,
  ].join("\n");
}

const BUSINESS_SIGNAL_KEYWORDS = [
  "sales",
  "customer",
  "customers",
  "footfall",
  "lead",
  "leads",
  "conversion",
  "order",
  "orders",
  "repeat",
  "margin",
  "profit",
  "pricing",
  "ads",
  "staff",
  "operations",
  "inventory",
  "budget",
  "whatsapp",
  "linkedin",
  "cold email",
];

const RESTAURANT_KEYWORDS = [
  "restaurant",
  "cafe",
  "cafe",
  "hotel",
  "food",
  "eatery",
];

function normalizeText(value: string): string {
  return value.trim().toLowerCase();
}

function isExplicitMainGoalStatement(userMessage: string): boolean {
  const normalized = normalizeText(userMessage);
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

const ONBOARDING_QUESTION_BY_FIELD: Record<BusinessProfileField, string> = {
  ownerName: "Aapka naam kya hai?",
  businessName: "Aapke business ka naam kya hai?",
  businessType: "Aap kis type ka business chalate ho?",
  cityArea: "Aap kis city ya area me kaam karte ho?",
  preferredLanguage: "Aap kis language me baat karna prefer karte ho?",
  offerDescription: "Aap kya sell karte ho?",
  customerType: "Aapke customers kis type ke hain?",
  priceRange: "Aapka typical price range kya hai?",
  businessModel: "Aapka business model online hai, offline hai, ya dono?",
  teamSize: "Aapki team me kitne log hain?",
  businessStage: "Aap business stage me beginner ho ya growing?",
  mainGoal: "Aapka main goal abhi kya hai?",
  secondaryGoal: "Aapka secondary goal kya hai?",
  currentFocus: "Aap abhi kis cheez par focus kar rahe ho?",
  budgetLevel: "Aapka budget level low, medium, ya high hai?",
  keyConstraint1: "Aapka sabse bada constraint kya hai?",
  keyConstraint2: "Dusra important constraint kya hai?",
  notes: "Koi aur stable business detail hai jo yaad rakhni chahiye?",
};

const ONBOARDING_ORDER: BusinessProfileField[] = [
  "businessType",
  "businessName",
  "cityArea",
  "mainGoal",
  "customerType",
  "budgetLevel",
  "teamSize",
  "ownerName",
  "businessModel",
  "businessStage",
];

function pickNextOnboardingField(
  missingFields: BusinessProfileField[]
): BusinessProfileField | null {
  const ordered = ONBOARDING_ORDER.find((field) => missingFields.includes(field));
  if (ordered) return ordered;
  return missingFields[0] ?? null;
}

function buildOnboardingPromptForField(field: BusinessProfileField): string {
  return ONBOARDING_QUESTION_BY_FIELD[field];
}

function getLastAskedOnboardingField(messages: ChatMessage[]): BusinessProfileField | null {
  const recentAssistantMessages = messages
    .filter((message) => message.role === "assistant")
    .slice(-6)
    .reverse();

  for (const message of recentAssistantMessages) {
    const content = message.content ?? "";
    const matchedField = (Object.keys(ONBOARDING_QUESTION_BY_FIELD) as BusinessProfileField[]).find(
      (field) => content.includes(ONBOARDING_QUESTION_BY_FIELD[field])
    );
    if (matchedField) return matchedField;
  }

  return null;
}

function isOnboardingFieldMeaningQuestion(
  latestUserMessage: string,
  field: BusinessProfileField
): boolean {
  const normalized = normalizeText(latestUserMessage);
  if (!normalized) return false;

  const meaningSignal =
    /\b(matlab|mutlab|mtlb|meaning|what do you mean|kya hota hai|samjhao|samjha do)\b/i.test(
      normalized
    ) || /\?$/.test(normalized);
  if (!meaningSignal) return false;

  const fieldKeywords: Partial<Record<BusinessProfileField, RegExp>> = {
    businessType: /\b(business type|type ka business|kis type)\b/i,
    businessName: /\b(business name|business ka naam)\b/i,
    cityArea: /\b(city|area|location)\b/i,
    mainGoal: /\b(main goal|goal)\b/i,
    customerType: /\b(customer type|customers kis type)\b/i,
    budgetLevel: /\b(budget level|budget)\b/i,
    teamSize: /\b(team size|team me kitne)\b/i,
  };

  const matcher = fieldKeywords[field];
  if (!matcher) return meaningSignal;
  return matcher.test(normalized);
}

function buildOnboardingFieldExplanation(
  field: BusinessProfileField,
  useEnglish: boolean
): string {
  if (field === "businessType") {
    return useEnglish
      ? [
          "Business type means what category your business is in.",
          "Example: Restaurant, Grocery Shop, Salon, Clinic, Coaching, Agency.",
          "Please answer in one line: your business type?",
        ].join("\n")
      : [
          "Business type ka matlab hai aapka business kis category ka hai.",
          "Example: Restaurant, Grocery Shop, Salon, Clinic, Coaching, Agency.",
          "Bas ek line me batao: aapka business type kya hai?",
        ].join("\n");
  }

  const question = buildOnboardingPromptForField(field);
  return useEnglish
    ? `Sure. I am asking this to give a correct decision.\nPlease answer in one line: ${question}`
    : `Thik hai. Ye detail isliye chahiye taaki sahi decision de sakun.\nBas ek line me jawab do: ${question}`;
}

function isTodayFocusIntent(normalizedMessage: string): boolean {
  return (
    /\bwhat should i focus on today\b/i.test(normalizedMessage) ||
    /\btoday(?:'s)?\s+priority\b/i.test(normalizedMessage) ||
    /\baaj\s+kya\s+focus\b/i.test(normalizedMessage) ||
    /\baaj\s+ka\s+focus\b/i.test(normalizedMessage) ||
    /\baaj\s+priority\b/i.test(normalizedMessage)
  );
}

function buildOnboardingClarifier(
  field: BusinessProfileField,
  useEnglish: boolean
): string {
  const question = buildOnboardingPromptForField(field);
  if (useEnglish) {
    return [
      "I will keep it very simple.",
      "I need just one detail so I can give today's exact priority.",
      `Please answer this in one line: ${question}`,
    ].join("\n");
  }

  return [
    "Main simple bolta hoon.",
    "Mujhe sirf ek detail chahiye taaki aaj ki exact priority de sakun.",
    `Bas ek line me jawab do: ${question}`,
  ].join("\n");
}

function pickRelevantMissingField(
  normalizedMessage: string,
  missingFields: BusinessProfileField[]
): BusinessProfileField | null {
  const relevanceMap: Array<{ field: BusinessProfileField; keywords: string[] }> = [
    { field: "customerType", keywords: ["customer", "audience", "buyer", "client"] },
    { field: "mainGoal", keywords: ["goal", "target", "grow", "growth"] },
    { field: "budgetLevel", keywords: ["budget", "ads", "spend", "cost"] },
    { field: "teamSize", keywords: ["team", "staff", "log", "employee"] },
    { field: "businessModel", keywords: ["online", "offline", "model"] },
    { field: "cityArea", keywords: ["city", "area", "location", "local"] },
    { field: "businessType", keywords: ["business", "restaurant", "shop", "store"] },
  ];

  for (const item of relevanceMap) {
    if (!missingFields.includes(item.field)) continue;
    if (item.keywords.some((keyword) => normalizedMessage.includes(keyword))) {
      return item.field;
    }
  }

  return null;
}

function isOnboardingSkipMessage(normalizedMessage: string): boolean {
  return [
    "baad me",
    "bad me",
    "later",
    "skip",
    "abhi nahi",
    "abhi not",
    "leave it",
    "chodo",
    "chhodo",
  ].some((pattern) => normalizedMessage.includes(pattern));
}

function hasOnboardingSkipInConversation(messages: ChatMessage[]): boolean {
  return messages
    .filter((message) => message.role === "user")
    .slice(-8)
    .some((message) => isOnboardingSkipMessage(normalizeText(message.content)));
}

function getOnboardingAskCount(
  messages: ChatMessage[],
  field: BusinessProfileField
): number {
  const question = ONBOARDING_QUESTION_BY_FIELD[field];
  return messages.filter(
    (message) =>
      message.role === "assistant" &&
      typeof message.content === "string" &&
      message.content.includes(question)
  ).length;
}

function getTotalOnboardingQuestionCount(messages: ChatMessage[]): number {
  const allOnboardingQuestions = Object.values(ONBOARDING_QUESTION_BY_FIELD);
  return messages.filter((message) => {
    if (message.role !== "assistant" || typeof message.content !== "string") {
      return false;
    }
    return allOnboardingQuestions.some((question) =>
      message.content.includes(question)
    );
  }).length;
}

function hasMinimumDecisionContext(context: ConversationContext): boolean {
  const hasBusinessType = Boolean(context.resolvedContext.businessType);
  const hasMainGoal = Boolean(context.resolvedContext.mainGoal);
  return hasBusinessType && hasMainGoal;
}

function detectAnswerType(latestUserMessage: string): AnswerType {
  const normalized = normalizeText(latestUserMessage);
  if (!normalized) return "other";

  const includesAnyPhrase = (phrases: string[]) =>
    phrases.some((phrase) => normalized.includes(phrase));

  if (includesAnyPhrase(["line likho", "example do", "message do", "kaise karun", "kaise karu"])) {
    return "execution";
  }

  if (includesAnyPhrase(["kaunsa best hai", "choose karo"])) {
    return "decision";
  }

  if (
    /nuks[a-z]*\s+(ho\s*ga|hoga|ho\s*gya|hoga\s*kiya|hoga\s*kya)/i.test(normalized) ||
    /sahi\s+hai(\s+ya\s+(nahi|nhi))?/i.test(normalized) ||
    /kya\s+sahi\s+hai/i.test(normalized) ||
    /risk\s+kya\s+hai/i.test(normalized) ||
    /profit\s+hoga\s+ya\s+nahi/i.test(normalized)
  ) {
    return "risk";
  }

  if (includesAnyPhrase(["kya karun", "kya karu", "sales drop ho raha", "sales drop ho rha"])) {
    return "strategy";
  }

  return "other";
}

function isForceDirectAnswerQuestion(latestUserMessage: string): boolean {
  const normalized = normalizeText(latestUserMessage);
  if (!normalized) return false;
  return (
    /kaunsa\s+best\s+hai/i.test(normalized) ||
    /nuks[a-z]*\s+(ho\s*ga|hoga|ho\s*gya|hoga\s*kiya|hoga\s*kya)/i.test(normalized) ||
    /kya\s+sahi\s+hai/i.test(normalized) ||
    /sahi\s+hai(\s+ya\s+(nahi|nhi))?/i.test(normalized)
  );
}

function detectRouteMode({
  latestUserMessage,
  selectedMode,
  businessProblemIntent,
  messageType,
}: {
  latestUserMessage: string;
  selectedMode: ChatMode;
  businessProblemIntent: boolean;
  messageType: MessageType;
}): RouteMode {
  // Master priority override:
  // direct/logical/comparison questions must use plain direct mode first.
  if (isForceDirectAnswerQuestion(latestUserMessage)) {
    return "direct";
  }

  const answerType = detectAnswerType(latestUserMessage);
  if (answerType === "execution") return "helper";
  if (answerType === "decision") return "decision";
  if (answerType === "risk") return "thinking";
  if (answerType === "strategy") return "manager";

  if (isThinkingModeIntent(latestUserMessage)) {
    return "thinking";
  }

  if (isHelperModeIntent(latestUserMessage)) {
    return "helper";
  }

  if (
    messageType === "business_strategy" ||
    messageType === "seasonal_strategy" ||
    messageType === "calculation" ||
    messageType === "marketing_content" ||
    businessProblemIntent ||
    selectedMode === "manager"
  ) {
    return "manager";
  }

  return "chat";
}

function isHelperDoneSignal(message: string): boolean {
  const text = normalizeText(message);
  if (!text) return false;
  return [
    "done",
    "ho gaya",
    "hogaya",
    "ho gya",
    "completed",
    "complete",
    "kardiya",
    "kar diya",
    "kiya",
    "finished",
  ].some((token) => text.includes(token));
}

function isHelperNextSignal(message: string): boolean {
  const text = normalizeText(message);
  if (!text) return false;
  return (
    text === "next" ||
    text === "aage" ||
    text === "agla" ||
    text === "next step" ||
    text.includes("next") ||
    text.includes("aage kya") ||
    text.includes("agla step")
  );
}

function extractHelperStepNumberAndText(
  assistantMessage: string
): { step: number; text: string } | null {
  const lines = assistantMessage
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) return null;

  for (const line of lines) {
    const match = line.match(/^(?:step\s*)?(\d{1,2})\s*[:.)-]\s*(.+)$/i);
    if (!match) continue;
    const step = Number.parseInt(match[1], 10);
    if (!Number.isFinite(step) || step <= 0) continue;
    const text = match[2]?.trim() ?? "";
    return {
      step,
      text: text.length > 0 ? text : line,
    };
  }

  const inlineStep = assistantMessage.match(/\bstep\s*(\d{1,2})\b/i);
  if (inlineStep) {
    const step = Number.parseInt(inlineStep[1], 10);
    if (Number.isFinite(step) && step > 0) {
      return {
        step,
        text: lines[0],
      };
    }
  }

  return null;
}

function deriveHelperExecutionState(messages: ChatMessage[]): HelperExecutionState {
  let explainedStep = 0;
  let completedStep = 0;
  let waitingForUserConfirmation = false;
  let explainedStepText: string | null = null;
  let latestUserAskedNextWithoutConfirmation = false;

  for (const message of messages) {
    if (message.role === "assistant") {
      const parsed = extractHelperStepNumberAndText(message.content);
      if (!parsed) continue;
      explainedStep = parsed.step;
      explainedStepText = parsed.text;
      waitingForUserConfirmation = true;
      latestUserAskedNextWithoutConfirmation = false;
      continue;
    }

    const userText = message.content;
    if (isHelperDoneSignal(userText) && waitingForUserConfirmation) {
      completedStep = Math.max(completedStep, explainedStep);
      waitingForUserConfirmation = false;
      latestUserAskedNextWithoutConfirmation = false;
      continue;
    }

    if (isHelperNextSignal(userText) && waitingForUserConfirmation) {
      latestUserAskedNextWithoutConfirmation = true;
    }
  }

  if (completedStep > explainedStep) {
    completedStep = explainedStep;
  }

  const currentStep = Math.max(1, completedStep + 1);
  return {
    currentStep,
    explainedStep,
    completedStep,
    waitingForUserConfirmation,
    explainedStepText,
    latestUserAskedNextWithoutConfirmation,
  };
}

function buildHelperWaitForDoneReply(
  state: HelperExecutionState,
  useEnglish: boolean
): string {
  if (useEnglish) {
    return [
      "Has this step been completed?",
      "If yes, reply with 'done'. If not, share exactly where you are stuck.",
    ].join("\n");
  }

  return [
    "Kya yeh step complete ho gaya?",
    "Agar ho gaya hai to 'done' likho. Agar nahi hua to exactly kahan atke ho woh bhejo.",
  ].join("\n");
}

function isHelperDefinitionQuestion(message: string): boolean {
  const normalized = normalizeText(message);
  if (!normalized) return false;
  const asksMeaning =
    normalized.includes("kya hai") ||
    normalized.includes("what is") ||
    normalized.includes("matlab") ||
    normalized.includes("meaning");
  if (!asksMeaning) return false;

  return [
    "webhook",
    "trigger",
    "workflow",
    "node",
    "api",
    "credential",
    "auth",
    "n8n",
  ].some((token) => normalized.includes(token));
}

function extractHelperConcept(message: string): string {
  const normalized = normalizeText(message);
  const known = [
    "webhook",
    "trigger",
    "workflow",
    "node",
    "api",
    "credential",
    "authentication",
    "n8n",
  ];
  const matched = known.find((token) => normalized.includes(token));
  return matched ?? "this term";
}

function buildHelperDefinitionReply({
  concept,
  state,
  useEnglish,
}: {
  concept: string;
  state: HelperExecutionState;
  useEnglish: boolean;
}): string {
  const stepText = state.explainedStepText?.trim();
  if (useEnglish) {
    return [
      `${concept} means the point where one system sends data/event to another system automatically.`,
      stepText
        ? `Now continue the same current step: ${stepText}`
        : "Now continue the same current step.",
      "Ho jaye to 'done' likho.",
    ].join("\n");
  }

  return [
    `${concept} ka matlab hai jahan ek system event/data automatically dusre system ko bhejta hai.`,
    stepText
      ? `Ab wahi current step continue karo: ${stepText}`
      : "Ab wahi current step continue karo.",
    "Ho jaye to 'done' likho.",
  ].join("\n");
}

function buildFastManagerDecisionReply(context: ConversationContext): string {
  const businessType = context.resolvedContext.businessType ?? "business";
  const mainGoal = context.resolvedContext.mainGoal ?? "growth";
  const customerType = context.resolvedContext.customerType;

  const situationLine = customerType
    ? `${businessType} business hai, goal ${mainGoal} hai, aur customer segment ${customerType} hai.`
    : `${businessType} business hai, aur goal ${mainGoal} hai.`;

  const todayPriority =
    /restaurant|cafe|food/i.test(businessType)
      ? "Aaj ek local acquisition experiment run karo: single offer, single channel, 24-hour tracking."
      : "Aaj ek high-impact channel par focused execution karo.";

  return [
    "Situation:",
    situationLine,
    "",
    "Manager Insight:",
    "Fast growth ke liye clarity + visibility + repeatable execution pe focus zaroori hai.",
    "",
    "Decision:",
    "Ab onboarding pause karke execution mode me aate hain, aur ek practical priority se momentum banate hain.",
    "",
    "Today's Priority:",
    todayPriority,
    "",
    "Action Steps:",
    "1. Ek offer define karo jo customer ko turant action lene pe push kare.",
    "2. Offer ko ek selected channel par publish/send karo.",
    "3. 24 ghante me response count note karke next micro-step decide karo.",
    "",
    "Watch:",
    "Primary metric: replies ya leads. Agar 24 ghante me movement low ho, offer line revise karo.",
  ].join("\n");
}

function resolveStableFieldAnswer(
  normalizedMessage: string,
  context: ConversationContext
): string | null {
  const isLikelyQuestion =
    normalizedMessage.includes("?") ||
    /\b(kya|what|kaunsa|kaun sa|which)\b/i.test(normalizedMessage);
  if (!isLikelyQuestion) {
    return null;
  }

  const hasNameQuery =
    normalizedMessage.includes("mera naam") ||
    normalizedMessage.includes("my name") ||
    normalizedMessage.includes("owner name");
  if (hasNameQuery) {
    const ownerName = context.resolvedContext.ownerName;
    return ownerName
      ? `Aapka naam ${ownerName} hai.`
      : "Business Profile me Owner Name abhi set nahi hai.";
  }

  const hasBusinessTypeQuery =
    normalizedMessage.includes("business type") ||
    normalizedMessage.includes("mera business kya") ||
    normalizedMessage.includes("hamara business kya");
  if (hasBusinessTypeQuery) {
    const businessType = context.resolvedContext.businessType;
    return businessType
      ? `Aapka business type ${businessType} hai.`
      : "Business Profile me Business Type abhi set nahi hai.";
  }

  const hasTeamSizeQuery =
    normalizedMessage.includes("team size") ||
    normalizedMessage.includes("meri team") ||
    normalizedMessage.includes("mere pass kitne log");
  if (hasTeamSizeQuery) {
    const teamSize = context.resolvedContext.teamSize;
    return teamSize
      ? `Aapki team size ${teamSize} hai.`
      : "Business Profile me Team Size abhi set nahi hai.";
  }

  const hasGoalQuery =
    normalizedMessage.includes("mera goal") || normalizedMessage.includes("main goal");
  if (hasGoalQuery) {
    const mainGoal = context.resolvedContext.mainGoal;
    return mainGoal
      ? `Aapka main goal ${mainGoal} hai.`
      : "Business Profile me Main Goal abhi set nahi hai.";
  }

  const hasBudgetQuery =
    normalizedMessage.includes("mera budget") || normalizedMessage.includes("budget kya");
  if (hasBudgetQuery) {
    const budgetLevel = context.resolvedContext.budgetLevel;
    return budgetLevel
      ? `Aapka budget level ${budgetLevel} hai.`
      : "Business Profile me Budget Level abhi set nahi hai.";
  }

  return null;
}

function isIdentityQuestion(text: string): boolean {
  return [
    "who are you",
    "what are you",
    "introduce yourself",
    "ap kaun ho",
    "aap kaun ho",
    "tum kaun ho",
    "tu kaun hai",
    "ap kon ho",
    "aap kon ho",
  ].some((pattern) => text.includes(pattern));
}

function isEverythingFineMessage(text: string): boolean {
  return [
    "everything is fine",
    "everything fine",
    "all good",
    "no issue",
    "no issues",
    "koi problem nahi",
    "koi issue nahi",
    "sab theek hai",
    "sab thik hai",
    "sab sahi hai",
    "sab badhiya hai",
    "sab theek chal raha hai",
    "sab thik chal raha hai",
    "sab kuch theek chal raha hai",
  ].some((pattern) => text.includes(pattern));
}

function isFrustratedOrStuckMessage(text: string): boolean {
  return [
    "mujhe kaise pata hoga",
    "kaise pata hoga",
    "samajh nahi aa raha",
    "samjh nahi aa raha",
    "nahi samajh aa raha",
    "confused",
    "frustrated",
    "ab kya karun",
    "bas fix karo",
    "fix my problem",
    "solve karo",
    "tum hi batao",
    "aap hi batao",
    "mujhe nahi pata",
    "mujhse nahi hoga",
    "confidence nahi hai",
    "step by step karo",
  ].some((pattern) => text.includes(pattern));
}

function isConfusion(userMessage: string): boolean {
  const text = normalizeText(userMessage);

  return [
    "matlab",
    "mutlab",
    "mtlb",
    "kya matlab",
    "what do you mean",
    "samajh nahi aaya",
    "samajh nahi aa raha",
    "kuch samajh nahi",
    "kuch samjha nahi",
    "samajh nahi pa raha",
    "samjh nahi aa raha",
    "nahi samajh aa raha",
    "kya bol rahe ho",
    "kya keh rahe ho",
    "kya kehna chahte ho",
    "samjhao",
    "kya karun",
    "kya karu",
    "kaise karun",
    "kaise karu",
    "clear nahi hai",
  ].some((pattern) => text.includes(pattern));
}

function isMeaningFollowUp(userMessage: string): boolean {
  const text = normalizeText(userMessage);
  if (!text) return false;

  return [
    "matlab",
    "mutlab",
    "mtlb",
    "kya matlab",
    "what do you mean",
    "meaning?",
    "samjhao",
    "samjha do",
  ].some((pattern) => text.includes(pattern));
}

function isHowToFollowUp(userMessage: string): boolean {
  const text = normalizeText(userMessage);
  if (!text) return false;

  return [
    "kaise karun",
    "kaise karu",
    "kaise karna hai",
    "how to",
    "how do i do",
    "how should i do",
    "step by step kaise",
  ].some((pattern) => text.includes(pattern));
}

function isTaskClarificationFollowUp(userMessage: string): boolean {
  const text = normalizeText(userMessage);
  if (!text) return false;

  const looksLikeQuestion =
    text.includes("?") || /^(kya|kiya|kia|kaise|what|why|how|do i|should i)\b/i.test(text);
  if (!looksLikeQuestion) return false;

  return [
    "sab",
    "saare",
    "all",
    "app",
    "apps",
    "channel",
    "bhej",
    "send",
    "kitne",
    "how many",
    "padega",
    "zaroori",
    "must",
  ].some((pattern) => text.includes(pattern));
}

function buildTaskClarificationReply({
  taskText,
  userMessage,
  useEnglish,
}: {
  taskText: string;
  userMessage: string;
  useEnglish: boolean;
}): string {
  const normalizedUserMessage = normalizeText(userMessage);
  const cleanTaskText = taskText.trim();

  const asksAllChannels =
    (normalizedUserMessage.includes("sab") ||
      normalizedUserMessage.includes("saare") ||
      normalizedUserMessage.includes("all")) &&
    (normalizedUserMessage.includes("app") ||
      normalizedUserMessage.includes("apps") ||
      normalizedUserMessage.includes("channel"));
  if (asksAllChannels) {
    return useEnglish
      ? [
          "No, you do not need to send on all apps/channels.",
          `For this task (${cleanTaskText}), use only one channel today so results stay clear.`,
          "Pick one: WhatsApp or Instagram or Google Maps post.",
        ].join("\n")
      : [
          "Nahi, saare apps/channels par bhejna zaroori nahi hai.",
          `Is task (${cleanTaskText}) me aaj sirf ek channel use karo taaki result clear aaye.`,
          "Ek choose karo: WhatsApp ya Instagram ya Google Maps post.",
        ].join("\n");
  }

  const asksVolume =
    normalizedUserMessage.includes("kitne") || normalizedUserMessage.includes("how many");
  if (asksVolume) {
    return useEnglish
      ? [
          "Use one channel and start with 25 relevant people.",
          "If 25 is hard today, minimum 15 is fine, but keep the same offer and CTA.",
        ].join("\n")
      : [
          "Ek hi channel use karo aur 25 relevant logon se start karo.",
          "Agar 25 mushkil lage to minimum 15 chalega, but offer aur CTA same rakho.",
        ].join("\n");
  }

  return useEnglish
    ? [
        `For this task (${cleanTaskText}), keep it simple: one channel, one offer, one CTA, then measure replies.`,
        "Ask your next question and I will answer it step by step.",
      ].join("\n")
    : [
        `Is task (${cleanTaskText}) ko simple rakho: ek channel, ek offer, ek CTA, phir replies measure karo.`,
        "Aap next question poochho, main step by step clear kar dunga.",
      ].join("\n");
}

function extractManagerSectionContent(
  reply: string,
  sectionTitle: "Decision" | "Today's Priority" | "Action Steps" | "Next Step"
): string | null {
  if (!reply.trim()) return null;

  const escapedTitle = sectionTitle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(
    `${escapedTitle}\\s*\\n([\\s\\S]*?)(?=\\n\\n(?:Situation|Manager Insight|Decision|Today's Priority|Action Steps|Watch|Short Answer|Why|Next Step)\\s*\\n|$)`,
    "i"
  );
  const match = pattern.exec(reply);
  if (!match?.[1]) return null;
  const value = match[1].trim();
  return value.length > 0 ? value : null;
}

function buildMeaningFollowUpReply({
  lastAssistantMessage,
  sharedTaskState,
  useEnglish,
}: {
  lastAssistantMessage: string;
  sharedTaskState: SharedTaskState;
  useEnglish: boolean;
}): string {
  const decision =
    extractManagerSectionContent(lastAssistantMessage, "Decision") ??
    (useEnglish
      ? "Pause extra planning and start one practical customer-facing move today."
      : "Extra planning abhi pause karo aur aaj ek practical customer-facing move start karo.");
  const priority =
    extractManagerSectionContent(lastAssistantMessage, "Today's Priority") ??
    getCurrentTaskText(sharedTaskState) ??
    (useEnglish
      ? "Call 10 recent customers with a comeback offer and track responses."
      : "Aaj 10 recent customers ko comeback offer ke saath call/WhatsApp karo aur response track karo.");

  return useEnglish
    ? [
        "Simple meaning:",
        decision,
        "",
        `What to do now: ${priority}`,
        "After doing this, reply with 'done' and I will give the next step.",
      ].join("\n")
    : [
        "Simple matlab:",
        decision,
        "",
        `Ab kya karna hai: ${priority}`,
        "Ye complete karke 'done' likho, main next step de dunga.",
      ].join("\n");
}

function getCurrentTaskText(sharedTaskState: SharedTaskState): string | null {
  const task = sharedTaskState.currentTaskText ?? sharedTaskState.currentPriority;
  if (!task) return null;

  const trimmed = task.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function hasRecentTaskAssignment(messages: ChatMessage[]): boolean {
  const recentAssistantMessages = messages
    .filter((message) => message.role === "assistant")
    .slice(-4)
    .map((message) => normalizeText(message.content));

  return recentAssistantMessages.some(
    (content) =>
      content.includes("today's priority") ||
      content.includes("todays priority") ||
      content.includes("aaj ka task") ||
      content.includes("action steps")
  );
}

function buildTaskAnchoredFollowUpQuestion(taskText: string): string {
  return `Thik hai. Aaj ka task ${taskText} tha. Kya issue aaya: time, clarity, ya materials?`;
}

function isTaskFollowUpMessage(
  latestUserMessage: string,
  lastAssistantMessage: string
): boolean {
  const normalizedUserMessage = normalizeText(latestUserMessage);
  if (!normalizedUserMessage) return false;

  // Keep identity/greeting/simple acknowledgement out of task-loop handling.
  if (
    isIdentityQuestion(normalizedUserMessage) ||
    isGreetingMessage(normalizedUserMessage) ||
    normalizedUserMessage === "ok" ||
    normalizedUserMessage === "okay" ||
    normalizedUserMessage === "all right" ||
    normalizedUserMessage === "alright" ||
    normalizedUserMessage.includes("thanks") ||
    normalizedUserMessage.includes("thank")
  ) {
    return false;
  }

  const taskSignals = [
    "aaj ka task",
    "today task",
    "task",
    "priority",
    "not done",
    "done",
    "blocker",
    "blocked",
    "delay",
    "time",
    "clarity",
    "material",
    "materials",
  ];

  if (taskSignals.some((signal) => normalizedUserMessage.includes(signal))) {
    return true;
  }

  const normalizedLastAssistantMessage = normalizeText(lastAssistantMessage);
  const previousPromptWasTaskFollowUp = normalizedLastAssistantMessage.includes(
    "kya issue aaya: time, clarity, ya materials?"
  );

  if (!previousPromptWasTaskFollowUp) {
    return false;
  }

  // If user is directly answering with one of the asked options.
  return ["time", "clarity", "material", "materials"].some((token) =>
    normalizedUserMessage.includes(token)
  );
}

function buildTaskSpecificSimplificationSteps(
  taskText: string,
  useEnglish = false
): string[] {
  const normalizedTaskText = normalizeText(taskText);

  if (
    normalizedTaskText.includes("high-impact channel") ||
    (normalizedTaskText.includes("focused execution") &&
      normalizedTaskText.includes("channel"))
  ) {
    return useEnglish
      ? [
          "Step 1: Pick one channel for today only: WhatsApp broadcast, Instagram DM, or Google Maps post.",
          "Step 2: Create one simple offer + CTA line (for example: 'Reply YES for today's offer').",
          "Step 3: Send/post to 25 relevant people and note replies after 24 hours.",
        ]
      : [
          "Step 1: Aaj ke liye sirf ek channel choose karo: WhatsApp broadcast, Instagram DM, ya Google Maps post.",
          "Step 2: Ek simple offer + CTA line likho (jaise: 'Aaj ke offer ke liye YES reply karo').",
          "Step 3: 25 relevant logon ko bhejo/post karo aur 24 ghante baad replies count note karo.",
        ];
  }

  if (normalizedTaskText.includes("bottleneck")) {
    return [
      "Step 1: Aaj sirf observe karo: customers kam aa rahe hain, orders slow hain, ya delivery delay hai.",
      "Step 2: Inme se jo issue sabse zyada repeat ho, wahi bottleneck mark karo.",
      "Step 3: Usi bottleneck par ek immediate fix action lagao aur result note karo.",
    ];
  }

  if (normalizedTaskText.includes("menu") && normalizedTaskText.includes("board")) {
    return [
      "Step 1: Top 3 dishes ke naam likho.",
      "Step 2: Har dish ke saamne price likho.",
      "Step 3: Board entrance ke bahar visible jagah par lagao.",
    ];
  }

  return [
    "Step 1: Aaj 10 purane customers ko naam se personal invite bhejo.",
    "Step 2: Counter par repeat-visit offer line lagao (jaise next visit par small discount).",
    "Step 3: Din ke end me replies/visits count karo aur kal ke liye same offer tune karo.",
  ];
}

function simplifyTask(currentPriority: string): string {
  return [
    `Thik hai. Aaj ka task ${currentPriority} tha. Simple karte hain.`,
    ...buildTaskSpecificSimplificationSteps(currentPriority).slice(0, 4),
  ].join("\n");
}

function buildTaskHowToReply(taskText: string, useEnglish: boolean): string {
  const cleanTaskText = taskText.trim();
  const steps = buildTaskSpecificSimplificationSteps(cleanTaskText, useEnglish).slice(0, 4);

  if (useEnglish) {
    return [
      `Do it like this for today's task: ${cleanTaskText}`,
      ...steps,
      "Share the result count after this and I will give the next move.",
    ].join("\n");
  }

  return [
    `Isko aise karo. Aaj ka task: ${cleanTaskText}`,
    ...steps,
    "Ye complete karke result count bhejo, main next move de dunga.",
  ].join("\n");
}

function isTaskCompletionSignal(latestUserMessage: string): boolean {
  const normalized = normalizeText(latestUserMessage);
  if (!normalized || normalized.includes("?")) return false;

  return (
    normalized === "ok" ||
    normalized === "okay" ||
    normalized === "haan" ||
    normalized === "han" ||
    normalized === "done" ||
    normalized === "ho gaya" ||
    normalized === "ho gya" ||
    /\b(ho gaya|ho gya|complete|completed|done)\b/i.test(normalized)
  );
}

type TaskResultQuality = "low" | "medium" | "high";

type TaskResultSnapshot = {
  replies: number | null;
  visits: number | null;
  quality: TaskResultQuality;
};

function extractTaskResultSnapshot(latestUserMessage: string): TaskResultSnapshot | null {
  const normalized = normalizeText(latestUserMessage);
  if (!normalized || normalized.includes("?")) return null;

  if (
    /\b(0|zero|koi response nahi|no response|no reply|nahi aaya|nahi aya|response nahi)\b/i.test(
      normalized
    )
  ) {
    return {
      replies: 0,
      visits: 0,
      quality: "low",
    };
  }

  const numberMatches = normalized.match(/\d+/g);
  const firstCount = numberMatches?.[0] ? Number(numberMatches[0]) : null;
  const hasReplyWord = /\b(reply|response|responses|lead|inquiry|inquiries)\b/i.test(normalized);
  const hasVisitWord = /\b(aaye|aaya|visit|visits|walk[-\s]?in|order|orders|footfall)\b/i.test(normalized);
  const highWord = /\b(bohot|bahut|kaafi zyada|many|lots|strong response)\b/i.test(normalized);
  const lowWord = /\b(thoda|kam|very low|weak response)\b/i.test(normalized);

  let quality: TaskResultQuality | null = null;
  if (highWord) {
    quality = "high";
  } else if (lowWord) {
    quality = "low";
  } else if (typeof firstCount === "number") {
    quality = firstCount <= 2 ? "low" : firstCount <= 7 ? "medium" : "high";
  }

  if (!quality) {
    if (/\b(response mila|reply aaya|log aaye)\b/i.test(normalized)) {
      quality = "medium";
    } else {
      return null;
    }
  }

  return {
    replies: hasReplyWord ? firstCount : null,
    visits: hasVisitWord ? firstCount : null,
    quality,
  };
}

function getLastTaskResult(messages: ChatMessage[]): TaskResultSnapshot | null {
  const recentUsers = messages
    .filter((message) => message.role === "user")
    .slice(-6)
    .reverse();

  for (const message of recentUsers) {
    const snapshot = extractTaskResultSnapshot(message.content);
    if (snapshot) return snapshot;
  }
  return null;
}

function askedTaskResultQuestion(lastAssistantMessage: string): boolean {
  const normalized = normalizeText(lastAssistantMessage);
  return (
    normalized.includes("kitne log reply kiye") ||
    normalized.includes("kitne log aaye") ||
    normalized.includes("reply kiye ya aaye") ||
    normalized.includes("response count")
  );
}

function ensureNonRepeatingReply(
  candidateReply: string,
  lastAssistantMessage: string,
  context: ConversationContext
): string {
  if (normalizeText(candidateReply) !== normalizeText(lastAssistantMessage)) {
    return candidateReply;
  }

  const businessType = context.businessType ?? "aapka business";
  return [
    "Situation",
    `${businessType} side par previous action already run ho chuka hai, aur same plan repeat karna useful nahi hoga.`,
    "",
    "Manager Insight",
    "Agle step me naya signal lena zaroori hai taaki strategy evolve ho.",
    "",
    "Decision",
    "Main decide kar raha hoon: ab alternate low-cost channel test karenge.",
    "",
    "Today's Priority",
    "Aaj one-day alternate channel test launch karo.",
    "",
    "Action Steps",
    "1. Jo offer WhatsApp par test kiya tha, usko in-store counter script me convert karo.\n2. Har walk-in customer ko same-day repeat CTA do.\n3. End of day conversion count note karo.",
    "",
    "Watch",
    "WhatsApp vs walk-in conversion difference.",
  ].join("\n");
}

function buildTaskProgressionReply({
  context,
  currentTaskText,
  resultSnapshot,
}: {
  context: ConversationContext;
  currentTaskText: string;
  resultSnapshot: TaskResultSnapshot | null;
}): string {
  const businessType = context.businessType ?? "aapka business";
  const resultLine = (() => {
    if (!resultSnapshot) return "";
    const replyCount =
      typeof resultSnapshot.replies === "number" ? `${resultSnapshot.replies} replies` : "";
    const visitCount =
      typeof resultSnapshot.visits === "number" ? `${resultSnapshot.visits} visits` : "";
    const combined = [replyCount, visitCount].filter(Boolean).join(", ");
    return combined ? ` Data: ${combined}.` : "";
  })();

  if (resultSnapshot?.quality === "high") {
    return [
      "Situation",
      `Thik hai. ${currentTaskText} test complete ho gaya aur response strong hai.${resultLine}`,
      "",
      "Manager Insight",
      "Signal strong hai, toh same winning offer ko aggressively scale karna best move hai.",
      "",
      "Decision",
      "Main decide kar raha hoon: same offer ko bigger audience par scale karenge.",
      "",
      "Today's Priority",
      "Aaj same offer 100 logon ko bhejo.",
      "",
      "Action Steps",
      "1. Winning message ko 100 high-intent contacts list me bhejo.\n2. Same CTA rakho; sirf delivery speed improve karo.\n3. Day-end conversion-rate track karo.",
      "",
      "Watch",
      "Scale ke baad conversion-rate stable raha ya nahi.",
    ].join("\n");
  }

  if (resultSnapshot?.quality === "medium") {
    return [
      "Situation",
      `Thik hai. ${currentTaskText} test complete ho gaya aur response medium hai.${resultLine}`,
      "",
      "Manager Insight",
      "Offer workable hai, lekin conversion unlock karne ke liye messaging tweak zaroori hai.",
      "",
      "Decision",
      "Main decide kar raha hoon: offer keep karenge, message improve karenge.",
      "",
      "Today's Priority",
      "Aaj improved message ke saath same offer re-test karo.",
      "",
      "Action Steps",
      "1. Offer line me clear outcome + deadline add karo.\n2. Same audience segment par revised copy test karo.\n3. Old vs new response-rate compare karo.",
      "",
      "Watch",
      "Message tweak ke baad reply-rate uplift.",
    ].join("\n");
  }

  if (resultSnapshot?.quality === "low") {
    return [
      "Situation",
      `Thik hai. ${currentTaskText} test complete hua aur response low raha.${resultLine}`,
      "",
      "Manager Insight",
      "Low response ka matlab current offer/message weak hai; same format repeat karna waste hoga.",
      "",
      "Decision",
      "Main decide kar raha hoon: offer change karke fresh test karenge.",
      "",
      "Today's Priority",
      "Aaj naya offer test karo.",
      "",
      "Action Steps",
      "1. Naya stronger benefit-based offer draft karo.\n2. Short clear CTA ke saath 30 target contacts par bhejo.\n3. 24h me response compare karke winner lock karo.",
      "",
      "Watch",
      "Naye offer ka reply-rate vs previous offer.",
    ].join("\n");
  }

  return [
    "Situation",
    `Thik hai. ${currentTaskText} test complete ho gaya. Ab result dekhte hain.`,
    "",
    "Manager Insight",
    `${businessType} me next move result signal ke basis par decide karna best hota hai.`,
    "",
    "Decision",
    "Main decide kar raha hoon: ab evidence-based next step choose karenge, guesswork nahi.",
    "",
    "Today's Priority",
    "Aaj test ka response-count capture karo.",
    "",
    "Action Steps",
    "1. Total replies/inquiries/visits ka quick count nikalo.\n2. Us count ko yesterday baseline se compare karo.\n3. Count share karo taaki next move immediately lock ho.",
    "",
    "Watch",
    "Ek short sawal: kitne log reply kiye ya aaye?",
  ].join("\n");
}

function buildConfusionGuidanceReply({
  context,
  sharedTaskState,
}: {
  context: ConversationContext;
  sharedTaskState: SharedTaskState;
}): string {
  const currentTaskText = getCurrentTaskText(sharedTaskState);

  if (currentTaskText) {
    return [
      `Thik hai. Aaj ka task ${currentTaskText} tha. Isko simple karte hain:`,
      ...buildTaskSpecificSimplificationSteps(currentTaskText),
    ].join("\n");
  }

  if (context.problemType === "Sales" || context.customerIssue === "Acquisition") {
    return [
      "Thik hai. Isko simple karte hain: aaj ka focus customer pull.",
      "1. 10 min: ek line me output likho jo aaj complete karna hai.",
      "2. 20 min: us output ka sabse chhota executable action complete karo.",
      "3. End of day: result note karo aur usi basis par next task set karo.",
    ].join("\n");
  }

  return [
    "Thik hai. Isko simple karte hain: aaj ka focus ek practical next step complete karna.",
    "1. 10 min: ek line me output likho jo aaj complete karna hai.",
    "2. 20 min: us output ka sabse chhota executable action complete karo.",
    "3. End of day: result note karo aur usi basis par next task set karo.",
  ].join("\n");
}

function buildFrustrationLeadManagerReply(context: ConversationContext): string {
  const businessType = context.businessType ?? "aapka business";
  const coreProblem = context.problemType ?? "customer flow issue";
  const impact = context.businessImpact ?? "sales/revenue pressure";
  const beginnerOrLowConfidence =
    context.userExperienceLevel === "Beginner" || context.confidenceLevel === "Low";

  return [
    "Situation",
    `Ab tak jo clear hai: ${businessType} me ${coreProblem} chal raha hai, aur impact ${impact} par dikh raha hai.`,
    "",
    "Manager Insight",
    beginnerOrLowConfidence
      ? "Aapko complex cheezein nahi chahiye. Simple aur low-risk local execution se pehla win jaldi milta hai."
      : "Is stage par over-questioning se progress slow hoti hai. Focused low-cost execution se signal fast milta hai.",
    "",
    "Decision",
    beginnerOrLowConfidence
      ? "Hum ek simple guided path lenge: pehle local visibility aur direct invites se customer flow wapas laayenge."
      : "Hum ab direct customer-flow recovery actions start karenge aur data se next move tune karenge.",
    "",
    "Today's Priority",
    "Aaj ek chhota lekin clear local customer pull action complete karna hai.",
    "",
    "Action Steps",
    beginnerOrLowConfidence
      ? "1. Aaj bas restaurant ke bahar clear menu + price board lagao.\n2. Aaj 5 known contacts ko WhatsApp invite bhejo.\n3. Aaj 3 existing customers se Google Maps review request karo."
      : "1. Aaj 10 recent customers ko personal WhatsApp ping bhejo with comeback offer.\n2. Entrance par visible offer/menu board lagao with clear CTA.\n3. Aaj hi 5 happy customers se Google Maps review request karo.",
    "",
    "Watch",
    "Next 48 hours me new walk-ins/inquiries count note karo.",
  ].join("\n");
}

function buildGrowthModeReply({
  context,
  messages,
}: {
  context: ConversationContext | null;
  messages: ChatMessage[];
}): string {
  const preferredLanguage = context?.resolvedContext.preferredLanguage;
  const conversationLanguage = context?.sharedContext.conversationLanguage;
  const latestUserMessage = messages[messages.length - 1]?.content ?? "";
  const useEnglish = shouldReplyInEnglish(
    latestUserMessage,
    conversationLanguage,
    preferredLanguage
  );
  const conversationText = getConversationFingerprint(messages);
  const businessType =
    context?.businessType ??
    (includesAny(conversationText, RESTAURANT_KEYWORDS) ? "Restaurant" : null);

  if (!businessType) {
    return useEnglish
      ? "If everything is going fine, great. Now let's focus on growth or improvement. What type of business do you run?"
      : "Agar sab theek chal raha hai, toh achhi baat hai. Ab growth ya improvement dekhte hain. Aap kis type ka business chala rahe ho?";
  }

  if (businessType === "Restaurant") {
    return useEnglish
      ? "If operations are stable, let's work on growth now. Which area do you want to strengthen: dine-in, repeat customers, or online orders?"
      : "Agar operations theek chal rahe hain, toh ab growth par kaam karte hain. Aap dine-in, repeat customers, ya online orders me kis side ko aur strong banana chahte ho?";
  }

  if (businessType === "Automation Agency") {
    return useEnglish
      ? "If things are stable, let's focus on scaling. Which area do you want to improve next: client acquisition, conversion, or offer positioning?"
      : "Agar sab stable hai, toh ab scale par focus karte hain. Aap client acquisition, conversion, ya offer positioning me kis side ko aur improve karna chahte ho?";
  }

  return useEnglish
    ? `If things are running smoothly, great. Now let's explore growth or optimization. In ${businessType}, which area do you want to improve now: sales, repeat customers, or profit?`
    : `Agar sab theek chal raha hai, toh achhi baat hai. Ab growth ya optimization explore karte hain. ${businessType} me aap abhi sales, repeat customers, ya profit me kis side ko aur improve karna chahte ho?`;
}

function isBusinessContextActive(
  latestUserMessage: string,
  messageType: MessageType,
  actionableTypes: Exclude<MessageType, "conversation">[],
  context: ConversationContext,
  previousMessageType: MessageType | null
): boolean {
  const hasResolvedBusinessContext = Boolean(
    context.businessType ||
      context.problemType ||
      context.businessImpact ||
      context.customerIssue ||
      context.currentProblem ||
      context.userGoal
  );

  return (
    messageType !== "conversation" ||
    actionableTypes.length > 0 ||
    isVagueBusinessMessage(latestUserMessage) ||
    isBusinessProblemIntent(latestUserMessage) ||
    hasResolvedBusinessContext ||
    previousMessageType === "business_strategy" ||
    previousMessageType === "seasonal_strategy" ||
    previousMessageType === "calculation" ||
    previousMessageType === "marketing_content"
  );
}

function getRecentUserMessages(messages: ChatMessage[]): string[] {
  return messages
    .filter((message) => message.role === "user")
    .slice(-6)
    .map((message) => normalizeText(message.content))
    .filter(Boolean);
}

function hasDetailedProblem(text: string | null): boolean {
  if (!text) {
    return false;
  }

  const normalized = normalizeText(text);

  if (!normalized || isVagueBusinessMessage(normalized)) {
    return false;
  }

  return normalized.split(" ").length >= 5;
}

function hasBusinessSignal(text: string): boolean {
  return BUSINESS_SIGNAL_KEYWORDS.some((keyword) => text.includes(keyword));
}

function includesAny(text: string, keywords: string[]): boolean {
  return keywords.some((keyword) => text.includes(keyword));
}

function getLastAssistantMessage(messages: ChatMessage[]): string {
  return (
    [...messages].reverse().find((message) => message.role === "assistant")?.content ?? ""
  );
}

function getConversationFingerprint(messages: ChatMessage[]): string {
  return getRecentUserMessages(messages).join(" ");
}

function hasAnsweredBusinessType(context: ConversationContext, conversationText: string): boolean {
  return Boolean(context.businessType || includesAny(conversationText, RESTAURANT_KEYWORDS));
}

function buildBusinessTypeClarificationQuestion(useEnglish: boolean): string {
  return useEnglish
    ? "What type of business do you run? (kirana, clothing, service, etc.)"
    : "Aapka business type kya hai? (kirana, clothing, service, etc.)";
}

function hasAnsweredProblemType(context: ConversationContext): boolean {
  return Boolean(context.problemType);
}

function matchesPreviousQuestion(reply: string, lastAssistantMessage: string): boolean {
  const normalizedReply = normalizeText(reply);
  const normalizedLastAssistant = normalizeText(lastAssistantMessage);

  if (!normalizedLastAssistant) {
    return false;
  }

  return normalizedReply === normalizedLastAssistant;
}

type ClarificationIntent =
  | "problem_signal"
  | "business_type"
  | "funnel_stage"
  | "restaurant_channel"
  | "competitor"
  | "beginner_step"
  | "goal"
  | "customer_type"
  | "budget"
  | "other";

function detectClarificationIntent(question: string): ClarificationIntent {
  const normalized = normalizeText(question);
  if (normalized.includes("visible signal")) return "problem_signal";
  if (normalized.includes("kis type ka business")) return "business_type";
  if (normalized.includes("naye customers") || normalized.includes("repeat") || normalized.includes("conversion")) {
    return "funnel_stage";
  }
  if (normalized.includes("dine-in") || normalized.includes("online orders")) {
    return "restaurant_channel";
  }
  if (normalized.includes("competitor") || normalized.includes("food outlet recently open")) {
    return "competitor";
  }
  if (normalized.includes("sirf ek simple step")) return "beginner_step";
  if (normalized.includes("primary goal")) return "goal";
  if (normalized.includes("main customers")) return "customer_type";
  if (normalized.includes("budget level")) return "budget";
  return "other";
}

function getAskedClarificationIntents(messages: ChatMessage[]): Set<ClarificationIntent> {
  const asked = new Set<ClarificationIntent>();
  for (const message of messages) {
    if (message.role !== "assistant") continue;
    const normalized = normalizeText(message.content);
    if (!normalized.includes("?")) continue;
    asked.add(detectClarificationIntent(message.content));
  }
  return asked;
}

function getClarificationQuestionCount(messages: ChatMessage[]): number {
  return messages.filter((message) => {
    if (message.role !== "assistant") return false;
    const normalized = normalizeText(message.content);
    if (!normalized.includes("?")) return false;
    return (
      normalized.includes("issue") ||
      normalized.includes("signal") ||
      normalized.includes("business") ||
      normalized.includes("customer") ||
      normalized.includes("budget") ||
      normalized.includes("dine-in") ||
      normalized.includes("online orders") ||
      normalized.includes("competitor")
    );
  }).length;
}

function shouldForceAssumptionDecision(latestUserMessage: string): boolean {
  const normalized = normalizeText(latestUserMessage);
  return (
    /\b(sales|sale)\s+(gir|down|kam)\b/i.test(normalized) ||
    /\b(problem|issue)\s+(hai|he|h)\b/i.test(normalized) ||
    /\b(nahi pata|nahin pata|mujhe nahi pata|tum hi batao|aap hi batao)\b/i.test(normalized)
  );
}

function buildAssumptionLeadManagerReply(context: ConversationContext): string {
  const businessType = context.businessType ?? "aapka business";
  const customerIssue = context.customerIssue ?? "customer pull";
  const impact = context.businessImpact ?? "sales pressure";

  return [
    "Situation",
    `Thik hai. Tumhe exact reason nahi pata, matlab hum assumption se start karenge. ${businessType} me abhi ${impact} dikh raha hai.`,
    "",
    "Manager Insight",
    "Is stage par over-questioning ka fayda kam hota hai. Fast test se real blocker pakadna best rehta hai.",
    "",
    "Decision",
    `Main decide kar raha hoon: pehla focus ${customerIssue} improve karke immediate customer-flow signal lena hai.`,
    "",
    "Today's Priority",
    "Aaj ek focused comeback-offer test run karna hai.",
    "",
    "Action Steps",
    "1. Last 20 customers ko WhatsApp par one-line comeback offer bhejo.\n2. Message me clear CTA rakho: aaj visit/order par specific benefit.\n3. End of day replies + visits count note karo.",
    "",
    "Watch",
    "24 hours me inquiry count, visit/order count, aur redemption rate.",
  ].join("\n");
}

function hasEnoughBusinessClarity({
  latestUserMessage,
  messageType,
  context,
  messages,
}: {
  latestUserMessage: string;
  messageType: MessageType;
  context: ConversationContext;
  messages: ChatMessage[];
}): boolean {
  if (messageType === "calculation" || messageType === "marketing_content") {
    return true;
  }

  const recentUserText = getRecentUserMessages(messages).join(" ");
  const detailedProblem = hasDetailedProblem(context.currentProblem);
  const businessSignals = hasBusinessSignal(recentUserText);
  const hasBudgetContext = Boolean(context.budgetConstraint);
  const hasCustomerContext = Boolean(context.customerIssue);
  const hasBusinessImpact = Boolean(context.businessImpact);
  const beginnerOrLowConfidence =
    context.userExperienceLevel === "Beginner" || context.confidenceLevel === "Low";
  const latestIsStillVague = isVagueBusinessMessage(latestUserMessage);

  if (!latestIsStillVague && messageType !== "conversation") {
    return true;
  }

  if (
    context.businessType &&
    context.problemType &&
    (hasBusinessImpact || detailedProblem || hasCustomerContext)
  ) {
    return true;
  }

  if (beginnerOrLowConfidence && context.businessType && context.problemType) {
    return true;
  }

  if (
    detailedProblem &&
    (businessSignals || hasBudgetContext || hasCustomerContext || hasBusinessImpact)
  ) {
    return true;
  }

  return false;
}

function buildClarificationReply({
  latestUserMessage,
  context,
  messages,
  sharedTaskState,
}: {
  latestUserMessage: string;
  context: ConversationContext;
  messages: ChatMessage[];
  sharedTaskState: SharedTaskState;
}): string {
  const normalized = normalizeText(latestUserMessage);
  const currentTaskText = getCurrentTaskText(sharedTaskState);
  const lastAssistantMessage = getLastAssistantMessage(messages);
  const useEnglish = shouldReplyInEnglish(
    latestUserMessage,
    context.sharedContext.conversationLanguage,
    context.resolvedContext.preferredLanguage
  );

  if (isConfusion(normalized)) {
    return buildConfusionGuidanceReply({ context, sharedTaskState });
  }

  if (currentTaskText && isTaskFollowUpMessage(latestUserMessage, lastAssistantMessage)) {
    return useEnglish
      ? `Alright. Today's task was ${currentTaskText}. What was the blocker: time, clarity, or materials?`
      : buildTaskAnchoredFollowUpQuestion(currentTaskText);
  }

  const conversationText = getConversationFingerprint(messages);
  const businessTypeKnown = hasAnsweredBusinessType(context, conversationText);
  const problemTypeKnown = hasAnsweredProblemType(context);
  const askedIntents = getAskedClarificationIntents(messages);
  const candidates: Array<{ intent: ClarificationIntent; question: string }> = [];

  if (!businessTypeKnown) {
    const question = buildBusinessTypeClarificationQuestion(useEnglish);
    if (!matchesPreviousQuestion(question, lastAssistantMessage)) {
      return question;
    }
  }

  if (!problemTypeKnown) {
    if (normalized.includes("trust")) {
      candidates.push({
        intent: "problem_signal",
        question:
          "Trust issue exact kis jagah feel ho raha hai: customers, staff, ya market credibility?",
      });
    } else if (
      normalized.includes("sales") ||
      normalized.includes("down") ||
      normalized.includes("footfall")
    ) {
      candidates.push({
        intent: "funnel_stage",
        question: "Yeh drop zyada naye customers me hai, repeat customers me hai, ya dono me?",
      });
    } else {
      candidates.push({
        intent: "problem_signal",
        question:
          "Is issue ka sabse visible signal kya hai: customers kam aa rahe hain, orders kam hain, ya revenue drop hai?",
      });
    }
  }

  if (
    context.problemType === "Sales" ||
    context.problemType === "Customer" ||
    context.problemType === "Trust" ||
    context.problemType === "Lead Generation"
  ) {
    candidates.push({
      intent: "funnel_stage",
      question: "Yeh issue naye customers me zyada hai, repeat me hai, ya conversion stage me?",
    });
  }

  if (
    (context.businessType === "Restaurant" || includesAny(conversationText, RESTAURANT_KEYWORDS)) &&
    !conversationText.includes("dine-in") &&
    !conversationText.includes("online orders")
  ) {
    candidates.push({
      intent: "restaurant_channel",
      question: "Restaurant side par issue dine-in me hai, online orders me hai, ya dono me?",
    });
  }

  if (
    (context.businessType === "Restaurant" || includesAny(conversationText, RESTAURANT_KEYWORDS)) &&
    !conversationText.includes("competitor")
  ) {
    candidates.push({
      intent: "competitor",
      question: "Nearby koi naya restaurant ya food outlet recently open hua hai kya?",
    });
  }

  if (context.userExperienceLevel === "Beginner" || context.confidenceLevel === "Low") {
    candidates.push({
      intent: "beginner_step",
      question:
        "Aaj ke liye sirf ek simple step lete hain: aap pehle WhatsApp invite bhejna chahoge ya outside board lagana?",
    });
  }

  const nextQuestion =
    candidates.find(
      (item) =>
        !askedIntents.has(item.intent) &&
        !matchesPreviousQuestion(item.question, lastAssistantMessage)
    )?.question ?? null;
  const missingProfileFieldQuestionMap: Partial<
    Record<keyof ConversationContext["resolvedBusinessProfile"], string>
  > = {
    businessType: "Aap kis type ka business chala rahe ho?",
    mainGoal: "Aapka abhi primary goal kya hai: naye customers, repeat, ya margin improve?",
    customerType: "Aapke main customers kaun hain?",
    budgetLevel: "Execution ke liye budget level low, medium, ya high hai?",
  };
  const missingProfileQuestion =
    context.criticalMissingProfileFields
      .map((field) => missingProfileFieldQuestionMap[field])
      .find(Boolean) ?? null;
  const nextMissingProfileQuestion =
    missingProfileQuestion && !matchesPreviousQuestion(missingProfileQuestion, lastAssistantMessage)
      ? missingProfileQuestion
      : null;

  return (
    nextQuestion ??
    nextMissingProfileQuestion ??
    normalizeManagerReply(buildAssumptionLeadManagerReply(context))
  );
}

function getLatestUserMessage(messages: ChatMessage[]): string {
  return (
    [...messages].reverse().find((message) => message.role === "user")?.content ?? ""
  );
}

function getPreviousResolvedType(messages: ChatMessage[]): MessageType | null {
  const userMessages = messages.filter((message) => message.role === "user");

  for (let index = userMessages.length - 1; index >= 0; index -= 1) {
    const currentMessage = userMessages[index]?.content ?? "";

    if (!currentMessage || isFollowUpMessage(currentMessage)) {
      continue;
    }

    return classifyMessage(currentMessage);
  }

  return null;
}

function buildScopedMessages(
  messages: ChatMessage[],
  latestUserMessage: string,
  instruction: string
): ChatMessage[] {
  const previousMessages = messages.slice(-8, -1);

  return [
    ...previousMessages,
    {
      role: "user",
      content: [
        `Original mixed request: ${latestUserMessage}`,
        instruction,
      ].join("\n\n"),
    },
  ];
}

function buildSectionInstruction(messageType: Exclude<MessageType, "conversation">): string {
  switch (messageType) {
    case "business_strategy":
      return [
        "Handle this as the main business strategy request.",
        "If the request is about a service business, prefer practical growth channels like LinkedIn outreach, cold email, YouTube tutorials, freelancer platforms, SaaS partnerships, and case study marketing.",
        "If the structured context says Restaurant or Cafe, keep the strategy local and customer-facing.",
        "For Restaurant or Cafe, allow only local visibility, Google Maps optimization, walk-in traffic, repeat customers, referral offers, local promotions, food quality, and service speed.",
        "For Restaurant or Cafe, do not suggest LinkedIn outreach, cold email campaigns, B2B lead generation, or SaaS funnels.",
        "If the structured context says budget is Low, start with low-cost moves like referral offers, WhatsApp broadcast, street visibility, and local partnerships.",
        "Use practical local-shop actions only when the business is clearly a shop. If business type is grocery or kirana, prefer grocery examples.",
        "Keep the reply practical and manager-like.",
        "Give one clear direction and one priority, not a menu of options.",
        "Avoid generic advice like improve quality, packaging, or better environment.",
      ].join(" ");
    case "seasonal_strategy":
      return [
        "Handle this as the main seasonal strategy request.",
        "Focus on wedding or festival execution, bulk orders, local partnerships, banners, WhatsApp promotion, and delivery.",
        "Keep the reply short, practical, and focused on local execution.",
        "Choose one clear priority instead of multiple campaign ideas.",
      ].join(" ");
    case "calculation":
      return [
        "Handle this as the main pricing, margin, discount, cost, or profit request.",
        "Calculate the math clearly and verify the numbers before answering.",
        "Keep cost price fixed unless the user clearly says supplier or purchase cost changed.",
        "If discount is applied, reduce only the selling price.",
        "Show the final profit or loss clearly inside the manager format.",
      ].join(" ");
    case "marketing_content":
      return [
        "Handle this as the main content request.",
        "Stay manager-first while giving one ready-to-use content draft.",
        "Do not mention cost price, margin, profit, or internal shop logic in the customer-facing copy.",
        "Create one strong poster or one strong content version only.",
      ].join(" ");
  }
}

async function runSingleIntentSection({
  messages,
  latestUserMessage,
  contextSummary,
  contextPrompt,
  isFollowUp,
  messageType,
}: {
  messages: ChatMessage[];
  latestUserMessage: string;
  contextSummary: string;
  contextPrompt: string;
  isFollowUp: boolean;
  messageType: Exclude<MessageType, "conversation">;
}): Promise<{ reply: string; provider: ProviderName }> {
  const scopedMessages = buildScopedMessages(
    messages,
    latestUserMessage,
    [
      "Use the structured business context below before interpreting the raw request.",
      contextPrompt,
      buildSectionInstruction(messageType),
    ].join("\n\n")
  );

  if (messageType === "calculation") {
    const deepseekResult = await runDeepseekReasoning({
      messages: scopedMessages,
      contextSummary,
      isFollowUp,
    });

    if (deepseekResult.ok && deepseekResult.reply) {
      return {
        reply: deepseekResult.reply,
        provider: "deepseek-reasoning",
      };
    }

    const fallbackReply = await runAdvisorProvider({
      messages: scopedMessages,
      messageType,
      contextSummary,
      isFollowUp,
    });

    return {
      reply: fallbackReply,
      provider: "advisor",
    };
  }

  if (messageType === "marketing_content") {
    const reply = await contentProvider({
      messages: scopedMessages,
      contextSummary,
      isFollowUp,
    });

    return {
      reply,
      provider: "content",
    };
  }

  const reply = await runAdvisorProvider({
    messages: scopedMessages,
    messageType,
    contextSummary,
    isFollowUp,
  });

  return {
    reply,
    provider: "advisor",
  };
}

async function runUnifiedManagerReply({
  messages,
  latestUserMessage,
  contextSummary,
  contextPrompt,
  isFollowUp,
  actionableTypes,
}: {
  messages: ChatMessage[];
  latestUserMessage: string;
  contextSummary: string;
  contextPrompt: string;
  isFollowUp: boolean;
  actionableTypes: Exclude<MessageType, "conversation">[];
}): Promise<{ reply: string; provider: ProviderName }> {
  const scopedMessages = buildScopedMessages(
    messages,
    latestUserMessage,
    [
      "Use the structured business context below before interpreting the raw request.",
      contextPrompt,
      `This request includes multiple intents: ${actionableTypes.join(", ")}.`,
      "Synthesize them into one single Neurova manager reply.",
      "Do not split by topic.",
      "Give one decision and one Today's Priority only.",
      "If calculation is included, mention the necessary number or implication inside the manager sections.",
      "If content is included, include only one ready-to-use draft inside Action Steps when needed.",
    ].join(" ")
  );

  const reply = await runAdvisorProvider({
    messages: scopedMessages,
    messageType: actionableTypes.includes("seasonal_strategy")
      ? "seasonal_strategy"
      : actionableTypes.includes("business_strategy")
        ? "business_strategy"
        : "conversation",
    contextSummary,
    isFollowUp,
  });

  return {
    reply,
    provider: "advisor",
  };
}

export async function routeAiMessage({
  messages,
  mode = DEFAULT_CHAT_MODE,
  sharedContext = EMPTY_SHARED_BUSINESS_CONTEXT,
  businessProfile = EMPTY_BUSINESS_PROFILE,
  sharedTaskState = EMPTY_SHARED_TASK_STATE,
  userSettings = DEFAULT_USER_SETTINGS,
}: RouteAiMessageParams): Promise<RouteAiMessageResult> {
  const latestUserMessage = getLatestUserMessage(messages);
  console.log(`[AUTO-DETECT] raw user message = ${latestUserMessage}`);
  const extractedProfilePatch = {
    ...extractProfileUpdates(latestUserMessage),
  };
  const explicitGoalStatement = isExplicitMainGoalStatement(latestUserMessage);
  if (extractedProfilePatch.mainGoal && !explicitGoalStatement) {
    delete extractedProfilePatch.mainGoal;
  }
  console.log("[AUTO-DETECT] extracted fields =", extractedProfilePatch);
  const normalizedBusinessProfile = normalizeBusinessProfile(businessProfile);
  const changedProfilePatch: Partial<BusinessProfile> = {};

  for (const [field, nextValue] of Object.entries(extractedProfilePatch) as Array<
    [keyof BusinessProfile, string]
  >) {
    const previousValue = normalizedBusinessProfile[field]?.trim() ?? "";
    const cleanedNextValue = nextValue?.trim() ?? "";
    if (!cleanedNextValue) continue;
    if (previousValue.toLowerCase() === cleanedNextValue.toLowerCase()) continue;
    changedProfilePatch[field] = cleanedNextValue;
  }

  const nextBusinessProfile = applyProfilePatch(
    normalizedBusinessProfile,
    changedProfilePatch
  );
  console.log("[PROFILE SAVE] updating fields =", changedProfilePatch);

  for (const [field, value] of Object.entries(changedProfilePatch)) {
    console.log(`[Profile Update] ${field} = ${value}`);
  }

  console.log("[PROFILE SAVE] success/failure = success");

  const nextSharedContext = mergeSharedContextWithBusinessProfile(
    sharedContext,
    nextBusinessProfile
  );
  console.log("[PROFILE CONTEXT] refreshed profile =", nextBusinessProfile);
  const previousMessages = messages.slice(0, -1);
  const previousMessageType = getPreviousResolvedType(previousMessages);
  const detectedTypes = detectMessageTypes(latestUserMessage, {
    previousMessageType,
  });
  const messageType = detectedTypes[0] ?? classifyMessage(latestUserMessage, {
    previousMessageType,
  });
  const context = buildConversationContext({
    messages,
    latestUserMessage,
    messageType,
    isFollowUp: isFollowUpMessage(latestUserMessage),
    sharedContext: nextSharedContext,
    businessProfile: nextBusinessProfile,
  });
  const normalizedUserSettings: UserSettings = {
    ...DEFAULT_USER_SETTINGS,
    ...userSettings,
  };
  const preferredLanguageFromSettings =
    normalizedUserSettings.language === "english" ? "English" : "Hinglish";
  const providerContextSummary = [
    context.summary,
    buildSettingsInstructionBlock(normalizedUserSettings),
  ].join("\n\n");
  const normalizedLatestUserMessage = normalizeText(latestUserMessage);
  const useEnglishForLatestMessage = shouldReplyInEnglish(
    latestUserMessage,
    context.sharedContext.conversationLanguage,
    context.resolvedContext.preferredLanguage || preferredLanguageFromSettings
  );
  const lastAssistantMessage = getLastAssistantMessage(messages);
  const currentTaskText = getCurrentTaskText(sharedTaskState);
  const hasTaskContextInConversation = hasRecentTaskAssignment(messages);
  const taskMarkedDoneByUser =
    Boolean(currentTaskText) &&
    hasTaskContextInConversation &&
    isTaskCompletionSignal(latestUserMessage);
  const inferredTaskState: { description: string; status: "pending" | "done" } | null =
    currentTaskText
      ? {
          description: currentTaskText,
          status:
            taskMarkedDoneByUser || sharedTaskState.taskStatus === "done"
              ? "done"
              : "pending",
        }
      : null;
  const businessProblemIntent = isBusinessProblemIntent(latestUserMessage);
  const routeMode = detectRouteMode({
    latestUserMessage,
    selectedMode: mode,
    businessProblemIntent,
    messageType,
  });
  console.log("MODE:", routeMode);
  const stableFieldAnswer = resolveStableFieldAnswer(
    normalizedLatestUserMessage,
    context
  );
  const profileState = getBusinessProfileState(context.resolvedBusinessProfile);
  const missingImportantFields = getMissingImportantFields(
    context.resolvedBusinessProfile
  );
  const answeredFields = getAnsweredImportantFields(context.resolvedBusinessProfile);
  const hasFreshProfileUpdate = Object.keys(changedProfilePatch).length > 0;
  const skipOnboardingNow = isOnboardingSkipMessage(normalizedLatestUserMessage);
  const skipOnboardingActive = hasOnboardingSkipInConversation(messages);
  const onboardingQuestionCount = getTotalOnboardingQuestionCount(messages);
  const forceManagerModeByLimit = onboardingQuestionCount >= 3;
  const minimumDecisionContextReady = hasMinimumDecisionContext(context);
  const shouldExitOnboarding =
    forceManagerModeByLimit || minimumDecisionContextReady || skipOnboardingActive;
  const allowOnboardingFlow = routeMode === "manager";
  const isShortAcknowledgement =
    normalizedLatestUserMessage === "ok" ||
    normalizedLatestUserMessage === "okay" ||
    normalizedLatestUserMessage === "all right" ||
    normalizedLatestUserMessage === "alright" ||
    normalizedLatestUserMessage.includes("thanks") ||
    normalizedLatestUserMessage.includes("thank");

  if (
    routeMode === "chat" &&
    (isIdentityQuestion(normalizedLatestUserMessage) ||
      isGreetingMessage(latestUserMessage) ||
      isEverythingFineMessage(normalizedLatestUserMessage) ||
      isShortAcknowledgement)
  ) {
    return {
      reply: buildNormalChatReply(
        latestUserMessage,
        context.sharedContext.conversationLanguage,
        context.resolvedContext.preferredLanguage || preferredLanguageFromSettings
      ),
      messageType: "conversation",
      provider: "advisor",
      sharedContext: context.sharedContext,
      businessProfile: context.resolvedBusinessProfile,
    };
  }

  if (routeMode === "helper") {
    const helperState = deriveHelperExecutionState(messages);
    const helperUseEnglish = shouldReplyInEnglish(
      latestUserMessage,
      context.sharedContext.conversationLanguage,
      context.resolvedContext.preferredLanguage || preferredLanguageFromSettings
    );
    if (
      helperState.waitingForUserConfirmation &&
      isHelperDefinitionQuestion(latestUserMessage)
    ) {
      return {
        reply: buildHelperDefinitionReply({
          concept: extractHelperConcept(latestUserMessage),
          state: helperState,
          useEnglish: helperUseEnglish,
        }),
        messageType: "conversation",
        provider: "helper",
        sharedContext: context.sharedContext,
        businessProfile: context.resolvedBusinessProfile,
      };
    }
    if (
      helperState.waitingForUserConfirmation &&
      helperState.latestUserAskedNextWithoutConfirmation
    ) {
      return {
        reply: buildHelperWaitForDoneReply(helperState, helperUseEnglish),
        messageType: "conversation",
        provider: "helper",
        sharedContext: context.sharedContext,
        businessProfile: context.resolvedBusinessProfile,
      };
    }

    const reply = await runHelperProvider({
      messages,
      contextSummary: providerContextSummary,
      helperState: {
        currentStep: helperState.currentStep,
        explainedStep: helperState.explainedStep,
        completedStep: helperState.completedStep,
        waitingForUserConfirmation: helperState.waitingForUserConfirmation,
        explainedStepText: helperState.explainedStepText,
        latestUserAskedNextWithoutConfirmation:
          helperState.latestUserAskedNextWithoutConfirmation,
      },
    });

    return {
      reply,
      messageType: "conversation",
      provider: "helper",
      sharedContext: context.sharedContext,
      businessProfile: context.resolvedBusinessProfile,
    };
  }

  if (routeMode === "thinking") {
    const reply = await runThinkingProvider({
      messages,
      contextSummary: providerContextSummary,
    });

    return {
      reply,
      messageType: "conversation",
      provider: "thinking",
      sharedContext: context.sharedContext,
      businessProfile: context.resolvedBusinessProfile,
    };
  }

  if (routeMode === "direct") {
    const reply = await runDirectProvider({
      messages,
      contextSummary: providerContextSummary,
    });
    const plainReply = reply
      .split(/\r?\n/)
      .filter(
        (line) =>
          !/^\s*(Situation|Manager Insight|Decision|Today's Priority|Action Steps|Watch|Short Answer|Why|Next Step)\s*[:\-]?\s*$/i.test(
            line.trim()
          )
      )
      .join("\n")
      .trim();

    return {
      reply: plainReply || reply,
      messageType: "conversation",
      provider: "direct",
      sharedContext: context.sharedContext,
      businessProfile: context.resolvedBusinessProfile,
    };
  }

  if (routeMode === "decision") {
    const reply = await runDecisionProvider({
      messages,
      contextSummary: providerContextSummary,
    });

    return {
      reply,
      messageType: "conversation",
      provider: "decision",
      sharedContext: context.sharedContext,
      businessProfile: context.resolvedBusinessProfile,
    };
  }

  if (isMeaningFollowUp(normalizedLatestUserMessage) && lastAssistantMessage.trim()) {
    const useEnglish = shouldReplyInEnglish(
      latestUserMessage,
      context.sharedContext.conversationLanguage,
      context.resolvedContext.preferredLanguage || preferredLanguageFromSettings
    );
    return {
      reply: buildMeaningFollowUpReply({
        lastAssistantMessage,
        sharedTaskState,
        useEnglish,
      }),
      messageType: "conversation",
      provider: "advisor",
      sharedContext: context.sharedContext,
      businessProfile: context.resolvedBusinessProfile,
    };
  }

  if (isHowToFollowUp(normalizedLatestUserMessage)) {
    const useEnglish = shouldReplyInEnglish(
      latestUserMessage,
      context.sharedContext.conversationLanguage,
      context.resolvedContext.preferredLanguage || preferredLanguageFromSettings
    );
    const followUpTaskText =
      currentTaskText ??
      extractManagerSectionContent(lastAssistantMessage, "Today's Priority") ??
      extractManagerSectionContent(lastAssistantMessage, "Next Step");

    if (followUpTaskText) {
      return {
        reply: buildTaskHowToReply(followUpTaskText, useEnglish),
        messageType: "conversation",
        provider: "advisor",
        sharedContext: context.sharedContext,
        businessProfile: context.resolvedBusinessProfile,
      };
    }
  }

  if (isTaskClarificationFollowUp(normalizedLatestUserMessage)) {
    const useEnglish = shouldReplyInEnglish(
      latestUserMessage,
      context.sharedContext.conversationLanguage,
      context.resolvedContext.preferredLanguage || preferredLanguageFromSettings
    );
    const followUpTaskText =
      currentTaskText ??
      extractManagerSectionContent(lastAssistantMessage, "Today's Priority") ??
      extractManagerSectionContent(lastAssistantMessage, "Next Step");

    if (followUpTaskText) {
      return {
        reply: buildTaskClarificationReply({
          taskText: followUpTaskText,
          userMessage: latestUserMessage,
          useEnglish,
        }),
        messageType: "conversation",
        provider: "advisor",
        sharedContext: context.sharedContext,
        businessProfile: context.resolvedBusinessProfile,
      };
    }
  }

  if (stableFieldAnswer) {
    return {
      reply: stableFieldAnswer,
      messageType: "conversation",
      provider: "advisor",
      sharedContext: context.sharedContext,
      businessProfile: context.resolvedBusinessProfile,
    };
  }

  if (allowOnboardingFlow && profileState !== "ready" && missingImportantFields.length > 0) {
    const onboardingLanguageIsEnglish = shouldReplyInEnglish(
      latestUserMessage,
      context.sharedContext.conversationLanguage,
      context.resolvedContext.preferredLanguage || preferredLanguageFromSettings
    );
    const directTodayFocusIntent = isTodayFocusIntent(normalizedLatestUserMessage);
    const confusionDuringOnboarding = isConfusion(normalizedLatestUserMessage);
    const lastAskedOnboardingField = getLastAskedOnboardingField(messages);

    if (
      lastAskedOnboardingField &&
      isOnboardingFieldMeaningQuestion(latestUserMessage, lastAskedOnboardingField)
    ) {
      return {
        reply: buildOnboardingFieldExplanation(
          lastAskedOnboardingField,
          onboardingLanguageIsEnglish
        ),
        messageType: "conversation",
        provider: "advisor",
        sharedContext: context.sharedContext,
        businessProfile: context.resolvedBusinessProfile,
      };
    }

    if (directTodayFocusIntent) {
      const businessTypeKnown = hasAnsweredBusinessType(
        context,
        getConversationFingerprint(messages)
      );
      if (!businessTypeKnown) {
        return {
          reply: buildBusinessTypeClarificationQuestion(onboardingLanguageIsEnglish),
          messageType: "conversation",
          provider: "advisor",
          sharedContext: context.sharedContext,
          businessProfile: context.resolvedBusinessProfile,
        };
      }
      return {
        reply: normalizeManagerReply(buildAssumptionLeadManagerReply(context)),
        messageType: "business_strategy",
        provider: "advisor",
        sharedContext: context.sharedContext,
        businessProfile: context.resolvedBusinessProfile,
      };
    }

    // If user is clearly reporting a business problem, prioritize direct execution guidance
    // over onboarding/generic momentum templates.
    if (businessProblemIntent || shouldForceAssumptionDecision(latestUserMessage)) {
      const businessTypeKnown = hasAnsweredBusinessType(
        context,
        getConversationFingerprint(messages)
      );
      if (!businessTypeKnown) {
        return {
          reply: buildBusinessTypeClarificationQuestion(onboardingLanguageIsEnglish),
          messageType: "conversation",
          provider: "advisor",
          sharedContext: context.sharedContext,
          businessProfile: context.resolvedBusinessProfile,
        };
      }
      return {
        reply: normalizeManagerReply(buildAssumptionLeadManagerReply(context)),
        messageType: "business_strategy",
        provider: "advisor",
        sharedContext: context.sharedContext,
        businessProfile: context.resolvedBusinessProfile,
      };
    }

    if (skipOnboardingNow) {
      return {
        reply:
          "Thik hai. Abhi jo info hai uske base par kaam start karte hain. Baad me profile complete kar lenge.",
        messageType: "conversation",
        provider: "advisor",
        sharedContext: context.sharedContext,
        businessProfile: context.resolvedBusinessProfile,
      };
    }

    if (!shouldExitOnboarding) {
      const preferredNextField =
        profileState === "partial"
          ? pickRelevantMissingField(normalizedLatestUserMessage, missingImportantFields) ??
            pickNextOnboardingField(missingImportantFields)
          : pickNextOnboardingField(missingImportantFields);
      const candidateFields = [
        preferredNextField,
        ...missingImportantFields.filter((field) => field !== preferredNextField),
      ].filter((field): field is BusinessProfileField => Boolean(field));
      const nextField = candidateFields.find((field) => {
        if (answeredFields[field]) return false;
        const askCount = getOnboardingAskCount(messages, field);
        if (askCount < 2) return true;
        return confusionDuringOnboarding && field === lastAskedOnboardingField;
      });

      if (nextField) {
        const askCount = getOnboardingAskCount(messages, nextField);
        const nextQuestion = buildOnboardingPromptForField(nextField);

        if (confusionDuringOnboarding) {
          return {
            reply: buildOnboardingClarifier(nextField, onboardingLanguageIsEnglish),
            messageType: "conversation",
            provider: "advisor",
            sharedContext: context.sharedContext,
            businessProfile: context.resolvedBusinessProfile,
          };
        }

        const repeatQuestion =
          askCount >= 1
            ? onboardingLanguageIsEnglish
              ? `Just one quick detail: ${nextQuestion}`
              : `Bas ek choti detail: ${nextQuestion}`
            : nextQuestion;
        const onboardingLead =
          onboardingLanguageIsEnglish
            ? "Alright. Let me understand your business quickly, then I will give a better decision."
            : "Thik hai. Pehle aapke business ko properly samajh lete hain, phir main aapko better decision de paunga.";
        const reply =
          hasFreshProfileUpdate || profileState === "partial"
            ? repeatQuestion
            : `${onboardingLead}\n\n${repeatQuestion}`;

        return {
          reply,
          messageType: "conversation",
          provider: "advisor",
          sharedContext: context.sharedContext,
          businessProfile: context.resolvedBusinessProfile,
        };
      }

      // If every pending field already had 2 attempts, avoid loops and continue with available info.
      return {
        reply:
          "Thik hai. Abhi jo info hai uske base par kaam start karte hain. Baad me profile complete kar lenge.",
        messageType: "conversation",
        provider: "advisor",
        sharedContext: context.sharedContext,
        businessProfile: context.resolvedBusinessProfile,
      };
    }

    if (minimumDecisionContextReady || forceManagerModeByLimit) {
      const businessTypeKnown = hasAnsweredBusinessType(
        context,
        getConversationFingerprint(messages)
      );
      if (!businessTypeKnown) {
        return {
          reply: buildBusinessTypeClarificationQuestion(onboardingLanguageIsEnglish),
          messageType: "conversation",
          provider: "advisor",
          sharedContext: context.sharedContext,
          businessProfile: context.resolvedBusinessProfile,
        };
      }
      return {
        reply: buildFastManagerDecisionReply(context),
        messageType: "business_strategy",
        provider: "advisor",
        sharedContext: context.sharedContext,
        businessProfile: context.resolvedBusinessProfile,
      };
    }
  }

  if (routeMode === "chat") {
    const reply = await runChatProvider({
      messages,
      contextSummary: providerContextSummary,
    });

    return {
      reply,
      messageType: "conversation",
      provider: "chat",
      sharedContext: context.sharedContext,
      businessProfile: context.resolvedBusinessProfile,
    };
  }

  const responseMode = detectResponseMode(latestUserMessage, {
    previousMessageType,
  });
  const confusionSignalDetected = isConfusion(normalizedLatestUserMessage);
  const clarificationQuestionCount = getClarificationQuestionCount(messages);
  const clarificationCapReached = clarificationQuestionCount >= 2;
  const forceDecisionByUserSignal = shouldForceAssumptionDecision(latestUserMessage);
  const actionableTypes = detectedTypes.filter(
    (type): type is Exclude<MessageType, "conversation"> => type !== "conversation"
  );
  const businessContextActive = isBusinessContextActive(
    latestUserMessage,
    messageType,
    actionableTypes,
    context,
    previousMessageType
  );
  const businessTypeKnown = hasAnsweredBusinessType(
    context,
    getConversationFingerprint(messages)
  );
  const requiresBusinessTypeBeforeManager =
    businessContextActive &&
    (messageType === "business_strategy" || messageType === "seasonal_strategy") &&
    !businessTypeKnown;
  const shouldClarify =
    businessContextActive &&
    !clarificationCapReached &&
    !forceDecisionByUserSignal &&
    (responseMode === "clarification" || isVagueBusinessMessage(latestUserMessage)) &&
    !isEverythingFineMessage(normalizedLatestUserMessage) &&
    !hasEnoughBusinessClarity({
      latestUserMessage,
      messageType,
      context,
      messages,
    });

  if (responseMode === "greeting" || isGreetingMessage(latestUserMessage)) {
    return {
      reply: buildNormalChatReply(
        latestUserMessage,
        context.sharedContext.conversationLanguage,
        context.resolvedContext.preferredLanguage || preferredLanguageFromSettings
      ),
      messageType: "conversation",
      provider: "advisor",
      sharedContext: context.sharedContext,
      businessProfile: context.resolvedBusinessProfile,
    };
  }

  if (isIdentityQuestion(normalizedLatestUserMessage)) {
    return {
      reply: buildNormalChatReply(
        latestUserMessage,
        context.sharedContext.conversationLanguage,
        context.resolvedContext.preferredLanguage || preferredLanguageFromSettings
      ),
      messageType: "conversation",
      provider: "advisor",
      sharedContext: context.sharedContext,
      businessProfile: context.resolvedBusinessProfile,
    };
  }

  if (isEverythingFineMessage(normalizedLatestUserMessage)) {
    return {
      reply: buildGrowthModeReply({
        context,
        messages,
      }),
      messageType: "conversation",
      provider: "advisor",
      sharedContext: context.sharedContext,
      businessProfile: context.resolvedBusinessProfile,
    };
  }

  if (requiresBusinessTypeBeforeManager) {
    return {
      reply: buildBusinessTypeClarificationQuestion(useEnglishForLatestMessage),
      messageType: "conversation",
      provider: "advisor",
      sharedContext: context.sharedContext,
      businessProfile: context.resolvedBusinessProfile,
    };
  }

  const latestResultSnapshot = extractTaskResultSnapshot(latestUserMessage);
  const canUseHistoricalResult = askedTaskResultQuestion(lastAssistantMessage);
  const lastResult: TaskResultSnapshot | null =
    latestResultSnapshot ??
    (canUseHistoricalResult ? getLastTaskResult(messages) : null);

  if (inferredTaskState?.status === "done") {
    const progressionReply = buildTaskProgressionReply({
      context,
      currentTaskText: inferredTaskState.description,
      resultSnapshot: lastResult,
    });
    return {
      reply: normalizeManagerReply(
        ensureNonRepeatingReply(progressionReply, lastAssistantMessage, context)
      ),
      messageType: "business_strategy",
      provider: "advisor",
      sharedContext: context.sharedContext,
      businessProfile: context.resolvedBusinessProfile,
    };
  }

  if (!businessContextActive && messageType === "conversation") {
    return {
      reply: buildNormalChatReply(
        latestUserMessage,
        context.sharedContext.conversationLanguage,
        context.resolvedContext.preferredLanguage || preferredLanguageFromSettings
      ),
      messageType: "conversation",
      provider: "advisor",
      sharedContext: context.sharedContext,
      businessProfile: context.resolvedBusinessProfile,
    };
  }

  if (currentTaskText && confusionSignalDetected) {
    return {
      reply: simplifyTask(currentTaskText),
      messageType: "conversation",
      provider: "advisor",
      sharedContext: context.sharedContext,
      businessProfile: context.resolvedBusinessProfile,
    };
  }

  if (businessContextActive && (forceDecisionByUserSignal || clarificationCapReached)) {
    return {
      reply: normalizeManagerReply(buildAssumptionLeadManagerReply(context)),
      messageType: "business_strategy",
      provider: "advisor",
      sharedContext: context.sharedContext,
      businessProfile: context.resolvedBusinessProfile,
    };
  }

  if (businessContextActive && isFrustratedOrStuckMessage(normalizedLatestUserMessage)) {
    return {
      reply: normalizeManagerReply(buildFrustrationLeadManagerReply(context)),
      messageType: "business_strategy",
      provider: "advisor",
      sharedContext: context.sharedContext,
      businessProfile: context.resolvedBusinessProfile,
    };
  }

  if (businessContextActive && confusionSignalDetected) {
    return {
      reply: buildConfusionGuidanceReply({ context, sharedTaskState }),
      messageType: "conversation",
      provider: "advisor",
      sharedContext: context.sharedContext,
      businessProfile: context.resolvedBusinessProfile,
    };
  }

  if (shouldClarify) {
    return {
      reply: buildClarificationReply({
        latestUserMessage,
        context,
        messages,
        sharedTaskState,
      }),
      messageType: "conversation",
      provider: "advisor",
      sharedContext: context.sharedContext,
      businessProfile: context.resolvedBusinessProfile,
    };
  }

  if (actionableTypes.length > 1) {
    console.log("[aiRouter] Multi-intent message detected.", {
      detectedTypes: actionableTypes,
    });
    const unifiedReply = await runUnifiedManagerReply({
      messages,
      latestUserMessage,
      contextSummary: providerContextSummary,
      contextPrompt: context.promptBlock,
      isFollowUp: context.isFollowUp,
      actionableTypes,
    });

    return {
      reply: normalizeManagerReply(unifiedReply.reply),
      messageType,
      provider: unifiedReply.provider,
      sharedContext: context.sharedContext,
      businessProfile: context.resolvedBusinessProfile,
    };
  }

  // Pricing, margin, and discount questions should always go to reasoning.
  if (messageType === "calculation") {
    console.log("[aiRouter] DeepSeek selected for calculation reasoning.");

    const section = await runSingleIntentSection({
      messages,
      latestUserMessage,
      contextSummary: providerContextSummary,
      contextPrompt: context.promptBlock,
      isFollowUp: context.isFollowUp,
      messageType,
    });

    return {
      reply: normalizeManagerReply(section.reply),
      messageType,
      provider: section.provider,
      sharedContext: context.sharedContext,
      businessProfile: context.resolvedBusinessProfile,
    };
  }

  // Content mode is only for explicit writing/generation requests.
  if (messageType === "marketing_content") {
    const section = await runSingleIntentSection({
      messages,
      latestUserMessage,
      contextSummary: providerContextSummary,
      contextPrompt: context.promptBlock,
      isFollowUp: context.isFollowUp,
      messageType,
    });

    return {
      reply: normalizeManagerReply(section.reply),
      messageType,
      provider: section.provider,
      sharedContext: context.sharedContext,
      businessProfile: context.resolvedBusinessProfile,
    };
  }

  // Conversation, business strategy, and seasonal strategy all use
  // the main advisor path with different prompting.
  if (messageType === "business_strategy" || messageType === "seasonal_strategy") {
    const section = await runSingleIntentSection({
      messages,
      latestUserMessage,
      contextSummary: providerContextSummary,
      contextPrompt: context.promptBlock,
      isFollowUp: context.isFollowUp,
      messageType,
    });

    return {
      reply: normalizeManagerReply(section.reply),
      messageType,
      provider: section.provider,
      sharedContext: context.sharedContext,
      businessProfile: context.resolvedBusinessProfile,
    };
  }

  if (businessContextActive && messageType === "conversation") {
    const section = await runSingleIntentSection({
      messages,
      latestUserMessage,
      contextSummary: providerContextSummary,
      contextPrompt: context.promptBlock,
      isFollowUp: context.isFollowUp,
      messageType: "business_strategy",
    });

    return {
      reply: normalizeManagerReply(section.reply),
      messageType: "business_strategy",
      provider: section.provider,
      sharedContext: context.sharedContext,
      businessProfile: context.resolvedBusinessProfile,
    };
  }

  const reply = await runAdvisorProvider({
    messages,
    messageType,
    contextSummary: providerContextSummary,
    isFollowUp: context.isFollowUp,
  });

  return {
    reply: normalizeManagerReply(reply),
    messageType,
    provider: "advisor",
    sharedContext: context.sharedContext,
    businessProfile: context.resolvedBusinessProfile,
  };
}
