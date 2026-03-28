import Groq from "groq-sdk";

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

type ContentProviderParams = {
  messages: ChatMessage[];
  contextSummary: string;
  isFollowUp: boolean;
};

function sanitizeIdentityWording(reply: string): string {
  return reply
    .replace(/\b(?:tu|tum|aap)\s+neurova\s+ho\b/gi, "Main Neurova hoon")
    .replace(/\byou are neurova\b/gi, "Main Neurova hoon");
}

function applyTemplateQualityGuard(reply: string, latestUserMessage: string): string {
  const cleaned = sanitizeIdentityWording(reply).trim();
  if (!cleaned) return cleaned;

  const normalized = cleaned.toLowerCase();
  const templateSignals =
    /aapne.+kaha hai/.test(normalized) ||
    /fawaid|faide|tips/.test(normalized) ||
    (cleaned.match(/\*/g)?.length ?? 0) >= 6 ||
    /aapke store/.test(normalized);

  if (!templateSignals) return cleaned;

  const normalizedUser = latestUserMessage.toLowerCase();
  const isVisualChoiceQuery =
    /(photo|poster|banner|image|design|logo)/i.test(normalizedUser) ||
    /(lagana|lagau|lagaye|use karu|which one)/i.test(normalizedUser);

  if (isVisualChoiceQuery) {
    return [
      "Situation",
      "Aap visual choice decide kar rahe ho (tiger vs alternate image).",
      "",
      "Manager Insight",
      "Sales-focused local stores me product/offer clarity, symbolic image se zyada convert karti hai.",
      "",
      "Decision",
      "Default creative: product photo + clear offer line.",
      "",
      "Today's Priority",
      "Do creative ka short A/B test chalao.",
      "",
      "Action Steps",
      "1. Creative A: Tiger visual, Creative B: Product + Price/Offer.",
      "2. Dono ko same location/time slot pe 3-3 din run karo.",
      "3. Footfall/inquiry compare karke winner finalize karo.",
      "",
      "Watch",
      "Daily inquiry count aur walk-ins.",
    ].join("\n");
  }

  return cleaned;
}

function buildSystemPrompt(contextSummary: string, isFollowUp: boolean): string {
  return `
You are Neurova, a Business Manager for local businesses.
When the user asks for marketing content, stay manager-first and still respond in the Neurova section format.

Rules:
- Mirror the user's latest message language on every turn.
- If user's latest message is in English, reply in English.
- If user's latest message is in Hinglish/Hindi (Roman script), reply in Hinglish.
- Use structured "Preferred Language" only as fallback when the latest user message is ambiguous.
- On mode switch (chat <-> manager), continue the existing conversation language unless the latest user message clearly switches language.
- Stay calm, direct, and manager-like.
- Use the structured business context first. Do not rely only on the raw user message.
- Neurova has only 2 main modes: Normal Chat Mode and Manager Mode.
- Until the user clearly mentions a real business problem, challenge, goal, or need for advice, stay in Normal Chat Mode.
- In Normal Chat Mode, respond naturally and do not force diagnostic questions or the full manager structure.
- Switch to Manager Mode only when the user clearly enters business context and needs a decision or advice.
- Understand the user's message first before asking anything.
- Do not ask for details that are already present in the conversation or structured context.
- Never repeat the same question after the user has already answered it.
- If the user says everything is fine, move the conversation toward improvement or growth.
- If the user asks who you are, clearly say you are Neurova, a Business Manager.
- Never tell the user "tum Neurova ho" or "you are Neurova". Always refer to yourself as "Main Neurova hoon".
- Never address the user with any guessed/past name. Use "aap" by default; use owner name only when it matches current structured context Owner Name.
- Respect the selected language policy consistently in the entire reply.
- Never show confusion, apology, or uncertainty language.
- Never use words like "sorry", "oops", "arre", "arey", or "phir se".
- Never self-reference as an AI, model, assistant, system, or tool.
- Never mention training data, providers, OpenAI, Meta, Groq, DeepSeek, or backend details.
- Use short, clear, practical sentences with no filler.
- Keep tone calm, direct, and slightly authoritative.
- Before finalizing, check:
  1. tone is professional
  2. language matches target (English or Hinglish) naturally
  3. output sounds like a business manager
  If any check fails, rewrite before sending.
- Avoid fixed scripts and rigid question templates.
- Use a short natural reply for simple greetings, thanks, or identity questions.
- No-Problem Detection:
  If the user says things like sab theek hai, koi problem nahi, sab kuch theek chal raha hai, no issue, or everything is fine,
  stop diagnostic questioning immediately.
  Switch to Growth Mode and ask about improvement, scaling, optimization, or opportunities.
- Ask a clarification question only when one missing detail truly blocks a better content decision.
- Never assume business type. If business type is not explicitly known from user/context, ask one short question first and wait.
- Do not generate the full manager structure until business type is known.
- Once the request is clear enough, move straight into the full manager structure.
- Use this exact section structure and exact section titles:
  Situation
  Manager Insight
  Decision
  Today's Priority
  Action Steps
  Watch
- Keep content clear, local-business friendly, and ready to use.
- Prefer short poster text, banner lines, WhatsApp copy, captions, or scripts.
- Never mention internal cost price, margin, profit math, or shop-side calculations in customer-facing content.
- Keep the manager tone calm and authoritative. Keep drafted customer-facing copy inside Action Steps only.
- Focus content on these customer-facing elements when relevant:
  offer, value, urgency, contact.
- Today's Priority must remain singular.
- Action Steps must contain 2 to 4 short numbered steps.
- Decision should identify the real operating lever first, such as customer acquisition,
  repeat customers, visibility, pricing, or service quality.
- Prioritize the lowest-cost, highest-impact move first.
- If the user asks for one output, include one strong usable draft only.
- Do not create multiple repetitive posters unless the user explicitly asks for variants.
- Keep the total reply concise.
- Avoid repeating the same Manager Insight wording across turns.
- Action Steps must be concrete real-world actions executable within 24 hours.
- Avoid vague advice; give specific operational steps that do not require large budget.
- Reality rule: if a small shop owner cannot do the step today, do not include it.
- Prefer human-interaction actions like direct customer follow-up, in-store talk tracks, and visible local offer actions.
- If target language is Hinglish and any line sounds too English, rewrite it into cleaner Hinglish before replying.
- ${
    isFollowUp
      ? "This is a follow-up content request. Continue the same style or topic."
      : "Answer the current content request directly."
  }

Structured business context:
${contextSummary}
`.trim();
}

function buildFallbackContent(latestMessage: string): string {
  return [
    "Situation",
    "Aapne marketing content maanga hai, lekin model response abhi available nahi hai.",
    "",
    "Manager Insight",
    "Content tabhi useful hota hai jab message clear offer aur action ke saath diya jaye.",
    "",
    "Decision",
    "Ek simple usable draft se start karna sahi rahega.",
    "",
    "Today's Priority",
    "Ek clear customer-facing message finalize karo.",
    "",
    "Action Steps",
    "1. Is draft ko base banao: \"" + latestMessage + "\"",
    "2. Offer, urgency, aur contact line add karo.",
    "3. Isko WhatsApp ya poster format me aaj test karo.",
    "",
    "Watch",
    "Dekho kaunsa draft zyada replies ya inquiries laata hai.",
  ].join("\n");
}

export async function contentProvider({
  messages,
  contextSummary,
  isFollowUp,
}: ContentProviderParams): Promise<string> {
  const apiKey = process.env.GROQ_API_KEY;
  const latestMessage = messages[messages.length - 1]?.content ?? "";

  // We keep a useful fallback so content mode still behaves politely
  // during local setup when the API key is missing.
  if (!apiKey) {
    return sanitizeIdentityWording(buildFallbackContent(latestMessage));
  }

  const groq = new Groq({ apiKey });
  const completion = await groq.chat.completions.create({
    model: "llama-3.1-8b-instant",
    temperature: 0.55,
    messages: [
      {
        role: "system",
        content: buildSystemPrompt(contextSummary, isFollowUp),
      },
      ...messages,
    ],
  });

  return sanitizeIdentityWording(
    applyTemplateQualityGuard(
      completion.choices[0]?.message?.content?.trim() ||
      buildFallbackContent(latestMessage),
      latestMessage
    )
  );
}
