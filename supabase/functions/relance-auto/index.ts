import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ⚠️ Déployer avec "Verify JWT" DÉSACTIVÉ (déclenché par pg_cron, pas un user).
// Sécurité : header x-cron-secret == CRON_SECRET.
// Relance automatiquement les factures impayées des entreprises PRO,
// échelonné J+7 / J+15 / J+30 (une relance par palier).

const admin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") || Deno.env.get("Resend email");
const FROM_EMAIL = Deno.env.get("FROM_EMAIL") || "FactuPro <noreply@synapserh.fr>";
const CRON_SECRET = Deno.env.get("CRON_SECRET");

const THRESHOLDS = [7, 15, 30]; // jours de retard déclenchant la relance n°1/2/3
const fmt = (n: number) => (n || 0).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).replace(/[  ]/g, " ") + " €";

serve(async (req) => {
  if (CRON_SECRET && req.headers.get("x-cron-secret") !== CRON_SECRET) {
    return new Response("Non autorisé", { status: 401 });
  }

  try {
    const today = new Date();
    const day = 86400000;

    // 1) Entreprises Pro
    const { data: subs } = await admin.from("subscriptions").select("entreprise_id, plan").eq("plan", "pro");
    const proIds = new Set((subs || []).map((s) => s.entreprise_id));
    if (proIds.size === 0) return json({ sent: 0, message: "Aucune entreprise Pro" });

    // 2) Factures impayées échues des entreprises Pro
    const { data: factures } = await admin
      .from("factures")
      .select("id, numero, date_echeance, taux_tva, entreprise_id, statut, type, clients(nom, email), entreprises(nom, email), facture_lignes(quantite, prix_unitaire)")
      .eq("statut", "envoyee")
      .lt("date_echeance", today.toISOString().slice(0, 10));

    let sent = 0;
    const errors: string[] = [];

    for (const f of factures || []) {
      if (f.type === "avoir" || !proIds.has(f.entreprise_id)) continue;
      const client = f.clients as { nom?: string; email?: string } | null;
      if (!client?.email) continue;

      const daysOverdue = Math.floor((today.getTime() - new Date(f.date_echeance).getTime()) / day);

      // Nombre de relances déjà envoyées pour cette facture
      const { count } = await admin.from("relances").select("*", { count: "exact", head: true }).eq("facture_id", f.id);
      const nb = count || 0;
      if (nb >= THRESHOLDS.length) continue;          // 3 relances max
      if (daysOverdue < THRESHOLDS[nb]) continue;     // palier pas encore atteint

      const niveau = nb + 1;
      const ht = (f.facture_lignes || []).reduce((s: number, l: { quantite: number; prix_unitaire: number }) => s + (l.quantite * l.prix_unitaire), 0);
      const ttc = ht * (1 + (parseFloat(String(f.taux_tva)) || 0) / 100);
      const ent = f.entreprises as { nom?: string; email?: string } | null;

      try {
        await sendRelance(client.email, client.nom || "", f.numero, ttc, daysOverdue, niveau, ent);
        await admin.from("relances").insert({ facture_id: f.id, type: "email", notes: `Relance auto niveau ${niveau} (J+${daysOverdue})` });
        sent++;
      } catch (e) {
        errors.push(`${f.numero}: ${e.message}`);
      }
    }

    return json({ sent, errors });
  } catch (err) {
    return json({ error: err.message }, 500);
  }
});

async function sendRelance(to: string, nomClient: string, numero: string, ttc: number, jours: number, niveau: number, ent: { nom?: string; email?: string } | null) {
  if (!RESEND_API_KEY) throw new Error("RESEND_API_KEY manquant");
  const intro = niveau === 1
    ? `Sauf erreur de notre part, la facture ${numero} d'un montant de ${fmt(ttc)} reste impayée à ce jour (échéance dépassée de ${jours} jours).`
    : niveau === 2
    ? `Malgré notre précédent rappel, la facture ${numero} d'un montant de ${fmt(ttc)} demeure impayée (${jours} jours de retard). Nous vous remercions de régulariser rapidement.`
    : `MISE EN DEMEURE — La facture ${numero} d'un montant de ${fmt(ttc)} reste impayée malgré nos relances (${jours} jours de retard). À défaut de règlement sous 8 jours, nous nous réservons le droit d'engager les démarches de recouvrement.`;

  const titre = niveau >= 3 ? "Mise en demeure" : `Relance n°${niveau}`;
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="margin:0;background:#f4f4f0;font-family:Arial,sans-serif">
<div style="max-width:600px;margin:24px auto;background:#fff;border-radius:14px;overflow:hidden">
  <div style="background:linear-gradient(135deg,#1B4332,#40916C);padding:22px 28px;color:#fff">
    <div style="font-size:20px;font-weight:800">⚡ ${ent?.nom || "FactuPro"}</div>
    <div style="font-size:13px;opacity:.8">${titre}</div>
  </div>
  <div style="padding:24px 28px;font-size:14px;color:#333;line-height:1.7">
    <p>Bonjour ${nomClient},</p>
    <p>${intro}</p>
    <p>Nous vous remercions de bien vouloir procéder au règlement dans les meilleurs délais.</p>
    <p>Cordialement,<br>${ent?.nom || ""}</p>
  </div>
</div></body></html>`;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: FROM_EMAIL, to, subject: `${titre} — Facture ${numero}`, html, reply_to: ent?.email || undefined }),
  });
  if (!res.ok) {
    const d = await res.json().catch(() => ({}));
    throw new Error(d?.message || `Resend ${res.status}`);
  }
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
