const SECTION_TITLES = [
  "Situation",
  "Manager Insight",
  "Decision",
  "Today's Priority",
  "Action Steps",
  "Watch",
] as const;

type SectionTitle = (typeof SECTION_TITLES)[number];

export type ManagerSection = {
  title: SectionTitle;
  content: string;
};

const REQUIRED_SECTION_TITLES: SectionTitle[] = [
  "Situation",
  "Manager Insight",
  "Decision",
  "Today's Priority",
  "Action Steps",
];

const SECTION_ALIASES: Record<string, SectionTitle> = {
  situation: "Situation",
  "manager insight": "Manager Insight",
  insight: "Manager Insight",
  decision: "Decision",
  "today's priority": "Today's Priority",
  "todays priority": "Today's Priority",
  priority: "Today's Priority",
  "action steps": "Action Steps",
  actions: "Action Steps",
  "action plan": "Action Steps",
  watch: "Watch",
};

function normalizeHeading(value: string): string {
  return value
    .toLowerCase()
    .replace(/[*#:`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanLine(value: string): string {
  return value.replace(/^[*-]\s*/, "").trim();
}

function stripNestedSectionHeadings(content: string): string {
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => {
      const headingMatch = /^(?:##\s*)?([A-Za-z' ]+)\s*:?\s*$/.exec(line);

      if (!headingMatch) {
        return true;
      }

      return !SECTION_ALIASES[normalizeHeading(headingMatch[1])];
    })
    .join("\n")
    .trim();
}

function toOrderedList(content: string): string {
  const stripped = stripNestedSectionHeadings(content);
  const prepared = stripped
    .replace(/\s*(\d+)[).:-]\s*/g, "\n$1. ")
    .replace(/\s*(\d+)(?=[A-Za-z])/g, "\n$1. ");
  const rawLines = prepared
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (rawLines.length === 0) {
    return "";
  }

  const normalizeForDedup = (value: string): string =>
    value
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .replace(/\s+/g, " ")
      .trim();

  const dedupedLines: string[] = [];
  const seen = new Set<string>();

  for (const rawLine of rawLines) {
    const normalized = rawLine
      .replace(/^\d+[\s.)-]*/, "")
      .replace(/^[-*]\s*/, "")
      .trim();

    if (!normalized) {
      continue;
    }

    const key = normalizeForDedup(normalized);
    if (!key || seen.has(key)) {
      continue;
    }

    seen.add(key);
    dedupedLines.push(normalized);
  }

  return dedupedLines
    .slice(0, 4)
    .map((line, index) => `${index + 1}. ${line}`)
    .join("\n");
}

function toSentence(value: string): string {
  const compact = stripNestedSectionHeadings(value).replace(/\s+/g, " ").trim();

  if (!compact) {
    return "";
  }

  const normalizedSentences = compact
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);

  if (normalizedSentences.length <= 1) {
    return compact;
  }

  const dedupedSentences: string[] = [];
  const seen = new Set<string>();

  for (const sentence of normalizedSentences) {
    const key = sentence
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .replace(/\s+/g, " ")
      .trim();

    if (!key || seen.has(key)) {
      continue;
    }

    seen.add(key);
    dedupedSentences.push(sentence);
  }

  return dedupedSentences.join(" ");
}

function normalizeForSimilarity(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenSimilarity(a: string, b: string): number {
  const aTokens = new Set(normalizeForSimilarity(a).split(" ").filter(Boolean));
  const bTokens = new Set(normalizeForSimilarity(b).split(" ").filter(Boolean));

  if (aTokens.size === 0 || bTokens.size === 0) {
    return 0;
  }

  let overlap = 0;
  for (const token of aTokens) {
    if (bTokens.has(token)) {
      overlap += 1;
    }
  }

  return overlap / Math.max(aTokens.size, bTokens.size);
}

function firstActionStep(actionSteps: string): string | null {
  const firstLine = actionSteps
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);

  if (!firstLine) {
    return null;
  }

  const cleaned = firstLine.replace(/^\d+[\s.)-]*/, "").trim();
  return cleaned || null;
}

function enforceAntiRepeat(sections: ManagerSection[]): ManagerSection[] {
  const byTitle = new Map<SectionTitle, ManagerSection>();
  for (const section of sections) {
    byTitle.set(section.title, section);
  }

  const situation = byTitle.get("Situation")?.content ?? "";
  const insight = byTitle.get("Manager Insight")?.content ?? "";
  const decision = byTitle.get("Decision")?.content ?? "";
  const priority = byTitle.get("Today's Priority")?.content ?? "";
  const actionSteps = byTitle.get("Action Steps")?.content ?? "";

  if (insight && situation && tokenSimilarity(insight, situation) > 0.82) {
    byTitle.set("Manager Insight", {
      title: "Manager Insight",
      content:
        "Core bottleneck clear karna zaroori hai, tabhi execution focused hoga aur measurable result aayega.",
    });
  }

  const refreshedInsight = byTitle.get("Manager Insight")?.content ?? "";
  if (
    decision &&
    (tokenSimilarity(decision, situation) > 0.82 ||
      tokenSimilarity(decision, refreshedInsight) > 0.82)
  ) {
    byTitle.set("Decision", {
      title: "Decision",
      content:
        "Ab ek focused practical move pick karke next 24 hours me execution start karna hai.",
    });
  }

  const refreshedDecision = byTitle.get("Decision")?.content ?? "";
  if (
    priority &&
    (tokenSimilarity(priority, refreshedDecision) > 0.72 ||
      tokenSimilarity(priority, refreshedInsight) > 0.72)
  ) {
    const step = firstActionStep(actionSteps);
    byTitle.set("Today's Priority", {
      title: "Today's Priority",
      content: step ?? "Aaj ek hi bottleneck par focused execution shuru karo.",
    });
  }

  return SECTION_TITLES.flatMap((title) => {
    const section = byTitle.get(title);
    if (!section || !section.content.trim()) {
      return [];
    }
    return [section];
  });
}

function splitIntroAndBody(reply: string): { intro: string; body: string } {
  const firstSectionIndex = SECTION_TITLES.reduce((lowest, title) => {
    const pattern = new RegExp(`(?:^|\\n)\\s*(?:##\\s*)?${title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*:`, "i");
    const match = pattern.exec(reply);

    if (!match || match.index < 0) {
      return lowest;
    }

    return lowest === -1 ? match.index : Math.min(lowest, match.index);
  }, -1);

  if (firstSectionIndex === -1) {
    return { intro: "", body: reply.trim() };
  }

  return {
    intro: reply.slice(0, firstSectionIndex).trim(),
    body: reply.slice(firstSectionIndex).trim(),
  };
}

function parseSections(reply: string): Map<SectionTitle, string> {
  const { intro, body } = splitIntroAndBody(reply);
  const sections = new Map<SectionTitle, string>();
  let currentTitle: SectionTitle | null = null;
  let currentLines: string[] = [];

  const flush = () => {
    if (!currentTitle) {
      return;
    }

    const existing = sections.get(currentTitle);
    const merged = [...(existing ? [existing] : []), currentLines.join("\n").trim()]
      .filter(Boolean)
      .join("\n")
      .trim();

    if (merged) {
      sections.set(currentTitle, merged);
    }
  };

  if (intro) {
    sections.set("Situation", intro);
  }

  for (const line of body.split(/\r?\n/)) {
    const trimmed = line.trim();

    if (!trimmed) {
      currentLines.push("");
      continue;
    }

    const headingMatch = /^(?:##\s*)?([A-Za-z' ]+)\s*:?\s*$/.exec(trimmed);
    const normalizedHeading = headingMatch
      ? SECTION_ALIASES[normalizeHeading(headingMatch[1])]
      : null;

    if (normalizedHeading) {
      flush();
      currentTitle = normalizedHeading;
      currentLines = [];
      continue;
    }

    currentLines.push(cleanLine(line));
  }

  flush();

  return sections;
}

function buildFallbackSections(reply: string): ManagerSection[] {
  const compact = toSentence(reply);
  const fallbackSituation =
    compact || "Current business situation ko assess karne ke liye enough clear detail abhi limited hai.";

  return [
    {
      title: "Situation",
      content: fallbackSituation,
    },
    {
      title: "Manager Insight",
      content: "Jab input broad hota hai, pehla kaam problem ko ek practical operating issue me convert karna hota hai.",
    },
    {
      title: "Decision",
      content: "Neurova abhi ek focused next move define karega instead of multiple scattered suggestions.",
    },
    {
      title: "Today's Priority",
      content: "Sabse immediate bottleneck ko identify karke uspar execution shuru karo.",
    },
    {
      title: "Action Steps",
      content: [
        "1. Aaj ka main problem ek line me define karo.",
        "2. Revenue, customers, ya operations me sabse weak area note karo.",
        "3. Usi area par next 24 hours ka ek action complete karo.",
      ].join("\n"),
    },
    {
      title: "Watch",
      content: "Dekho ki selected action se 2 se 3 din me measurable movement aata hai ya nahi.",
    },
  ];
}

export function normalizeManagerReply(reply: string): string {
  const parsedSections = parseSections(reply);

  if (parsedSections.size === 0) {
    return formatManagerSections(buildFallbackSections(reply));
  }

  const sections: ManagerSection[] = SECTION_TITLES.flatMap((title) => {
    const rawContent = parsedSections.get(title)?.trim();

    if (!rawContent) {
      if (title === "Watch") {
        return [];
      }

      return [];
    }

    const content =
      title === "Action Steps" ? toOrderedList(rawContent) : toSentence(rawContent);

    return content ? [{ title, content }] : [];
  });

  const hasRequiredSections = REQUIRED_SECTION_TITLES.every((title) =>
    sections.some((section) => section.title === title && section.content.length > 0)
  );

  if (!hasRequiredSections) {
    return formatManagerSections(buildFallbackSections(reply));
  }

  return formatManagerSections(enforceAntiRepeat(sections));
}

export function formatManagerSections(sections: ManagerSection[]): string {
  return sections
    .map((section) => `${section.title}\n${section.content}`)
    .join("\n\n")
    .trim();
}
