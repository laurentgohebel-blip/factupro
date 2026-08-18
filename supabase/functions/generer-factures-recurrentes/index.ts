import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ⚠️ Déployer avec "Verify JWT" DÉSACTIVÉ (déclenché par pg_cron).
// Sécurité : header x-cron-secret == CRON_SECRET.
// Génère à chaque échéance une facture depuis chaque récurrence active (Pro).
//  - auto_envoi = false : facture BROUILLON (à valider dans l'app).
//  - auto_envoi = true  : facture ÉMISE (numérotée) + envoyée par email (HTML, sans PDF).
// Idempotent via l'index unique (recurrence_id, periode).

const admin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);
const CRON_SECRET = Deno.env.get("CRON_SECRET");
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") || Deno.env.get("Resend email");
const FROM_EMAIL = Deno.env.get("FROM_EMAIL") || "FactuPro <noreply@synapserh.fr>";

const MONTHS: Record<string, number> = { mensuelle: 1, trimestrielle: 3, annuelle: 12 };
const fmt = (n: number) => (n || 0).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).replace(/[  ]/g, " ") + " €";

function addMonths(dateStr: string, n: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const base = new Date(Date.UTC(y, m - 1 + n, 1));
  const lastDay = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + 1, 0)).getUTCDate();
  base.setUTCDate(Math.min(d, lastDay));
  return base.toISOString().slice(0, 10);
}
function addDays(dateStr: string, n: number): string {
  const dt = new Date(dateStr + "T00:00:00Z");
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}
function dfr(s: string) { try { return new Date(s).toLocaleDateString("fr-FR"); } catch { return s; } }

serve(async (req) => {
  if (CRON_SECRET && req.headers.get("x-cron-secret") !== CRON_SECRET) {
    return new Response("Non autorisé", { status: 401 });
  }

  try {
    const today = new Date().toISOString().slice(0, 10);

    const { data: subs } = await admin.from("subscriptions").select("entreprise_id").eq("plan", "pro");
    const proIds = new Set((subs || []).map((s) => s.entreprise_id));
    if (proIds.size === 0) return json({ generated: 0, message: "Aucune entreprise Pro" });

    const { data: recs } = await admin
      .from("recurrences").select("*").eq("statut", "active").lte("prochaine_generation", today);

    let generated = 0, sent = 0;
    const errors: string[] = [];

    for (const r of recs || []) {
      if (!proIds.has(r.entreprise_id)) continue;

      if (r.date_fin && r.prochaine_generation > r.date_fin) {
        await admin.from("recurrences").update({ statut: "terminee" }).eq("id", r.id);
        continue;
      }

      const periode = r.prochaine_generation.slice(0, 7);
      const echeance = addDays(r.prochaine_generation, r.delai_echeance || 30);

      // Numéro seulement si auto-envoi (facture émise) ; brouillon => null
      let numero: string | null = null;
      if (r.auto_envoi) {
        const { data: numData } = await admin.rpc("prochain_numero", { p_entreprise_id: r.entreprise_id, p_type: "facture" });
        numero = numData;
      }

      const { data: fac, error: facErr } = await admin
        .from("factures")
        .insert({
          entreprise_id: r.entreprise_id,
          client_id: r.client_id,
          recurrence_id: r.id,
          periode,
          numero,
          statut: r.auto_envoi ? "envoyee" : "brouillon",
          date_facture: r.prochaine_generation,
          date_echeance: echeance,
          taux_tva: r.taux_tva,
          type_operation: r.type_operation || "services",
          remise_type: r.remise_type || "montant",
          remise_valeur: r.remise_valeur || 0,
          notes: r.libelle || "",
        })
        .select()
        .single();

      if (facErr) {
        if (facErr.code !== "23505") { errors.push(`${r.id}: ${facErr.message}`); }
        // doublon => on avance quand même la date ci-dessous
      } else {
        const lignes = (r.lignes || []).map((l: any, i: number) => ({
          facture_id: fac.id, description: l.description, quantite: l.quantite, unite: l.unite, prix_unitaire: l.prix_unitaire, ordre: i,
        }));
        if (lignes.length) await admin.from("facture_lignes").insert(lignes);
        generated++;

        if (r.auto_envoi) {
          try { await envoyerFacture(r, fac, numero!, echeance); sent++; }
          catch (e) { errors.push(`envoi ${numero}: ${e.message}`); }
        }
      }

      const next = addMonths(r.prochaine_generation, MONTHS[r.frequence] || 1);
      const statut = (r.date_fin && next > r.date_fin) ? "terminee" : "active";
      await admin.from("recurrences").update({ prochaine_generation: next, statut }).eq("id", r.id);
    }

    return json({ generated, sent, errors });
  } catch (err) {
    return json({ error: err.message }, 500);
  }
});

async function envoyerFacture(r: any, fac: any, numero: string, echeance: string) {
  if (!RESEND_API_KEY) throw new Error("RESEND_API_KEY manquant");
  const { data: client } = await admin.from("clients").select("nom, email").eq("id", r.client_id).single();
  if (!client?.email) throw new Error("client sans email");
  const { data: ent } = await admin.from("entreprises").select("nom, adresse, email, iban").eq("id", r.entreprise_id).single();

  const lignes = r.lignes || [];
  const brut = lignes.reduce((s: number, l: any) => s + l.quantite * l.prix_unitaire, 0);
  const rv = parseFloat(r.remise_valeur) || 0;
  const remise = Math.min(r.remise_type === "pourcent" ? brut * rv / 100 : rv, brut);
  const net = brut - remise;
  const tv = parseFloat(r.taux_tva) || 20;
  const tva = net * tv / 100;
  const ttc = net + tva;

  const rows = lignes.map((l: any) =>
    `<tr><td style="padding:6px 8px;border-bottom:1px solid #eee">${l.description}</td><td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:center">${l.quantite} ${l.unite}</td><td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right">${fmt(l.prix_unitaire)}</td><td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right;font-weight:600">${fmt(l.quantite * l.prix_unitaire)}</td></tr>`
  ).join("");

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="margin:0;background:#f4f4f0;font-family:Arial,sans-serif">
<div style="max-width:600px;margin:24px auto;background:#fff;border-radius:14px;overflow:hidden">
  <div style="background:linear-gradient(135deg,#1B4332,#40916C);padding:22px 28px;color:#fff">
    <div style="font-size:20px;font-weight:800">${ent?.nom || "FactuPro"}</div>
    <div style="font-size:13px;opacity:.8">Facture ${numero}</div>
  </div>
  <div style="padding:24px 28px;font-size:14px;color:#333;line-height:1.7">
    <p>Bonjour ${client.nom || ""},</p>
    <p>Veuillez trouver ci-dessous votre facture <strong>${numero}</strong> du ${dfr(r.prochaine_generation)}.</p>
    <table style="width:100%;border-collapse:collapse;margin:14px 0">
      <thead><tr style="background:#1B4332;color:#fff"><th style="padding:6px 8px;text-align:left">Désignation</th><th style="padding:6px 8px">Qté</th><th style="padding:6px 8px;text-align:right">P.U.</th><th style="padding:6px 8px;text-align:right">Total HT</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div style="text-align:right;font-size:13px">
      Total HT : ${fmt(brut)}<br>
      ${remise > 0 ? `Remise : -${fmt(remise)}<br>Total HT net : ${fmt(net)}<br>` : ""}
      TVA (${tv}%) : ${fmt(tva)}<br>
      <strong style="font-size:16px;color:#1B4332">Total TTC : ${fmt(ttc)}</strong>
    </div>
    <p style="margin-top:16px">Échéance de paiement : <strong>${dfr(echeance)}</strong>${ent?.iban ? `<br>IBAN : ${ent.iban}` : ""}</p>
    <p>Cordialement,<br>${ent?.nom || ""}</p>
  </div>
</div></body></html>`;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: FROM_EMAIL, to: client.email, subject: `Facture ${numero} — ${ent?.nom || "FactuPro"}`, html, reply_to: ent?.email || undefined }),
  });
  if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d?.message || `Resend ${res.status}`); }
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
