// DEUTSCH KOMPASS · email outbox sender (Supabase Edge Function)
//
// POST /functions/v1/send-email  (caller: an admin's signed-in session, or the service role)
//   -> { sent, failed, skipped }
//
// Sends queued messages from public.email_outbox through Resend. The Resend key lives only in the
// function secret RESEND_API_KEY. Without it nothing is sent and rows stay pending.
// MAIL_FROM (optional secret) sets the sender, e.g. "Deutsch Kompass <noreply@deutschkompass.uz>".
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const url = Deno.env.get("SUPABASE_URL")!;
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.replace(/^Bearer\s+/i, "");

  // Caller must be the service role or an admin / super_admin.
  if (token !== service) {
    const userDb = createClient(url, anon, { global: { headers: { Authorization: auth } } });
    const { data: u } = await userDb.auth.getUser();
    if (!u?.user) return json({ error: "unauthorized" }, 401);
    const { data: prof } = await userDb.from("profiles").select("role").eq("id", u.user.id).maybeSingle();
    if (!prof || (prof.role !== "admin" && prof.role !== "super_admin")) return json({ error: "forbidden" }, 403);
  }

  const key = Deno.env.get("RESEND_API_KEY");
  if (!key) return json({ error: "not_configured", sent: 0, failed: 0, skipped: 0 }, 503);
  const from = Deno.env.get("MAIL_FROM") ?? "Deutsch Kompass <onboarding@resend.dev>";

  const db = createClient(url, service);
  const { data: rows, error } = await db.from("email_outbox").select("*")
    .eq("status", "pending").lt("attempts", 5).order("created_at", { ascending: true }).limit(25);
  if (error) return json({ error: "db" }, 500);

  let sent = 0, failed = 0;
  for (const row of rows ?? []) {
    try {
      const r = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from,
          to: [row.to_email],
          subject: row.subject,
          html: `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.6;color:#0b1020">` +
            `<h2 style="color:#0b1d4d;margin:0 0 12px">Deutsch Kompass</h2><p>${esc(row.body)}</p></div>`,
        }),
      });
      if (!r.ok) throw new Error("resend " + r.status);
      await db.from("email_outbox").update({ status: "sent", sent_at: new Date().toISOString(), attempts: row.attempts + 1, last_error: null }).eq("id", row.id);
      sent++;
    } catch (e) {
      const attempts = row.attempts + 1;
      await db.from("email_outbox").update({ status: attempts >= 5 ? "failed" : "pending", attempts, last_error: String(e.message || e).slice(0, 300) }).eq("id", row.id);
      failed++;
    }
  }
  return json({ sent, failed, skipped: 0 });
});
