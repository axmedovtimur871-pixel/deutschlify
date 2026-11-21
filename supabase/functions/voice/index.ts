// DEUTSCH KOMPASS · spoken Uzbek and German (Supabase Edge Function)
//
// POST /functions/v1/voice  { text: string, lang: "uz" | "de" }  ->  audio/mpeg
//
// Turns a short text into speech with OpenAI's text-to-speech model. Used when the NeuronAI voice is not available,
// because the device usually has no Uzbek voice. The OpenAI key stays in the function secret OPENAI_API_KEY.
// - The caller must be signed in (the gateway verifies the JWT).
// - Text is limited to 600 characters per request.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const MODEL = Deno.env.get("TTS_MODEL") ?? "gpt-4o-mini-tts";
const VOICE = Deno.env.get("TTS_VOICE") ?? "coral";
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  let body: { text?: string; lang?: string } = {};
  try { body = await req.json(); } catch (_) { return json({ error: "bad_json" }, 400); }
  const text = String(body.text ?? "").replace(/\s+/g, " ").trim();
  if (!text) return json({ error: "empty" }, 400);
  if (text.length > 600) return json({ error: "too_long" }, 413);

  const key = Deno.env.get("OPENAI_API_KEY");
  if (!key) return json({ error: "not_configured" }, 503);

  const instructions = body.lang === "uz"
    ? "Speak Uzbek (Latin script) naturally and clearly, at a calm teaching pace."
    : "Speak German naturally and clearly, at a calm teaching pace.";
  const r = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: MODEL, voice: VOICE, input: text, instructions, response_format: "mp3" }),
  });
  if (!r.ok) {
    console.error("openai speech failed", r.status);
    return json({ error: "upstream", status: r.status }, 502);
  }
  return new Response(r.body, { headers: { ...cors, "Content-Type": "audio/mpeg", "Cache-Control": "private, max-age=3600" } });
});
