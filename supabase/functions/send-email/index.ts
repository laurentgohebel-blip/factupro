import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") || Deno.env.get("Resend email");

// Adresse d'expédition — DOIT être sur un domaine vérifié chez Resend.
// Aucune valeur codée en dur : une configuration absente doit échouer
// bruyamment, pas envoyer dans le vide (incident synapserh.fr, nov. 2026).
const FROM_ADDRESS = Deno.env.get("FROM_ADDRESS"); // ex. facturation@osmosetechnologies.fr
const FROM_EMAIL = Deno.env.get("FROM_EMAIL");     // ex. FactuPro <facturation@osmosetechnologies.fr>

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

// Le nom d'expéditeur part dans un en-tête : on retire tout ce qui pourrait
// casser le parsing de l'adresse ou injecter un en-tête supplémentaire.
function cleanName(n: unknown): string {
  return String(n ?? "")
    .replace(/[\r\n<>";,]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
}

// Expéditeur affiché : le nom de l'entreprise émettrice, pas « FactuPro ».
// Le client reçoit une facture signée par celui qui la lui envoie.
function buildFrom(fromName: unknown): string {
  const name = cleanName(fromName);
  if (name && FROM_ADDRESS) return `${name} <${FROM_ADDRESS}>`;
  if (FROM_EMAIL) return FROM_EMAIL;
  return `FactuPro <${FROM_ADDRESS}>`;
}

// Version texte brut à partir du HTML (une partie text/plain réduit le score spam).
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
      return json({ error: "RESEND_API_KEY manquant dans les secrets Supabase" });
    }
    if (!FROM_ADDRESS && !FROM_EMAIL) {
      return json({
        error:
          "FROM_ADDRESS (ou FROM_EMAIL) manquant dans les secrets Supabase — aucun domaine d'expédition configuré",
      });
    }

    const { to, subject, html, replyTo, attachment, fromName } = await req.json();

    if (!to || !subject || !html) {
      return json({ error: "Paramètres manquants : to, subject, html requis" });
    }

    const from = buildFrom(fromName);

    const payload: Record<string, unknown> = {
      from,
      to,
      subject,
      html,
      text: htmlToText(html),
      headers: { "X-Entity-Ref-ID": crypto.randomUUID() },
    };

    if (replyTo) payload.reply_to = replyTo;

    // Pièce jointe PDF (base64 nu, sans préfixe data:)
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

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      // Tracé dans les logs Supabase pour diagnostic a posteriori.
      console.error(`Resend ${res.status} from=${from} to=${to} :`, JSON.stringify(data));
      return json({
        error: data?.message || data?.name || `Resend ${res.status}`,
        status: res.status,
        from,
      });
    }

    console.log(`Resend OK id=${data.id} from=${from} to=${to}`);
    return json({ success: true, id: data.id, from });

  } catch (err) {
    console.error("send-email:", err);
    return json({ error: (err as Error).message });
  }
});
