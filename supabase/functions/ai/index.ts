// Deutschlify · AI Lehrer backend (Supabase Edge Function)
//
// POST /functions/v1/ai   { messages: [{role, content}], level: "A1".."C1", mode: "free"|"grammar"|"check"|"speak" }
//   -> { reply: string, remaining: number }
// POST /functions/v1/ai   { mode: "board", level, messages: [{role: "user", content: <topic>}] }
//   -> { board: { title, steps: [{say, heading, kind, lines: [{de, uz}]}], question: {prompt, answers, explain} }, remaining }
//
// - The caller must be signed in with Supabase Auth; the gateway verifies the JWT and this function reads the user from it.
// - The Claude API key lives only in the function secret ANTHROPIC_API_KEY and never reaches the browser.
// - Every user has a daily message allowance (AI_DAILY_MESSAGES, default 30), counted in public.usage_daily.
// - No message text is stored or logged; public.ai_runs keeps only model, token counts, duration and status.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import Anthropic from "npm:@anthropic-ai/sdk@^0.136.0";
import { createClient } from "npm:@supabase/supabase-js@2";

const MODEL = Deno.env.get("AI_MODEL") ?? "claude-haiku-5-5";
const DAILY_LIMIT = Number(Deno.env.get("AI_DAILY_MESSAGES") ?? "30");
const LEVELS = ["A1", "A2", "B1", "B2", "C1"];
const MODES = ["free", "grammar", "check", "speak", "board"];
const MAX_TURNS = 16; // only the most recent turns are sent, to keep long chats affordable
const MAX_CHARS = 2000;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const MODE_GUIDE: Record<string, string> = {
  free: "The learner wants conversation practice. Reply in German at their level, keep the conversation going with one short question, and after your German reply add a brief Uzbek note only if they made a mistake worth fixing.",
  grammar: "The learner wants a grammar explanation. Explain in Uzbek, simply, with two or three short German examples and their Uzbek translations.",
  check: "The learner wants their German text checked. Quote each real mistake, give the corrected German, and explain the rule briefly in Uzbek. Then give the full corrected text. If the text is already correct, say so.",
  speak: "The text was produced by speech recognition from the learner speaking German, so ignore punctuation and capitalisation. Comment in Uzbek on word choice and grammar only. You cannot hear the audio, so say nothing about pronunciation.",
};

// Blackboard lessons come back as JSON in exactly this shape (structured outputs), so the page can draw them step by step.
const BOARD_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["title", "steps", "question"],
  properties: {
    title: { type: "string" },
    steps: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["say", "heading", "kind", "lines"],
        properties: {
          say: { type: "string" },
          heading: { type: "string" },
          kind: { type: "string", enum: ["rule", "examples", "compare", "warning"] },
          lines: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["de", "uz"],
              properties: { de: { type: "string" }, uz: { type: "string" } },
            },
          },
        },
      },
    },
    question: {
      type: "object",
      additionalProperties: false,
      required: ["prompt", "answers", "explain"],
      properties: { prompt: { type: "string" }, answers: { type: "array", items: { type: "string" } }, explain: { type: "string" } },
    },
  },
};

function boardPrompt(level: string): string {
  return [
    "You are AI Lehrer, the German teacher inside Deutschlify, a German-learning platform for Uzbek speakers.",
    `The learner's level is ${level} (CEFR). They name a topic and you teach it on a blackboard, step by step.`,
    "Write a lesson of 5 to 7 steps that builds from the simplest idea to the harder parts.",
    "For each step: `say` is what you tell the learner in Uzbek (Latin script), one or two friendly sentences. `heading` is a short title for the board block. `lines` are one to four board lines: `de` holds the German form, pattern or example sentence (for instance \"spielen → gespielt\" or \"Ich habe Fußball gespielt.\"), `uz` holds its Uzbek meaning or a very short note, and may be empty.",
    "`kind` is \"rule\" for a rule or pattern, \"examples\" for example sentences, \"compare\" for two things set side by side, and \"warning\" for a typical mistake learners make.",
    "Include one \"warning\" step when the topic has a well-known trap.",
    "Finish with `question`: `prompt` asks in Uzbek for one short German answer that checks the lesson, `answers` lists every spelling you would accept, and `explain` gives the reason in Uzbek.",
    "Every German form and example must be correct standard German. If you are unsure about a detail, leave it out rather than guess.",
    "`title` names the topic in Uzbek, with the German term in brackets where there is one.",
    "If the request is not about learning German, return an empty `steps` array, put a short Uzbek sentence in `title` saying that you teach German topics, and leave the question fields empty.",
  ].join("\n");
}

function systemPrompt(level: string, mode: string): string {
  return [
    "You are AI Lehrer, the German teacher inside Deutschlify, a German-learning platform for Uzbek speakers.",
    `The learner's level is ${level} (CEFR). Use German vocabulary and sentence length that fit this level.`,
    "Explanations are in Uzbek (Latin script). German examples stay in German.",
    "Be warm and encouraging, never condescending. Keep answers short: usually under 120 words unless the learner asks for more.",
    "Only correct genuine mistakes. Do not present a stylistic preference as an error.",
    "If you are not sure about a fact of German grammar or usage, say so instead of guessing.",
    "Stay on the subject of learning German. If asked for something unrelated, say briefly that you can help with German and offer a way to continue.",
    "Plain text only: no Markdown headings, tables or code blocks.",
    MODE_GUIDE[mode],
  ].join("\n");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) return json({ error: "ai_not_configured" }, 503);

  // Who is calling
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });
  const { data: auth, error: authError } = await admin.auth.getUser(token);
  if (authError || !auth?.user) return json({ error: "not_signed_in" }, 401);
  const userId = auth.user.id;

  // Validate the request
  let body: { messages?: unknown; level?: unknown; mode?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }
  const level = LEVELS.includes(body.level as string) ? (body.level as string) : "A1";
  const mode = MODES.includes(body.mode as string) ? (body.mode as string) : "free";
  if (!Array.isArray(body.messages) || body.messages.length === 0) return json({ error: "messages_required" }, 400);
  const messages: { role: "user" | "assistant"; content: string }[] = [];
  for (const m of body.messages.slice(-MAX_TURNS) as { role?: unknown; content?: unknown }[]) {
    if ((m?.role !== "user" && m?.role !== "assistant") || typeof m.content !== "string") return json({ error: "invalid_message" }, 400);
    const content = m.content.trim().slice(0, MAX_CHARS);
    if (content) messages.push({ role: m.role, content });
  }
  while (messages.length && messages[0].role !== "user") messages.shift(); // the API needs a user turn first
  if (!messages.length || messages[messages.length - 1].role !== "user") return json({ error: "last_message_must_be_user" }, 400);

  // Daily allowance (atomic: the database function increments only while under the limit)
  const { data: used, error: usageError } = await admin.rpc("bump_ai_usage", { p_user: userId, p_limit: DAILY_LIMIT });
  if (usageError) return json({ error: "usage_unavailable" }, 500);
  if (used === null) return json({ error: "daily_limit_reached", limit: DAILY_LIMIT }, 429);

  const started = Date.now();
  const log = (status: string, input_tokens: number | null = null, output_tokens: number | null = null) =>
    admin.from("ai_runs").insert({ step: "lehrer:" + mode, model: MODEL, input_tokens, output_tokens, duration_ms: Date.now() - started, status });

  try {
    const client = new Anthropic({ apiKey });
    if (mode === "board") {
      const response = await client.messages.create({
        model: MODEL,
        max_tokens: 6000,
        system: boardPrompt(level),
        output_config: { effort: "medium", format: { type: "json_schema", schema: BOARD_SCHEMA } },
        messages: [{ role: "user", content: messages[messages.length - 1].content.slice(0, 300) }],
      });
      const usage = response.usage;
      if (response.stop_reason === "refusal") {
        await log("refused", usage.input_tokens, usage.output_tokens);
        return json({ error: "refused" }, 422);
      }
      let board: { title?: unknown; steps?: unknown; question?: unknown } | null = null;
      try {
        board = JSON.parse(response.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join(""));
      } catch {
        board = null;
      }
      if (!board || typeof board.title !== "string" || !Array.isArray(board.steps)) {
        await log("schema_invalid", usage.input_tokens, usage.output_tokens);
        return json({ error: "ai_error" }, 502);
      }
      await log("ok", usage.input_tokens, usage.output_tokens);
      return json({ board, remaining: DAILY_LIMIT - used });
    }
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 2000,
      system: systemPrompt(level, mode),
      output_config: { effort: "low" },
      messages,
    });
    if (response.stop_reason === "refusal") {
      await log("refused", response.usage.input_tokens, response.usage.output_tokens);
      return json({ reply: "Kechirasiz, bu so‘rovga javob bera olmayman. Nemis tili bo‘yicha boshqa savol bering.", remaining: DAILY_LIMIT - used });
    }
    const reply = response.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("").trim();
    if (!reply) {
      await log("error", response.usage.input_tokens, response.usage.output_tokens);
      return json({ error: "empty_reply" }, 502);
    }
    await log("ok", response.usage.input_tokens, response.usage.output_tokens);
    return json({ reply, remaining: DAILY_LIMIT - used });
  } catch (error) {
    await log("error");
    if (error instanceof Anthropic.RateLimitError) return json({ error: "ai_busy" }, 429);
    if (error instanceof Anthropic.AuthenticationError) return json({ error: "ai_not_configured" }, 503);
    if (error instanceof Anthropic.APIError) return json({ error: "ai_error" }, 502);
    return json({ error: "server_error" }, 500);
  }
});
