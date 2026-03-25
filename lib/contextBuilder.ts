import type { MessageType } from "./classifyMessage";
import {
  EMPTY_BUSINESS_PROFILE,
  getCriticalMissingProfileFields,
  getMissingProfileFields,
  normalizeBusinessProfile,
  type BusinessProfile,
} from "./businessProfile";
import {
  EMPTY_SHARED_BUSINESS_CONTEXT,
  type SharedBusinessContext,
} from "./sharedContext";

type ContextMessage = {
  role: "user" | "assistant";
  content: string;
};

type Rule = {
  label: string;
  keywords: string[];
};

const TEXT_NORMALIZATIONS: Array<[RegExp, string]> = [
  [/\bresturent\b/g, "restaurant"],
  [/\brestaurent\b/g, "restaurant"],
  [/\brestro\b/g, "restaurant"],
  [/\bproblam\b/g, "problem"],
  [/\bprobleam\b/g, "problem"],
  [/\bcustmer\b/g, "customer"],
  [/\bcoustomer\b/g, "customer"],
  [/\bmarkting\b/g, "marketing"],
  [/\bopration\b/g, "operation"],
  [/\bdine in\b/g, "dine-in"],
];

const BUSINESS_TYPE_RULES: Rule[] = [
  { label: "Kirana / Grocery Shop", keywords: ["kirana", "grocery", "general store"] },
  { label: "Clothing Shop", keywords: ["clothes", "garment", "boutique", "fashion"] },
  { label: "Cosmetics Shop", keywords: ["cosmetic", "beauty", "makeup"] },
  { label: "Mobile Shop", keywords: ["mobile", "phone", "accessories"] },
  { label: "Bakery / Sweets Shop", keywords: ["bakery", "cake", "sweet", "mithai"] },
  { label: "Restaurant", keywords: ["restaurant", "cafe", "food business", "eatery"] },
  {
    label: "Automation Agency",
    keywords: ["automation agency", "ai agency", "agency", "automation services"],
  },
  {
    label: "Consulting Business",
    keywords: ["consulting", "consultant", "advisory", "service business"],
  },
  { label: "Recruitment Agency", keywords: ["recruitment", "staffing", "hiring agency"] },
  { label: "Law Firm", keywords: ["law firm", "legal service", "lawyer"] },
  {
    label: "Real Estate Business",
    keywords: ["real estate", "property consultant", "brokerage"],
  },
  { label: "Clinic / Med Spa", keywords: ["clinic", "med spa", "doctor", "dental clinic"] },
];

const PROBLEM_TYPE_RULES: Rule[] = [
  { label: "Sales", keywords: ["sales", "sale", "revenue"] },
  { label: "Trust", keywords: ["trust", "bharosa", "confidence"] },
  { label: "Customer", keywords: ["customer", "customers", "footfall", "walk-in"] },
  { label: "Marketing", keywords: ["marketing", "ads", "promotion", "campaign"] },
  { label: "Operations", keywords: ["operations", "operation", "staff", "process", "delivery"] },
  { label: "Margin", keywords: ["margin", "profit", "pricing", "discount"] },
  { label: "Lead Generation", keywords: ["lead", "leads", "inquiry", "enquiry"] },
];

const CUSTOMER_ISSUE_RULES: Rule[] = [
  { label: "Acquisition", keywords: ["new customers", "customer acquisition", "footfall", "walk-in"] },
  { label: "Trust", keywords: ["trust", "bharosa", "confidence"] },
  { label: "Conversion", keywords: ["conversion", "closing", "close rate"] },
  { label: "Retention", keywords: ["repeat", "retention", "return customer"] },
  { label: "Online Orders", keywords: ["online orders", "zomato", "swiggy"] },
  { label: "Dine-in", keywords: ["dine-in", "table bookings", "walk-in dining"] },
];

const BUSINESS_IMPACT_RULES: Rule[] = [
  { label: "Revenue down", keywords: ["revenue down", "sales down", "income down"] },
  { label: "Footfall down", keywords: ["footfall down", "customer nahi aa rahe", "walk-in kam"] },
  { label: "Orders down", keywords: ["orders down", "online orders kam", "order kam"] },
  { label: "Margin down", keywords: ["margin kam", "profit kam", "loss ho raha"] },
];

const BEGINNER_SIGNAL_RULES: Rule[] = [
  { label: "Beginner", keywords: ["main naya hun", "main naya hu", "beginner", "new hun"] },
  { label: "Beginner", keywords: ["naya business", "first business", "abhi start kiya"] },
];

const LOW_CONFIDENCE_SIGNAL_RULES: Rule[] = [
  { label: "Low", keywords: ["mujhe nahi pata", "mujhse nahi hoga", "confidence nahi hai"] },
  { label: "Low", keywords: ["tum hi batao", "aap hi batao", "step by step karo"] },
  { label: "Low", keywords: ["mujhe kaise pata hoga", "confused", "samajh nahi aa raha"] },
];

const BUDGET_CONSTRAINT_RULES: Rule[] = [
  { label: "Low", keywords: ["low budget", "budget kam", "kam budget", "cheap"] },
  { label: "Medium", keywords: ["medium budget", "thoda budget", "normal budget"] },
  { label: "High", keywords: ["high budget", "budget theek hai", "large budget"] },
];

const KEYWORD_RULES = [
  "sales",
  "trust",
  "customer",
  "customers",
  "marketing",
  "operations",
  "lead",
  "leads",
  "margin",
  "profit",
  "pricing",
  "repeat",
  "dine-in",
  "online orders",
  "delivery",
  "whatsapp",
  "linkedin",
];

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

function normalizeMessage(message: string): string {
  let normalized = message.toLowerCase().replace(/\s+/g, " ").trim();

  for (const [pattern, replacement] of TEXT_NORMALIZATIONS) {
    normalized = normalized.replace(pattern, replacement);
  }

  return normalized;
}

function includesKeyword(text: string, keyword: string): boolean {
  return text.includes(keyword);
}

function pickFirstMatch(text: string, rules: Rule[]): string | null {
  for (const rule of rules) {
    if (rule.keywords.some((keyword) => includesKeyword(text, keyword))) {
      return rule.label;
    }
  }

  return null;
}

function pickKeywords(text: string): string[] {
  return KEYWORD_RULES.filter((keyword) => includesKeyword(text, keyword)).slice(0, 6);
}

function shortText(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 3).trim()}...`;
}

function isShortFollowUpMessage(message: string): boolean {
  return normalizeMessage(message).split(" ").length <= 6;
}

function shouldReusePreviousGoal(message: string): boolean {
  const normalized = normalizeMessage(message);

  if (!normalized) {
    return true;
  }

  if (normalized.split(" ").length <= 3) {
    return true;
  }

  return ["ok", "okay", "haan", "hmm", "theek", "thik"].includes(normalized);
}

function getRecentUserMessages(messages: ContextMessage[]): string[] {
  return messages
    .filter((message) => message.role === "user")
    .slice(-8)
    .map((message) => normalizeMessage(message.content))
    .filter(Boolean);
}

function pickReferenceUserMessage(
  recentUserMessages: string[],
  latestUserMessage: string,
  isFollowUp: boolean
): string {
  const normalizedLatestMessage = normalizeMessage(latestUserMessage);

  if (!isFollowUp) {
    return normalizedLatestMessage;
  }

  for (let index = recentUserMessages.length - 1; index >= 0; index -= 1) {
    const currentMessage = recentUserMessages[index];

    if (!currentMessage || currentMessage === normalizedLatestMessage) {
      continue;
    }

    if (!isShortFollowUpMessage(currentMessage)) {
      return currentMessage;
    }
  }

  return normalizedLatestMessage;
}

function toTopicLabel(messageType: MessageType, latestUserMessage: string): string {
  switch (messageType) {
    case "seasonal_strategy":
      return "Seasonal sales strategy";
    case "business_strategy":
      return "Business growth strategy";
    case "calculation":
      return "Calculation or pricing";
    case "marketing_content":
      return "Marketing content creation";
    default:
      return latestUserMessage ? "General business conversation" : "New chat";
  }
}

function isMeaningfulField(value: string | null): boolean {
  return Boolean(value && value.trim());
}

function detectTurnLanguage(message: string): "english" | "hinglish" | null {
  const normalized = normalizeMessage(message);
  if (!normalized) return null;

  const lowSignalReplies = ["ok", "okay", "hmm", "thanks", "thank you"];
  if (lowSignalReplies.includes(normalized)) {
    return null;
  }

  const hasHinglishHint = HINGLISH_HINT_WORDS.some((word) =>
    new RegExp(`\\b${word}\\b`, "i").test(normalized)
  );
  return hasHinglishHint ? "hinglish" : "english";
}

export type ContextBuilderResult = {
  rawUserMessage: string;
  normalizedUserMessage: string;
  businessType: string | null;
  problemType: string | null;
  businessImpact: string | null;
  userExperienceLevel: string | null;
  confidenceLevel: string | null;
  customerIssue: string | null;
  budgetConstraint: string | null;
  businessEnvironment: string | null;
  keywords: string[];
  currentProblem: string | null;
  currentTopic: string;
  userGoal: string | null;
  missingFields: string[];
  missingProfileFields: Array<keyof BusinessProfile>;
  criticalMissingProfileFields: Array<keyof BusinessProfile>;
  isFollowUp: boolean;
  summary: string;
  promptBlock: string;
  sharedContext: SharedBusinessContext;
  resolvedBusinessProfile: BusinessProfile;
  resolvedContext: {
    ownerName: string | null;
    businessName: string | null;
    businessType: string | null;
    cityArea: string | null;
    preferredLanguage: string | null;
    customerType: string | null;
    priceRange: string | null;
    businessModel: string | null;
    teamSize: string | null;
    mainGoal: string | null;
    secondaryGoal: string | null;
    currentFocus: string | null;
    budgetLevel: string | null;
    keyConstraint1: string | null;
    keyConstraint2: string | null;
    notes: string | null;
  };
};

export type ConversationContext = ContextBuilderResult;

export function buildContextBuilder({
  messages,
  latestUserMessage,
  messageType,
  isFollowUp,
  sharedContext = EMPTY_SHARED_BUSINESS_CONTEXT,
  businessProfile = EMPTY_BUSINESS_PROFILE,
}: {
  messages: ContextMessage[];
  latestUserMessage: string;
  messageType: MessageType;
  isFollowUp: boolean;
  sharedContext?: SharedBusinessContext;
  businessProfile?: BusinessProfile;
}): ContextBuilderResult {
  const normalizedProfile = normalizeBusinessProfile(businessProfile);
  const recentUserMessages = getRecentUserMessages(messages);
  const joinedUserText = recentUserMessages.join(" ");
  const normalizedUserMessage = normalizeMessage(latestUserMessage);
  const referenceUserMessage = pickReferenceUserMessage(
    recentUserMessages,
    latestUserMessage,
    isFollowUp
  );

  const detectedBusinessType = pickFirstMatch(joinedUserText, BUSINESS_TYPE_RULES);
  const detectedProblemType = pickFirstMatch(joinedUserText, PROBLEM_TYPE_RULES);
  const detectedBusinessImpact = pickFirstMatch(joinedUserText, BUSINESS_IMPACT_RULES);
  const detectedUserExperienceLevel = pickFirstMatch(joinedUserText, BEGINNER_SIGNAL_RULES);
  const detectedConfidenceLevel = pickFirstMatch(joinedUserText, LOW_CONFIDENCE_SIGNAL_RULES);
  const detectedCustomerIssue = pickFirstMatch(joinedUserText, CUSTOMER_ISSUE_RULES);
  const detectedBudgetConstraint = pickFirstMatch(joinedUserText, BUDGET_CONSTRAINT_RULES);
  const businessType =
    normalizedProfile.businessType || sharedContext.businessType || detectedBusinessType;
  const problemType = detectedProblemType ?? sharedContext.problemType;
  const businessImpact = detectedBusinessImpact ?? sharedContext.businessImpact;
  const userExperienceLevel =
    normalizedProfile.businessStage ||
    sharedContext.userExperienceLevel ||
    detectedUserExperienceLevel;
  const confidenceLevel = detectedConfidenceLevel ?? sharedContext.confidenceLevel;
  const customerIssue = detectedCustomerIssue ?? sharedContext.customerIssue;
  const budgetConstraint =
    normalizedProfile.budgetLevel || sharedContext.budgetConstraint || detectedBudgetConstraint;
  const businessEnvironment =
    (businessType === "Restaurant"
      ? "Local consumer food business"
      : businessType === "Kirana / Grocery Shop" ||
          businessType === "Clothing Shop" ||
          businessType === "Cosmetics Shop" ||
          businessType === "Mobile Shop" ||
          businessType === "Bakery / Sweets Shop"
        ? "Local walk-in retail business"
        : businessType === "Automation Agency" ||
            businessType === "Consulting Business" ||
            businessType === "Recruitment Agency" ||
            businessType === "Law Firm" ||
            businessType === "Real Estate Business" ||
            businessType === "Clinic / Med Spa"
          ? "Service business"
          : null) ??
    sharedContext.businessEnvironment;
  const keywords = pickKeywords(joinedUserText);
  const currentProblem =
    (referenceUserMessage ? shortText(referenceUserMessage, 140) : null) ??
    sharedContext.currentProblem;
  const fallbackUserGoal =
    latestUserMessage && !shouldReusePreviousGoal(latestUserMessage)
      ? shortText(latestUserMessage.trim(), 140)
      : null;
  const userGoal = normalizedProfile.mainGoal || sharedContext.userGoal || fallbackUserGoal;
  const detectedTurnLanguage = detectTurnLanguage(latestUserMessage);
  const preferredLanguageText = normalizedProfile.preferredLanguage.toLowerCase();
  const preferredLanguageFallback =
    preferredLanguageText.includes("english")
      ? "english"
      : preferredLanguageText.includes("hinglish") || preferredLanguageText.includes("hindi")
        ? "hinglish"
        : null;
  const conversationLanguage =
    detectedTurnLanguage ??
    sharedContext.conversationLanguage ??
    preferredLanguageFallback;
  const currentTopic = toTopicLabel(messageType, latestUserMessage);
  const nextSharedContext: SharedBusinessContext = {
    businessType,
    problemType,
    businessImpact,
    userExperienceLevel,
    confidenceLevel,
    customerIssue,
    budgetConstraint,
    businessEnvironment,
    currentProblem,
    userGoal,
    conversationLanguage,
  };
  const resolvedContext = {
    ownerName: normalizedProfile.ownerName || null,
    businessName: normalizedProfile.businessName || null,
    businessType: normalizedProfile.businessType || sharedContext.businessType || detectedBusinessType,
    cityArea: normalizedProfile.cityArea || null,
    preferredLanguage: normalizedProfile.preferredLanguage || null,
    customerType: normalizedProfile.customerType || null,
    priceRange: normalizedProfile.priceRange || null,
    businessModel: normalizedProfile.businessModel || null,
    teamSize: normalizedProfile.teamSize || null,
    mainGoal: normalizedProfile.mainGoal || sharedContext.userGoal || fallbackUserGoal,
    secondaryGoal: normalizedProfile.secondaryGoal || null,
    currentFocus: normalizedProfile.currentFocus || null,
    budgetLevel:
      normalizedProfile.budgetLevel || sharedContext.budgetConstraint || detectedBudgetConstraint,
    keyConstraint1: normalizedProfile.keyConstraint1 || null,
    keyConstraint2: normalizedProfile.keyConstraint2 || null,
    notes: normalizedProfile.notes || null,
  };
  const missingFields = [
    !isMeaningfulField(businessType) ? "Business Type" : null,
    !isMeaningfulField(problemType) ? "Problem Type" : null,
    !isMeaningfulField(businessImpact) ? "Business Impact" : null,
    !isMeaningfulField(userExperienceLevel) ? "User Experience" : null,
    !isMeaningfulField(confidenceLevel) ? "User Confidence" : null,
    !isMeaningfulField(customerIssue) ? "Customer Issue" : null,
    !isMeaningfulField(budgetConstraint) ? "Budget Constraint" : null,
  ].filter((field): field is string => Boolean(field));
  const missingProfileFields = getMissingProfileFields(normalizedProfile);
  const criticalMissingProfileFields = getCriticalMissingProfileFields(normalizedProfile);

  const promptLines = [
    "Structured Context",
    `Raw User Message: ${latestUserMessage || "not provided"}`,
    `Normalized User Message: ${normalizedUserMessage || "not provided"}`,
    `Business Type: ${businessType ?? "Not clear yet"}`,
    `Problem Type: ${problemType ?? "Not clear yet"}`,
    `Business Impact: ${businessImpact ?? "Not clear yet"}`,
    `User Experience: ${userExperienceLevel ?? "Not clear yet"}`,
    `User Confidence: ${confidenceLevel ?? "Not clear yet"}`,
    `Customer Issue: ${customerIssue ?? "Not clear yet"}`,
    `Budget: ${budgetConstraint ?? "Not clear yet"}`,
    `Business Environment: ${businessEnvironment ?? "Not clear yet"}`,
    `Keywords: ${keywords.length > 0 ? keywords.join(", ") : "Not detected yet"}`,
    `Current Problem: ${currentProblem ?? "Not clear yet"}`,
    `Current Topic: ${currentTopic}`,
    `User Goal: ${userGoal ?? "Not clear yet"}`,
    `Conversation Language: ${conversationLanguage ?? "Not clear yet"}`,
    `Owner Name: ${normalizedProfile.ownerName || "Not set"}`,
    `Business Name: ${normalizedProfile.businessName || "Not set"}`,
    `City / Area: ${normalizedProfile.cityArea || "Not set"}`,
    `Preferred Language: ${normalizedProfile.preferredLanguage || "Not set"}`,
    `Customer Type: ${normalizedProfile.customerType || "Not set"}`,
    `Price Range: ${normalizedProfile.priceRange || "Not set"}`,
    `Business Model: ${normalizedProfile.businessModel || "Not set"}`,
    `Team Size: ${normalizedProfile.teamSize || "Not set"}`,
    `Secondary Goal: ${normalizedProfile.secondaryGoal || "Not set"}`,
    `Current Focus: ${normalizedProfile.currentFocus || "Not set"}`,
    `Key Constraint 1: ${normalizedProfile.keyConstraint1 || "Not set"}`,
    `Key Constraint 2: ${normalizedProfile.keyConstraint2 || "Not set"}`,
    `Notes: ${normalizedProfile.notes || "Not set"}`,
    `Missing Profile Fields: ${
      missingProfileFields.length > 0 ? missingProfileFields.join(", ") : "none"
    }`,
    `Missing Context: ${missingFields.length > 0 ? missingFields.join(", ") : "Enough context available"}`,
    isFollowUp ? "Conversation Note: User is asking a follow-up" : "Conversation Note: Fresh request",
    `Confirmed Facts: ${[
      businessType ? `businessType=${businessType}` : null,
      problemType ? `coreProblem=${problemType}` : null,
      businessImpact ? `businessImpact=${businessImpact}` : null,
      userExperienceLevel ? `userExperience=${userExperienceLevel}` : null,
      confidenceLevel ? `confidence=${confidenceLevel}` : null,
    ]
      .filter(Boolean)
      .join(", ") || "none yet"}`,
  ];

  return {
    rawUserMessage: latestUserMessage,
    normalizedUserMessage,
    businessType,
    problemType,
    businessImpact,
    userExperienceLevel,
    confidenceLevel,
    customerIssue,
    budgetConstraint,
    businessEnvironment,
    keywords,
    currentProblem,
    currentTopic,
    userGoal,
    missingFields,
    missingProfileFields,
    criticalMissingProfileFields,
    isFollowUp,
    summary: promptLines.join("\n"),
    promptBlock: promptLines.join("\n"),
    sharedContext: nextSharedContext,
    resolvedBusinessProfile: normalizedProfile,
    resolvedContext,
  };
}

export function buildConversationContext(args: {
  messages: ContextMessage[];
  latestUserMessage: string;
  messageType: MessageType;
  isFollowUp: boolean;
  sharedContext?: SharedBusinessContext;
  businessProfile?: BusinessProfile;
}): ConversationContext {
  return buildContextBuilder(args);
}
