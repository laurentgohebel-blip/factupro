import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") || Deno.env.get("Resend email");
const FROM_EMAIL = Deno.env.get("FROM_EMAIL") || "FactuPro <noreply@synapserh.fr>";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Génère une version texte brut à partir du HTML (évite le spam)
function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<\/tr>/gi, "\n")
    .replace(/<\/td>/gi, " | ")
    .replace(/<\/th>/gi, " | ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&euro;/g, "€")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    if (!RESEND_API_KEY) {
      return new Response(JSON.stringify({ error: "RESEND_API_KEY manquant dans les secrets Supabase" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { to, subject, html, replyTo, attachment } = await req.json();

    if (!to || !subject || !html) {
      return new Response(JSON.stringify({ error: "Paramètres manquants : to, subject, html requis" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const text = htmlToText(html);

    const payload: Record<string, unknown> = {
      from: FROM_EMAIL,
      to,
      subject,
      html,
      text,
      headers: {
        "X-Entity-Ref-ID": crypto.randomUUID(),
      },
    };

    if (replyTo) payload.reply_to = replyTo;

    // Pièce jointe PDF (base64)
    if (attachment?.content && attachment?.filename) {
      payload.attachments = [{ filename: attachment.filename, content: attachment.content }];
    }

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const data = await res.json();

    if (!res.ok) {
      return new Response(JSON.stringify({ error: data?.message || data?.name || JSON.stringify(data) }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ success: true, id: data.id }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
