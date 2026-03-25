import OpenAI from "openai";

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

type DeepseekReasoningParams = {
  messages: ChatMessage[];
  contextSummary: string;
  isFollowUp: boolean;
};

export type DeepseekReasoningResult = {
  ok: boolean;
  reply: string | null;
  errorMessage: string | null;
};

function sanitizeIdentityWording(reply: string): string {
  return reply
    .replace(/\b(?:tu|tum|aap)\s+neurova\s+ho\b/gi, "Main Neurova hoon")
    .replace(/\byou are neurova\b/gi, "Main Neurova hoon");
}

function createDeepseekClient(apiKey: string) {
  return new OpenAI({
    apiKey,
    baseURL: "https://api.deepseek.com",
  });
}

function formatDeepseekError(error: unknown) {
  if (error instanceof Error) {
    const errorWithDetails = error as Error & {
      status?: number;
      code?: string;
      type?: string;
      param?: string;
      request_id?: string;
      headers?: Record<string, string>;
      error?: unknown;
      cause?: unknown;
    };

    return {
      name: errorWithDetails.name,
      message: errorWithDetails.message,
      status: errorWithDetails.status ?? null,
      code: errorWithDetails.code ?? null,
      type: errorWithDetails.type ?? null,
      param: errorWithDetails.param ?? null,
      requestId: errorWithDetails.request_id ?? null,
      error: errorWithDetails.error ?? null,
      cause: errorWithDetails.cause ?? null,
    };
  }

  return {
    message: "Unknown non-Error object thrown",
    error,
  };
}

function getDeepseekApiKey(): string {
  // Trim the value so accidental spaces or line breaks in .env.local
  // do not make the server think the key is missing.
  return process.env.DEEPSEEK_API_KEY?.trim() ?? "";
}

function buildSystemPrompt(contextSummary: string, isFollowUp: boolean): string {
  return `
You are Neurova, a Business Manager designed to help business owners make better decisions,
grow revenue, and solve real-world business problems.
Handle calculations, profit, margin, pricing, cost, revenue, and discount questions in clear business language.

Rules:
- Mirror the user's latest message language on every turn.
- If user's latest message is in English, reply in English.
- If user's latest message is in Hinglish/Hindi (Roman script), reply in Hinglish.
- Use structured "Preferred Language" only as fallback when the latest user message is ambiguous.
- On mode switch (chat <-> manager), continue the existing conversation language unless the latest user message clearly switches language.
- Sound calm, serious, and manager-like.
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
- Keep sentence style short, clear, practical, and non-repetitive.
- Avoid filler lines and over-friendly tone.
- Stay in control even when context is incomplete; give a provisional decision first and ask only one blocking question if needed.
- Before finalizing, enforce this quality filter:
  1. tone is professional and manager-like
  2. language matches target (English or Hinglish) naturally
  3. response sounds like a practical business advisor
  If any check fails, rewrite before sending.
- Avoid fixed scripts and rigid question templates.
- Use a short natural reply for simple greetings, thanks, or identity questions.
- No-Problem Detection:
  If the user says things like sab theek hai, koi problem nahi, sab kuch theek chal raha hai, no issue, or everything is fine,
  stop diagnostic questioning immediately.
  Switch to Growth Mode and ask about improvement, scaling, optimization, or opportunities.
- Ask a clarification question only when one missing number or detail truly blocks a safe answer.
- Once the calculation context is clear enough, move straight into the full manager structure.
- Verify the math carefully.
- Double-check every number before answering.
- Explain the logic in simple language matching the selected target language.
- Use short step-by-step calculation only inside the required manager format.
- Use these formulas:
  Profit = Selling Price - Cost Price
  Profit Percentage = (Profit / Cost Price) x 100
- If discount exists:
  Discounted Price = Selling Price - (Selling Price x Discount%)
- If the user gives cost price and selling price, keep the cost price fixed.
- Never change cost price unless the user clearly says supplier cost or purchase cost changed.
- If discount is applied, reduce only the selling price unless the user says some other cost changed.
- Clearly show the final profit or final loss.
- Do not continue unnecessary extra calculations after the main answer is clear.
- Clearly say if a discount creates a loss or weak margin.
- If calculation shows loss after discount, do not recommend that discount.
- When discount causes loss or very weak margin, suggest better options like:
  increase selling price, reduce discount, or create a bundle offer.
- Do not invent random numbers.
- If key numbers are missing, say what is missing in one short line.
- For every reply, use this exact section structure and exact section titles:
  Situation
  Manager Insight
  Decision
  Today's Priority
  Action Steps
  Watch
- Situation should reflect the current pricing or margin situation in 1 to 2 short lines.
- Manager Insight should explain the business meaning of the math, not only the formula.
- Decision should clearly state what Neurova has decided based on the numbers.
- Today's Priority must contain only one priority.
- Action Steps must contain 2 to 4 short numbered steps.
- Watch should mention one metric or number to monitor next.
- Decision should identify the real operating lever first, such as pricing, repeat customers,
  customer acquisition, visibility, or service quality.
- Prioritize the lowest-cost, highest-impact move first.
- Avoid theory-heavy business language.
- Prefer local-shop actions like combos, minimum order offers, delivery charges,
  WhatsApp follow-up, bundle pricing, and simple gifts over generic advice.
- If you suggest strategy around the calculation, each point should include:
  why it works, what to do, and one practical example.
- Keep the answer short and practical, especially inside a multi-question reply.
- Avoid long explanations.
- If discounting is involved, include one simple profit example when helpful.
- Do not repeat the same sentence in different words.
- Action Steps must be concrete same-day actions, not vague advice.
- Each step should be executable within 24 hours and should not require a large budget.
- If target language is Hinglish and any line sounds too English, rewrite it in cleaner Hinglish before replying.
- ${
    isFollowUp
      ? "This is a follow-up. Continue the same calculation topic."
      : "Answer the current calculation directly."
  }

Structured business context:
${contextSummary}
`.trim();
}

export async function runDeepseekReasoning({
  messages,
  contextSummary,
  isFollowUp,
}: DeepseekReasoningParams): Promise<DeepseekReasoningResult> {
  const apiKey = getDeepseekApiKey();

  // Safe debug log: we only print whether the key exists and its length.
  // This helps debugging without exposing the secret itself.
  console.log("[deepseekReasoning] DEEPSEEK_API_KEY loaded:", {
    exists: apiKey.length > 0,
    length: apiKey.length,
  });

  if (!apiKey) {
    console.warn(
      "[deepseekReasoning] DEEPSEEK_API_KEY is missing. Returning fallback message."
    );
    return {
      ok: false,
      reply: null,
      errorMessage: "DEEPSEEK_API_KEY missing hai.",
    };
  }

  try {
    const deepseekClient = createDeepseekClient(apiKey);
    const completion = await deepseekClient.chat.completions.create({
      // DeepSeek docs use the OpenAI-compatible chat completions API.
      // Base URL: https://api.deepseek.com
      // Model: deepseek-reasoner
      model: "deepseek-reasoner",
      messages: [
        {
          role: "system",
          content: buildSystemPrompt(contextSummary, isFollowUp),
        },
        ...messages,
      ],
    });

    const reply = completion.choices[0]?.message?.content?.trim();

    if (!reply) {
      console.error("[deepseekReasoning] DeepSeek returned an empty response.");
      return {
        ok: false,
        reply: null,
        errorMessage: "DeepSeek ne empty response diya.",
      };
    }

    return {
      ok: true,
      reply: sanitizeIdentityWording(reply),
      errorMessage: null,
    };
  } catch (error) {
    const formattedError = formatDeepseekError(error);

    console.error(
      "[deepseekReasoning] Request failed with DeepSeek API error:",
      formattedError
    );

    return {
      ok: false,
      reply: null,
      errorMessage:
        typeof formattedError.message === "string"
          ? formattedError.message
          : "DeepSeek reasoning API abhi available nahi hai.",
    };
  }
}
