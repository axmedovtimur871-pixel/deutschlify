// DEUTSCH KOMPASS · live voice tutor (Supabase Edge Function)
//
// POST /functions/v1/realtime  { level: "A1".."C2", style?: string }
//   -> { value, expires_at, model }
//
// Returns a short-lived client secret for the OpenAI Realtime API. The browser uses it to open a WebRTC
// call directly with OpenAI, so audio never passes through this function and the real API key never reaches the page.
// - The caller must be signed in with Supabase Auth (verified by the gateway, read here from the JWT).
// - The OpenAI key lives only in the function secret OPENAI_API_KEY.
// - Only the level and a short style name come from the client; the instructions are written here.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const MODEL = Deno.env.get("REALTIME_MODEL") ?? "gpt-realtime";
const VOICE = Deno.env.get("REALTIME_VOICE") ?? "marin";
const LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"];
const STYLES: Record<string, string> = {
  friendly: "Warm and encouraging, like a patient school teacher.",
  strict: "Clear and disciplined, corrects every mistake briefly.",
  friend: "Relaxed and conversational, like a friend who speaks German.",
  examiner: "Neutral and exam-like, asks the learner to answer and then gives a short evaluation.",
};

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

function instructions(level: string, style: string) {
  return [
    "You are DEUTSCH KOMPASS, a personal German teacher speaking with a learner whose Uzbek is their first language.",
    `Learner level: CEFR ${level}. Keep German at or slightly above this level; use simple sentences for A1–A2.`,
    `Teaching style: ${STYLES[style] ?? STYLES.friendly}`,
    "Languages: speak German when practising. Explain grammar, meanings and corrections in Uzbek (Latin script) when the learner needs help. If the learner speaks Uzbek or Russian, understand them and answer in the language they used, then bring the conversation back to German.",
    "Corrections: when the learner makes a mistake, say the corrected sentence in German once, then give a one-sentence reason in Uzbek. Do not interrupt a sentence that is still being spoken.",
    "Keep every turn short (two or three sentences) and end with one question so the learner keeps talking. Never read out lists of rules unless asked.",
    "If you did not hear something clearly, ask the learner to repeat it in German. Do not invent what they said.",
  ].join("\n");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const auth = req.headers.get("authorization") ?? "";
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: auth } },
  });
  const { data: u, error: uerr } = await supabase.auth.getUser();
  if (uerr || !u?.user) return json({ error: "unauthorized" }, 401);

  let body: { level?: string; style?: string } = {};
  try { body = await req.json(); } catch (_) { return json({ error: "bad_json" }, 400); }
  const level = LEVELS.includes(String(body.level)) ? String(body.level) : "A1";
  const style = STYLES[String(body.style)] ? String(body.style) : "friendly";

  const key = Deno.env.get("OPENAI_API_KEY");
  if (!key) return json({ error: "not_configured" }, 503);

  const r = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      session: {
        type: "realtime",
        model: MODEL,
        instructions: instructions(level, style),
        audio: {
          input: {
            transcription: { model: "gpt-4o-transcribe", language: "de" },
            turn_detection: { type: "server_vad", silence_duration_ms: 600 },
          },
          output: { voice: VOICE },
        },
      },
    }),
  });
  if (!r.ok) {
    console.error("openai client_secrets failed", r.status);
    return json({ error: "upstream", status: r.status }, 502);
  }
  const d = await r.json();
  return json({ value: d.value, expires_at: d.expires_at, model: MODEL });
});
