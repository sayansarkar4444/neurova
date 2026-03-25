// This file keeps message classification simple and editable.
// The goal is not perfect NLP. The goal is predictable routing for common
// business, seasonal, calculation, and content requests.

export type MessageType =
  | "conversation"
  | "business_strategy"
  | "seasonal_strategy"
  | "calculation"
  | "marketing_content";

export type ResponseMode = "greeting" | "clarification" | "manager";

type ClassifyMessageOptions = {
  previousMessageType?: MessageType | null;
};

const TYPO_NORMALIZATIONS: Array<[RegExp, string]> = [
  [/\bsalce\b/g, "sales"],
  [/\bseles\b/g, "sales"],
  [/\bslaes\b/g, "sales"],
  [/\bproblame\b/g, "problem"],
  [/\bproblm\b/g, "problem"],
  [/\bproblam\b/g, "problem"],
  [/\bddown\b/g, "down"],
  [/\bcoustomer\b/g, "customer"],
  [/\bcustmer\b/g, "customer"],
];

const CALCULATION_KEYWORDS = [
  "profit",
  "margin",
  "discount",
  "calculate",
  "calculation",
  "price",
  "pricing",
  "cost",
  "rate",
  "revenue",
  "loss",
  "percentage",
  "percent",
  "roi",
  "gp",
  "sp",
  "cp",
];

const SEASONAL_STRATEGY_KEYWORDS = [
  "wedding season",
  "festival season",
  "offer strategy",
  "profit strategy",
  "season",
  "seasonal",
  "bulk order",
  "bulk orders",
  "bulk",
  "demand",
  "festive",
  "shaadi",
  "shadi",
  "tyohar",
  "diwali",
  "eid",
  "holi",
  "rakhi",
  "navratri",
  "wedding",
];

const BUSINESS_STRATEGY_KEYWORDS = [
  "sales",
  "sale",
  "customer",
  "customers",
  "customer attraction",
  "business",
  "strategy",
  "growth",
  "plan",
  "store",
  "shop",
  "compete",
  "competition",
  "retention",
  "order",
  "orders",
  "attract",
  "footfall",
  "lead",
  "leads",
  "wholesale",
  "upsell",
  "bundle",
  "offer",
  "offers",
  "offer strategy",
  "profit strategy",
  "service business",
  "service businesses",
  "agency",
  "automation agency",
  "ai agency",
  "consulting",
  "consultant",
  "recruitment",
  "law firm",
  "real estate",
  "clinic",
  "med spa",
  "client acquisition",
  "outreach",
  "cold email",
  "linkedin outreach",
  "partnership",
  "saas partnerships",
  "case study",
  "upwork",
  "fiverr",
  "youtube tutorials",
];

const CASUAL_CONVERSATION_KEYWORDS = [
  "hi",
  "hello",
  "hey",
  "hii",
  "namaste",
  "good morning",
  "good afternoon",
  "good evening",
  "kaise ho",
  "how are you",
  "thanks",
  "thank you",
  "ok",
  "okay",
];

const VAGUE_BUSINESS_PHRASES = [
  "business slow hai",
  "business slow chal raha hai",
  "problem hai",
  "kya karun",
  "kya karu",
  "kya karna chahiye",
  "help chahiye",
  "samajh nahi aa raha",
  "samjh nahi aa raha",
  "issue hai",
  "kuch problem hai",
  "sales down hai",
  "slow chal raha hai",
];

const BUSINESS_PROBLEM_KEYWORDS = [
  "sales",
  "customer",
  "customers",
  "business",
  "problem",
  "issue",
  "trust",
  "margin",
  "profit",
  "revenue",
  "growth",
  "lead",
  "leads",
  "competitor",
  "competition",
  "footfall",
  "orders",
];

const BUSINESS_PAIN_PHRASES = [
  "down ho raha hai",
  "down ho gaya",
  "kam ho gaya",
  "kam ho rahi",
  "nahi aa rahe",
  "nahi aa raha",
  "slow hai",
  "issue hai",
  "problem hai",
  "trust issue",
  "margin kam",
  "growth nahi ho rahi",
  "competitor aa gaya",
  "loss ho raha",
  "drop ho raha",
];

const BUSINESS_FIX_INTENT_PHRASES = [
  "fix karna hai",
  "fix karo",
  "isse fix",
  "solve karo",
  "solve karna hai",
  "kaise fix",
  "mujhe fix karna hai",
  "sahi karo",
  "theek karo",
];

// Content mode should only trigger when the user clearly asks us to produce text.
const CONTENT_FORMAT_KEYWORDS = [
  "poster",
  "poster text",
  "ad",
  "caption",
  "banner text",
  "message writing",
  "script",
];

const CONTENT_ACTION_KEYWORDS = [
  "write",
  "create",
  "make",
  "generate",
  "give me",
  "send",
  "draft",
  "banao",
  "banado",
  "bana do",
  "likho",
  "likh do",
  "likhdo",
  "de do",
];

const FOLLOW_UP_PHRASES = [
  "matlab",
  "kaise",
  "samjhao",
  "samjha",
  "phir",
  "phir kya karun",
  "phir kya karu",
  "ab kya karun",
  "ab kya karu",
  "fir",
  "aur batao",
  "detail me",
  "detail mein",
  "step by step",
  "example do",
  "short me",
  "aur",
];

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeMessage(message: string): string {
  let normalized = message
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

  for (const [pattern, replacement] of TYPO_NORMALIZATIONS) {
    normalized = normalized.replace(pattern, replacement);
  }

  return normalized;
}

function includesKeyword(message: string, keyword: string): boolean {
  const pattern = new RegExp(`(^|\\b)${escapeRegex(keyword)}(\\b|$)`, "i");
  return pattern.test(message);
}

function includesAnyKeyword(message: string, keywords: string[]): boolean {
  return keywords.some((keyword) => includesKeyword(message, keyword));
}

function looksLikeMathQuestion(message: string): boolean {
  const hasNumber = /\d/.test(message);
  const hasMathHint = /[%+\-/*=]/.test(message);

  return hasNumber && hasMathHint;
}

function isCasualConversation(message: string): boolean {
  return includesAnyKeyword(message, CASUAL_CONVERSATION_KEYWORDS);
}

export function isBusinessProblemIntent(message: string): boolean {
  const normalizedMessage = normalizeMessage(message);

  if (!normalizedMessage) {
    return false;
  }

  const hasBusinessKeyword = includesAnyKeyword(normalizedMessage, BUSINESS_PROBLEM_KEYWORDS);
  const hasPainPhrase = BUSINESS_PAIN_PHRASES.some((phrase) =>
    includesKeyword(normalizedMessage, phrase)
  );
  const hasFixIntent = BUSINESS_FIX_INTENT_PHRASES.some((phrase) =>
    includesKeyword(normalizedMessage, phrase)
  );
  const hasNegativeSignal =
    includesAnyKeyword(normalizedMessage, ["down", "drop", "kam", "slow", "loss"]) ||
    /nahi\s+(aa|ho)/i.test(normalizedMessage);

  if (hasPainPhrase && hasBusinessKeyword) {
    return true;
  }

  if (
    hasFixIntent &&
    (hasBusinessKeyword || includesAnyKeyword(normalizedMessage, ["issue", "problem"]))
  ) {
    return true;
  }

  return hasBusinessKeyword && hasNegativeSignal;
}

export function isGreetingMessage(message: string): boolean {
  const normalizedMessage = normalizeMessage(message);

  if (!normalizedMessage) {
    return false;
  }

  if (normalizedMessage.split(" ").length > 4) {
    return false;
  }

  return isCasualConversation(normalizedMessage);
}

export function isVagueBusinessMessage(message: string): boolean {
  const normalizedMessage = normalizeMessage(message);

  if (!normalizedMessage) {
    return false;
  }

  if (VAGUE_BUSINESS_PHRASES.some((phrase) => includesKeyword(normalizedMessage, phrase))) {
    return true;
  }

  if (isBusinessProblemIntent(normalizedMessage) && normalizedMessage.split(" ").length <= 8) {
    return true;
  }

  const wordCount = normalizedMessage.split(" ").length;
  const hasBusinessHint =
    includesAnyKeyword(normalizedMessage, BUSINESS_STRATEGY_KEYWORDS) ||
    includesAnyKeyword(normalizedMessage, ["business", "sales", "customer", "problem"]);

  if (!hasBusinessHint) {
    return false;
  }

  const looksIncomplete =
    wordCount <= 4 ||
    /^(kya|kaise|kyun|problem|issue|business|sales)\b/i.test(normalizedMessage);

  return looksIncomplete;
}

export function detectResponseMode(
  message: string,
  options: ClassifyMessageOptions = {}
): ResponseMode {
  const normalizedMessage = normalizeMessage(message);

  if (!normalizedMessage) {
    return "clarification";
  }

  if (isGreetingMessage(normalizedMessage)) {
    return "greeting";
  }

  const businessProblemIntent = isBusinessProblemIntent(normalizedMessage);

  if (
    options.previousMessageType &&
    options.previousMessageType !== "conversation" &&
    isFollowUpMessage(normalizedMessage)
  ) {
    return "manager";
  }

  if (businessProblemIntent && !isVagueBusinessMessage(normalizedMessage)) {
    return "manager";
  }

  if (isVagueBusinessMessage(normalizedMessage)) {
    return "clarification";
  }

  const detectedTypes = detectMessageTypes(normalizedMessage, options);

  if (detectedTypes.some((type) => type !== "conversation")) {
    return "manager";
  }

  return "clarification";
}

export function isFollowUpMessage(message: string): boolean {
  const normalizedMessage = normalizeMessage(message);

  if (!normalizedMessage) {
    return false;
  }

  // Follow-up continuity is only for short clarifying replies.
  // Bigger questions should be classified on their own.
  if (normalizedMessage.split(" ").length > 6) {
    return false;
  }

  return FOLLOW_UP_PHRASES.some((phrase) => includesKeyword(normalizedMessage, phrase));
}

function isExplicitContentRequest(message: string): boolean {
  const asksForContentFormat = includesAnyKeyword(message, CONTENT_FORMAT_KEYWORDS);
  const asksForContentAction = includesAnyKeyword(message, CONTENT_ACTION_KEYWORDS);

  return asksForContentFormat && asksForContentAction;
}

export function detectMessageTypes(
  message: string,
  options: ClassifyMessageOptions = {}
): MessageType[] {
  const normalizedMessage = normalizeMessage(message);

  if (!normalizedMessage) {
    return ["conversation"];
  }

  if (
    options.previousMessageType &&
    options.previousMessageType !== "conversation" &&
    isFollowUpMessage(normalizedMessage)
  ) {
    return [options.previousMessageType];
  }

  const detectedTypes: MessageType[] = [];

  if (
    includesAnyKeyword(normalizedMessage, CALCULATION_KEYWORDS) ||
    looksLikeMathQuestion(normalizedMessage)
  ) {
    detectedTypes.push("calculation");
  }

  if (includesAnyKeyword(normalizedMessage, SEASONAL_STRATEGY_KEYWORDS)) {
    detectedTypes.push("seasonal_strategy");
  }

  if (includesAnyKeyword(normalizedMessage, BUSINESS_STRATEGY_KEYWORDS)) {
    detectedTypes.push("business_strategy");
  }

  if (isExplicitContentRequest(normalizedMessage)) {
    detectedTypes.push("marketing_content");
  }

  if (detectedTypes.length === 0 && isBusinessProblemIntent(normalizedMessage)) {
    detectedTypes.push("business_strategy");
  }

  if (detectedTypes.length > 0) {
    return detectedTypes;
  }

  if (isCasualConversation(normalizedMessage)) {
    return ["conversation"];
  }

  return ["conversation"];
}

export function classifyMessage(
  message: string,
  options: ClassifyMessageOptions = {}
): MessageType {
  return detectMessageTypes(message, options)[0] ?? "conversation";
}
