import type { SharedBusinessContext } from "./sharedContext";

export const BUSINESS_PROFILE_STORAGE_KEY = "neural-x-business-profile";
export const BUSINESS_MEMORY_STORAGE_KEY = "neural-x-business-memory";
export const BUSINESS_PROFILE_SUGGESTIONS_STORAGE_KEY =
  "neural-x-business-profile-suggestions";
export const BUSINESS_PROFILE_META_STORAGE_KEY = "neural-x-business-profile-meta";
export const BUSINESS_PROFILE_SYNC_EVENT = "neural-x-profile-sync";

export type BusinessProfile = {
  ownerName: string;
  businessName: string;
  businessType: string;
  cityArea: string;
  preferredLanguage: string;
  offerDescription: string;
  customerType: string;
  priceRange: string;
  businessModel: string;
  teamSize: string;
  businessStage: string;
  mainGoal: string;
  secondaryGoal: string;
  currentFocus: string;
  budgetLevel: string;
  keyConstraint1: string;
  keyConstraint2: string;
  notes: string;
};

export type BusinessProfileField = keyof BusinessProfile;
export type BusinessMemoryKey = BusinessProfileField;
export type BusinessProfileState = "empty" | "partial" | "ready";
export type AnsweredImportantFields = Partial<Record<BusinessProfileField, boolean>>;
export type ProfileFieldSource = "chat" | "manual";
export type BusinessProfileFieldMeta = {
  source: ProfileFieldSource;
  updatedAt: string;
  editedAfterAutoFill?: boolean;
};
export type BusinessProfileMeta = Partial<
  Record<BusinessProfileField, BusinessProfileFieldMeta>
>;

export type BusinessMemoryItem = {
  field: BusinessMemoryKey;
  value: string;
  source: "chat";
  confidence: number;
  editable: true;
};

export type ProfileUpdateSuggestion = {
  field: BusinessProfileField;
  value: string;
  currentValue?: string;
  suggestedValue?: string;
  source: "chat";
  confidence: number;
  status: "pending" | "approved" | "rejected";
};

export const EMPTY_BUSINESS_PROFILE: BusinessProfile = {
  ownerName: "",
  businessName: "",
  businessType: "",
  cityArea: "",
  preferredLanguage: "",
  offerDescription: "",
  customerType: "",
  priceRange: "",
  businessModel: "",
  teamSize: "",
  businessStage: "",
  mainGoal: "",
  secondaryGoal: "",
  currentFocus: "",
  budgetLevel: "",
  keyConstraint1: "",
  keyConstraint2: "",
  notes: "",
};
const ALL_PROFILE_FIELDS = Object.keys(EMPTY_BUSINESS_PROFILE) as BusinessProfileField[];

function sanitizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeIsoTimestamp(value: unknown): string {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : new Date().toISOString();
}

export function normalizeBusinessProfileMeta(
  candidate: unknown
): BusinessProfileMeta {
  if (!candidate || typeof candidate !== "object") {
    return {};
  }

  const record = candidate as Partial<Record<BusinessProfileField, unknown>>;
  const normalized: BusinessProfileMeta = {};

  for (const field of ALL_PROFILE_FIELDS) {
    const rawMeta = record[field];
    if (!rawMeta || typeof rawMeta !== "object") continue;

    const sourceCandidate = (rawMeta as { source?: unknown }).source;
    const source: ProfileFieldSource =
      sourceCandidate === "chat" || sourceCandidate === "manual"
        ? sourceCandidate
        : "manual";

    normalized[field] = {
      source,
      updatedAt: normalizeIsoTimestamp(
        (rawMeta as { updatedAt?: unknown }).updatedAt
      ),
      editedAfterAutoFill:
        (rawMeta as { editedAfterAutoFill?: unknown }).editedAfterAutoFill === true,
    };
  }

  return normalized;
}

export function mergeBusinessProfileMetaWithSource({
  previousProfile,
  nextProfile,
  previousMeta,
  source,
  timestamp = new Date().toISOString(),
}: {
  previousProfile: BusinessProfile;
  nextProfile: BusinessProfile;
  previousMeta: BusinessProfileMeta;
  source: ProfileFieldSource;
  timestamp?: string;
}): BusinessProfileMeta {
  const mergedMeta: BusinessProfileMeta = { ...previousMeta };
  const normalizedTimestamp = normalizeIsoTimestamp(timestamp);

  for (const field of ALL_PROFILE_FIELDS) {
    const previousValue = sanitizeString(previousProfile[field]);
    const nextValue = sanitizeString(nextProfile[field]);
    if (previousValue === nextValue) continue;

    const previousFieldMeta = previousMeta[field];
    const wasAutoDetected =
      previousFieldMeta?.source === "chat" &&
      previousFieldMeta?.editedAfterAutoFill !== true;

    mergedMeta[field] = {
      source,
      updatedAt: normalizedTimestamp,
      editedAfterAutoFill:
        source === "manual"
          ? wasAutoDetected || previousFieldMeta?.editedAfterAutoFill === true
          : false,
    };
  }

  return mergedMeta;
}

export function normalizeBusinessProfile(
  candidate: Partial<BusinessProfile> | null | undefined
): BusinessProfile {
  return {
    ownerName: sanitizeString(candidate?.ownerName),
    businessName: sanitizeString(candidate?.businessName),
    businessType: sanitizeString(candidate?.businessType),
    cityArea: sanitizeString(candidate?.cityArea),
    preferredLanguage: sanitizeString(candidate?.preferredLanguage),
    offerDescription: sanitizeString(candidate?.offerDescription),
    customerType: sanitizeString(candidate?.customerType),
    priceRange: sanitizeString(candidate?.priceRange),
    businessModel: sanitizeString(candidate?.businessModel),
    teamSize: sanitizeString(candidate?.teamSize),
    businessStage: sanitizeString(candidate?.businessStage),
    mainGoal: sanitizeMemoryValue("mainGoal", candidate?.mainGoal),
    secondaryGoal: sanitizeString(candidate?.secondaryGoal),
    currentFocus: sanitizeString(candidate?.currentFocus),
    budgetLevel: sanitizeString(candidate?.budgetLevel),
    keyConstraint1: sanitizeString(candidate?.keyConstraint1),
    keyConstraint2: sanitizeString(candidate?.keyConstraint2),
    notes: sanitizeString(candidate?.notes),
  };
}

export function normalizeBusinessMemory(
  candidate: Partial<BusinessMemoryItem>[] | null | undefined
): BusinessMemoryItem[] {
  if (!Array.isArray(candidate)) {
    return [];
  }

  const normalized = candidate
    .filter((item): item is Partial<BusinessMemoryItem> => typeof item === "object" && item !== null)
    .map((item) => {
      const field = normalizeMemoryField(item);
      const value = sanitizeMemoryValue(field, item.value);
      const confidence = normalizeConfidence(item.confidence);

      return {
        field,
        value,
        source: "chat" as const,
        confidence,
        editable: true as const,
      };
    })
    .filter(
      (item): item is BusinessMemoryItem =>
        item.field !== null &&
        item.value.length > 0 &&
        item.confidence > MEMORY_CONFIDENCE_THRESHOLD
    );

  return mergeBusinessMemory([], normalized);
}

const MEMORY_CONFIDENCE_THRESHOLD = 0.7;
const AUTO_UPDATE_CONFIDENCE_THRESHOLD = 0.7;
const SUGGESTION_CONFIDENCE_THRESHOLD = 0.55;
const STABLE_PROFILE_FIELDS: BusinessProfileField[] = [
  "ownerName",
  "businessName",
  "businessType",
  "cityArea",
  "preferredLanguage",
  "offerDescription",
  "customerType",
  "priceRange",
  "businessModel",
  "teamSize",
  "businessStage",
  "mainGoal",
  "secondaryGoal",
  "currentFocus",
  "budgetLevel",
  "keyConstraint1",
  "keyConstraint2",
  "notes",
];
const CRITICAL_PROFILE_FIELDS: BusinessProfileField[] = [
  "businessType",
  "mainGoal",
  "customerType",
  "budgetLevel",
  "businessName",
];
const IMPORTANT_PROFILE_FIELDS: BusinessProfileField[] = [
  "businessType",
  "businessName",
  "cityArea",
  "mainGoal",
  "customerType",
  "budgetLevel",
  "teamSize",
];

const BUSINESS_TYPE_KEYWORDS: Array<{ keyword: string; normalizedValue: string }> = [
  { keyword: "restaurant", normalizedValue: "Restaurant" },
  { keyword: "cafe", normalizedValue: "Cafe" },
  { keyword: "salon", normalizedValue: "Salon" },
  { keyword: "gym", normalizedValue: "Gym" },
  { keyword: "agency", normalizedValue: "Agency" },
  { keyword: "store", normalizedValue: "Store" },
  { keyword: "shop", normalizedValue: "Shop" },
  { keyword: "clinic", normalizedValue: "Clinic" },
  { keyword: "coaching", normalizedValue: "Coaching" },
  { keyword: "tuition", normalizedValue: "Tuition" },
];

function normalizeMemoryField(item: Partial<BusinessMemoryItem>): BusinessMemoryKey | null {
  const fieldCandidate = item.field;
  const keyCandidate = (item as Partial<{ key: unknown }>).key;
  const nextField = typeof fieldCandidate === "string" ? fieldCandidate : keyCandidate;

  return STABLE_PROFILE_FIELDS.includes(nextField as BusinessProfileField)
    ? (nextField as BusinessProfileField)
    : null;
}

function normalizeConfidence(candidate: unknown): number {
  if (typeof candidate === "number" && Number.isFinite(candidate)) {
    return Math.max(0, Math.min(1, candidate));
  }

  return 0.8;
}

function titleCaseWords(value: string): string {
  return value
    .toLowerCase()
    .split(/\s+/)
    .map((part) => (part ? part[0].toUpperCase() + part.slice(1) : ""))
    .join(" ");
}

function sanitizeExtractedText(value: string): string {
  return value
    .replace(/^[\s:,.!?-]+/, "")
    .replace(/[\s:,.!?-]+$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isQuestionLike(text: string): boolean {
  const normalized = text.toLowerCase().trim();
  return (
    normalized.includes("?") ||
    normalized.startsWith("kya ") ||
    normalized.startsWith("kya tum") ||
    normalized.startsWith("kya aap") ||
    normalized.includes("pata hai") ||
    normalized.includes("what is") ||
    normalized.includes("can you tell")
  );
}

function sanitizeMemoryValue(field: BusinessMemoryKey | null, rawValue: unknown): string {
  const value = sanitizeString(rawValue);
  if (!field || !value) return "";

  switch (field) {
    case "ownerName": {
      if (
        value.length < 3 ||
        value.length > 48 ||
        /\b(?:mera|my|naam|name|goal|team|pass|hai|hun|hoon)\b/i.test(value)
      ) {
        return "";
      }
      return titleCaseWords(value);
    }
    case "teamSize": {
      const match = value.match(/\d{1,3}/);
      if (!match) return "";
      return match[0];
    }
    case "businessType": {
      const keywordMatch = BUSINESS_TYPE_KEYWORDS.find(({ keyword }) =>
        value.toLowerCase().includes(keyword)
      );
      if (keywordMatch) return keywordMatch.normalizedValue;
      if (value.split(/\s+/).length > 3) return "";
      return titleCaseWords(value);
    }
    case "mainGoal": {
      if (
        value.length < 4 ||
        value.length > 80 ||
        /(kya|kiya|kia|pata hai|\?|mera naam|mere pass|my name)/i.test(value)
      ) {
        return "";
      }
      const normalizedGoal = value.toLowerCase().trim();
      if (
        normalizedGoal === "nahi" ||
        normalizedGoal === "nahin" ||
        normalizedGoal === "kya" ||
        normalizedGoal === "kiya" ||
        normalizedGoal === "kia" ||
        normalizedGoal === "none" ||
        /\b(?:goal|target)\s+(?:nahi|nahin)\b/i.test(normalizedGoal)
      ) {
        return "";
      }
      return value;
    }
    case "budgetLevel": {
      if (/^\d/.test(value)) return value;
      if (/low|medium|high/i.test(value)) return titleCaseWords(value);
      return "";
    }
    case "cityArea": {
      if (value.length > 40 || /(kya|goal|team|budget|\?)/i.test(value)) {
        return "";
      }
      return titleCaseWords(value);
    }
    case "businessName":
    case "businessStage":
    case "preferredLanguage":
      return value.length <= 48 ? titleCaseWords(value) : "";
    case "businessModel":
      return value.length <= 24 ? titleCaseWords(value) : "";
    case "priceRange":
      return value.length <= 32 ? value : "";
    case "offerDescription":
    case "customerType":
    case "secondaryGoal":
    case "currentFocus":
    case "keyConstraint1":
    case "keyConstraint2":
      return value.length <= 120 ? value : "";
    case "notes":
      return value.length <= 220 ? value : "";
  }
}

function createMemoryItem(
  field: BusinessMemoryKey,
  value: string,
  confidence: number
): BusinessMemoryItem | null {
  const cleanedValue = sanitizeMemoryValue(field, value);
  if (!cleanedValue || confidence <= MEMORY_CONFIDENCE_THRESHOLD) {
    return null;
  }

  return {
    field,
    value: cleanedValue,
    source: "chat",
    confidence,
    editable: true,
  };
}

export function extractBusinessField(userMessage: string): BusinessMemoryItem | null {
  const extracted = extractBusinessProfileFromUserMessage(userMessage).memoryEntries[0];
  return extracted ?? null;
}

export function getMissingProfileFields(
  profile: BusinessProfile,
  fields: BusinessProfileField[] = STABLE_PROFILE_FIELDS
): BusinessProfileField[] {
  return fields.filter((field) => !sanitizeString(profile[field]));
}

export function getCriticalMissingProfileFields(
  profile: BusinessProfile
): BusinessProfileField[] {
  return getMissingProfileFields(profile, CRITICAL_PROFILE_FIELDS);
}

export function getMissingImportantFields(
  profile: BusinessProfile
): BusinessProfileField[] {
  return getMissingProfileFields(profile, IMPORTANT_PROFILE_FIELDS);
}

export function getAnsweredImportantFields(
  profile: BusinessProfile
): AnsweredImportantFields {
  const answered: AnsweredImportantFields = {};
  for (const field of IMPORTANT_PROFILE_FIELDS) {
    answered[field] = sanitizeString(profile[field]).length > 0;
  }
  return answered;
}

export function getBusinessProfileState(
  profile: BusinessProfile
): BusinessProfileState {
  const importantMissingFields = getMissingImportantFields(profile);
  if (importantMissingFields.length === 0) return "ready";

  const hasAnyImportantField = IMPORTANT_PROFILE_FIELDS.some(
    (field) => sanitizeString(profile[field]).length > 0
  );
  return hasAnyImportantField ? "partial" : "empty";
}

export function normalizeSuggestedProfileUpdates(
  candidate: Partial<ProfileUpdateSuggestion>[] | null | undefined
): ProfileUpdateSuggestion[] {
  if (!Array.isArray(candidate)) {
    return [];
  }

  return candidate.reduce<ProfileUpdateSuggestion[]>((acc, item) => {
    if (typeof item !== "object" || item === null) {
      return acc;
    }

    const field = STABLE_PROFILE_FIELDS.includes(item.field as BusinessProfileField)
      ? (item.field as BusinessProfileField)
      : null;
    const suggestedCandidate =
      typeof item.suggestedValue === "string" ? item.suggestedValue : item.value;
    const value = sanitizeMemoryValue(field, suggestedCandidate);
    const currentValue = sanitizeMemoryValue(
      field,
      typeof item.currentValue === "string" ? item.currentValue : ""
    );
    const confidence = normalizeConfidence(item.confidence);
    const status: ProfileUpdateSuggestion["status"] =
      item.status === "approved" || item.status === "rejected"
        ? item.status
        : "pending";

    if (!field || !value) return acc;

    acc.push({
      field,
      value,
      currentValue: currentValue || undefined,
      suggestedValue: value,
      source: "chat" as const,
      confidence,
      status,
    });

    return acc;
  }, []);
}

type ExtractedSignal = {
  field: BusinessProfileField;
  value: string;
  confidence: number;
};

function upsertSignal(signals: ExtractedSignal[], next: ExtractedSignal | null) {
  if (!next) return;
  const existingIndex = signals.findIndex((item) => item.field === next.field);
  if (existingIndex === -1) {
    signals.push(next);
    return;
  }
  signals[existingIndex] =
    signals[existingIndex].confidence >= next.confidence
      ? signals[existingIndex]
      : next;
}

function extractSignalsFromMessage(userMessage: string): ExtractedSignal[] {
  const text = sanitizeString(userMessage);
  const normalized = text.toLowerCase();
  const signals: ExtractedSignal[] = [];
  if (!text || isQuestionLike(normalized)) return signals;

  const ownerNameCandidate = (() => {
    const directPatterns: Array<{ regex: RegExp; confidence: number }> = [
      {
        regex: /(?:^|[\s,.-])(?:mera|my)\s+naam\s+([a-zA-Z][a-zA-Z\s.'-]{1,40})\s+(?:hai|is)\b/i,
        confidence: 0.96,
      },
      {
        regex: /(?:^|[\s,.-])my\s+name\s+is\s+([a-zA-Z][a-zA-Z\s.'-]{1,40})\b/i,
        confidence: 0.96,
      },
      {
        regex: /^\s*(?:mai|main)\s+([a-zA-Z][a-zA-Z\s.'-]{1,40})\s+(?:hu|hun|hoon)\s*[.!?]?\s*$/i,
        confidence: 0.98,
      },
      {
        regex: /^\s*(?:i am|i'm)\s+([a-zA-Z][a-zA-Z\s.'-]{1,40})\s*[.!?]?\s*$/i,
        confidence: 0.98,
      },
    ];

    const isLikelyOwnerName = (value: string) => {
      const cleaned = sanitizeExtractedText(value);
      if (!cleaned || /\d/.test(cleaned)) return false;
      if (cleaned.split(/\s+/).length > 3) return false;
      if (!/^[a-zA-Z][a-zA-Z\s.'-]*$/.test(cleaned)) return false;

      return !/\b(?:mera|my|naam|name|mai|main|i|am|im|hai|hun|hoon|are|we|located|based|in|from)\b/i.test(
        cleaned
      );
    };

    for (const { regex, confidence } of directPatterns) {
      const match = text.match(regex);
      if (!match) continue;
      const candidate = sanitizeExtractedText(match[1]);
      if (!isLikelyOwnerName(candidate)) continue;
      return { value: candidate, confidence };
    }

    return null;
  })();

  if (ownerNameCandidate) {
    upsertSignal(signals, {
      field: "ownerName",
      value: ownerNameCandidate.value,
      confidence: ownerNameCandidate.confidence,
    });
  }

  const businessNameMatch =
    text.match(
      /(?:mera|meri|hamara|hamari|my|our)\s+(?:company|business|shop)\s+(?:ka\s+)?naam\s+(.+?)\s+hai/i
    ) ??
    text.match(
      /(?:mera|meri|hamara|hamari|my|our)\s+(?:restaurant|cafe|salon|gym|clinic|shop|store|business)\s+([a-zA-Z][a-zA-Z0-9\s.'&-]{1,40})\s+hai\b/i
    ) ??
    text.match(/(?:business|company)\s+name\s+(?:is|=)\s+(.+)$/i);
  if (businessNameMatch) {
    upsertSignal(signals, {
      field: "businessName",
      value: sanitizeExtractedText(businessNameMatch[1]),
      confidence: 0.9,
    });
  }

  const teamMatch =
    text.match(/(?:mere|hamare|my)\s+(?:pass|paas|team(?:\s+me)?)\s+(\d{1,3})\s+(?:log|people|members?|staff)\b/i) ??
    text.match(/(?:team\s+size|staff)\s+(?:is|=)?\s*(\d{1,3})\b/i);
  if (teamMatch) {
    upsertSignal(signals, { field: "teamSize", value: teamMatch[1], confidence: 0.95 });
  }

  const businessTypeMatch = BUSINESS_TYPE_KEYWORDS.find(({ keyword }) =>
    normalized.includes(keyword)
  );
  if (
    businessTypeMatch &&
    (/\b(?:mera|hamara|my|our)\b/.test(normalized) ||
      /\b(?:business|shop|store|agency|restaurant|cafe|salon|gym|clinic)\b/.test(normalized))
  ) {
    upsertSignal(signals, {
      field: "businessType",
      value: businessTypeMatch.normalizedValue,
      confidence: 0.92,
    });
  }

  const goalMatch =
    text.match(
      /(?:mera|hamara|my|our)\s+(?:main\s+)?goal\s+(.+?)\s+(?:hai|is)\b/i
    ) ??
    text.match(
      /(?:mera|hamara|my|our)\s+(?:main\s+)?goal\s+(?:hai|is)\s+(.+)$/i
    ) ??
    text.match(/(?:my|our)\s+goal\s+is\s+(.+)$/i);
  if (goalMatch) {
    const goalValue = sanitizeExtractedText(goalMatch[1]);
    if (/\b(?:nahi|nahin|none|kya|kiya|kia)\b/i.test(goalValue)) {
      return signals;
    }
    upsertSignal(signals, {
      field: "mainGoal",
      value: goalValue,
      confidence: 0.9,
    });
  } else if (
    /\b(national level|nationwide|all india|national)\b/i.test(text) &&
    /\b(represent|expand|grow|le\s+jana|jana|pahunch|scale)\b/i.test(text)
  ) {
    const goalValue = /\b(restaurant|resturent|restro|cafe)\b/i.test(text)
      ? "Expand restaurant to national level"
      : "Expand business to national level";
    upsertSignal(signals, {
      field: "mainGoal",
      value: goalValue,
      confidence: 0.86,
    });
  }

  const customerTypeMatch =
    text.match(/(?:mere|hamare|my|our)\s+customers?\s+(.+?)\s+(?:hai|hain|are)\b/i) ??
    text.match(/customer\s+type\s+(?:is|=)\s+(.+)$/i);
  if (customerTypeMatch) {
    upsertSignal(signals, {
      field: "customerType",
      value: sanitizeExtractedText(customerTypeMatch[1]),
      confidence: 0.72,
    });
  }

  const budgetMatch =
    text.match(
      /(?:mera|hamara|my|our)\s+(?:monthly\s+)?budget\s+(?:is|=|hai)?\s*(low|medium|high|\d[\d,\s]*(?:k|lakh|lac|crore|rs|inr)?)\b/i
    ) ?? text.match(/\bbudget\s*[:=]?\s*(low|medium|high|\d[\d,\s]*(?:k|lakh|lac|crore|rs|inr)?)\b/i);
  if (budgetMatch) {
    upsertSignal(signals, {
      field: "budgetLevel",
      value: sanitizeExtractedText(budgetMatch[1]),
      confidence: 0.87,
    });
  }

  const locationMatch =
    text.match(
      /(?:mera|hamara|my|our)\s+(?:business|shop|store)\s+([a-zA-Z][a-zA-Z\s]+?)\s+(?:me|mein|mein hai|located|based)\b/i
    ) ??
    text.match(
      /(?:mera|hamara|my|our)\s+(?:restaurant|business|shop|store|cafe)\s+([a-zA-Z][a-zA-Z\s.'-]{1,40})\s+(?:me|mein)\s+hai\b/i
    ) ??
    text.match(/(?:i am|we are)\s+(?:located|based)\s+in\s+([a-zA-Z][a-zA-Z\s]+)$/i) ??
    text.match(
      /(?:location|address|jagah)\s*[:=-]?\s*([a-zA-Z0-9][a-zA-Z0-9\s,.'-]{1,60})$/i
    );
  if (locationMatch) {
    upsertSignal(signals, {
      field: "cityArea",
      value: sanitizeExtractedText(locationMatch[1]),
      confidence: 0.82,
    });
  }

  const languageMatch =
    text.match(/(?:meri|my)\s+(?:language|preferred language)\s+(.+?)\s+(?:hai|is)\b/i) ??
    text.match(/(?:i|we)\s+prefer\s+(.+?)\s+language/i) ??
    text.match(
      /(?:mai|main|mein)\s+([a-zA-Z][a-zA-Z\s-]{1,30})\s+language\s+prefer\s+karta\s+(?:hu|hun|hoon)\b/i
    ) ??
    text.match(
      /(?:mai|main|mein)\s+([a-zA-Z][a-zA-Z\s-]{1,30})\s+prefer\s+karta\s+(?:hu|hun|hoon)\b/i
    ) ??
    text.match(
      /(?:mai|main|mein)\s+([a-zA-Z][a-zA-Z\s-]{1,30})\s+language\s+prefer\s+karti\s+(?:hu|hun|hoon)\b/i
    ) ??
    text.match(
      /(?:mai|main|mein)\s+([a-zA-Z][a-zA-Z\s-]{1,30})\s+prefer\s+karti\s+(?:hu|hun|hoon)\b/i
    );
  if (languageMatch) {
    upsertSignal(signals, {
      field: "preferredLanguage",
      value: sanitizeExtractedText(languageMatch[1]),
      confidence: 0.78,
    });
  }

  const businessModelMatch = text.match(
    /(?:hamara|mera|our|my)\s+business\s+model\s+(?:is|=|hai)?\s*(online|offline|both|hybrid)\b/i
  );
  if (businessModelMatch) {
    upsertSignal(signals, {
      field: "businessModel",
      value: sanitizeExtractedText(businessModelMatch[1]),
      confidence: 0.82,
    });
  }

  return signals;
}

export function extractBusinessProfileFromUserMessage(userMessage: string): {
  profilePatch: Partial<BusinessProfile>;
  memoryEntries: BusinessMemoryItem[];
  suggestedUpdates: ProfileUpdateSuggestion[];
} {
  const signals = extractSignalsFromMessage(userMessage);
  if (signals.length === 0) {
    return { profilePatch: {}, memoryEntries: [], suggestedUpdates: [] };
  }

  const profilePatch: Partial<BusinessProfile> = {};
  const memoryEntries: BusinessMemoryItem[] = [];
  const suggestedUpdates: ProfileUpdateSuggestion[] = [];

  for (const signal of signals) {
    if (signal.confidence >= AUTO_UPDATE_CONFIDENCE_THRESHOLD) {
      const cleaned = sanitizeMemoryValue(signal.field, signal.value);
      if (!cleaned) continue;
      profilePatch[signal.field] = cleaned;
      const memoryItem = createMemoryItem(signal.field, cleaned, signal.confidence);
      if (memoryItem) memoryEntries.push(memoryItem);
      continue;
    }

    if (signal.confidence >= SUGGESTION_CONFIDENCE_THRESHOLD) {
      const cleaned = sanitizeMemoryValue(signal.field, signal.value);
      if (!cleaned) continue;
      suggestedUpdates.push({
        field: signal.field,
        value: cleaned,
        source: "chat",
        confidence: signal.confidence,
        status: "pending",
      });
    }
  }

  return {
    profilePatch,
    memoryEntries,
    suggestedUpdates,
  };
}

export function extractBusinessMemoryFromUserMessage(userMessage: string): {
  profilePatch: Partial<BusinessProfile>;
  memoryEntries: BusinessMemoryItem[];
  suggestedUpdates: ProfileUpdateSuggestion[];
} {
  return extractBusinessProfileFromUserMessage(userMessage);
}

export function extractProfileUpdates(userMessage: string): Partial<BusinessProfile> {
  return extractBusinessProfileFromUserMessage(userMessage).profilePatch;
}

export function mergeBusinessMemory(
  previousMemory: BusinessMemoryItem[],
  incomingMemory: BusinessMemoryItem[]
): BusinessMemoryItem[] {
  const map = new Map<BusinessMemoryKey, BusinessMemoryItem>();

  for (const item of previousMemory) {
    if (item.confidence <= MEMORY_CONFIDENCE_THRESHOLD) continue;
    map.set(item.field, item);
  }

  for (const item of incomingMemory) {
    if (item.confidence <= MEMORY_CONFIDENCE_THRESHOLD) continue;
    map.set(item.field, item);
  }

  return Array.from(map.values());
}

export function mergeSuggestedProfileUpdates(
  previous: ProfileUpdateSuggestion[],
  incoming: ProfileUpdateSuggestion[]
): ProfileUpdateSuggestion[] {
  const stable = normalizeSuggestedProfileUpdates(previous);
  const next = normalizeSuggestedProfileUpdates(incoming);
  const map = new Map<BusinessProfileField, ProfileUpdateSuggestion>();

  for (const suggestion of stable) {
    if (suggestion.status === "pending") {
      map.set(suggestion.field, suggestion);
    }
  }

  for (const suggestion of next) {
    if (suggestion.status !== "pending") continue;
    map.set(suggestion.field, suggestion);
  }

  return Array.from(map.values());
}

export function pruneSuggestedProfileUpdatesAgainstProfile(
  suggestions: ProfileUpdateSuggestion[],
  profile: BusinessProfile
): ProfileUpdateSuggestion[] {
  return suggestions.filter((suggestion) => {
    if (suggestion.status !== "pending") return false;
    const profileValue = sanitizeString(profile[suggestion.field]);
    const suggestedValue = sanitizeString(
      suggestion.suggestedValue ?? suggestion.value
    );
    if (!suggestedValue) return false;
    return profileValue.toLowerCase() !== suggestedValue.toLowerCase();
  });
}

export function applyProfilePatch(
  profile: BusinessProfile,
  patch: Partial<BusinessProfile>
): BusinessProfile {
  const nextProfile = { ...profile };

  for (const [key, value] of Object.entries(patch)) {
    const typedKey = key as keyof BusinessProfile;
    const cleaned = sanitizeString(value);
    if (!cleaned) continue;

    nextProfile[typedKey] = cleaned;
  }

  return nextProfile;
}

export function mergeSharedContextWithBusinessProfile(
  sharedContext: SharedBusinessContext,
  profile: BusinessProfile
): SharedBusinessContext {
  const profileBusinessType = sanitizeString(profile.businessType) || null;
  const profileBudget = sanitizeString(profile.budgetLevel) || null;
  const profileGoal = sanitizeString(profile.mainGoal) || null;
  const profileStage = sanitizeString(profile.businessStage) || null;

  return {
    ...sharedContext,
    businessType: profileBusinessType ?? sharedContext.businessType,
    budgetConstraint: profileBudget ?? sharedContext.budgetConstraint,
    userGoal: profileGoal ?? sharedContext.userGoal,
    userExperienceLevel: profileStage ?? sharedContext.userExperienceLevel,
  };
}
