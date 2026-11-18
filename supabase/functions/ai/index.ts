// DEUTSCH KOMPASS · AI Lehrer backend (Supabase Edge Function)
//
// POST /functions/v1/ai   { messages: [{role, content}], level: "A1".."C1", mode: "free"|"grammar"|"check"|"speak" }
//   -> { reply: string, remaining: number }
// POST /functions/v1/ai   { mode: "board", level, messages: [{role: "user", content: <topic>}] }
//   -> { board: { title, steps: [{say, heading, kind, lines: [{de, uz}]}], question: {prompt, answers, explain} }, remaining }
// POST /functions/v1/ai   { mode: "word", level, messages: [{role: "user", content: <one word>}] }
//   -> { word: { word, pos, article, uz, definition_de, definition_uz, example_de, example_uz, synonyms, antonyms, note }, remaining }
//      or 422 { error: "not_a_word" } when the input is not a German or Uzbek word
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
const LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"];
const MODES = ["free", "grammar", "check", "speak", "board", "word", "talk"];
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
        required: ["say", "heading", "kind", "lines", "items"],
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
          items: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["type", "de", "uz", "header", "rows"],
              properties: {
                type: { type: "string", enum: ["rule", "example", "table", "conjugation", "arrow", "note"] },
                de: { type: "string" },
                uz: { type: "string" },
                header: { type: "array", items: { type: "string" } },
                rows: {
                  type: "array",
                  items: {
                    type: "object",
                    additionalProperties: false,
                    required: ["cells"],
                    properties: { cells: { type: "array", items: { type: "string" } } },
                  },
                },
              },
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

// Dictionary card for one word (structured outputs).
const WORD_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["ok", "word", "pos", "article", "uz", "definition_de", "definition_uz", "example_de", "example_uz", "synonyms", "antonyms", "note"],
  properties: {
    ok: { type: "boolean" },
    word: { type: "string" },
    pos: { type: "string", enum: ["Nomen", "Verb", "Adjektiv", "Adverb", "Präposition", "Konjunktion", "Pronomen", "Ausdruck", "Sonstiges"] },
    article: { type: "string", enum: ["der", "die", "das", ""] },
    uz: { type: "string" },
    definition_de: { type: "string" },
    definition_uz: { type: "string" },
    example_de: { type: "string" },
    example_uz: { type: "string" },
    synonyms: { type: "array", items: { type: "string" } },
    antonyms: { type: "array", items: { type: "string" } },
    note: { type: "string" },
  },
};

// Conversation partners (AI Sprecher). One engine, four personality configurations.
const PERSONA_IDS = ["strict", "romantic", "funny", "friendly"];
const LEVEL_GUIDE: Record<string, string> = {
  A1: "very simple sentences in the present tense, common everyday words, one idea per sentence",
  A2: "short, clear sentences about everyday life, simple past and perfect",
  B1: "connected sentences, opinions and experiences, some subordinate clauses with weil and dass",
  B2: "natural, flowing speech, arguments and abstract topics, varied connectors",
  C1: "precise, nuanced language, complex structures and idiomatic expressions where natural",
  C2: "near-native fluency, subtle nuance, idiom and register awareness",
};
const PERSONA_GUIDE: Record<string, string> = {
  strict: "Your personality is QATTIQQO‘L: a strict, demanding examiner-teacher. Use the formal Sie-form, short direct sentences and no small talk. Praise only with one short word such as \"Richtig.\". Insist on complete sentences. Never insult or mock the learner.",
  romantic: "Your personality is ROMANTIK: warm, poetic and gentle, using the du-form. Describe things with feeling, compliment the learner's effort, and ask about their dreams and feelings. Stay respectful and tasteful; never flirt explicitly and never claim to be a real person.",
  funny: "Your personality is HAZILKASH: playful and witty, using the du-form. Use light jokes and funny but simple German examples suited to the level. You may use the emotion tag [laughter] at most once per reply. Laugh with the learner about mistakes, never at the learner.",
  friendly: "Your personality is DO‘STONA: a supportive, friendly conversation partner using the du-form and a relaxed everyday tone. Encourage the learner, ask follow-up questions about their life and celebrate their progress.",
};
const TALK_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["reply_de", "corrections", "uz", "tip_uz"],
  properties: {
    reply_de: { type: "string" },
    corrections: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["wrong", "right", "why_uz"],
        properties: { wrong: { type: "string" }, right: { type: "string" }, why_uz: { type: "string" } },
      },
    },
    uz: { type: "string" },
    tip_uz: { type: "string" },
  },
};

function talkPrompt(level: string, persona: string): string {
  return [
    "You are a German conversation partner inside DEUTSCH KOMPASS, a German-learning app for Uzbek speakers.",
    `Speak German at CEFR level ${level}: ${LEVEL_GUIDE[level]}.`,
    PERSONA_GUIDE[persona],
    "reply_de is your German reply: at most two short sentences and under 220 characters. End it with a question that invites the learner to answer.",
    "corrections: list only real grammar, word-order or word-choice mistakes in the learner's LAST message. Quote the wrong part exactly as written, give the corrected version, and explain briefly in Uzbek (Latin script) in why_uz. Do not correct style preferences. If there are no mistakes, return an empty array.",
    "uz: leave it an empty string unless the learner asks for an Uzbek explanation. When they ask, explain your previous German reply in simple Uzbek (Latin script) and keep reply_de as a short German follow-up.",
    "tip_uz: one short, encouraging Uzbek tip for improving, or an empty string.",
    "Stay on learning German and everyday conversation. If asked about something unrelated, say briefly in German that you talk about German, and ask a question.",
  ].join("\n");
}

function wordPrompt(level: string): string {
  return [
    "You are a German–Uzbek dictionary inside DEUTSCH KOMPASS, a German-learning platform for Uzbek speakers.",
    "The user types ONE word. It may be German or Uzbek.",
    "If it is Uzbek, `word` is the German equivalent (correct German spelling, capitalised for nouns) and `uz` is the Uzbek word the user typed.",
    "If it is German, `word` is the German word as written in its dictionary form, and `uz` is its Uzbek translation.",
    "If the input is neither a German nor an Uzbek word or short phrase, set `ok` to false and leave every other field empty (empty strings and empty arrays).",
    `The learner's level is ${level} (CEFR). Choose simple vocabulary for the definition and the example that fits this level.`,
    "Write Uzbek in Latin script. `definition_de` is one short, simple German sentence explaining the meaning. `definition_uz` gives the same meaning in Uzbek.",
    "`example_de` is one natural German sentence that uses the word correctly; `example_uz` is its Uzbek translation.",
    "`synonyms`: up to three German synonyms that fit this level. `antonyms`: up to three German antonyms; use an empty array when the word has no real opposite.",
    "`pos` is the part of speech in German (Nomen, Verb, Adjektiv, Adverb, Präposition, Konjunktion, Pronomen, Ausdruck, Sonstiges). `article` is der, die or das for nouns and an empty string otherwise.",
    "`note` is empty unless there is an important usage hint, then one short Uzbek sentence.",
    "Every German form must be correct standard German. If you are not sure, leave the field out rather than guess.",
  ].join("\n");
}

// Blackboard lessons come back as JSON in exactly this shape, so the page can draw them step by step.
function boardPrompt(level: string): string {
  return [
    "You are AI Lehrer, the German teacher inside DEUTSCH KOMPASS, a German-learning platform for Uzbek speakers.",
    `The learner's level is ${level} (CEFR). They name a topic and you teach it on a blackboard, step by step.`,
    "Write a lesson of 5 to 7 steps that builds from the simplest idea to the harder parts.",
    "For each step: `say` is what you tell the learner in Uzbek (Latin script), one or two friendly sentences. `heading` is a short title for the board block. `lines` are one to four board lines: `de` holds the German form, pattern or example sentence (for instance \"spielen → gespielt\" or \"Ich habe Fußball gespielt.\"), `uz` holds its Uzbek meaning or a very short note, and may be empty.",
    "`kind` is \"rule\" for a rule or pattern, \"examples\" for example sentences, \"compare\" for two things set side by side, and \"warning\" for a typical mistake learners make.",
    "Include one \"warning\" step when the topic has a well-known trap.",
    "Finish with `question`: `prompt` asks in Uzbek for one short German answer that checks the lesson, `answers` lists every spelling you would accept, and `explain` gives the reason in Uzbek.",
    "Every German form and example must be correct standard German. If you are unsure about a detail, leave it out rather than guess.",
    "`items` is what is drawn on the board for a step, 0 to 4 items per step. Use `rule` to highlight a grammar rule (de = the rule, uz = its explanation); `example` for a German sentence (de) with its Uzbek translation (uz); `table` for a table with `header` (column titles) and `rows` (each row has `cells`), for instance the articles der, die, das with their nouns; `conjugation` for a verb table (header: ich, du, er/sie/es, wir, ihr, sie/Sie); `arrow` for how parts connect (de = the pattern, for instance \"Subjekt → Verb → Objekt\", uz = what it means); `note` for a short Uzbek remark (uz). Fill only the fields an item uses and leave the others as an empty string or empty array.",
    "`title` names the topic in Uzbek, with the German term in brackets where there is one.",
    "If the request is not about learning German, return an empty `steps` array, put a short Uzbek sentence in `title` saying that you teach German topics, and leave the question fields empty.",
  ].join("\n");
}

const BOARD_KINDS = ["rule", "examples", "compare", "warning"];
const ITEM_TYPES = ["rule", "example", "table", "conjugation", "arrow", "note"];
const clip = (v: unknown, n: number) => (typeof v === "string" ? v.trim().slice(0, n) : "");
// Keeps only well-formed visual items; anything malformed is dropped rather than shown half-drawn.
function cleanItem(x: any) {
  if (!x || !ITEM_TYPES.includes(x.type)) return null;
  const rows = (Array.isArray(x.rows) ? x.rows : []).slice(0, 8)
    .map((r: any) => ({ cells: (Array.isArray(r?.cells) ? r.cells : []).slice(0, 5).map((c: unknown) => clip(c, 80)).filter(Boolean) }))
    .filter((r: any) => r.cells.length);
  const header = (Array.isArray(x.header) ? x.header : []).slice(0, 5).map((c: unknown) => clip(c, 80)).filter(Boolean);
  const out = { type: x.type as string, de: clip(x.de, 200), uz: clip(x.uz, 200), header, rows };
  if (x.type === "table" || x.type === "conjugation") return rows.length ? out : null;
  return out.de || out.uz ? out : null;
}
function cleanBoard(b: any) {
  const steps = (Array.isArray(b.steps) ? b.steps : []).slice(0, 8).map((s: any) => ({
    say: clip(s?.say, 600),
    heading: clip(s?.heading, 120),
    kind: BOARD_KINDS.includes(s?.kind) ? s.kind : "rule",
    lines: (Array.isArray(s?.lines) ? s.lines : []).slice(0, 4).map((l: any) => ({ de: clip(l?.de, 200), uz: clip(l?.uz, 200) })).filter((l: any) => l.de),
    items: (Array.isArray(s?.items) ? s.items : []).slice(0, 6).map(cleanItem).filter(Boolean),
  })).filter((s: any) => s.heading && (s.lines.length || s.items.length));
  const q = b.question || {};
  return {
    title: clip(b.title, 200),
    steps,
    question: {
      prompt: clip(q.prompt, 300),
      answers: (Array.isArray(q.answers) ? q.answers : []).slice(0, 5).map((a: unknown) => clip(a, 120)).filter(Boolean),
      explain: clip(q.explain, 400),
    },
  };
}

function systemPrompt(level: string, mode: string): string {
  return [
    "You are AI Lehrer, the German teacher inside DEUTSCH KOMPASS, a German-learning platform for Uzbek speakers.",
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
  let body: { messages?: unknown; level?: unknown; mode?: unknown; persona?: unknown };
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
    if (mode === "talk") {
      const persona = PERSONA_IDS.includes(body.persona as string) ? (body.persona as string) : "friendly";
      const response = await client.messages.create({
        model: MODEL,
        max_tokens: 1200,
        system: talkPrompt(level, persona),
        output_config: { effort: "low", format: { type: "json_schema", schema: TALK_SCHEMA } },
        messages,
      });
      const usage = response.usage;
      if (response.stop_reason === "refusal") {
        await log("refused", usage.input_tokens, usage.output_tokens);
        return json({ error: "refused" }, 422);
      }
      let turn: { reply_de?: unknown; corrections?: unknown; uz?: unknown; tip_uz?: unknown } | null = null;
      try {
        turn = JSON.parse(response.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join(""));
      } catch {
        turn = null;
      }
      if (!turn || typeof turn.reply_de !== "string" || !Array.isArray(turn.corrections)) {
        await log("schema_invalid", usage.input_tokens, usage.output_tokens);
        return json({ error: "ai_error" }, 502);
      }
      await log("ok", usage.input_tokens, usage.output_tokens);
      return json({ turn, remaining: DAILY_LIMIT - used });
    }
    if (mode === "word") {
      const response = await client.messages.create({
        model: MODEL,
        max_tokens: 1200,
        system: wordPrompt(level),
        output_config: { effort: "low", format: { type: "json_schema", schema: WORD_SCHEMA } },
        messages: [{ role: "user", content: messages[messages.length - 1].content.slice(0, 60) }],
      });
      const usage = response.usage;
      if (response.stop_reason === "refusal") {
        await log("refused", usage.input_tokens, usage.output_tokens);
        return json({ error: "not_a_word", remaining: DAILY_LIMIT - used }, 422);
      }
      let word: { ok?: unknown; word?: unknown } | null = null;
      try {
        word = JSON.parse(response.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join(""));
      } catch {
        word = null;
      }
      if (!word || typeof word.word !== "string") {
        await log("schema_invalid", usage.input_tokens, usage.output_tokens);
        return json({ error: "ai_error" }, 502);
      }
      await log("ok", usage.input_tokens, usage.output_tokens);
      if (!word.ok || !word.word.trim()) return json({ error: "not_a_word", remaining: DAILY_LIMIT - used }, 422);
      return json({ word, remaining: DAILY_LIMIT - used });
    }
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
      return json({ board: cleanBoard(board), remaining: DAILY_LIMIT - used });
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
