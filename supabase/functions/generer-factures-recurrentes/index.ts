import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { PDFDocument, StandardFonts, rgb } from "https://esm.sh/pdf-lib@1.17.1";
import { encodeBase64, decodeBase64 } from "https://deno.land/std@0.224.0/encoding/base64.ts";

// ⚠️ Verify JWT DÉSACTIVÉ. Sécurité : header x-cron-secret == CRON_SECRET.
// Génère à chaque échéance une facture depuis chaque récurrence active (Pro).
//  - auto_envoi=false : BROUILLON (à valider dans l'app).
//  - auto_envoi=true  : ÉMISE (numérotée) + envoyée par email AVEC PDF joint (pdf-lib).

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const CRON_SECRET = Deno.env.get("CRON_SECRET");
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") || Deno.env.get("Resend email");
const FROM_EMAIL = Deno.env.get("FROM_EMAIL") || "FactuPro <noreply@synapserh.fr>";

const MONTHS: Record<string, number> = { mensuelle: 1, trimestrielle: 3, annuelle: 12 };
const GREEN = rgb(0.106, 0.263, 0.196);
const GREY = rgb(0.42, 0.42, 0.42);
const money = (n: number) => (n || 0).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).replace(/\s/g, " ") + " EUR";
// pdf-lib (WinAnsi) : on remplace tout caractère non encodable pour éviter un throw.
const safe = (s: unknown) => String(s ?? "").replace(/ | /g, " ").replace(/[^\x20-\x7E -ÿ]/g, "?");

function addMonths(dateStr: string, n: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const base = new Date(Date.UTC(y, m - 1 + n, 1));
  const lastDay = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + 1, 0)).getUTCDate();
  base.setUTCDate(Math.min(d, lastDay));
  return base.toISOString().slice(0, 10);
}
function addDays(dateStr: string, n: number): string { const dt = new Date(dateStr + "T00:00:00Z"); dt.setUTCDate(dt.getUTCDate() + n); return dt.toISOString().slice(0, 10); }
function dfr(s: string) { try { return new Date(s).toLocaleDateString("fr-FR"); } catch { return s; } }
function calc(r: any) {
  const lignes = r.lignes || [];
  const brut = lignes.reduce((s: number, l: any) => s + l.quantite * l.prix_unitaire, 0);
  const rv = parseFloat(r.remise_valeur) || 0;
  const remise = Math.min(r.remise_type === "pourcent" ? brut * rv / 100 : rv, brut);
  const net = brut - remise, tv = parseFloat(r.taux_tva) || 20, tva = net * tv / 100, ttc = net + tva;
  return { lignes, brut, remise, net, tv, tva, ttc };
}

serve(async (req) => {
  if (CRON_SECRET && req.headers.get("x-cron-secret") !== CRON_SECRET) return new Response("Non autorisé", { status: 401 });
  try {
    const today = new Date().toISOString().slice(0, 10);
    const { data: subs } = await admin.from("subscriptions").select("entreprise_id").eq("plan", "pro");
    const proIds = new Set((subs || []).map((s) => s.entreprise_id));
    if (proIds.size === 0) return json({ generated: 0, message: "Aucune entreprise Pro" });

    const { data: recs } = await admin.from("recurrences").select("*").eq("statut", "active").lte("prochaine_generation", today);
    let generated = 0, sent = 0; const errors: string[] = [];

    for (const r of recs || []) {
      if (!proIds.has(r.entreprise_id)) continue;
      if (r.date_fin && r.prochaine_generation > r.date_fin) { await admin.from("recurrences").update({ statut: "terminee" }).eq("id", r.id); continue; }

      const periode = r.prochaine_generation.slice(0, 7);
      const echeance = addDays(r.prochaine_generation, r.delai_echeance || 30);
      let numero: string | null = null;
      if (r.auto_envoi) { const { data: n } = await admin.rpc("prochain_numero", { p_entreprise_id: r.entreprise_id, p_type: "facture" }); numero = n; }

      const { data: fac, error: facErr } = await admin.from("factures").insert({
        entreprise_id: r.entreprise_id, client_id: r.client_id, recurrence_id: r.id, periode, numero,
        statut: r.auto_envoi ? "envoyee" : "brouillon",
        date_facture: r.prochaine_generation, date_echeance: echeance, taux_tva: r.taux_tva,
        type_operation: r.type_operation || "services", remise_type: r.remise_type || "montant", remise_valeur: r.remise_valeur || 0, notes: r.libelle || "",
      }).select().single();

      if (facErr) { if (facErr.code !== "23505") errors.push(`${r.id}: ${facErr.message}`); }
      else {
        const lignes = (r.lignes || []).map((l: any, i: number) => ({ facture_id: fac.id, description: l.description, quantite: l.quantite, unite: l.unite, prix_unitaire: l.prix_unitaire, ordre: i }));
        if (lignes.length) await admin.from("facture_lignes").insert(lignes);
        generated++;
        if (r.auto_envoi) { try { await envoyerFacture(r, numero!, echeance); sent++; } catch (e) { errors.push(`envoi ${numero}: ${e.message}`); } }
      }

      const next = addMonths(r.prochaine_generation, MONTHS[r.frequence] || 1);
      const statut = (r.date_fin && next > r.date_fin) ? "terminee" : "active";
      await admin.from("recurrences").update({ prochaine_generation: next, statut }).eq("id", r.id);
    }
    return json({ generated, sent, errors });
  } catch (err) { return json({ error: err.message }, 500); }
});

async function envoyerFacture(r: any, numero: string, echeance: string) {
  if (!RESEND_API_KEY) throw new Error("RESEND_API_KEY manquant");
  const { data: client } = await admin.from("clients").select("nom, adresse, email, siret").eq("id", r.client_id).single();
  if (!client?.email) throw new Error("client sans email");
  const { data: ent } = await admin.from("entreprises").select("nom, adresse, email, tel, siret, tva_intra, iban, logo_url").eq("id", r.entreprise_id).single();

  const pdfB64 = await genererPdf(r, numero, echeance, client, ent);
  const t = calc(r);

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="margin:0;background:#f4f4f0;font-family:Arial,sans-serif"><div style="max-width:600px;margin:24px auto;background:#fff;border-radius:14px;overflow:hidden"><div style="background:linear-gradient(135deg,#1B4332,#40916C);padding:22px 28px;color:#fff"><div style="font-size:20px;font-weight:800">${ent?.nom || "FactuPro"}</div><div style="font-size:13px;opacity:.8">Facture ${numero}</div></div><div style="padding:24px 28px;font-size:14px;color:#333;line-height:1.7"><p>Bonjour ${client.nom || ""},</p><p>Veuillez trouver ci-joint votre facture <strong>${numero}</strong> du ${dfr(r.prochaine_generation)}, d'un montant de <strong>${money(t.ttc).replace("EUR", "€")}</strong> TTC.</p><p>Échéance : <strong>${dfr(echeance)}</strong>${ent?.iban ? `<br>IBAN : ${ent.iban}` : ""}</p><p>Cordialement,<br>${ent?.nom || ""}</p></div></div></body></html>`;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: FROM_EMAIL, to: client.email, subject: `Facture ${numero} — ${ent?.nom || "FactuPro"}`, html,
      reply_to: ent?.email || undefined,
      attachments: [{ filename: `Facture-${numero}.pdf`, content: pdfB64 }],
    }),
  });
  if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d?.message || `Resend ${res.status}`); }
}

async function genererPdf(r: any, numero: string, echeance: string, client: any, ent: any): Promise<string> {
  const t = calc(r);
  const doc = await PDFDocument.create();
  const page = doc.addPage([595.28, 841.89]);
  const W = 595.28, M = 42;
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  let y = 841.89 - M;
  const text = (s: string, x: number, yy: number, size = 9, f = font, color = rgb(0.1, 0.1, 0.1)) => page.drawText(safe(s), { x, y: yy, size, font: f, color });
  const right = (s: string, xr: number, yy: number, size = 9, f = font, color = rgb(0.1, 0.1, 0.1)) => { const w = f.widthOfTextAtSize(safe(s), size); page.drawText(safe(s), { x: xr - w, y: yy, size, font: f, color }); };

  // ── En-tête ──
  let leftY = y;
  if (ent?.logo_url) {
    try {
      const [meta, b64] = String(ent.logo_url).split(",");
      const bytes = decodeBase64(b64);
      const img = meta.includes("png") ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
      const h = 40, w = (img.width / img.height) * h;
      page.drawImage(img, { x: M, y: y - h, width: Math.min(w, 150), height: h });
      leftY = y - h - 6;
    } catch { text(ent?.nom || "FactuPro", M, y - 4, 16, bold, GREEN); leftY = y - 16; }
  } else { text(ent?.nom || "FactuPro", M, y - 4, 16, bold, GREEN); leftY = y - 16; }
  text(ent?.nom || "", M, leftY - 10, 11, bold); leftY -= 22;
  for (const line of [ent?.adresse, [ent?.tel, ent?.email].filter(Boolean).join("  "), `SIRET ${(ent?.siret || "").slice(0, 9)}  TVA ${ent?.tva_intra || "N/A"}`].filter(Boolean)) { text(String(line), M, leftY, 8, font, GREY); leftY -= 11; }

  right("FACTURE", W - M, y - 2, 18, bold, GREEN);
  right(numero, W - M, y - 18, 12, bold);
  right(`Date : ${dfr(r.prochaine_generation)}`, W - M, y - 32, 9, font, GREY);
  right(`Echeance : ${dfr(echeance)}`, W - M, y - 44, 9, font, GREY);

  y = Math.min(leftY, y - 56) - 10;

  // ── Client ──
  page.drawRectangle({ x: M, y: y - 44, width: W - 2 * M, height: 44, color: rgb(0.94, 0.97, 0.95) });
  text("CLIENT", M + 8, y - 12, 7, bold, GREY);
  text(client?.nom || "", M + 8, y - 26, 11, bold);
  if (client?.adresse) text(String(client.adresse), M + 8, y - 38, 8, font, GREY);
  if (client?.siret) right(`SIRET ${client.siret}`, W - M - 8, y - 38, 8, font, GREY);
  y -= 60;

  // ── Tableau ──
  const cQte = W - M - 190, cPu = W - M - 100, cTot = W - M;
  page.drawRectangle({ x: M, y: y - 18, width: W - 2 * M, height: 18, color: GREEN });
  text("DESCRIPTION", M + 6, y - 12, 8, bold, rgb(1, 1, 1));
  right("QTE", cQte + 20, y - 12, 8, bold, rgb(1, 1, 1));
  right("P.U.", cPu + 40, y - 12, 8, bold, rgb(1, 1, 1));
  right("TOTAL HT", cTot - 4, y - 12, 8, bold, rgb(1, 1, 1));
  y -= 18;

  for (const l of t.lignes) {
    const descLines = wrap(String(l.description || ""), font, 9, cQte - M - 12);
    const rowH = Math.max(16, descLines.length * 11 + 6);
    if (y - rowH < 120) break; // sécurité 1 page
    let ly = y - 12;
    for (const dl of descLines) { text(dl, M + 6, ly, 9); ly -= 11; }
    right(`${l.quantite} ${l.unite}`, cQte + 30, y - 12, 9);
    right(money(l.prix_unitaire), cPu + 40, y - 12, 9);
    right(money(l.quantite * l.prix_unitaire), cTot - 4, y - 12, 9, bold);
    y -= rowH;
    page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.5, color: rgb(0.9, 0.9, 0.9) });
  }
  y -= 14;

  // ── Totaux ──
  const tl = W - M - 150;
  right("Total HT", tl + 60, y, 9, font, GREY); right(money(t.brut), W - M, y, 9); y -= 12;
  if (t.remise > 0) { right("Remise", tl + 60, y, 9, font, rgb(0.72, 0.11, 0.11)); right(`-${money(t.remise)}`, W - M, y, 9, font, rgb(0.72, 0.11, 0.11)); y -= 12; right("Total HT net", tl + 60, y, 9, font, GREY); right(money(t.net), W - M, y, 9); y -= 12; }
  right(`TVA (${t.tv}%)`, tl + 60, y, 9, font, GREY); right(money(t.tva), W - M, y, 9); y -= 6;
  page.drawLine({ start: { x: tl, y }, end: { x: W - M, y }, thickness: 1, color: GREEN }); y -= 16;
  right("Total TTC", tl + 60, y, 13, bold, GREEN); right(money(t.ttc), W - M, y, 13, bold, GREEN); y -= 24;

  // ── Mentions ──
  const mentions = `Type d'operation : ${{ biens: "Livraison de biens", mixte: "Operation mixte" }[r.type_operation] || "Prestation de services"}. SIREN vendeur : ${(ent?.siret || "").slice(0, 9) || "N/A"}. Paiement a ${r.delai_echeance || 30} jours, echeance ${dfr(echeance)}. ${ent?.iban ? "IBAN : " + ent.iban + ". " : ""}En cas de retard, penalite de 3x le taux d'interet legal + indemnite de 40 EUR (art. L.441-10 C. com.). TVA ${t.tv}%.`;
  const mLines = wrap(mentions, font, 7.5, W - 2 * M - 12);
  const mH = mLines.length * 10 + 10;
  page.drawRectangle({ x: M, y: y - mH, width: W - 2 * M, height: mH, color: rgb(0.96, 0.96, 0.94) });
  let my = y - 12;
  for (const ml of mLines) { text(ml, M + 6, my, 7.5, font, GREY); my -= 10; }

  const bytes = await doc.save();
  return encodeBase64(bytes);
}

function wrap(str: string, font: any, size: number, maxW: number): string[] {
  const words = safe(str).split(/\s+/); const lines: string[] = []; let cur = "";
  for (const w of words) {
    const test = cur ? cur + " " + w : w;
    if (font.widthOfTextAtSize(test, size) > maxW && cur) { lines.push(cur); cur = w; }
    else cur = test;
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [""];
}

function json(body: unknown, status = 200) { return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }); }
