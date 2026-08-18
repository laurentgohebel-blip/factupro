import { useState, useRef, useEffect, useMemo } from "react";
import { useAuth } from '../lib/auth';
import { useClients, useDevis, useFactures, useCatalogue, useSubscription, useAudit, useClotures, useRecurrences, collectExportData } from '../lib/data';
import { supabase } from '../lib/supabase';

/* ══════════════ NORMALIZERS (Supabase → UI format) ══════════════ */
function normClient(c) { return c; } // same format
function normCat(c) { return { id: c.id, cat: c.categorie, desc: c.description, unite: c.unite, pu: parseFloat(c.prix_unitaire) }; }
function normDevis(d) {
  return { id: d.numero, dbId: d.id, clientId: d.client_id, date: d.date_devis, validite: d.date_validite, statut: d.statut, signature: d.signature_url, tva: parseFloat(d.taux_tva), typeOp: d.type_operation || 'services', remiseType: d.remise_type || 'montant', remiseValeur: parseFloat(d.remise_valeur) || 0, notes: d.notes || '',
    lignes: (d.devis_lignes || []).sort((a,b) => a.ordre - b.ordre).map(l => ({ desc: l.description, qte: parseFloat(l.quantite), unite: l.unite, pu: parseFloat(l.prix_unitaire) })),
    _raw: d };
}
function normFacture(f) {
  let statut = f.statut;
  if (statut === 'envoyee' && f.type !== 'avoir' && f.date_echeance && new Date(f.date_echeance) < new Date()) {
    statut = 'en_retard';
  }
  const brouillon = f.statut === 'brouillon';
  return { id: f.numero || (brouillon ? 'Brouillon' : ''), dbId: f.id, devisId: f.devis_id, clientId: f.client_id, date: f.date_facture, echeance: f.date_echeance, statut, brouillon, tva: parseFloat(f.taux_tva), typeOp: f.type_operation || 'services', type: f.type || 'facture', origineId: f.facture_origine_id, recurrenceId: f.recurrence_id, remiseType: f.remise_type || 'montant', remiseValeur: parseFloat(f.remise_valeur) || 0, paiement: f.mode_paiement, datePaiement: f.date_paiement, notes: f.notes || '',
    relances: (f.relances || []).map(r => ({ date: r.date_relance, type: r.type })),
    lignes: (f.facture_lignes || []).sort((a,b) => a.ordre - b.ordre).map(l => ({ desc: l.description, qte: parseFloat(l.quantite), unite: l.unite, pu: parseFloat(l.prix_unitaire) })),
    _raw: f };
}

/* ══════════════ UTILS ══════════════ */
// Type d'opération (mention obligatoire facture 2026)
const TYPE_OP = { biens: "Livraison de biens", services: "Prestation de services", mixte: "Opération mixte" };
const typeOpLabel = (t) => TYPE_OP[t] || TYPE_OP.services;
const FREQS = [{ v: "mensuelle", l: "Mensuelle" }, { v: "trimestrielle", l: "Trimestrielle" }, { v: "annuelle", l: "Annuelle" }];
const freqLabel = (f) => (FREQS.find(x => x.v === f) || {}).l || "Mensuelle";
// Libellé lisible d'une entrée du journal d'audit
const auditLabel = (a) => {
  const t = a.table_name === "factures" ? "Facture" : "Devis";
  const num = a.numero ? " " + a.numero : "";
  if (a.action === "INSERT") return `Création ${t}${num}`;
  if (a.action === "DELETE") return `Suppression ${t}${num}`;
  if (a.statut_avant !== a.statut_apres) return `${t}${num} : ${a.statut_avant || "—"} → ${a.statut_apres || "—"}`;
  return `Modification ${t}${num}`;
};
const tl = (l) => l.reduce((s, x) => s + x.qte * x.pu, 0);
const fmt = (n) => n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
const fmtShort = (n) => n >= 1000 ? (n / 1000).toFixed(1).replace('.0', '') + "k €" : fmt(n);
const dfr = (d) => new Date(d).toLocaleDateString("fr-FR");
const dd = (a, b) => Math.floor((new Date(b) - new Date(a)) / 86400000);
const tod = () => new Date().toISOString().slice(0, 10);
const in30 = () => new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
// Remise (sur le total HT) : montant fixe ou pourcentage.
const remiseOf = (doc) => {
  const brut = tl(doc.lignes);
  const v = parseFloat(doc.remiseValeur) || 0;
  const r = doc.remiseType === "pourcent" ? brut * v / 100 : v;
  return Math.min(Math.max(r, 0), brut);
};
// Totaux d'un document en tenant compte de la remise.
const totals = (doc) => {
  const brut = tl(doc.lignes);
  const remise = remiseOf(doc);
  const net = brut - remise;
  const tv = doc.tva || 10;
  const tva = net * tv / 100;
  return { brut, remise, net, tv, tva, ttc: net + tva };
};
const ttc = (doc) => totals(doc).ttc;
const PAIEMENTS = [{ v: "virement", l: "Virement", i: "🏦" }, { v: "cheque", l: "Chèque", i: "📝" }, { v: "especes", l: "Espèces", i: "💶" }, { v: "cb", l: "Carte", i: "💳" }];

/* ══════════════ EMAIL ══════════════ */
async function sendEmailViaResend(to, subject, html, replyTo, attachment) {
  const { supabase } = await import('../lib/supabase');
  const { data, error } = await supabase.functions.invoke('send-email', {
    body: { to, subject, html, replyTo, attachment },
  });
  if (error) {
    const msg = error?.context?.json?.error || error?.message || 'Erreur inconnue';
    throw new Error(msg);
  }
  if (data?.error) throw new Error(data.error);
  return data;
}

// Pré-charge une image data-URI et la ré-encode en JPEG borné sur fond blanc.
// Garantit une image valide/décodée et légère (évite le PDF blanc sur mobile
// quand html2canvas peine sur les gros PNG transparents en data-URI).
async function shrinkDataUrl(dataUrl, maxW = 360) {
  if (!dataUrl) return null;
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = dataUrl; });
    const nw = img.naturalWidth || maxW, nh = img.naturalHeight || 120;
    const scale = Math.min(1, maxW / nw);
    const w = Math.max(1, Math.round(nw * scale)), h = Math.max(1, Math.round(nh * scale));
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    return c.toDataURL('image/jpeg', 0.92);
  } catch { return null; }
}

// Redimensionne un logo en conservant la transparence (PNG), borné en largeur.
async function resizeLogo(dataUrl, maxW = 400) {
  if (!dataUrl) return null;
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = dataUrl; });
    const nw = img.naturalWidth || maxW, nh = img.naturalHeight || maxW;
    const scale = Math.min(1, maxW / nw);
    const w = Math.max(1, Math.round(nw * scale)), h = Math.max(1, Math.round(nh * scale));
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    c.getContext('2d').drawImage(img, 0, 0, w, h);
    return c.toDataURL('image/png');
  } catch { return null; }
}

// Dimensions naturelles d'une image (pour préserver le ratio dans le PDF).
async function imgDims(dataUrl) {
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = dataUrl; });
    return { w: img.naturalWidth || 1, h: img.naturalHeight || 1 };
  } catch { return { w: 3, h: 1 }; }
}

// Génération du PDF NATIVEMENT avec jsPDF (texte/tableau dessinés, pas de
// capture d'écran). html2canvas rend une page blanche sur certains mobiles /
// en mode PWA — cette approche est fiable partout.
async function generatePDFAttachment(type, doc, client, entreprise) {
  const { jsPDF } = await import('jspdf');
  const signature = await shrinkDataUrl(doc.signature || null);
  const e = entreprise || {};
  const isF = type === 'facture';
  const ti = doc.type === 'avoir' ? 'AVOIR' : (isF ? 'FACTURE' : 'DEVIS');
  const { brut, remise, net: ht, tv, tva, ttc: tot } = totals(doc);
  const money = n => (n || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).replace(/\s/g, ' ').replace(/[  ]/g, ' ') + ' €';
  const GREEN = [27, 67, 50];

  const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
  const PW = pdf.internal.pageSize.getWidth();
  const PH = pdf.internal.pageSize.getHeight();
  const M = 15;
  const ensure = (need) => { if (y + need > PH - M) { pdf.addPage(); y = M; } };
  let y = M;

  // ── En-tête ──
  let hy;
  if (e.logo_url) {
    const d = await imgDims(e.logo_url);
    const logoH = 14, logoW = Math.min(50, logoH * (d.w / d.h || 3));
    try { pdf.addImage(e.logo_url, 'PNG', M, y, logoW, logoH); } catch (err) { console.warn('logo:', err); }
    pdf.setTextColor(20); pdf.setFont('helvetica', 'bold'); pdf.setFontSize(11);
    pdf.text(e.nom || '', M, y + logoH + 6);
    hy = y + logoH + 11;
  } else {
    pdf.setTextColor(...GREEN); pdf.setFont('helvetica', 'bold'); pdf.setFontSize(20);
    pdf.text('FactuPro', M, y + 2);
    pdf.setTextColor(20); pdf.setFontSize(11);
    pdf.text(e.nom || '', M, y + 9);
    hy = y + 14;
  }
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8); pdf.setTextColor(110);
  if (e.adresse) { pdf.text(String(e.adresse), M, hy); hy += 4; }
  const contact = [e.tel, e.email].filter(Boolean).join('   ');
  if (contact) { pdf.text(contact, M, hy); hy += 4; }
  const legal = ['SIRET ' + (e.siret || '—'), e.ape ? 'APE ' + e.ape : '', e.tva_intra ? 'TVA ' + e.tva_intra : ''].filter(Boolean).join('   ');
  if (legal) { pdf.text(legal, M, hy); hy += 4; }

  pdf.setTextColor(...GREEN); pdf.setFont('helvetica', 'bold'); pdf.setFontSize(18);
  pdf.text(ti, PW - M, y + 2, { align: 'right' });
  pdf.setTextColor(20); pdf.setFontSize(12);
  pdf.text(String(doc.id || ''), PW - M, y + 9, { align: 'right' });
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(9); pdf.setTextColor(110);
  pdf.text('Date : ' + dfr(doc.date), PW - M, y + 14, { align: 'right' });
  pdf.text((isF ? 'Echeance : ' + dfr(doc.echeance) : 'Validite : ' + dfr(doc.validite)), PW - M, y + 18, { align: 'right' });

  y = Math.max(hy, y + 22) + 4;

  // ── Bloc client ──
  const cliBoxH = client?.siret ? 25 : 21;
  pdf.setFillColor(240, 247, 242); pdf.roundedRect(M, y, PW - 2 * M, cliBoxH, 2, 2, 'F');
  pdf.setTextColor(110); pdf.setFont('helvetica', 'bold'); pdf.setFontSize(7);
  pdf.text('CLIENT', M + 4, y + 5);
  pdf.setTextColor(20); pdf.setFontSize(11);
  pdf.text(client?.nom || '', M + 4, y + 11);
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8); pdf.setTextColor(90);
  if (client?.adresse) pdf.text(String(client.adresse), M + 4, y + 15.5);
  if (client?.siret) pdf.text('SIRET ' + client.siret, M + 4, y + 20);
  y += cliBoxH + 6;

  // ── En-tête tableau ──
  const C = { desc: M + 2, qte: 118, pu: 152, tot: PW - M - 2 };
  pdf.setFillColor(...GREEN); pdf.rect(M, y, PW - 2 * M, 8, 'F');
  pdf.setTextColor(255); pdf.setFont('helvetica', 'bold'); pdf.setFontSize(8);
  pdf.text('DESCRIPTION', C.desc, y + 5.3);
  pdf.text('QTE', C.qte, y + 5.3, { align: 'center' });
  pdf.text('P.U.', C.pu, y + 5.3, { align: 'right' });
  pdf.text('TOTAL HT', C.tot, y + 5.3, { align: 'right' });
  y += 8;

  // ── Lignes ──
  pdf.setFont('helvetica', 'normal'); pdf.setTextColor(30); pdf.setFontSize(9);
  for (const l of doc.lignes) {
    const descLines = pdf.splitTextToSize(String(l.desc || ''), 92);
    const rowH = Math.max(7, descLines.length * 4.2 + 2.8);
    ensure(rowH);
    pdf.text(descLines, C.desc, y + 4.5);
    pdf.text(`${l.qte} ${l.unite}`, C.qte, y + 4.5, { align: 'center' });
    pdf.text(money(l.pu), C.pu, y + 4.5, { align: 'right' });
    pdf.setFont('helvetica', 'bold');
    pdf.text(money(l.qte * l.pu), C.tot, y + 4.5, { align: 'right' });
    pdf.setFont('helvetica', 'normal');
    y += rowH;
    pdf.setDrawColor(230); pdf.setLineWidth(0.2); pdf.line(M, y, PW - M, y);
  }
  y += 5;

  // ── Totaux ──
  ensure(remise > 0 ? 34 : 24);
  const tx = PW - M - 70;
  pdf.setFontSize(9); pdf.setTextColor(70);
  let ry = y + 4;
  pdf.text('Total HT', tx, ry); pdf.text(money(brut), PW - M, ry, { align: 'right' }); ry += 5;
  if (remise > 0) {
    pdf.setTextColor(185, 28, 28);
    pdf.text('Remise', tx, ry); pdf.text('-' + money(remise), PW - M, ry, { align: 'right' }); ry += 5;
    pdf.setTextColor(70);
    pdf.text('Total HT net', tx, ry); pdf.text(money(ht), PW - M, ry, { align: 'right' }); ry += 5;
  }
  pdf.text(`TVA (${tv}%)`, tx, ry); pdf.text(money(tva), PW - M, ry, { align: 'right' }); ry += 3;
  pdf.setDrawColor(...GREEN); pdf.setLineWidth(0.5); pdf.line(tx, ry, PW - M, ry); ry += 7;
  pdf.setFont('helvetica', 'bold'); pdf.setFontSize(13); pdf.setTextColor(...GREEN);
  pdf.text('Total TTC', tx, ry); pdf.text(money(tot), PW - M, ry, { align: 'right' });
  pdf.setFont('helvetica', 'normal'); pdf.setLineWidth(0.2);
  y = ry + 9;

  // ── Notes ──
  if (doc.notes) {
    const lines = pdf.splitTextToSize('Notes : ' + doc.notes, PW - 2 * M - 8);
    const boxH = lines.length * 4 + 8;
    ensure(boxH + 4);
    pdf.setFillColor(250, 250, 247); pdf.roundedRect(M, y, PW - 2 * M, boxH, 2, 2, 'F');
    pdf.setTextColor(90); pdf.setFontSize(8.5);
    pdf.text(lines, M + 4, y + 6);
    y += boxH + 5;
  }

  // ── Mentions légales ──
  const typeOpTxt = typeOpLabel(doc.typeOp).normalize('NFD').replace(/[̀-ͯ]/g, '');
  const mentions = isF
    ? `Type d'operation : ${typeOpTxt}. SIREN vendeur : ${(e.siret || '').slice(0, 9) || 'N/A'}. Conditions de paiement : paiement a 30 jours. Echeance : ${dfr(doc.echeance)}. ${e.iban ? 'IBAN : ' + e.iban + '. ' : ''}En cas de retard, penalite de 3x le taux d'interet legal + indemnite forfaitaire de 40 EUR pour frais de recouvrement (art. L.441-10 C. com.). TVA ${tv}%${tv === 0 ? ' — TVA non applicable, art. 293 B du CGI' : ''}.`
    : `Validite du devis : ${dfr(doc.validite)}. Devis gratuit. Les travaux ne debuteront qu'apres acceptation du present devis.`;
  const mLines = pdf.splitTextToSize(mentions, PW - 2 * M - 8);
  const mH = mLines.length * 3.6 + 8;
  ensure(mH + 4);
  pdf.setFillColor(245, 245, 242); pdf.roundedRect(M, y, PW - 2 * M, mH, 2, 2, 'F');
  pdf.setTextColor(120); pdf.setFontSize(7.5);
  pdf.text(mLines, M + 4, y + 5.5);
  y += mH + 6;

  // ── Signature ──
  if (signature) {
    ensure(30);
    const sigW = 45, sigH = 20, sx = PW - M - sigW;
    pdf.setFontSize(8); pdf.setTextColor(110);
    pdf.text('Bon pour accord — signe electroniquement', PW - M, y, { align: 'right' });
    try { pdf.addImage(signature, 'JPEG', sx, y + 2, sigW, sigH); } catch (err) { console.warn('addImage signature:', err); }
    pdf.setDrawColor(180); pdf.line(sx, y + sigH + 3, PW - M, y + sigH + 3);
  }

  const base64 = pdf.output('datauristring').split(',')[1];
  const filename = `${isF ? 'Facture' : 'Devis'}-${doc.id}.pdf`;
  return { content: base64, filename };
}

function defaultMessage(type, doc, client, entreprise) {
  const isF = type === "facture";
  const isR = type === "relance";
  const e = entreprise || {};
  const nom = client?.nom || "";
  if (isR) return `Bonjour ${nom},\n\nSauf erreur de notre part, la facture ${doc.id} d'un montant de ${fmt(ttc(doc))} TTC reste impayée à ce jour.\n\nNous vous remercions de bien vouloir régulariser cette situation dans les meilleurs délais.\n\nN'hésitez pas à nous contacter si vous avez des questions.\n\nCordialement,\n${e.nom || ""}`;
  if (isF) return `Bonjour ${nom},\n\nVeuillez trouver ci-dessous votre facture ${doc.id} d'un montant de ${fmt(ttc(doc))} TTC.\n\nMerci de procéder au règlement avant le ${dfr(doc.echeance)}.\n\nCordialement,\n${e.nom || ""}`;
  return `Bonjour ${nom},\n\nVeuillez trouver ci-dessous votre devis ${doc.id} d'un montant de ${fmt(ttc(doc))} TTC.\n\nCe devis est valable jusqu'au ${dfr(doc.validite)}. N'hésitez pas à nous contacter pour toute question.\n\nCordialement,\n${e.nom || ""}`;
}

function buildEmailHtml(type, doc, client, entreprise, customMessage) {
  const isF = type === "facture";
  const ti = doc.type === "avoir" ? "Avoir" : (isF ? "Facture" : "Devis");
  const { brut, remise, net: ht, tv, tva, ttc: tot } = totals(doc);
  const e = entreprise || {};
  const ibanBlock = e.iban ? `<tr><td style="padding:6px 0;color:#666;font-size:13px">IBAN</td><td style="padding:6px 0;font-weight:600;font-size:13px">${e.iban}</td></tr>` : "";

  const lignesRows = doc.lignes.map(l => `
    <tr style="border-bottom:1px solid #eee">
      <td style="padding:10px 8px;font-size:13px">${l.desc}</td>
      <td style="padding:10px 8px;text-align:center;font-size:13px">${l.qte} ${l.unite}</td>
      <td style="padding:10px 8px;text-align:right;font-size:13px">${fmt(l.pu)}</td>
      <td style="padding:10px 8px;text-align:right;font-weight:600;font-size:13px">${fmt(l.qte * l.pu)}</td>
    </tr>`).join("");

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f4f0;font-family:'Helvetica Neue',Arial,sans-serif">
<div style="max-width:600px;margin:32px auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08)">

  <!-- Header -->
  <div style="background:linear-gradient(135deg,#1B4332,#40916C);padding:28px 32px;color:#fff">
    <div style="font-size:24px;font-weight:800;letter-spacing:-0.5px">⚡ FactuPro</div>
    <div style="font-size:13px;opacity:0.75;margin-top:2px">${e.nom || ""}</div>
  </div>

  <!-- Body -->
  <div style="padding:28px 32px">
    <h2 style="font-size:20px;font-weight:700;color:#1a1a18;margin:0 0 16px">${ti} ${doc.id}</h2>
    ${customMessage ? `<div style="font-size:14px;color:#333;line-height:1.7;margin-bottom:24px;white-space:pre-line">${
      customMessage
        .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
        .replace(/(https?:\/\/[^\s]+)/g, '<a href="$1" style="color:#1B4332;font-weight:600">$1</a>')
    }</div>` : `<p style="font-size:14px;color:#666;margin:0 0 24px">Bonjour ${client?.nom || ""},<br>Veuillez trouver ci-dessous votre ${ti.toLowerCase()}.</p>`}

    <!-- Client -->
    <div style="background:#f0f7f2;border-radius:10px;padding:14px 16px;margin-bottom:20px">
      <div style="font-size:11px;text-transform:uppercase;letter-spacing:0.8px;color:#666;font-weight:700;margin-bottom:4px">Client</div>
      <div style="font-size:14px;font-weight:700">${client?.nom || ""}</div>
      ${client?.adresse ? `<div style="font-size:12px;color:#555;margin-top:2px">${client.adresse}</div>` : ""}
    </div>

    <!-- Lignes -->
    <table style="width:100%;border-collapse:collapse;margin-bottom:16px">
      <thead><tr style="background:#1B4332;color:#fff">
        <th style="padding:10px 8px;text-align:left;font-size:11px;text-transform:uppercase">Description</th>
        <th style="padding:10px 8px;text-align:center;font-size:11px;text-transform:uppercase">Qté</th>
        <th style="padding:10px 8px;text-align:right;font-size:11px;text-transform:uppercase">P.U.</th>
        <th style="padding:10px 8px;text-align:right;font-size:11px;text-transform:uppercase">Total HT</th>
      </tr></thead>
      <tbody>${lignesRows}</tbody>
    </table>

    <!-- Totaux -->
    <div style="display:flex;justify-content:flex-end;margin-bottom:20px">
      <table style="width:220px">
        <tr><td style="padding:4px 0;font-size:13px;color:#666">Total HT</td><td style="padding:4px 0;font-size:13px;font-weight:600;text-align:right">${fmt(brut)}</td></tr>
        ${remise > 0 ? `<tr><td style="padding:4px 0;font-size:13px;color:#b91c1c">Remise</td><td style="padding:4px 0;font-size:13px;text-align:right;color:#b91c1c">−${fmt(remise)}</td></tr><tr><td style="padding:4px 0;font-size:13px;color:#666">Total HT net</td><td style="padding:4px 0;font-size:13px;font-weight:600;text-align:right">${fmt(ht)}</td></tr>` : ''}
        <tr><td style="padding:4px 0;font-size:13px;color:#666">TVA (${tv}%)</td><td style="padding:4px 0;font-size:13px;text-align:right;color:#666">${fmt(tva)}</td></tr>
        <tr style="border-top:2px solid #1B4332"><td style="padding:8px 0;font-size:18px;font-weight:800;color:#1B4332">Total TTC</td><td style="padding:8px 0;font-size:18px;font-weight:800;color:#1B4332;text-align:right">${fmt(tot)}</td></tr>
      </table>
    </div>

    <!-- Infos paiement -->
    ${isF ? `<div style="background:#f8f8f5;border-radius:10px;padding:14px 16px;font-size:13px;color:#555;line-height:1.7">
      <table style="width:100%">
        <tr><td style="padding:6px 0;color:#666;font-size:13px">Échéance</td><td style="padding:6px 0;font-weight:600;font-size:13px">${dfr(doc.echeance)}</td></tr>
        ${ibanBlock}
      </table>
      <div style="margin-top:8px;font-size:12px;color:#888">En cas de retard, pénalité de 3× le taux légal + 40€ forfaitaires.</div>
    </div>` : `<div style="background:#f8f8f5;border-radius:10px;padding:14px 16px;font-size:13px;color:#555">
      Devis valable jusqu'au <strong>${dfr(doc.validite)}</strong>. Les travaux ne débuteront qu'après acceptation.
    </div>`}
  </div>

  <!-- Footer -->
  <div style="padding:20px 32px;background:#f9f9f7;border-top:1px solid #eee;font-size:12px;color:#999;text-align:center">
    ${e.nom || ""} · ${e.adresse || ""}<br>
    Tél : ${e.tel || ""} · ${e.email || ""}<br>
    SIRET : ${e.siret || ""}
    <div style="margin-top:8px;font-size:11px">Envoyé via ⚡ FactuPro</div>
  </div>
</div>
</body></html>`;
}

function buildEmailContent(type, doc, client, entreprise) {
  const isF = type === "facture";
  const ti = doc.type === "avoir" ? "Avoir" : (isF ? "Facture" : "Devis");
  const { brut, remise, net: ht, tv, tva, ttc: tot } = totals(doc);
  const e = entreprise || {};
  const ibanLine = e.iban ? `\nIBAN : ${e.iban}` : "";
  const subject = `${ti} ${doc.id} — ${e.nom || "FactuPro"}`;
  const lignesText = doc.lignes.map(l =>
    `  • ${l.desc} : ${l.qte} ${l.unite} × ${fmt(l.pu)} = ${fmt(l.qte * l.pu)}`
  ).join("\n");
  const body = `Bonjour ${client?.nom || ""},

Veuillez trouver en pièce jointe votre ${ti.toLowerCase()} ${doc.id} du ${dfr(doc.date)}.

${lignesText}

Total HT : ${fmt(brut)}${remise > 0 ? `\nRemise : -${fmt(remise)}\nTotal HT net : ${fmt(ht)}` : ""}
TVA (${tv}%) : ${fmt(tva)}
Total TTC : ${fmt(tot)}

${isF ? `Date d'échéance : ${dfr(doc.echeance)}\nMerci de procéder au règlement dans les délais.${ibanLine}` : `Ce devis est valable jusqu'au ${dfr(doc.validite)}.`}

Cordialement,
${e.nom || ""}
${e.tel || ""} — ${e.email || ""}
${e.adresse || ""}
SIRET : ${e.siret || ""}`;
  return { subject, body, to: client?.email || "" };
}

function EmailModal({ type, doc, client, signature, entreprise, onClose, onSent, defaultMessage: initMessage, relance }) {
  const { subject: baseSubject, to } = buildEmailContent(type, doc, client, entreprise);
  const subject = relance ? `RELANCE — ${baseSubject}` : baseSubject;
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState(() => initMessage || defaultMessage(type, doc, client, entreprise));
  const [attachPdf, setAttachPdf] = useState(true);

  async function handleSend() {
    if (!to) { setError("Aucun email renseigné pour ce client."); return; }
    setSending(true); setError("");
    try {
      const html = buildEmailHtml(type, doc, client, entreprise, message);
      const replyTo = entreprise?.email || undefined;
      let attachment = null;
      if (attachPdf) {
        try { attachment = await generatePDFAttachment(type, doc, client, entreprise); }
        catch (e) { console.warn("PDF attachment failed:", e); }
      }
      await sendEmailViaResend(to, subject, html, replyTo, attachment);
      setSent(true);
      setTimeout(() => { onClose(); onSent?.(); }, 1500);
    } catch (e) {
      setError("Erreur d'envoi : " + (e.message || "réessayez"));
    }
    setSending(false);
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 100, display: "flex", alignItems: "flex-end", justifyContent: "center", animation: "fadeIn .2s" }} onClick={onClose}>
      <div style={{ background: T.bgCard, borderRadius: "20px 20px 0 0", padding: 22, width: "100%", maxWidth: 480, maxHeight: "90vh", overflowY: "auto", animation: "slideUp .25s" }} onClick={e => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <h3 style={{ fontSize: 17, fontWeight: 700 }}>✉ Envoyer par email</h3>
          <button onClick={onClose} style={{ background: T.bgElevated, border: "none", cursor: "pointer", color: T.textMuted, width: 32, height: 32, borderRadius: "50%", fontSize: 16 }}>×</button>
        </div>

        <div style={{ background: T.bgElevated, borderRadius: T.radiusSm, padding: "12px 16px", marginBottom: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
            <span style={{ fontSize: 12, color: T.textMuted, fontWeight: 600 }}>À</span>
            <span style={{ fontSize: 13, fontWeight: 700, color: to ? T.text : T.danger }}>{to || "⚠ Email client manquant"}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span style={{ fontSize: 12, color: T.textMuted, fontWeight: 600 }}>Objet</span>
            <span style={{ fontSize: 13, color: T.text }}>{subject}</span>
          </div>
        </div>

        {/* Message personnalisé */}
        <div style={{ marginBottom: 14 }}>
          <label style={{ fontSize: 12, fontWeight: 600, color: T.textMuted, display: "block", marginBottom: 6 }}>MESSAGE D'ACCOMPAGNEMENT</label>
          <textarea value={message} onChange={e => setMessage(e.target.value)} rows={6}
            style={{ width: "100%", padding: "12px 14px", borderRadius: T.radiusSm, border: `1.5px solid ${T.border}`, background: T.bgElevated, color: T.text, fontSize: 13, lineHeight: 1.6, fontFamily: T.font, resize: "vertical", boxSizing: "border-box", outline: "none" }} />
        </div>

        {/* Option PDF */}
        <label style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", background: T.bgElevated, borderRadius: T.radiusSm, marginBottom: 14, cursor: "pointer" }}>
          <input type="checkbox" checked={attachPdf} onChange={e => setAttachPdf(e.target.checked)} style={{ width: 16, height: 16, accentColor: T.primary }} />
          <span style={{ fontSize: 13, fontWeight: 600 }}>📎 Joindre le PDF en pièce jointe</span>
        </label>

        {error && <div style={{ background: T.dangerPale, border: `1px solid #FECACA`, borderRadius: T.radiusXs, padding: "10px 14px", marginBottom: 14, fontSize: 13, color: "#991B1B" }}>⚠ {error}</div>}

        {sent
          ? <div style={{ background: T.primaryPale, borderRadius: T.radiusSm, padding: 16, textAlign: "center", fontSize: 15, fontWeight: 700, color: T.primary }}>✓ Email envoyé !</div>
          : <button className="btn-press" onClick={handleSend} disabled={sending || !to} style={{ width: "100%", padding: 14, borderRadius: T.radiusSm, border: "none", background: sending ? T.primaryLighter : T.primary, color: "#fff", fontSize: 15, fontWeight: 700, cursor: sending ? "wait" : "pointer", fontFamily: T.font, boxShadow: "0 4px 14px rgba(27,67,50,0.3)" }}>
              {sending ? (attachPdf ? "Génération PDF..." : "Envoi en cours...") : `✉ Envoyer à ${to || "..."}`}
            </button>
        }
      </div>
    </div>
  );
}

/* ══════════════ CSV EXPORT ══════════════ */
function exportCSV(factures, clients) {
  const headers = ["Numéro", "Date", "Client", "Email client", "Remise", "Montant HT", "TVA %", "Montant TVA", "Montant TTC", "Statut", "Mode paiement", "Date paiement", "Échéance"];

  const rows = factures.map(f => {
    const cl = clients.find(c => c.id === f.clientId);
    const { remise, net: ht, tv, tva, ttc: tot } = totals(f);
    return [
      f.id,
      f.date,
      cl?.nom || "",
      cl?.email || "",
      remise.toFixed(2),
      ht.toFixed(2),
      tv,
      tva.toFixed(2),
      tot.toFixed(2),
      f.statut,
      f.paiement || "",
      f.datePaiement || "",
      f.echeance || "",
    ];
  });

  const csv = [headers, ...rows].map(r => r.map(c => `"${c}"`).join(";")).join("\n");
  const BOM = "\uFEFF"; // pour Excel français
  const blob = new Blob([BOM + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `FactuPro_Export_${tod()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function exportDevisCSV(devis, clients) {
  const headers = ["Numéro", "Date", "Validité", "Client", "Email client", "Remise", "Montant HT", "TVA %", "Montant TTC", "Statut"];

  const rows = devis.map(d => {
    const cl = clients.find(c => c.id === d.clientId);
    const { remise, net: ht, tv, ttc } = totals(d);
    return [
      d.id, d.date, d.validite || "", cl?.nom || "", cl?.email || "",
      remise.toFixed(2), ht.toFixed(2), tv, ttc.toFixed(2), d.statut,
    ];
  });

  const csv = [headers, ...rows].map(r => r.map(c => `"${c}"`).join(";")).join("\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `FactuPro_Devis_${tod()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

/* ══════════════ CSS ══════════════ */
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700;800;900&display=swap');
@keyframes fadeUp { from { opacity: 0; transform: translateY(16px); } to { opacity: 1; transform: translateY(0); } }
@keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
@keyframes slideUp { from { transform: translateY(100%); } to { transform: translateY(0); } }
@keyframes countUp { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
@keyframes barGrow { from { height: 0; } }
.fade-up { animation: fadeUp .5s cubic-bezier(.16,1,.3,1) both; }
.fade-up-1 { animation-delay: .05s; } .fade-up-2 { animation-delay: .1s; } .fade-up-3 { animation-delay: .15s; } .fade-up-4 { animation-delay: .2s; } .fade-up-5 { animation-delay: .25s; }
.card-hover { transition: transform .2s, box-shadow .2s; } .card-hover:hover { transform: translateY(-2px); box-shadow: 0 8px 24px rgba(0,0,0,0.08); }
.btn-press { transition: all .15s; } .btn-press:active { transform: scale(.97); }
.bar-animate { animation: barGrow .6s cubic-bezier(.16,1,.3,1) both; }
.toast-anim { animation: fadeUp .3s cubic-bezier(.16,1,.3,1) both; }
.gradient-header { background: linear-gradient(135deg, #1B4332 0%, #2D6A4F 50%, #40916C 100%); position: relative; overflow: hidden; }
.gradient-header::after { content: ''; position: absolute; top: -50%; right: -20%; width: 200px; height: 200px; background: radial-gradient(circle, rgba(255,255,255,0.08) 0%, transparent 70%); border-radius: 50%; pointer-events: none; }
.search-glow:focus { border-color: #40916C; box-shadow: 0 0 0 3px rgba(64,145,108,0.15); }
::-webkit-scrollbar { width: 4px; } ::-webkit-scrollbar-thumb { background: #D1D5C8; border-radius: 4px; }
`;

/* ══════════════ TOKENS ══════════════ */
const T = {
  font: "'Outfit', system-ui, sans-serif",
  primary: "#1B4332", primaryLight: "#2D6A4F", primaryLighter: "#40916C", primaryPale: "#D8F3DC",
  accent: "#F59E0B", accentPale: "#FEF3C7", danger: "#DC2626", dangerPale: "#FEE2E2", info: "#2563EB", infoPale: "#DBEAFE",
  bg: "#F7F6F3", bgCard: "#FFFFFF", bgElevated: "#FDFCFA",
  border: "#E8E5DE", borderLight: "#F0EDE6",
  text: "#1A1A18", textMuted: "#7A7A72", textLight: "#A3A39B",
  radius: 14, radiusSm: 10, radiusXs: 7,
  shadow: "0 1px 3px rgba(0,0,0,0.04), 0 4px 12px rgba(0,0,0,0.03)",
  shadowMd: "0 4px 16px rgba(0,0,0,0.06), 0 1px 4px rgba(0,0,0,0.04)",
  shadowLg: "0 8px 32px rgba(0,0,0,0.08), 0 2px 8px rgba(0,0,0,0.04)",
};

/* ══════════════ SMALL COMPONENTS ══════════════ */
function Badge({ statut }) {
  const m = { brouillon:["Brouillon","#F1F1EE","#666","#999"], en_attente:["En attente",T.accentPale,"#92400E",T.accent], accepte:["Accepté",T.primaryPale,"#065F46","#10B981"], refuse:["Refusé",T.dangerPale,"#991B1B",T.danger], payee:["Payée",T.primaryPale,"#065F46","#10B981"], en_retard:["En retard",T.dangerPale,"#991B1B",T.danger], envoyee:["Envoyée",T.infoPale,"#1E40AF",T.info], facture:["Facturé","#E0E7FF","#3730A3","#6366F1"], signe:["Signé",T.primaryPale,"#065F46","#10B981"] };
  const s = m[statut] || [statut,"#E5E7EB","#374151","#9CA3AF"];
  return <span style={{ background: s[1], color: s[2], padding: "4px 10px 4px 8px", borderRadius: 20, fontSize: 11, fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 5 }}><span style={{ width: 6, height: 6, borderRadius: "50%", background: s[3], flexShrink: 0 }} />{s[0]}</span>;
}

function Toast({ m }) { return m ? <div className="toast-anim" style={{ position: "fixed", top: 70, left: "50%", transform: "translateX(-50%)", background: T.primary, color: "#fff", padding: "10px 22px", borderRadius: 12, fontSize: 13, fontWeight: 600, zIndex: 200, boxShadow: T.shadowLg, display: "flex", alignItems: "center", gap: 7, whiteSpace: "nowrap" }}>✓ {m}</div> : null; }

function Confirm({ msg, onOk, onNo }) {
  return <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", padding: 20, animation: "fadeIn .2s" }} onClick={onNo}>
    <div style={{ background: T.bgCard, borderRadius: T.radius, padding: 24, width: "100%", maxWidth: 320, boxShadow: T.shadowLg }} onClick={e => e.stopPropagation()}>
      <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>Confirmation</div>
      <div style={{ fontSize: 14, color: T.textMuted, marginBottom: 20, lineHeight: 1.5 }}>{msg}</div>
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button className="btn-press" onClick={onNo} style={{ padding: "8px 16px", borderRadius: T.radiusXs, border: `1px solid ${T.border}`, background: T.bgCard, fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: T.font }}>Annuler</button>
        <button className="btn-press" onClick={onOk} style={{ padding: "8px 16px", borderRadius: T.radiusXs, border: "none", background: T.dangerPale, fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: T.font, color: "#991B1B" }}>Supprimer</button>
      </div>
    </div>
  </div>;
}

function Search({ v, set, ph }) {
  return <div style={{ position: "relative", marginBottom: 12 }}>
    <svg style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: T.textLight, pointerEvents: "none" }} width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
    <input className="search-glow" style={{ width: "100%", padding: "10px 36px 10px 38px", borderRadius: T.radiusSm, border: `1px solid ${T.border}`, fontSize: 13, fontFamily: T.font, color: T.text, outline: "none", boxSizing: "border-box", background: T.bgCard }} placeholder={ph || "Rechercher..."} value={v} onChange={e => set(e.target.value)} />
    {v && <button onClick={() => set("")} style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", color: T.textLight, fontSize: 16 }}>×</button>}
  </div>;
}

function Chips({ opts, val, set }) {
  return <div style={{ display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap" }}>
    {opts.map(o => <button key={o.v} className="btn-press" onClick={() => set(val === o.v ? null : o.v)} style={{ padding: "6px 14px", borderRadius: 20, fontSize: 12, fontWeight: 600, cursor: "pointer", border: "none", background: val === o.v ? T.primary : T.bgElevated, color: val === o.v ? "#fff" : T.textMuted, boxShadow: val === o.v ? "none" : `inset 0 0 0 1px ${T.border}` }}>{o.l}</button>)}
  </div>;
}

function StatCard({ label, value, color, icon, sub, delay, onClick }) {
  return <div className={`fade-up fade-up-${delay} card-hover`} onClick={onClick} style={{ background: T.bgCard, borderRadius: T.radius, padding: "18px 16px", boxShadow: T.shadow, cursor: onClick ? "pointer" : "default", position: "relative", overflow: "hidden" }}>
    <div style={{ position: "absolute", top: 12, right: 14, fontSize: 22, opacity: 0.15 }}>{icon}</div>
    <div style={{ fontSize: 10, fontWeight: 600, color: T.textMuted, textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 6 }}>{label}</div>
    <div style={{ fontSize: 24, fontWeight: 800, color: color || T.primary, letterSpacing: -0.5, lineHeight: 1, animation: "countUp .5s cubic-bezier(.16,1,.3,1) both" }}>{value}</div>
    {sub && <div style={{ fontSize: 11, color: T.textLight, marginTop: 4 }}>{sub}</div>}
  </div>;
}

/* ── Modals ── */
function CatPicker({ cat, onSel, onClose }) {
  const [q, setQ] = useState(""); const [c, setC] = useState(null);
  const cs = [...new Set(cat.map(x => x.cat))];
  const f = cat.filter(x => (!c || x.cat === c) && (!q || x.desc.toLowerCase().includes(q.toLowerCase())));
  return <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 100, display: "flex", alignItems: "flex-end", justifyContent: "center", animation: "fadeIn .2s" }} onClick={onClose}>
    <div style={{ background: T.bgCard, borderRadius: "20px 20px 0 0", padding: 22, width: "100%", maxWidth: 480, maxHeight: "80vh", overflowY: "auto", animation: "slideUp .25s" }} onClick={e => e.stopPropagation()}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 14 }}><h3 style={{ fontSize: 17, fontWeight: 700 }}>Catalogue</h3><button onClick={onClose} style={{ background: T.bgElevated, border: "none", cursor: "pointer", color: T.textMuted, width: 32, height: 32, borderRadius: "50%", fontSize: 16 }}>×</button></div>
      <Search v={q} set={setQ} /><Chips opts={cs.map(x => ({ v: x, l: x }))} val={c} set={setC} />
      {f.map(x => <div key={x.id} className="card-hover" onClick={() => { onSel(x); onClose(); }} style={{ padding: "12px 14px", borderBottom: `1px solid ${T.borderLight}`, cursor: "pointer", display: "flex", justifyContent: "space-between", borderRadius: T.radiusXs }}>
        <div><div style={{ fontSize: 13, fontWeight: 600 }}>{x.desc}</div><div style={{ fontSize: 11, color: T.textMuted }}>{x.cat} · {x.unite}</div></div>
        <div style={{ fontWeight: 700, fontSize: 13, color: T.primary }}>{fmt(x.pu)}</div>
      </div>)}
    </div>
  </div>;
}

function SigPad({ onSave, onNo }) {
  const ref = useRef(null), dr = useRef(false), lp = useRef({ x: 0, y: 0 });
  const initialized = useRef(false);

  function initCanvas() {
    const c = ref.current;
    if (!c || initialized.current) return;
    const w = c.offsetWidth;
    const h = c.offsetHeight;
    if (w === 0 || h === 0) return; // pas encore rendu
    const dpr = window.devicePixelRatio || 1;
    c.width = w * dpr;
    c.height = h * dpr;
    const ctx = c.getContext("2d");
    ctx.scale(dpr, dpr);
    ctx.strokeStyle = "#1a1a18";
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    initialized.current = true;
  }

  useEffect(() => {
    // Essaie immédiatement, puis via RAF si le canvas n'est pas encore dimensionné
    initCanvas();
    if (!initialized.current) {
      const id = requestAnimationFrame(() => {
        initCanvas();
        if (!initialized.current) {
          // Dernier recours : ResizeObserver
          const ro = new ResizeObserver(() => { initCanvas(); if (initialized.current) ro.disconnect(); });
          if (ref.current) ro.observe(ref.current);
        }
      });
      return () => cancelAnimationFrame(id);
    }
  }, []);

  function getPos(e) {
    const r = ref.current.getBoundingClientRect();
    const t = e.touches ? e.touches[0] : e;
    return { x: t.clientX - r.left, y: t.clientY - r.top };
  }

  function draw(e) {
    if (!dr.current) return;
    e.preventDefault();
    const p = getPos(e);
    const ctx = ref.current.getContext("2d");
    ctx.beginPath();
    ctx.moveTo(lp.current.x, lp.current.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    lp.current = p;
  }

  function clear() {
    const c = ref.current;
    c.getContext("2d").clearRect(0, 0, c.width, c.height);
  }

  const ev = {
    onMouseDown:  e => { e.preventDefault(); dr.current = true; lp.current = getPos(e); },
    onMouseMove:  e => draw(e),
    onMouseUp:    () => { dr.current = false; },
    onMouseLeave: () => { dr.current = false; },
    onTouchStart: e => { e.preventDefault(); dr.current = true; lp.current = getPos(e); },
    onTouchMove:  e => draw(e),
    onTouchEnd:   () => { dr.current = false; },
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 100, display: "flex", alignItems: "flex-end", justifyContent: "center", animation: "fadeIn .2s" }} onClick={onNo}>
      <div style={{ background: T.bgCard, borderRadius: "20px 20px 0 0", padding: 22, width: "100%", maxWidth: 480, animation: "slideUp .25s" }} onClick={e => e.stopPropagation()}>
        <h3 style={{ fontSize: 17, fontWeight: 700, marginBottom: 4 }}>Signature client</h3>
        <p style={{ fontSize: 12, color: T.textMuted, marginBottom: 14 }}>Signez dans la zone ci-dessous</p>
        <div style={{ border: `2px dashed ${T.border}`, borderRadius: 12, overflow: "hidden", background: "#FAFAF8", marginBottom: 14, touchAction: "none" }}>
          <canvas ref={ref} style={{ display: "block", width: "100%", height: 180, cursor: "crosshair", touchAction: "none" }} {...ev} />
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn-press" onClick={clear} style={{ padding: "8px 14px", borderRadius: T.radiusXs, border: `1px solid ${T.border}`, background: T.bgCard, fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: T.font }}>Effacer</button>
          <div style={{ flex: 1 }} />
          <button className="btn-press" onClick={onNo} style={{ padding: "8px 14px", borderRadius: T.radiusXs, border: `1px solid ${T.border}`, background: T.bgCard, fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: T.font }}>Annuler</button>
          <button className="btn-press" onClick={() => onSave(ref.current.toDataURL("image/png"))} style={{ padding: "8px 14px", borderRadius: T.radiusXs, border: "none", background: T.primary, color: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: T.font }}>Valider</button>
        </div>
      </div>
    </div>
  );
}

function PDFPrev({ type, doc, client, signature, onClose, entreprise }) {
  const { brut, remise, net: ht, tv, tva, ttc: tot } = totals(doc), isF = type === "facture", ti = doc.type === "avoir" ? "AVOIR" : (isF ? "FACTURE" : "DEVIS");
  const e = entreprise || {};
  return <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 100, overflowY: "auto", padding: "16px 8px", animation: "fadeIn .2s" }}>
    <div style={{ background: "#fff", width: "100%", maxWidth: 480, margin: "0 auto", borderRadius: T.radius, overflow: "hidden", boxShadow: T.shadowLg }}>
      <div className="gradient-header" style={{ color: "#fff", padding: "10px 16px", display: "flex", justifyContent: "space-between", position: "relative", zIndex: 2 }}>
        <span style={{ fontWeight: 700, fontSize: 13 }}>📄 {ti} {doc.id}</span>
        <div style={{ display: "flex", gap: 6 }}>
          <button onClick={() => openPrintablePDF(type, doc, client, signature, entreprise)} style={{ background: "rgba(255,255,255,0.25)", border: "none", color: "#fff", borderRadius: 8, padding: "5px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>⬇ PDF</button>
          {type === "facture" && <button onClick={() => downloadFacturX(doc, client, entreprise)} style={{ background: "rgba(255,255,255,0.25)", border: "none", color: "#fff", borderRadius: 8, padding: "5px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>📋 Export XML</button>}
          <button onClick={onClose} style={{ background: "rgba(255,255,255,0.15)", border: "none", color: "#fff", borderRadius: 8, padding: "5px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>✕</button>
        </div>
      </div>
      <div style={{ padding: 20, fontFamily: T.font, fontSize: 11 }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 18 }}>
          <div>
            {e.logo_url ? <img src={e.logo_url} alt="" style={{ maxHeight: 40, maxWidth: 130, marginBottom: 4, display: "block" }} /> : <div style={{ fontSize: 18, fontWeight: 800, color: T.primary }}>⚡ FactuPro</div>}
            <div style={{ fontSize: 11, fontWeight: 700, marginTop: 2 }}>{e.nom}</div>
            <div style={{ fontSize: 9, color: "#666" }}>{e.adresse}</div>
            <div style={{ fontSize: 9, color: "#666" }}>{e.tel} — {e.email}</div>
            <div style={{ fontSize: 8, color: "#999", marginTop: 2 }}>SIRET {e.siret} — TVA {e.tva_intra}</div>
          </div>
          <div style={{ textAlign: "right" }}><div style={{ fontSize: 14, fontWeight: 800, color: T.primary }}>{ti}</div><div style={{ fontSize: 12, fontWeight: 700 }}>{doc.id}</div><div style={{ fontSize: 10, color: "#888", marginTop: 2 }}>{dfr(doc.date)}</div></div>
        </div>
        <div style={{ background: T.primaryPale, borderRadius: 8, padding: 10, marginBottom: 14 }}>
          <div style={{ fontSize: 8, fontWeight: 700, color: T.textMuted, textTransform: "uppercase", marginBottom: 2 }}>Client</div>
          <div style={{ fontSize: 12, fontWeight: 700 }}>{client?.nom}</div><div style={{ fontSize: 10, color: "#555" }}>{client?.adresse}</div>
        </div>
        <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 12 }}>
          <thead><tr style={{ background: T.primary, color: "#fff" }}><th style={{ padding: 5, textAlign: "left", fontSize: 8 }}>Description</th><th style={{ padding: 5, textAlign: "center", fontSize: 8 }}>Qté</th><th style={{ padding: 5, textAlign: "right", fontSize: 8 }}>P.U.</th><th style={{ padding: 5, textAlign: "right", fontSize: 8 }}>Total</th></tr></thead>
          <tbody>{doc.lignes.map((l, i) => <tr key={i} style={{ borderBottom: `1px solid ${T.borderLight}` }}><td style={{ padding: 5 }}>{l.desc}</td><td style={{ padding: 5, textAlign: "center" }}>{l.qte} {l.unite}</td><td style={{ padding: 5, textAlign: "right" }}>{fmt(l.pu)}</td><td style={{ padding: 5, textAlign: "right", fontWeight: 600 }}>{fmt(l.qte * l.pu)}</td></tr>)}</tbody>
        </table>
        <div style={{ display: "flex", justifyContent: "flex-end" }}><div style={{ width: 170 }}>
          <div style={{ display: "flex", justifyContent: "space-between", padding: "3px 0" }}><span>HT</span><span style={{ fontWeight: 600 }}>{fmt(brut)}</span></div>
          {remise > 0 && <div style={{ display: "flex", justifyContent: "space-between", padding: "3px 0", color: T.danger }}><span>Remise</span><span>−{fmt(remise)}</span></div>}
          {remise > 0 && <div style={{ display: "flex", justifyContent: "space-between", padding: "3px 0" }}><span>HT net</span><span style={{ fontWeight: 600 }}>{fmt(ht)}</span></div>}
          <div style={{ display: "flex", justifyContent: "space-between", padding: "3px 0", color: "#888" }}><span>TVA {tv}%</span><span>{fmt(tva)}</span></div>
          <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", fontSize: 15, fontWeight: 800, color: T.primary, borderTop: `2px solid ${T.primary}`, marginTop: 3 }}><span>TTC</span><span>{fmt(tot)}</span></div>
        </div></div>
        {signature && <div style={{ marginTop: 16, display: "flex", justifyContent: "flex-end" }}><div style={{ textAlign: "center" }}><div style={{ fontSize: 8, color: "#888" }}>Bon pour accord</div><img src={signature} alt="" style={{ height: 45 }}/></div></div>}
        {type === "facture" && <div style={{ marginTop: 14 }}>
          <div style={{ padding: 10, background: "#f0f7f2", borderRadius: 6, fontSize: 9, color: "#555", lineHeight: 1.6, marginBottom: 6 }}>
            <strong style={{ color: T.primary }}>Mentions obligatoires</strong><br/>
            Type d'opération : {typeOpLabel(doc.typeOp)} · Adresse livraison : {client?.adresse || "id. facturation"}<br/>
            SIREN vendeur : {(e.siret || "").slice(0, 9)} · TVA Intra : {e.tva_intra || "N/A"}{client?.siret ? ` · SIRET client : ${client.siret}` : ""}
          </div>
          <div style={{ padding: 10, background: "#f8f8f5", borderRadius: 6, fontSize: 9, color: "#888", lineHeight: 1.6, marginBottom: 6 }}>
            Paiement 30j · Échéance : {dfr(doc.echeance)} · Pénalité retard : 3× taux légal + 40€
          </div>
          <div style={{ padding: 6, background: "#f0f0ec", borderRadius: 6, fontSize: 8, color: "#888", textAlign: "center" }}>
            Numérotation séquentielle · Mentions légales
          </div>
        </div>}
      </div>
    </div>
  </div>;
}

function PayPicker({ onSel, onClose }) {
  return <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 100, display: "flex", alignItems: "flex-end", justifyContent: "center", animation: "fadeIn .2s" }} onClick={onClose}>
    <div style={{ background: T.bgCard, borderRadius: "20px 20px 0 0", padding: 22, width: "100%", maxWidth: 480, animation: "slideUp .25s" }} onClick={e => e.stopPropagation()}>
      <h3 style={{ fontSize: 17, fontWeight: 700, marginBottom: 14 }}>Mode de paiement</h3>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        {PAIEMENTS.map(p => <button key={p.v} className="card-hover btn-press" onClick={() => onSel(p.v)} style={{ background: T.bgElevated, border: `1px solid ${T.border}`, borderRadius: T.radius, padding: 18, textAlign: "center", cursor: "pointer", fontFamily: T.font }}><div style={{ fontSize: 30, marginBottom: 6 }}>{p.i}</div><div style={{ fontSize: 14, fontWeight: 600 }}>{p.l}</div></button>)}
      </div>
    </div>
  </div>;
}

/* ══════════════ PAGES ══════════════ */
function Dashboard({ devis, factures, clients, onNav, onSelectDevis, onSelectFacture }) {
  const ca = factures.filter(f => f.statut === "payee").reduce((s, f) => s + ttc(f), 0);
  const att = factures.filter(f => f.statut !== "payee" && !f.brouillon && f.type !== "avoir").reduce((s, f) => s + ttc(f), 0);
  const dc = devis.filter(d => d.statut === "en_attente").length;
  const ret = factures.filter(f => f.statut === "en_retard").length;
  const conv = devis.length > 0 ? Math.round(devis.filter(d => ["accepte", "facture"].includes(d.statut)).length / devis.length * 100) : 0;
  const mois = ["Jan","Fév","Mar","Avr","Mai","Jun","Jul","Aoû","Sep","Oct","Nov","Déc"];
  const ma = new Date().getMonth();
  const bars = Array.from({ length: 6 }, (_, i) => { const m = (ma - 5 + i + 12) % 12; return { m: mois[m], t: factures.filter(f => new Date(f.date).getMonth() === m && f.statut === "payee").reduce((s, f) => s + ttc(f), 0) }; });
  const mx = Math.max(...bars.map(b => b.t), 1);
  const recent = [...devis.map(d => ({ ...d, _t: "devis" })), ...factures.map(f => ({ ...f, _t: "facture" }))].sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 3);

  return <div>
    {ret > 0 && <div className="fade-up card-hover" onClick={() => onNav("relances")} style={{ background: `linear-gradient(135deg, ${T.dangerPale}, #FFF1F2)`, border: "1px solid #FECACA", borderRadius: T.radius, padding: "14px 16px", marginBottom: 16, cursor: "pointer", display: "flex", alignItems: "center", gap: 12 }}>
      <div style={{ width: 40, height: 40, borderRadius: 12, background: "#FEE2E2", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20 }}>🔔</div>
      <div><div style={{ fontSize: 14, fontWeight: 700, color: "#991B1B" }}>{ret} facture{ret > 1 ? "s" : ""} en retard</div><div style={{ fontSize: 12, color: "#B91C1C" }}>Relancer →</div></div>
    </div>}
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 16 }}>
      <StatCard label="CA encaissé" value={fmtShort(ca)} icon="💰" delay={1} />
      <StatCard label="En attente" value={fmtShort(att)} color={att > 0 ? "#B45309" : T.primary} icon="⏳" delay={2} />
      <StatCard label="Devis en cours" value={dc} icon="📄" delay={3} sub={`${conv}% convertis`} />
      <StatCard label="Clients" value={clients.length} icon="👥" delay={4} onClick={() => onNav("clients")} />
    </div>
    <div className="fade-up fade-up-3" style={{ background: T.bgCard, borderRadius: T.radius, padding: "20px 18px", boxShadow: T.shadow, marginBottom: 16 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: T.textMuted, textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 16 }}>Chiffre d'affaires</div>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 4, height: 90 }}>
        {bars.map((b, i) => <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: "center", flex: 1 }}>
          <div style={{ fontSize: 9, fontWeight: 700, color: T.primary, marginBottom: 4, opacity: b.t > 0 ? 1 : 0 }}>{fmtShort(b.t)}</div>
          <div className="bar-animate" style={{ width: "100%", maxWidth: 34, background: i === 5 ? `linear-gradient(180deg, ${T.primaryLighter}, ${T.primary})` : T.primaryPale, borderRadius: "6px 6px 3px 3px", height: Math.max(4, (b.t / mx) * 60), animationDelay: `${i * .08}s` }} />
          <div style={{ fontSize: 10, color: i === 5 ? T.primary : T.textLight, marginTop: 6, fontWeight: 600 }}>{b.m}</div>
        </div>)}
      </div>
    </div>
    <div className="fade-up fade-up-4" style={{ marginTop: 8 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: T.textMuted, textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 10 }}>Actions rapides</div>
      <div style={{ display: "flex", gap: 8 }}>
        <button className="btn-press" onClick={() => onNav("nouveau_devis")} style={{ flex: 1, padding: 14, borderRadius: T.radius, border: "none", background: T.primary, color: "#fff", fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: T.font, boxShadow: "0 4px 14px rgba(27,67,50,0.3)" }}>+ Nouveau devis</button>
        <button className="btn-press" onClick={() => onNav("analytics")} style={{ padding: "14px 18px", borderRadius: T.radius, border: `1.5px solid ${T.border}`, background: T.bgCard, fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: T.font }}>📊</button>
      </div>
    </div>
    {recent.length > 0 && <div className="fade-up fade-up-5" style={{ marginTop: 20 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: T.textMuted, textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 10 }}>Activité récente</div>
      {recent.map(item => { const cl = clients.find(c => c.id === item.clientId); return <div key={item.id} className="card-hover" onClick={() => item._t === "devis" ? onSelectDevis(item) : onSelectFacture(item)} style={{ background: T.bgCard, borderRadius: T.radiusSm, padding: "12px 14px", marginBottom: 6, boxShadow: T.shadow, display: "flex", alignItems: "center", gap: 12, cursor: "pointer" }}>
        <div style={{ width: 36, height: 36, borderRadius: 10, background: item._t === "devis" ? T.infoPale : T.primaryPale, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>{item._t === "devis" ? "📄" : "🧾"}</div>
        <div style={{ flex: 1 }}><div style={{ fontSize: 13, fontWeight: 600 }}>{item.id} — {cl?.nom}</div><div style={{ fontSize: 11, color: T.textMuted }}>{dfr(item.date)}</div></div>
        <div style={{ textAlign: "right" }}><div style={{ fontSize: 13, fontWeight: 700, color: T.primary }}>{fmtShort(ttc(item))}</div><Badge statut={item.statut} /></div>
      </div>; })}
    </div>}
  </div>;
}

function ClientsList({ clients, onSelect, onAdd }) {
  const [q, setQ] = useState("");
  const f = clients.filter(c => !q || c.nom.toLowerCase().includes(q.toLowerCase()) || (c.tel||"").includes(q));
  return <div>
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}><div style={{ fontSize: 12, fontWeight: 700, color: T.textMuted, textTransform: "uppercase", letterSpacing: 0.8 }}>Clients ({clients.length})</div><button className="btn-press" onClick={onAdd} style={{ padding: "8px 14px", borderRadius: T.radiusSm, border: "none", background: T.primary, color: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: T.font }}>+ Ajouter</button></div>
    <Search v={q} set={setQ} ph="Nom, téléphone..." />
    {f.map(c => <div key={c.id} className="card-hover" style={{ background: T.bgCard, borderRadius: T.radiusSm, padding: 14, marginBottom: 8, boxShadow: T.shadow, cursor: "pointer", display: "flex", alignItems: "center", gap: 12 }} onClick={() => onSelect(c)}>
      <div style={{ width: 40, height: 40, borderRadius: 12, background: `linear-gradient(135deg, ${T.primary}, ${T.primaryLighter})`, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 14 }}>{c.nom.split(" ").map(w => w[0]).join("").slice(0, 2)}</div>
      <div style={{ flex: 1 }}><div style={{ fontWeight: 600, fontSize: 14 }}>{c.nom}</div><div style={{ fontSize: 12, color: T.textMuted }}>{c.tel}</div></div><div style={{ color: T.textLight }}>→</div>
    </div>)}
  </div>;
}

function ClientForm({ client, onSave, onNo }) {
  const [f, setF] = useState(client || { nom: "", tel: "", email: "", adresse: "", notes: "" });
  const inputStyle = { width: "100%", padding: "10px 12px", borderRadius: T.radiusXs, border: `1px solid ${T.border}`, fontSize: 14, fontFamily: T.font, color: T.text, outline: "none", boxSizing: "border-box", background: T.bgElevated };
  return <div>
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 18 }}><button className="btn-press" onClick={onNo} style={{ width: 36, height: 36, borderRadius: 10, border: `1px solid ${T.border}`, background: T.bgCard, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>‹</button><h2 style={{ fontSize: 18, fontWeight: 700 }}>{client ? "Modifier" : "Nouveau client"}</h2></div>
    {[["nom","Nom complet"],["tel","Téléphone"],["email","Email"],["adresse","Adresse"],["siret","SIRET (si professionnel)"]].map(([k, l]) => <div key={k} style={{ marginBottom: 12 }}><label style={{ fontSize: 11, fontWeight: 600, color: T.textMuted, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4, display: "block" }}>{l}</label><input className="search-glow" style={inputStyle} value={f[k]||""} onChange={e => setF({ ...f, [k]: e.target.value })} /></div>)}
    <div style={{ marginBottom: 12 }}><label style={{ fontSize: 11, fontWeight: 600, color: T.textMuted, textTransform: "uppercase", marginBottom: 4, display: "block" }}>Notes</label><textarea className="search-glow" style={{ ...inputStyle, minHeight: 70, resize: "vertical" }} value={f.notes||""} onChange={e => setF({ ...f, notes: e.target.value })} /></div>
    <button className="btn-press" style={{ width: "100%", padding: 14, borderRadius: T.radiusSm, border: "none", background: T.primary, color: "#fff", fontSize: 15, fontWeight: 700, cursor: "pointer", fontFamily: T.font }} onClick={() => onSave(f)}>Enregistrer</button>
  </div>;
}

function ClientProfil({ client, devis, factures, onBack, onEdit }) {
  const dvs = devis.filter(d => d.clientId === client.id);
  const fcs = factures.filter(f => f.clientId === client.id);
  const ca = fcs.filter(f => f.statut === "payee").reduce((s, f) => s + ttc(f), 0);
  return <div>
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
      <button className="btn-press" onClick={onBack} style={{ width: 36, height: 36, borderRadius: 10, border: `1px solid ${T.border}`, background: T.bgCard, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>‹</button>
      <h2 style={{ fontSize: 18, fontWeight: 700, flex: 1 }}>{client.nom}</h2>
      <button className="btn-press" onClick={onEdit} style={{ padding: "7px 14px", borderRadius: T.radiusXs, border: `1px solid ${T.border}`, background: T.bgCard, fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: T.font }}>Modifier</button>
    </div>
    <div style={{ background: T.bgCard, borderRadius: T.radius, padding: 16, boxShadow: T.shadow, marginBottom: 12 }}>
      {client.adresse && <div style={{ fontSize: 13, color: T.textMuted, marginBottom: 4 }}>📍 {client.adresse}</div>}
      {client.tel && <div style={{ fontSize: 13, color: T.textMuted, marginBottom: 4 }}>📞 {client.tel}</div>}
      {client.email && <div style={{ fontSize: 13, color: T.textMuted, marginBottom: 4 }}>✉ {client.email}</div>}
      {client.siret && <div style={{ fontSize: 13, color: T.textMuted, marginBottom: 4 }}>🏢 SIRET {client.siret}</div>}
      {client.notes && <div style={{ marginTop: 8, fontSize: 12, color: T.textMuted, fontStyle: "italic", borderTop: `1px solid ${T.borderLight}`, paddingTop: 8 }}>{client.notes}</div>}
    </div>
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 16 }}>
      <StatCard label="CA encaissé" value={fmtShort(ca)} icon="💰" delay={1} />
      <StatCard label="Devis" value={dvs.length} icon="📄" delay={2} />
      <StatCard label="Factures" value={fcs.length} icon="🧾" delay={3} />
    </div>
    {dvs.length > 0 && <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: T.textMuted, textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 8 }}>Devis</div>
      {dvs.slice(0, 5).map(d => <div key={d.id} style={{ background: T.bgCard, borderRadius: T.radiusSm, padding: "10px 14px", marginBottom: 6, boxShadow: T.shadow, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div><div style={{ fontSize: 13, fontWeight: 600 }}>{d.id}</div><div style={{ fontSize: 11, color: T.textMuted }}>{dfr(d.date)}</div></div>
        <div style={{ textAlign: "right" }}><div style={{ fontSize: 13, fontWeight: 700 }}>{fmt(ttc(d))}</div><Badge statut={d.statut} /></div>
      </div>)}
    </div>}
    {fcs.length > 0 && <div>
      <div style={{ fontSize: 11, fontWeight: 700, color: T.textMuted, textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 8 }}>Factures</div>
      {fcs.slice(0, 5).map(f => <div key={f.id} style={{ background: T.bgCard, borderRadius: T.radiusSm, padding: "10px 14px", marginBottom: 6, boxShadow: T.shadow, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div><div style={{ fontSize: 13, fontWeight: 600 }}>{f.id}</div><div style={{ fontSize: 11, color: T.textMuted }}>{dfr(f.date)}</div></div>
        <div style={{ textAlign: "right" }}><div style={{ fontSize: 13, fontWeight: 700 }}>{fmt(ttc(f))}</div><Badge statut={f.statut} /></div>
      </div>)}
    </div>}
  </div>;
}

function DevisList({ devis, clients, onSelect, onNew }) {
  const [q, setQ] = useState(""); const [fi, setFi] = useState(null);
  const f = devis.filter(d => { const cl = clients.find(c => c.id === d.clientId); return (!q || d.id.toLowerCase().includes(q.toLowerCase()) || cl?.nom.toLowerCase().includes(q.toLowerCase())) && (!fi || d.statut === fi); });
  return <div>
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}><div style={{ fontSize: 12, fontWeight: 700, color: T.textMuted, textTransform: "uppercase", letterSpacing: 0.8 }}>Devis ({devis.length})</div><button className="btn-press" onClick={onNew} style={{ padding: "8px 14px", borderRadius: T.radiusSm, border: "none", background: T.primary, color: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: T.font }}>+ Nouveau</button></div>
    <Search v={q} set={setQ} ph="N°, client..." /><Chips opts={[{ v: "en_attente", l: "En attente" }, { v: "accepte", l: "Accepté" }, { v: "facture", l: "Facturé" }]} val={fi} set={setFi} />
    {f.map(d => { const cl = clients.find(c => c.id === d.clientId); return <div key={d.id} className="card-hover" style={{ background: T.bgCard, borderRadius: T.radiusSm, padding: 14, marginBottom: 8, boxShadow: T.shadow, cursor: "pointer" }} onClick={() => onSelect(d)}>
      <div style={{ display: "flex", justifyContent: "space-between" }}><div><div style={{ fontWeight: 700, fontSize: 14 }}>{d.id}</div><div style={{ fontSize: 12, color: T.textMuted }}>{cl?.nom} · {dfr(d.date)}</div></div><div style={{ textAlign: "right" }}><div style={{ fontWeight: 700, fontSize: 15, color: T.primary }}>{fmt(ttc(d))}</div><div style={{ marginTop: 4 }}><Badge statut={d.statut} /></div></div></div>
    </div>; })}
  </div>;
}

function DevisDetail({ devis, client, onBack, onConvert, onDelete, onSign, onPDF, onDup, onEmail, onViewFacture, onSendSignLink, onRefresh, onEdit }) {
  const { brut, remise, net: ht, tv, tva, ttc: tot } = totals(devis);
  return <div>
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
      <button className="btn-press" onClick={onBack} style={{ width: 36, height: 36, borderRadius: 10, border: `1px solid ${T.border}`, background: T.bgCard, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>‹</button>
      <h2 style={{ fontSize: 18, fontWeight: 700, flex: 1 }}>{devis.id}</h2>
      <Badge statut={devis.statut} />
      {!['accepte', 'refuse', 'facture'].includes(devis.statut) && <button className="btn-press" onClick={onRefresh} title="Actualiser" style={{ width: 32, height: 32, borderRadius: 8, border: `1px solid ${T.border}`, background: T.bgCard, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15 }}>🔄</button>}
    </div>
    <div style={{ background: T.bgCard, borderRadius: T.radius, padding: 16, boxShadow: T.shadow, marginBottom: 10 }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: T.textMuted, textTransform: "uppercase", marginBottom: 4 }}>Client</div><div style={{ fontWeight: 600, fontSize: 15 }}>{client?.nom}</div><div style={{ fontSize: 12, color: T.textMuted }}>{client?.adresse}</div>
      <div style={{ display: "flex", gap: 16, marginTop: 10, fontSize: 12 }}><span><span style={{ color: T.textMuted }}>Date</span> {dfr(devis.date)}</span><span><span style={{ color: T.textMuted }}>TVA</span> {tv}%</span></div>
    </div>
    <div style={{ background: T.bgCard, borderRadius: T.radius, padding: 16, boxShadow: T.shadow, marginBottom: 10 }}>
      {devis.lignes.map((l, i) => <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: i < devis.lignes.length - 1 ? `1px solid ${T.borderLight}` : "none" }}><div><div style={{ fontSize: 13, fontWeight: 500 }}>{l.desc}</div><div style={{ fontSize: 11, color: T.textMuted }}>{l.qte} {l.unite} × {fmt(l.pu)}</div></div><div style={{ fontWeight: 700, fontSize: 13 }}>{fmt(l.qte * l.pu)}</div></div>)}
      <div style={{ borderTop: `2px solid ${T.primary}`, marginTop: 8, paddingTop: 8 }}>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 3 }}><span>HT</span><span style={{ fontWeight: 600 }}>{fmt(brut)}</span></div>
        {remise > 0 && <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 3, color: T.danger }}><span>Remise</span><span>−{fmt(remise)}</span></div>}
        {remise > 0 && <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 3 }}><span>HT net</span><span style={{ fontWeight: 600 }}>{fmt(ht)}</span></div>}
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: T.textMuted }}><span>TVA {tv}%</span><span>{fmt(tva)}</span></div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 18, fontWeight: 800, color: T.primary, marginTop: 4 }}><span>TTC</span><span>{fmt(tot)}</span></div>
      </div>
    </div>
    {devis.notes && <div style={{ background: T.bgCard, borderRadius: T.radius, padding: 14, boxShadow: T.shadow, marginBottom: 10 }}><div style={{ fontSize: 11, fontWeight: 600, color: T.textMuted, marginBottom: 4 }}>Notes</div><div style={{ fontSize: 13, color: T.text, lineHeight: 1.6 }}>{devis.notes}</div></div>}
    {devis.signature && <div style={{ background: T.bgCard, borderRadius: T.radius, padding: 14, boxShadow: T.shadow, marginBottom: 10 }}><div style={{ fontSize: 11, fontWeight: 600, color: T.textMuted }}>Signature ✍</div><img src={devis.signature} alt="" style={{ height: 50, marginTop: 6 }}/></div>}
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
      {!devis.signature && devis.statut === "en_attente" && <button className="btn-press" onClick={onSign} style={{ padding: "9px 14px", borderRadius: T.radiusXs, border: "none", background: T.primary, color: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: T.font }}>✍ Signer</button>}
      {(devis.statut === "accepte" || devis.signature) && devis.statut !== "facture" && <button className="btn-press" onClick={onConvert} style={{ padding: "9px 14px", borderRadius: T.radiusXs, border: "none", background: T.primary, color: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: T.font }}>→ Facturer</button>}
      {devis.statut === "facture" && <button className="btn-press" onClick={onViewFacture} style={{ padding: "9px 14px", borderRadius: T.radiusXs, border: "none", background: "#6366F1", color: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: T.font }}>🧾 Voir la facture</button>}
      {!devis.signature && devis.statut !== "facture" && devis.statut !== "refuse" && <button className="btn-press" onClick={onSendSignLink} style={{ padding: "9px 14px", borderRadius: T.radiusXs, border: "none", background: "#0EA5E9", color: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: T.font }}>🔗 Lien de signature</button>}
      <button className="btn-press" onClick={onPDF} style={{ padding: "9px 14px", borderRadius: T.radiusXs, border: `1px solid ${T.border}`, background: T.bgCard, fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: T.font }}>📄 PDF</button>
      <button className="btn-press" onClick={onEmail} style={{ padding: "9px 14px", borderRadius: T.radiusXs, border: `1px solid ${T.border}`, background: T.bgCard, fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: T.font }}>✉ Envoyer</button>
      {devis.statut === "en_attente" && <button className="btn-press" onClick={onEdit} style={{ padding: "9px 14px", borderRadius: T.radiusXs, border: `1px solid ${T.border}`, background: T.bgCard, fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: T.font }}>✏ Modifier</button>}
      <button className="btn-press" onClick={onDup} style={{ padding: "9px 14px", borderRadius: T.radiusXs, border: `1px solid ${T.border}`, background: T.bgCard, fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: T.font }}>📋 Dupliquer</button>
      <button className="btn-press" onClick={onDelete} style={{ padding: "9px 14px", borderRadius: T.radiusXs, border: `1px solid ${T.dangerPale}`, background: T.dangerPale, fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: T.font, color: "#991B1B" }}>🗑</button>
    </div>
  </div>;
}

function DevisForm({ clients, onSave, onNo, catalogue, init, mode }) {
  const [cId, setCId] = useState(init?.clientId || clients[0]?.id || "");
  const [ls, setLs] = useState(init?.lignes?.map(l => ({ ...l })) || [{ desc: "", qte: 1, unite: "forfait", pu: 0 }]);
  const [tv, setTv] = useState(init?.tva || 10);
  const [typeOp, setTypeOp] = useState(init?.typeOp || "services");
  const [remiseType, setRemiseType] = useState(init?.remiseType || "montant");
  const [remiseValeur, setRemiseValeur] = useState(init?.remiseValeur || 0);
  const [notes, setNotes] = useState(init?.notes || "");
  const [showC, setShowC] = useState(false);
  const [saving, setSaving] = useState(false);
  const uL = (i, k, v) => { const n = [...ls]; n[i] = { ...n[i], [k]: k === "qte" || k === "pu" ? parseFloat(v) || 0 : v }; setLs(n); };
  const inputStyle = { width: "100%", padding: "8px 10px", borderRadius: T.radiusXs, border: `1px solid ${T.border}`, fontSize: 14, fontFamily: T.font, fontWeight: 600, color: T.text, outline: "none", boxSizing: "border-box", background: T.bgElevated };

  return <div>
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}><button className="btn-press" onClick={onNo} style={{ width: 36, height: 36, borderRadius: 10, border: `1px solid ${T.border}`, background: T.bgCard, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>‹</button><h2 style={{ fontSize: 18, fontWeight: 700 }}>{mode === "edit" ? "Modifier le devis" : (init ? "Dupliquer" : "Nouveau devis")}</h2></div>
    <div style={{ marginBottom: 12 }}><label style={{ fontSize: 11, fontWeight: 600, color: T.textMuted, textTransform: "uppercase", marginBottom: 4, display: "block" }}>Client</label><select className="search-glow" style={{ ...inputStyle, fontWeight: 400 }} value={cId} onChange={e => setCId(e.target.value)}>{clients.map(c => <option key={c.id} value={c.id}>{c.nom}</option>)}</select></div>
    <div style={{ marginBottom: 12 }}><label style={{ fontSize: 11, fontWeight: 600, color: T.textMuted, textTransform: "uppercase", marginBottom: 6, display: "block" }}>TVA</label><Chips opts={[0, 5.5, 10, 20].map(t => ({ v: t, l: t + "%" }))} val={tv} set={setTv} /></div>
    <div style={{ marginBottom: 12 }}><label style={{ fontSize: 11, fontWeight: 600, color: T.textMuted, textTransform: "uppercase", marginBottom: 6, display: "block" }}>Type d'opération</label><Chips opts={[{ v: "services", l: "Services" }, { v: "biens", l: "Biens" }, { v: "mixte", l: "Mixte" }]} val={typeOp} set={setTypeOp} /></div>
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
      <label style={{ fontSize: 11, fontWeight: 600, color: T.textMuted, textTransform: "uppercase" }}>Prestations</label>
      <button className="btn-press" onClick={() => setShowC(true)} style={{ padding: "5px 10px", borderRadius: T.radiusXs, border: `1px solid ${T.border}`, background: T.bgCard, fontSize: 11, fontWeight: 600, cursor: "pointer", fontFamily: T.font }}>📋 Catalogue</button>
    </div>
    {ls.map((l, i) => <div key={i} style={{ background: T.bgCard, borderRadius: T.radiusSm, padding: 12, marginBottom: 8, boxShadow: T.shadow }}>
      <input className="search-glow" style={{ ...inputStyle, marginBottom: 6 }} placeholder="Description" value={l.desc} onChange={e => uL(i, "desc", e.target.value)} />
      <div style={{ display: "flex", gap: 6 }}>
        <div style={{ width: 55 }}><label style={{ fontSize: 9, fontWeight: 600, color: T.textLight }}>Qté</label><input className="search-glow" style={{ ...inputStyle, fontWeight: 400, padding: "6px 8px", fontSize: 13 }} type="number" value={l.qte} onChange={e => uL(i, "qte", e.target.value)} /></div>
        <div style={{ flex: 1 }}><label style={{ fontSize: 9, fontWeight: 600, color: T.textLight }}>Unité</label><select className="search-glow" style={{ ...inputStyle, fontWeight: 400, padding: "6px 8px", fontSize: 13 }} value={l.unite} onChange={e => uL(i, "unite", e.target.value)}>{["forfait","m²","ml","unité","heure","jour"].map(u => <option key={u}>{u}</option>)}</select></div>
        <div style={{ width: 75 }}><label style={{ fontSize: 9, fontWeight: 600, color: T.textLight }}>P.U.</label><input className="search-glow" style={{ ...inputStyle, fontWeight: 400, padding: "6px 8px", fontSize: 13 }} type="number" value={l.pu} onChange={e => uL(i, "pu", e.target.value)} /></div>
        <button onClick={() => ls.length > 1 && setLs(ls.filter((_, j) => j !== i))} style={{ alignSelf: "flex-end", background: "none", border: "none", color: T.danger, cursor: "pointer", padding: 6, fontSize: 14 }}>×</button>
      </div>
    </div>)}
    <button className="btn-press" onClick={() => setLs([...ls, { desc: "", qte: 1, unite: "forfait", pu: 0 }])} style={{ width: "100%", padding: 12, borderRadius: T.radiusSm, border: `1.5px dashed ${T.border}`, background: "transparent", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: T.font, color: T.textMuted, marginBottom: 14 }}>+ Ajouter une ligne</button>
    <div style={{ marginBottom: 12 }}>
      <label style={{ fontSize: 11, fontWeight: 600, color: T.textMuted, textTransform: "uppercase", marginBottom: 6, display: "block" }}>Remise (optionnel)</label>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <Chips opts={[{ v: "montant", l: "€" }, { v: "pourcent", l: "%" }]} val={remiseType} set={setRemiseType} />
        <input className="search-glow" style={{ ...inputStyle, fontWeight: 400, width: 110 }} type="number" min="0" value={remiseValeur} onChange={e => setRemiseValeur(parseFloat(e.target.value) || 0)} />
      </div>
    </div>
    <div style={{ background: T.bgCard, borderRadius: T.radius, padding: 14, marginBottom: 14, boxShadow: T.shadow }}>
      {(() => { const t = totals({ lignes: ls, tva: tv, remiseType, remiseValeur }); return <>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: T.textMuted, marginBottom: 2 }}><span>Total HT</span><span>{fmt(t.brut)}</span></div>
        {t.remise > 0 && <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: T.danger, marginBottom: 2 }}><span>Remise</span><span>−{fmt(t.remise)}</span></div>}
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: T.textMuted, marginBottom: 4 }}><span>TVA {t.tv}%</span><span>{fmt(t.tva)}</span></div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 18, fontWeight: 800, color: T.primary }}><span>TTC</span><span>{fmt(t.ttc)}</span></div>
      </>; })()}
    </div>
    <div style={{ marginBottom: 14 }}><label style={{ fontSize: 11, fontWeight: 600, color: T.textMuted, textTransform: "uppercase", marginBottom: 4, display: "block" }}>Notes (optionnel)</label><textarea className="search-glow" style={{ width: "100%", padding: "10px 12px", borderRadius: T.radiusXs, border: `1px solid ${T.border}`, fontSize: 14, fontFamily: T.font, color: T.text, outline: "none", boxSizing: "border-box", background: T.bgElevated, minHeight: 70, resize: "vertical" }} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Conditions particulières, délais, remarques..." /></div>
    <button className="btn-press" disabled={saving} onClick={async () => { const vl = ls.filter(l => l.desc.trim()); if (!vl.length) return; setSaving(true); await onSave({ clientId: cId, tva: tv, typeOp, remiseType, remiseValeur, lignes: vl, notes }); setSaving(false); }} style={{ width: "100%", padding: 14, borderRadius: T.radiusSm, border: "none", background: saving ? T.primaryLighter : T.primary, color: "#fff", fontSize: 15, fontWeight: 700, cursor: saving ? "wait" : "pointer", fontFamily: T.font, boxShadow: "0 4px 14px rgba(27,67,50,0.3)" }}>{saving ? "Enregistrement..." : mode === "edit" ? "Enregistrer les modifications" : "Créer le devis"}</button>
    {showC && <CatPicker cat={catalogue} onSel={x => setLs([...ls, { desc: x.desc, qte: 1, unite: x.unite, pu: x.pu }])} onClose={() => setShowC(false)} />}
  </div>;
}

function FactureDetail({ facture, client, onBack, onPDF, onEmail, onPay, onAvoir, onDup, onValider, onDelete }) {
  const { brut, remise, net: ht, tv, tva, ttc: tot } = totals(facture);
  const p = PAIEMENTS.find(y => y.v === facture.paiement);
  const isAvoir = facture.type === "avoir";
  const isBrouillon = facture.brouillon;
  return <div>
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
      <button className="btn-press" onClick={onBack} style={{ width: 36, height: 36, borderRadius: 10, border: `1px solid ${T.border}`, background: T.bgCard, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>‹</button>
      <h2 style={{ fontSize: 18, fontWeight: 700, flex: 1 }}>{facture.id}</h2>
      {isAvoir && <span style={{ fontSize: 11, fontWeight: 700, padding: "3px 8px", borderRadius: 6, background: "#FEF3C7", color: "#92400E" }}>AVOIR</span>}
      <Badge statut={facture.statut} />
    </div>
    {isAvoir && facture.notes && <div style={{ fontSize: 12, color: T.textMuted, marginBottom: 10 }}>↩ {facture.notes}</div>}

    <div style={{ background: T.bgCard, borderRadius: T.radius, padding: 16, boxShadow: T.shadow, marginBottom: 10 }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: T.textMuted, textTransform: "uppercase", marginBottom: 4 }}>Client</div>
      <div style={{ fontWeight: 600, fontSize: 15 }}>{client?.nom}</div>
      <div style={{ fontSize: 12, color: T.textMuted }}>{client?.adresse}</div>
      <div style={{ display: "flex", gap: 16, marginTop: 10, fontSize: 12, flexWrap: "wrap" }}>
        <span><span style={{ color: T.textMuted }}>Date </span>{dfr(facture.date)}</span>
        <span><span style={{ color: T.textMuted }}>Échéance </span>{dfr(facture.echeance)}</span>
        <span><span style={{ color: T.textMuted }}>TVA </span>{tv}%</span>
        {p && <span>{p.i} {p.l}</span>}
      </div>
    </div>

    <div style={{ background: T.bgCard, borderRadius: T.radius, padding: 16, boxShadow: T.shadow, marginBottom: 10 }}>
      {facture.lignes.map((l, i) => <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: i < facture.lignes.length - 1 ? `1px solid ${T.borderLight}` : "none" }}>
        <div><div style={{ fontSize: 13, fontWeight: 500 }}>{l.desc}</div><div style={{ fontSize: 11, color: T.textMuted }}>{l.qte} {l.unite} × {fmt(l.pu)}</div></div>
        <div style={{ fontWeight: 700, fontSize: 13 }}>{fmt(l.qte * l.pu)}</div>
      </div>)}
      <div style={{ borderTop: `2px solid ${T.primary}`, marginTop: 8, paddingTop: 8 }}>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 3 }}><span>HT</span><span style={{ fontWeight: 600 }}>{fmt(brut)}</span></div>
        {remise > 0 && <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 3, color: T.danger }}><span>Remise</span><span>−{fmt(remise)}</span></div>}
        {remise > 0 && <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 3 }}><span>HT net</span><span style={{ fontWeight: 600 }}>{fmt(ht)}</span></div>}
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: T.textMuted }}><span>TVA {tv}%</span><span>{fmt(tva)}</span></div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 18, fontWeight: 800, color: T.primary, marginTop: 4 }}><span>TTC</span><span>{fmt(tot)}</span></div>
      </div>
    </div>

    {facture.datePaiement && <div style={{ background: T.primaryPale, borderRadius: T.radius, padding: 14, boxShadow: T.shadow, marginBottom: 10, fontSize: 13, color: "#065F46" }}>
      ✓ Payée le {dfr(facture.datePaiement)}
    </div>}

    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
      {isBrouillon ? <>
        <button className="btn-press" onClick={onValider} style={{ padding: "9px 14px", borderRadius: T.radiusXs, border: "none", background: T.primary, color: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: T.font }}>✅ Valider et émettre</button>
        <button className="btn-press" onClick={onPDF} style={{ padding: "9px 14px", borderRadius: T.radiusXs, border: `1px solid ${T.border}`, background: T.bgCard, fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: T.font }}>📄 Aperçu</button>
        <button className="btn-press" onClick={onDelete} style={{ padding: "9px 14px", borderRadius: T.radiusXs, border: `1px solid ${T.dangerPale}`, background: T.dangerPale, color: "#991B1B", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: T.font }}>🗑 Supprimer</button>
      </> : <>
        {facture.statut !== "payee" && <button className="btn-press" onClick={() => onPay(facture.dbId)} style={{ padding: "9px 14px", borderRadius: T.radiusXs, border: "none", background: T.primary, color: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: T.font }}>💰 Marquer payée</button>}
        <button className="btn-press" onClick={onPDF} style={{ padding: "9px 14px", borderRadius: T.radiusXs, border: `1px solid ${T.border}`, background: T.bgCard, fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: T.font }}>📄 PDF</button>
        <button className="btn-press" onClick={onEmail} style={{ padding: "9px 14px", borderRadius: T.radiusXs, border: `1px solid ${T.border}`, background: T.bgCard, fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: T.font }}>✉ Envoyer</button>
        {!isAvoir && <button className="btn-press" onClick={onDup} style={{ padding: "9px 14px", borderRadius: T.radiusXs, border: `1px solid ${T.border}`, background: T.bgCard, fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: T.font }}>📋 Dupliquer</button>}
        {!isAvoir && <button className="btn-press" onClick={onAvoir} style={{ padding: "9px 14px", borderRadius: T.radiusXs, border: `1px solid ${T.accent}`, background: T.accentPale, color: "#92400E", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: T.font }}>↩ Créer un avoir</button>}
      </>}
    </div>
    {isBrouillon
      ? <div style={{ marginTop: 10, fontSize: 11, color: T.textLight, display: "flex", alignItems: "center", gap: 6 }}>📝 Brouillon — non émis. Validez-le pour lui attribuer un numéro et le rendre définitif.</div>
      : !isAvoir && <div style={{ marginTop: 10, fontSize: 11, color: T.textLight, display: "flex", alignItems: "center", gap: 6 }}>🔒 Facture émise — inaltérable. Pour corriger, créez un avoir.</div>}
  </div>;
}

function AvoirModal({ facture, onClose, onConfirm }) {
  const _t = totals(facture), ht = _t.net, tv = _t.tv, totTtc = _t.ttc;
  const [mode, setMode] = useState("total"); // total | custom
  const [montant, setMontant] = useState(ht.toFixed(2));
  const [motif, setMotif] = useState("");
  const [saving, setSaving] = useState(false);
  const iS = { width: "100%", padding: "10px 12px", borderRadius: T.radiusXs, border: `1px solid ${T.border}`, fontSize: 14, fontFamily: T.font, color: T.text, outline: "none", boxSizing: "border-box", background: T.bgElevated };
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 100, display: "flex", alignItems: "flex-end", justifyContent: "center", animation: "fadeIn .2s" }} onClick={onClose}>
      <div style={{ background: T.bgCard, borderRadius: "20px 20px 0 0", padding: 22, width: "100%", maxWidth: 480, animation: "slideUp .25s" }} onClick={e => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <h3 style={{ fontSize: 17, fontWeight: 700 }}>↩ Créer un avoir</h3>
          <button onClick={onClose} style={{ background: T.bgElevated, border: "none", cursor: "pointer", color: T.textMuted, width: 32, height: 32, borderRadius: "50%", fontSize: 16 }}>×</button>
        </div>
        <div style={{ background: T.bgElevated, borderRadius: T.radiusSm, padding: "10px 14px", marginBottom: 14, fontSize: 13, color: T.textMuted }}>
          Facture {facture.id} · HT {fmt(ht)} · TTC {fmt(totTtc)}
        </div>
        <div style={{ marginBottom: 14 }}><label style={{ fontSize: 11, fontWeight: 600, color: T.textMuted, textTransform: "uppercase", marginBottom: 6, display: "block" }}>Type d'avoir</label>
          <Chips opts={[{ v: "total", l: "Avoir total" }, { v: "custom", l: "Montant personnalisé" }]} val={mode} set={setMode} />
        </div>
        {mode === "custom" && <>
          <div style={{ marginBottom: 12 }}><label style={{ fontSize: 11, fontWeight: 600, color: T.textMuted, textTransform: "uppercase", marginBottom: 4, display: "block" }}>Montant à créditer (€ HT)</label><input style={iS} type="number" value={montant} onChange={e => setMontant(e.target.value)} /></div>
          <div style={{ marginBottom: 14 }}><label style={{ fontSize: 11, fontWeight: 600, color: T.textMuted, textTransform: "uppercase", marginBottom: 4, display: "block" }}>Motif</label><input style={iS} value={motif} onChange={e => setMotif(e.target.value)} placeholder="ex: Remise commerciale, annulation partielle..." /></div>
        </>}
        <button className="btn-press" disabled={saving} onClick={async () => {
          setSaving(true);
          try { await onConfirm(mode === "custom" ? { montant: parseFloat(montant) || 0, motif } : null); }
          finally { setSaving(false); }
        }} style={{ width: "100%", padding: 14, borderRadius: T.radiusSm, border: "none", background: saving ? T.primaryLighter : T.primary, color: "#fff", fontSize: 15, fontWeight: 700, cursor: saving ? "wait" : "pointer", fontFamily: T.font }}>
          {saving ? "Création..." : "Créer l'avoir"}
        </button>
      </div>
    </div>
  );
}

function RecurrenceForm({ clients, catalogue, onSave, onNo, init }) {
  const [cId, setCId] = useState(init?.client_id || clients[0]?.id || "");
  const [libelle, setLibelle] = useState(init?.libelle || "");
  const [ls, setLs] = useState(init?.lignes?.length ? init.lignes.map(l => ({ desc: l.description, qte: parseFloat(l.quantite), unite: l.unite, pu: parseFloat(l.prix_unitaire) })) : [{ desc: "", qte: 1, unite: "forfait", pu: 0 }]);
  const [tv, setTv] = useState(init?.taux_tva ?? 20);
  const [typeOp, setTypeOp] = useState(init?.type_operation || "services");
  const [remiseType, setRemiseType] = useState(init?.remise_type || "montant");
  const [remiseValeur, setRemiseValeur] = useState(init?.remise_valeur || 0);
  const [delai, setDelai] = useState(init?.delai_echeance ?? 30);
  const [frequence, setFrequence] = useState(init?.frequence || "mensuelle");
  const [dateDebut, setDateDebut] = useState(init?.date_debut || tod());
  const [dateFin, setDateFin] = useState(init?.date_fin || "");
  const [showC, setShowC] = useState(false);
  const [saving, setSaving] = useState(false);
  const uL = (i, k, v) => { const n = [...ls]; n[i] = { ...n[i], [k]: k === "qte" || k === "pu" ? parseFloat(v) || 0 : v }; setLs(n); };
  const iS = { width: "100%", padding: "8px 10px", borderRadius: T.radiusXs, border: `1px solid ${T.border}`, fontSize: 14, fontFamily: T.font, color: T.text, outline: "none", boxSizing: "border-box", background: T.bgElevated };

  return <div>
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}><button className="btn-press" onClick={onNo} style={{ width: 36, height: 36, borderRadius: 10, border: `1px solid ${T.border}`, background: T.bgCard, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>‹</button><h2 style={{ fontSize: 18, fontWeight: 700 }}>{init ? "Modifier la récurrence" : "Nouvelle récurrence"}</h2></div>
    <div style={{ marginBottom: 12 }}><label style={{ fontSize: 11, fontWeight: 600, color: T.textMuted, textTransform: "uppercase", marginBottom: 4, display: "block" }}>Libellé (interne)</label><input className="search-glow" style={iS} value={libelle} onChange={e => setLibelle(e.target.value)} placeholder="ex: Maintenance mensuelle Dupont" /></div>
    <div style={{ marginBottom: 12 }}><label style={{ fontSize: 11, fontWeight: 600, color: T.textMuted, textTransform: "uppercase", marginBottom: 4, display: "block" }}>Client</label><select className="search-glow" style={iS} value={cId} onChange={e => setCId(e.target.value)}>{clients.map(c => <option key={c.id} value={c.id}>{c.nom}</option>)}</select></div>
    <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
      <div style={{ flex: 1 }}><label style={{ fontSize: 11, fontWeight: 600, color: T.textMuted, textTransform: "uppercase", marginBottom: 6, display: "block" }}>Fréquence</label><Chips opts={FREQS} val={frequence} set={setFrequence} /></div>
    </div>
    <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
      <div style={{ flex: 1 }}><label style={{ fontSize: 11, fontWeight: 600, color: T.textMuted, textTransform: "uppercase", marginBottom: 4, display: "block" }}>Début</label><input className="search-glow" style={iS} type="date" value={dateDebut} onChange={e => setDateDebut(e.target.value)} /></div>
      <div style={{ flex: 1 }}><label style={{ fontSize: 11, fontWeight: 600, color: T.textMuted, textTransform: "uppercase", marginBottom: 4, display: "block" }}>Fin (optionnel)</label><input className="search-glow" style={iS} type="date" value={dateFin} onChange={e => setDateFin(e.target.value)} /></div>
    </div>
    <div style={{ marginBottom: 12 }}><label style={{ fontSize: 11, fontWeight: 600, color: T.textMuted, textTransform: "uppercase", marginBottom: 6, display: "block" }}>TVA</label><Chips opts={[0, 5.5, 10, 20].map(t => ({ v: t, l: t + "%" }))} val={tv} set={setTv} /></div>
    <div style={{ marginBottom: 12 }}><label style={{ fontSize: 11, fontWeight: 600, color: T.textMuted, textTransform: "uppercase", marginBottom: 6, display: "block" }}>Type d'opération</label><Chips opts={[{ v: "services", l: "Services" }, { v: "biens", l: "Biens" }, { v: "mixte", l: "Mixte" }]} val={typeOp} set={setTypeOp} /></div>
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
      <label style={{ fontSize: 11, fontWeight: 600, color: T.textMuted, textTransform: "uppercase" }}>Prestations</label>
      <button className="btn-press" onClick={() => setShowC(true)} style={{ padding: "5px 10px", borderRadius: T.radiusXs, border: `1px solid ${T.border}`, background: T.bgCard, fontSize: 11, fontWeight: 600, cursor: "pointer", fontFamily: T.font }}>📋 Catalogue</button>
    </div>
    {ls.map((l, i) => <div key={i} style={{ background: T.bgCard, borderRadius: T.radiusSm, padding: 12, marginBottom: 8, boxShadow: T.shadow }}>
      <input className="search-glow" style={{ ...iS, fontWeight: 600, marginBottom: 6 }} placeholder="Description" value={l.desc} onChange={e => uL(i, "desc", e.target.value)} />
      <div style={{ display: "flex", gap: 6 }}>
        <div style={{ width: 55 }}><label style={{ fontSize: 9, fontWeight: 600, color: T.textLight }}>Qté</label><input className="search-glow" style={{ ...iS, padding: "6px 8px", fontSize: 13 }} type="number" value={l.qte} onChange={e => uL(i, "qte", e.target.value)} /></div>
        <div style={{ flex: 1 }}><label style={{ fontSize: 9, fontWeight: 600, color: T.textLight }}>Unité</label><select className="search-glow" style={{ ...iS, padding: "6px 8px", fontSize: 13 }} value={l.unite} onChange={e => uL(i, "unite", e.target.value)}>{["forfait","m²","ml","unité","heure","jour"].map(u => <option key={u}>{u}</option>)}</select></div>
        <div style={{ width: 75 }}><label style={{ fontSize: 9, fontWeight: 600, color: T.textLight }}>P.U.</label><input className="search-glow" style={{ ...iS, padding: "6px 8px", fontSize: 13 }} type="number" value={l.pu} onChange={e => uL(i, "pu", e.target.value)} /></div>
        <button onClick={() => ls.length > 1 && setLs(ls.filter((_, j) => j !== i))} style={{ alignSelf: "flex-end", background: "none", border: "none", color: T.danger, cursor: "pointer", padding: 6, fontSize: 14 }}>×</button>
      </div>
    </div>)}
    <button className="btn-press" onClick={() => setLs([...ls, { desc: "", qte: 1, unite: "forfait", pu: 0 }])} style={{ width: "100%", padding: 12, borderRadius: T.radiusSm, border: `1.5px dashed ${T.border}`, background: "transparent", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: T.font, color: T.textMuted, marginBottom: 12 }}>+ Ajouter une ligne</button>
    <div style={{ marginBottom: 12 }}><label style={{ fontSize: 11, fontWeight: 600, color: T.textMuted, textTransform: "uppercase", marginBottom: 4, display: "block" }}>Délai de paiement (jours)</label><input className="search-glow" style={iS} type="number" value={delai} onChange={e => setDelai(parseInt(e.target.value) || 0)} /></div>
    <div style={{ background: T.bgCard, borderRadius: T.radius, padding: 14, marginBottom: 14, boxShadow: T.shadow }}>
      {(() => { const t = totals({ lignes: ls, tva: tv, remiseType, remiseValeur }); return <div style={{ display: "flex", justifyContent: "space-between", fontSize: 16, fontWeight: 800, color: T.primary }}><span>TTC / échéance</span><span>{fmt(t.ttc)}</span></div>; })()}
    </div>
    <button className="btn-press" disabled={saving} onClick={async () => {
      const vl = ls.filter(l => l.desc.trim()); if (!vl.length || !cId || !dateDebut) return;
      setSaving(true);
      await onSave({
        client_id: cId, libelle,
        lignes: vl.map(l => ({ description: l.desc, quantite: l.qte, unite: l.unite, prix_unitaire: l.pu })),
        taux_tva: tv, type_operation: typeOp, remise_type: remiseType, remise_valeur: remiseValeur,
        delai_echeance: delai, frequence, date_debut: dateDebut, date_fin: dateFin || null,
      });
      setSaving(false);
    }} style={{ width: "100%", padding: 14, borderRadius: T.radiusSm, border: "none", background: saving ? T.primaryLighter : T.primary, color: "#fff", fontSize: 15, fontWeight: 700, cursor: saving ? "wait" : "pointer", fontFamily: T.font }}>{saving ? "Enregistrement..." : (init ? "Enregistrer" : "Créer la récurrence")}</button>
    {showC && <CatPicker cat={catalogue} onSel={x => setLs([...ls, { desc: x.desc, qte: 1, unite: x.unite, pu: x.pu }])} onClose={() => setShowC(false)} />}
  </div>;
}

function RecurrencesList({ recurrences, clients, factures, onNew, onEdit, onToggle, onStop }) {
  const stMap = { active: ["Active", T.primaryPale, "#065F46"], en_pause: ["En pause", T.accentPale, "#92400E"], terminee: ["Terminée", "#F1F1EE", "#666"] };
  return <div>
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: T.textMuted, textTransform: "uppercase", letterSpacing: 0.8 }}>Récurrences ({recurrences.length})</div>
      <button className="btn-press" onClick={onNew} style={{ padding: "8px 14px", borderRadius: T.radiusSm, border: "none", background: T.primary, color: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: T.font }}>+ Nouvelle</button>
    </div>
    <div style={{ fontSize: 11, color: T.textMuted, marginBottom: 14, lineHeight: 1.5 }}>Chaque échéance génère automatiquement une facture <strong>brouillon</strong> que vous validez avant envoi.</div>
    {recurrences.length === 0 && <div style={{ textAlign: "center", padding: 30, color: T.textMuted }}><div style={{ fontSize: 36, marginBottom: 8 }}>🔁</div><div style={{ fontWeight: 600 }}>Aucune récurrence</div><div style={{ fontSize: 13, marginTop: 4 }}>Automatisez vos factures régulières</div></div>}
    {recurrences.map(r => {
      const cl = clients.find(c => c.id === r.client_id);
      const nbGen = factures.filter(f => f.recurrenceId === r.id).length;
      const st = stMap[r.statut] || stMap.active;
      return <div key={r.id} className="card-hover" style={{ background: T.bgCard, borderRadius: T.radiusSm, padding: 14, marginBottom: 8, boxShadow: T.shadow }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: 14 }}>{r.libelle || cl?.nom || "Récurrence"}</div>
            <div style={{ fontSize: 12, color: T.textMuted }}>{cl?.nom} · {freqLabel(r.frequence)}</div>
            <div style={{ fontSize: 11, color: T.textLight, marginTop: 2 }}>{r.statut === "terminee" ? "Terminée" : `Prochaine : ${dfr(r.prochaine_generation)}`}{r.date_fin ? ` · Fin : ${dfr(r.date_fin)}` : ""} · {nbGen} générée(s)</div>
          </div>
          <span style={{ fontSize: 10, fontWeight: 700, padding: "3px 8px", borderRadius: 20, background: st[1], color: st[2], whiteSpace: "nowrap" }}>{st[0]}</span>
        </div>
        {r.statut !== "terminee" && <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
          <button className="btn-press" onClick={() => onEdit(r)} style={{ padding: "6px 11px", borderRadius: T.radiusXs, border: `1px solid ${T.border}`, background: T.bgCard, fontSize: 11, fontWeight: 600, cursor: "pointer", fontFamily: T.font }}>✏ Modifier</button>
          <button className="btn-press" onClick={() => onToggle(r)} style={{ padding: "6px 11px", borderRadius: T.radiusXs, border: `1px solid ${T.border}`, background: T.bgCard, fontSize: 11, fontWeight: 600, cursor: "pointer", fontFamily: T.font }}>{r.statut === "active" ? "⏸ Pause" : "▶ Reprendre"}</button>
          <button className="btn-press" onClick={() => onStop(r)} style={{ padding: "6px 11px", borderRadius: T.radiusXs, border: `1px solid ${T.dangerPale}`, background: T.dangerPale, color: "#991B1B", fontSize: 11, fontWeight: 600, cursor: "pointer", fontFamily: T.font }}>⏹ Arrêter</button>
        </div>}
      </div>;
    })}
  </div>;
}

function FacturesList({ factures, clients, onSelect, onPDF, onPay, onEmail, onNew, onRecurrences }) {
  const [q, setQ] = useState(""); const [fi, setFi] = useState(null);
  const f = factures.filter(x => { const cl = clients.find(c => c.id === x.clientId); return (!q || x.id.toLowerCase().includes(q.toLowerCase()) || cl?.nom.toLowerCase().includes(q.toLowerCase())) && (!fi || x.statut === fi); });
  return <div>
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}><div style={{ fontSize: 12, fontWeight: 700, color: T.textMuted, textTransform: "uppercase", letterSpacing: 0.8 }}>Factures ({factures.length})</div><div style={{ display: "flex", gap: 6 }}><button className="btn-press" onClick={onRecurrences} style={{ padding: "8px 12px", borderRadius: T.radiusSm, border: `1px solid ${T.border}`, background: T.bgCard, fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: T.font }}>🔁 Récurrences</button><button className="btn-press" onClick={onNew} style={{ padding: "8px 14px", borderRadius: T.radiusSm, border: "none", background: T.primary, color: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: T.font }}>+ Nouvelle</button></div></div>
    <Search v={q} set={setQ} /><Chips opts={[{ v: "brouillon", l: "Brouillon" }, { v: "payee", l: "Payée" }, { v: "envoyee", l: "Envoyée" }, { v: "en_retard", l: "En retard" }]} val={fi} set={setFi} />
    {f.map(x => { const cl = clients.find(c => c.id === x.clientId); return <div key={x.id} className="card-hover" onClick={() => onSelect(x)} style={{ background: T.bgCard, borderRadius: T.radiusSm, padding: 14, marginBottom: 8, boxShadow: T.shadow, cursor: "pointer" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div><div style={{ fontWeight: 700, fontSize: 14, display: "flex", alignItems: "center", gap: 6 }}>{x.id}{x.type === "avoir" && <span style={{ fontSize: 9, fontWeight: 700, padding: "1px 5px", borderRadius: 4, background: "#FEF3C7", color: "#92400E" }}>AVOIR</span>}</div><div style={{ fontSize: 12, color: T.textMuted }}>{cl?.nom}</div><div style={{ fontSize: 11, color: T.textLight }}>{dfr(x.date)} — éch. {dfr(x.echeance)}</div></div>
        <div style={{ textAlign: "right" }}><div style={{ fontWeight: 700, fontSize: 15, color: T.primary }}>{fmt(ttc(x))}</div><div style={{ marginTop: 4 }}><Badge statut={x.statut} /></div></div>
      </div>
    </div>; })}
  </div>;
}

function ProLock({ titre, desc, onUpgrade }) {
  return <div>
    <div style={{ fontSize: 12, fontWeight: 700, color: T.textMuted, textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 14 }}>{titre}</div>
    <div className="fade-up" style={{ background: `linear-gradient(135deg, ${T.primary}, ${T.primaryLighter})`, color: "#fff", borderRadius: T.radius, padding: 26, textAlign: "center", boxShadow: T.shadow }}>
      <div style={{ fontSize: 42, marginBottom: 10 }}>🔒</div>
      <div style={{ fontSize: 19, fontWeight: 800, marginBottom: 8 }}>Fonctionnalité Pro</div>
      <div style={{ fontSize: 13, opacity: 0.9, lineHeight: 1.6, marginBottom: 20 }}>{desc}</div>
      <button className="btn-press" onClick={onUpgrade} style={{ width: "100%", padding: 14, borderRadius: T.radiusSm, border: "none", background: "#fff", color: T.primary, fontSize: 15, fontWeight: 700, cursor: "pointer", fontFamily: T.font }}>⭐ Passer à Pro — 9 €/mois</button>
    </div>
  </div>;
}

function Relances({ factures, clients, onRelance, onPaid }) {
  const ov = factures.filter(f => f.type !== "avoir" && !f.brouillon && f.statut !== "payee" && dd(f.echeance, tod()) > 0);
  const pe = factures.filter(f => f.type !== "avoir" && !f.brouillon && f.statut !== "payee" && dd(f.echeance, tod()) <= 0);
  return <div>
    <div style={{ fontSize: 12, fontWeight: 700, color: T.textMuted, textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 14 }}>Relances</div>
    {ov.map(f => { const cl = clients.find(c => c.id === f.clientId); return <div key={f.id} className="fade-up" style={{ background: T.bgCard, borderRadius: T.radiusSm, padding: 14, marginBottom: 8, boxShadow: T.shadow, borderLeft: `4px solid ${T.danger}` }}>
      <div style={{ fontWeight: 700, fontSize: 14 }}>{f.id} — {cl?.nom}</div>
      <div style={{ fontSize: 12, color: T.danger, fontWeight: 600, marginTop: 2 }}>⚠ {dd(f.echeance, tod())}j de retard · {fmt(ttc(f))}</div>
      <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
        <button className="btn-press" onClick={() => onRelance(f)} style={{ padding: "7px 12px", borderRadius: T.radiusXs, border: "none", background: T.primary, color: "#fff", fontSize: 11, fontWeight: 600, cursor: "pointer", fontFamily: T.font }}>✉ Relancer</button>
        <button className="btn-press" onClick={() => onPaid(f.dbId || f.id)} style={{ padding: "7px 12px", borderRadius: T.radiusXs, border: `1px solid ${T.border}`, background: T.bgCard, fontSize: 11, fontWeight: 600, cursor: "pointer", fontFamily: T.font }}>✓ Payée</button>
      </div>
    </div>; })}
    {pe.map(f => { const cl = clients.find(c => c.id === f.clientId); return <div key={f.id} style={{ background: T.bgCard, borderRadius: T.radiusSm, padding: 14, marginBottom: 8, boxShadow: T.shadow, borderLeft: `4px solid ${T.accent}` }}>
      <div style={{ fontWeight: 700, fontSize: 14 }}>{f.id} — {cl?.nom}</div>
      <div style={{ fontSize: 12, color: "#92400E", marginTop: 2 }}>J-{dd(tod(), f.echeance)} · {fmt(ttc(f))}</div>
      <button className="btn-press" onClick={() => onPaid(f.dbId || f.id)} style={{ padding: "7px 12px", borderRadius: T.radiusXs, border: `1px solid ${T.border}`, background: T.bgCard, fontSize: 11, fontWeight: 600, cursor: "pointer", fontFamily: T.font, marginTop: 6 }}>✓ Payée</button>
    </div>; })}
    {ov.length + pe.length === 0 && <div style={{ textAlign: "center", padding: 30, color: T.textMuted }}><div style={{ fontSize: 36, marginBottom: 8 }}>🎉</div><div style={{ fontWeight: 600 }}>Tout est à jour !</div></div>}
  </div>;
}

function Analytics({ factures, devis, clients, onExportFactures, onExportDevis }) {
  const payees = factures.filter(f => f.statut === "payee");
  const caByClient = {};
  payees.forEach(f => { const cl = clients.find(c => c.id === f.clientId); caByClient[cl?.nom || "?"] = (caByClient[cl?.nom || "?"] || 0) + ttc(f); });
  const caArr = Object.entries(caByClient).sort((a, b) => b[1] - a[1]);
  const maxCA = Math.max(...caArr.map(x => x[1]), 1);
  const delai = payees.filter(f => f.datePaiement).length > 0 ? Math.round(payees.filter(f => f.datePaiement).reduce((s, f) => s + dd(f.date, f.datePaiement), 0) / payees.filter(f => f.datePaiement).length) : 0;
  const conv = devis.length > 0 ? Math.round(devis.filter(d => ["accepte", "facture"].includes(d.statut)).length / devis.length * 100) : 0;
  return <div>
    <div style={{ fontSize: 12, fontWeight: 700, color: T.textMuted, textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 14 }}>Statistiques</div>
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 16 }}>
      <StatCard label="Délai" value={`${delai}j`} icon="⏱" delay={1} /><StatCard label="Conversion" value={`${conv}%`} icon="📈" delay={2} /><StatCard label="Payées" value={payees.length} icon="✓" delay={3} />
    </div>
    <div className="fade-up fade-up-4" style={{ background: T.bgCard, borderRadius: T.radius, padding: 16, boxShadow: T.shadow }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: T.textMuted, textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 12 }}>CA par client</div>
      {caArr.map(([nom, ca]) => <div key={nom} style={{ marginBottom: 10 }}>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 4 }}><span style={{ fontWeight: 600 }}>{nom}</span><span style={{ fontWeight: 700, color: T.primary }}>{fmt(ca)}</span></div>
        <div style={{ background: T.borderLight, borderRadius: 4, height: 6, overflow: "hidden" }}><div style={{ background: `linear-gradient(90deg, ${T.primary}, ${T.primaryLighter})`, height: "100%", borderRadius: 4, width: `${(ca / maxCA) * 100}%` }} /></div>
      </div>)}
      {caArr.length === 0 && <div style={{ fontSize: 13, color: T.textMuted, textAlign: "center", padding: 16 }}>Aucune donnée</div>}
    </div>

    <div className="fade-up fade-up-5" style={{ marginTop: 16 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: T.textMuted, textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 10 }}>Export comptable</div>
      <div style={{ display: "flex", gap: 8 }}>
        <button className="btn-press card-hover" onClick={onExportFactures} style={{ flex: 1, background: T.bgCard, borderRadius: T.radiusSm, padding: 14, border: `1px solid ${T.border}`, cursor: "pointer", fontFamily: T.font, textAlign: "center", boxShadow: T.shadow }}>
          <div style={{ fontSize: 24, marginBottom: 4 }}>🧾</div>
          <div style={{ fontSize: 12, fontWeight: 700 }}>Factures CSV</div>
          <div style={{ fontSize: 10, color: T.textMuted, marginTop: 2 }}>{factures.length} factures</div>
        </button>
        <button className="btn-press card-hover" onClick={onExportDevis} style={{ flex: 1, background: T.bgCard, borderRadius: T.radiusSm, padding: 14, border: `1px solid ${T.border}`, cursor: "pointer", fontFamily: T.font, textAlign: "center", boxShadow: T.shadow }}>
          <div style={{ fontSize: 24, marginBottom: 4 }}>📄</div>
          <div style={{ fontSize: 12, fontWeight: 700 }}>Devis CSV</div>
          <div style={{ fontSize: 10, color: T.textMuted, marginTop: 2 }}>{devis.length} devis</div>
        </button>
      </div>
      <div style={{ fontSize: 11, color: T.textLight, marginTop: 8, textAlign: "center" }}>Compatible Excel · Séparateur point-virgule · Encodage UTF-8</div>
    </div>
  </div>;
}

/* ══════════════ PDF DOWNLOAD + FACTUR-X ══════════════ */

function generateFacturXml(doc, client, ent) {
  const e = ent || {};
  const { brut, remise, net: ht, tv, tva, ttc: tot } = totals(doc);
  const dateXml = (doc.date || tod()).replace(/-/g, "");
  const echeanceXml = (doc.echeance || in30()).replace(/-/g, "");

  const lignesXml = doc.lignes.map((l, i) => `
    <ram:IncludedSupplyChainTradeLineItem>
      <ram:AssociatedDocumentLineDocument><ram:LineID>${i + 1}</ram:LineID></ram:AssociatedDocumentLineDocument>
      <ram:SpecifiedTradeProduct><ram:Name>${l.desc.replace(/&/g,"&amp;").replace(/</g,"&lt;")}</ram:Name></ram:SpecifiedTradeProduct>
      <ram:SpecifiedLineTradeAgreement>
        <ram:NetPriceProductTradePrice><ram:ChargeAmount>${l.pu.toFixed(2)}</ram:ChargeAmount></ram:NetPriceProductTradePrice>
      </ram:SpecifiedLineTradeAgreement>
      <ram:SpecifiedLineTradeDelivery><ram:BilledQuantity unitCode="${l.unite === 'heure' ? 'HUR' : l.unite === 'm²' ? 'MTK' : l.unite === 'ml' ? 'MTR' : 'C62'}">${l.qte}</ram:BilledQuantity></ram:SpecifiedLineTradeDelivery>
      <ram:SpecifiedLineTradeSettlement>
        <ram:ApplicableTradeTax><ram:TypeCode>VAT</ram:TypeCode><ram:CategoryCode>S</ram:CategoryCode><ram:RateApplicablePercent>${tv}</ram:RateApplicablePercent></ram:ApplicableTradeTax>
        <ram:SpecifiedTradeSettlementLineMonetarySummation><ram:LineTotalAmount>${(l.qte * l.pu).toFixed(2)}</ram:LineTotalAmount></ram:SpecifiedTradeSettlementLineMonetarySummation>
      </ram:SpecifiedLineTradeSettlement>
    </ram:IncludedSupplyChainTradeLineItem>`).join("");

  return `<?xml version="1.0" encoding="UTF-8"?>
<rsm:CrossIndustryInvoice xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100"
  xmlns:ram="urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100"
  xmlns:udt="urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100"
  xmlns:qdt="urn:un:unece:uncefact:data:standard:QualifiedDataType:100">

  <rsm:ExchangedDocumentContext>
    <ram:GuidelineSpecifiedDocumentContextParameter>
      <ram:ID>urn:factur-x.eu:1p0:basicwl</ram:ID>
    </ram:GuidelineSpecifiedDocumentContextParameter>
  </rsm:ExchangedDocumentContext>

  <rsm:ExchangedDocument>
    <ram:ID>${doc.id}</ram:ID>
    <ram:TypeCode>380</ram:TypeCode>
    <ram:IssueDateTime><udt:DateTimeString format="102">${dateXml}</udt:DateTimeString></ram:IssueDateTime>
  </rsm:ExchangedDocument>

  <rsm:SupplyChainTradeTransaction>
    <ram:ApplicableHeaderTradeAgreement>
      <ram:SellerTradeParty>
        <ram:Name>${(e.nom || '').replace(/&/g,"&amp;")}</ram:Name>
        <ram:SpecifiedLegalOrganization><ram:ID schemeID="0002">${e.siret || ''}</ram:ID></ram:SpecifiedLegalOrganization>
        <ram:PostalTradeAddress><ram:LineOne>${(e.adresse || '').replace(/&/g,"&amp;")}</ram:LineOne><ram:CountryID>FR</ram:CountryID></ram:PostalTradeAddress>
        <ram:SpecifiedTaxRegistration><ram:ID schemeID="VA">${e.tva_intra || ''}</ram:ID></ram:SpecifiedTaxRegistration>
      </ram:SellerTradeParty>
      <ram:BuyerTradeParty>
        <ram:Name>${(client?.nom || '').replace(/&/g,"&amp;")}</ram:Name>
        ${client?.siret ? `<ram:SpecifiedLegalOrganization><ram:ID schemeID="0002">${client.siret}</ram:ID></ram:SpecifiedLegalOrganization>` : ''}
        <ram:PostalTradeAddress><ram:LineOne>${(client?.adresse || '').replace(/&/g,"&amp;")}</ram:LineOne><ram:CountryID>FR</ram:CountryID></ram:PostalTradeAddress>
      </ram:BuyerTradeParty>
    </ram:ApplicableHeaderTradeAgreement>

    <ram:ApplicableHeaderTradeDelivery>
      <ram:ActualDeliverySupplyChainEvent><ram:OccurrenceDateTime><udt:DateTimeString format="102">${dateXml}</udt:DateTimeString></ram:OccurrenceDateTime></ram:ActualDeliverySupplyChainEvent>
      <ram:ShipToTradeParty><ram:PostalTradeAddress><ram:LineOne>${(client?.adresse || '').replace(/&/g,"&amp;")}</ram:LineOne><ram:CountryID>FR</ram:CountryID></ram:PostalTradeAddress></ram:ShipToTradeParty>
    </ram:ApplicableHeaderTradeDelivery>

    <ram:ApplicableHeaderTradeSettlement>
      <ram:InvoiceCurrencyCode>EUR</ram:InvoiceCurrencyCode>
      <ram:SpecifiedTradePaymentTerms>
        <ram:DueDateDateTime><udt:DateTimeString format="102">${echeanceXml}</udt:DateTimeString></ram:DueDateDateTime>
      </ram:SpecifiedTradePaymentTerms>
      ${remise > 0 ? `<ram:SpecifiedTradeAllowanceCharge>
        <ram:ChargeIndicator><udt:Indicator>false</udt:Indicator></ram:ChargeIndicator>
        <ram:ActualAmount>${remise.toFixed(2)}</ram:ActualAmount>
        <ram:Reason>Remise</ram:Reason>
        <ram:CategoryTradeTax><ram:TypeCode>VAT</ram:TypeCode><ram:CategoryCode>S</ram:CategoryCode><ram:RateApplicablePercent>${tv}</ram:RateApplicablePercent></ram:CategoryTradeTax>
      </ram:SpecifiedTradeAllowanceCharge>` : ''}
      <ram:ApplicableTradeTax>
        <ram:CalculatedAmount>${tva.toFixed(2)}</ram:CalculatedAmount>
        <ram:TypeCode>VAT</ram:TypeCode>
        <ram:BasisAmount>${ht.toFixed(2)}</ram:BasisAmount>
        <ram:CategoryCode>S</ram:CategoryCode>
        <ram:RateApplicablePercent>${tv}</ram:RateApplicablePercent>
      </ram:ApplicableTradeTax>
      <ram:SpecifiedTradeSettlementHeaderMonetarySummation>
        <ram:LineTotalAmount>${brut.toFixed(2)}</ram:LineTotalAmount>
        <ram:AllowanceTotalAmount>${remise.toFixed(2)}</ram:AllowanceTotalAmount>
        <ram:TaxBasisTotalAmount>${ht.toFixed(2)}</ram:TaxBasisTotalAmount>
        <ram:TaxTotalAmount currencyID="EUR">${tva.toFixed(2)}</ram:TaxTotalAmount>
        <ram:GrandTotalAmount>${tot.toFixed(2)}</ram:GrandTotalAmount>
        <ram:DuePayableAmount>${tot.toFixed(2)}</ram:DuePayableAmount>
      </ram:SpecifiedTradeSettlementHeaderMonetarySummation>
    </ram:ApplicableHeaderTradeSettlement>
${lignesXml}
  </rsm:SupplyChainTradeTransaction>
</rsm:CrossIndustryInvoice>`;
}

function downloadFacturX(doc, client, entreprise) {
  const xml = generateFacturXml(doc, client, entreprise);
  const blob = new Blob([xml], { type: "application/xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `Facture_${doc.id}_facturx.xml`;
  a.click();
  URL.revokeObjectURL(url);
}

function generatePDFHtml(type, doc, client, signature, ent) {
  const { brut, remise, net: ht, tv, tva, ttc: tot } = totals(doc);
  const isF = type === "facture", ti = doc.type === "avoir" ? "AVOIR" : (isF ? "FACTURE" : "DEVIS");
  const e = ent || {};
  const lignesHtml = doc.lignes.map(l => `<tr style="border-bottom:1px solid #eee"><td style="padding:10px 8px;font-size:13px">${l.desc}</td><td style="padding:10px 8px;text-align:center;font-size:13px">${l.qte} ${l.unite}</td><td style="padding:10px 8px;text-align:right;font-size:13px">${fmt(l.pu)}</td><td style="padding:10px 8px;text-align:right;font-weight:600;font-size:13px">${fmt(l.qte * l.pu)}</td></tr>`).join("");
  const sigHtml = signature ? `<div style="margin-top:30px;display:flex;justify-content:flex-end"><div style="text-align:center"><p style="font-size:11px;color:#666;margin-bottom:6px">Bon pour accord — Signature du client</p><img src="${signature}" style="height:70px;border-bottom:1px solid #ccc"/></div></div>` : "";

  // Mentions obligatoires 2026
  const mentionsObligatoires = isF ? `
    <div style="margin-top:24px;padding:14px;background:#f0f7f2;border-radius:8px;font-size:10px;color:#555;line-height:1.8">
      <strong style="font-size:11px;color:#1B4332">Mentions obligatoires</strong><br/>
      <strong>Type d'opération :</strong> ${typeOpLabel(doc.typeOp)}<br/>
      <strong>Adresse de livraison :</strong> ${client?.adresse || 'Identique à l\'adresse de facturation'}<br/>
      <strong>N° SIREN vendeur :</strong> ${(e.siret || '').slice(0, 9)}<br/>
      ${client?.siret ? `<strong>SIRET client :</strong> ${client.siret}<br/>` : ''}
      <strong>N° TVA intracommunautaire :</strong> ${e.tva_intra || 'Non applicable'}
    </div>
    <div style="margin-top:12px;padding:14px;background:#f8f8f5;border-radius:8px;font-size:10px;color:#888;line-height:1.7">
      <strong>Conditions de paiement :</strong> Paiement à 30 jours. Échéance : ${dfr(doc.echeance)}<br/>
      ${e.iban ? `<strong>IBAN :</strong> ${e.iban}<br/>` : ''}
      En cas de retard, pénalité de 3× le taux d'intérêt légal + indemnité forfaitaire de 40€ pour frais de recouvrement (art. L.441-10 C. com.).<br/>
      TVA ${tv}% — ${tv === 0 ? 'TVA non applicable, art. 293 B du CGI' : `Taux de TVA appliqué : ${tv}%`}
    </div>
    <div style="margin-top:8px;padding:8px 14px;background:#f0f0ec;border-radius:8px;font-size:9px;color:#888;display:flex;align-items:center;gap:6px">
      Numérotation séquentielle sans rupture · Mentions légales obligatoires
    </div>`
  : `<div style="margin-top:24px;padding:14px;background:#f8f8f5;border-radius:8px;font-size:10px;color:#888;line-height:1.7">
      <strong>Validité :</strong> ${dfr(doc.validite)}. Devis gratuit. Les travaux ne débuteront qu'après acceptation du présent devis.
    </div>`;

  const notesHtml = doc.notes ? `<div style="margin-top:16px;padding:14px;background:#fafaf7;border-radius:8px;border-left:3px solid #1B4332;font-size:11px;color:#555;line-height:1.7"><strong style="color:#1B4332">Notes :</strong> ${doc.notes}</div>` : '';

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${ti} ${doc.id}</title><link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700;800&display=swap" rel="stylesheet"><style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:'Outfit',sans-serif;color:#1a1a18;padding:40px;max-width:800px;margin:0 auto}@media print{body{padding:20px}.no-print{display:none!important}}</style></head><body>
<div style="display:flex;justify-content:space-between;margin-bottom:30px"><div>${e.logo_url ? `<img src="${e.logo_url}" style="max-height:56px;max-width:180px;margin-bottom:6px;display:block"/>` : '<div style="font-size:28px;font-weight:800;color:#1B4332">⚡ FactuPro</div>'}<div style="font-size:14px;font-weight:700;margin-top:4px">${e.nom||''}</div><div style="font-size:11px;color:#666;margin-top:2px">${e.adresse||''}</div><div style="font-size:11px;color:#666">Tél : ${e.tel||''} — ${e.email||''}</div><div style="font-size:10px;color:#999;margin-top:4px">SIRET : ${e.siret||''} — APE : ${e.ape||''} — TVA Intra : ${e.tva_intra||''}</div></div><div style="text-align:right"><div style="font-size:24px;font-weight:800;color:#1B4332;letter-spacing:2px">${ti}</div><div style="font-size:16px;font-weight:700;margin-top:4px">${doc.id}</div><div style="font-size:12px;color:#666;margin-top:4px">Date : ${dfr(doc.date)}</div>${isF ? `<div style="font-size:11px;color:#666">Échéance : ${dfr(doc.echeance)}</div>` : ''}</div></div>
<div style="background:#f0f7f2;border-radius:10px;padding:16px;margin-bottom:24px"><div style="font-size:10px;text-transform:uppercase;letter-spacing:1px;color:#666;font-weight:700;margin-bottom:6px">Client</div><div style="font-size:15px;font-weight:700">${client?.nom||''}</div><div style="font-size:12px;color:#555;margin-top:2px">${client?.adresse||''}</div><div style="font-size:12px;color:#555">${client?.tel||''} — ${client?.email||''}</div></div>
<table style="width:100%;border-collapse:collapse;margin-bottom:16px"><thead><tr style="background:#1B4332;color:#fff"><th style="padding:10px;text-align:left;font-size:11px;text-transform:uppercase;border-radius:8px 0 0 0">Description</th><th style="padding:10px;text-align:center;font-size:11px;text-transform:uppercase">Quantité</th><th style="padding:10px;text-align:right;font-size:11px;text-transform:uppercase">Prix unit.</th><th style="padding:10px;text-align:right;font-size:11px;text-transform:uppercase;border-radius:0 8px 0 0">Total HT</th></tr></thead><tbody>${lignesHtml}</tbody></table>
<div style="display:flex;justify-content:flex-end"><div style="width:260px"><div style="display:flex;justify-content:space-between;padding:6px 0;font-size:13px"><span>Total HT</span><span style="font-weight:600">${fmt(brut)}</span></div>${remise > 0 ? `<div style="display:flex;justify-content:space-between;padding:6px 0;font-size:13px;color:#b91c1c"><span>Remise</span><span>−${fmt(remise)}</span></div><div style="display:flex;justify-content:space-between;padding:6px 0;font-size:13px"><span>Total HT net</span><span style="font-weight:600">${fmt(ht)}</span></div>` : ''}<div style="display:flex;justify-content:space-between;padding:6px 0;font-size:13px;color:#666"><span>TVA (${tv}%)</span><span>${fmt(tva)}</span></div><div style="display:flex;justify-content:space-between;padding:10px 0;font-size:20px;font-weight:800;color:#1B4332;border-top:2px solid #1B4332;margin-top:4px"><span>Total TTC</span><span>${fmt(tot)}</span></div></div></div>
${notesHtml}${sigHtml}${mentionsObligatoires}
<div class="no-print" style="text-align:center;margin-top:40px"><button onclick="window.print()" style="background:#1B4332;color:#fff;border:none;padding:14px 32px;border-radius:10px;font-size:15px;font-weight:700;cursor:pointer;font-family:'Outfit',sans-serif">📄 Imprimer / Enregistrer en PDF</button></div>
</body></html>`;
}


function openPrintablePDF(type, doc, client, signature, entreprise) {
  const html = generatePDFHtml(type, doc, client, signature, entreprise);
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  window.open(url, "_blank");
}

/* ══════════════ PROFIL ENTREPRISE ══════════════ */
function ProfilPage({ entreprise, onSave, onSignOut, plan, isPro, subscription, onUpgrade, onManage, devisMois = 0, facturesMois = 0, freeLimit = 5, audit = [], clotures = [], onCloture, onExport, onSaveLogo }) {
  const logoRef = useRef(null);
  const handleLogoFile = async (e) => {
    const file = e.target.files?.[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => { const resized = await resizeLogo(reader.result); if (resized) onSaveLogo?.(resized); };
    reader.readAsDataURL(file);
    e.target.value = "";
  };
  const anneeCourante = new Date().getFullYear();
  const anneePrec = anneeCourante - 1;
  const dejaCloture = (a) => clotures.some(c => c.annee === a);
  const [f, setF] = useState({
    nom: entreprise?.nom || "", siret: entreprise?.siret || "", adresse: entreprise?.adresse || "",
    tel: entreprise?.tel || "", email: entreprise?.email || "", ape: entreprise?.ape || "", tva_intra: entreprise?.tva_intra || "", iban: entreprise?.iban || "",
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const iS = { width: "100%", padding: "10px 12px", borderRadius: T.radiusXs, border: `1px solid ${T.border}`, fontSize: 14, fontFamily: T.font, color: T.text, outline: "none", boxSizing: "border-box", background: T.bgElevated };
  const lS = { fontSize: 11, fontWeight: 600, color: T.textMuted, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4, display: "block" };

  return <div>
    <div style={{ fontSize: 12, fontWeight: 700, color: T.textMuted, textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 14 }}>Mon entreprise</div>
    <div className="fade-up" style={{ background: T.bgCard, borderRadius: T.radius, padding: 18, boxShadow: T.shadow, marginBottom: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 14 }}>
        {entreprise?.logo_url
          ? <div style={{ width: 56, height: 56, borderRadius: 14, background: "#fff", border: `1px solid ${T.border}`, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}><img src={entreprise.logo_url} alt="Logo" style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} /></div>
          : <div style={{ width: 56, height: 56, borderRadius: 14, background: `linear-gradient(135deg, ${T.primary}, ${T.primaryLighter})`, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 22 }}>{(f.nom || "?").split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase()}</div>}
        <div><div style={{ fontSize: 18, fontWeight: 700 }}>{f.nom || "Mon Entreprise"}</div><div style={{ fontSize: 12, color: T.textMuted }}>SIRET {f.siret || "Non renseigné"}</div></div>
      </div>
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <input ref={logoRef} type="file" accept="image/*" onChange={handleLogoFile} style={{ display: "none" }} />
        <button className="btn-press" onClick={() => logoRef.current?.click()} style={{ flex: 1, padding: "9px 12px", borderRadius: T.radiusXs, border: `1px solid ${T.border}`, background: T.bgElevated, fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: T.font }}>🖼 {entreprise?.logo_url ? "Changer le logo" : "Ajouter un logo"}</button>
        {entreprise?.logo_url && <button className="btn-press" onClick={() => onSaveLogo?.(null)} style={{ padding: "9px 12px", borderRadius: T.radiusXs, border: `1px solid ${T.dangerPale}`, background: T.dangerPale, color: "#991B1B", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: T.font }}>Retirer</button>}
      </div>
      {[["nom","Nom de l'entreprise"],["siret","SIRET"],["adresse","Adresse complète"],["tel","Téléphone"],["email","Email"],["ape","Code APE"],["tva_intra","N° TVA Intracommunautaire"],["iban","IBAN (affiché sur vos factures)"]].map(([k, l]) => (
        <div key={k} style={{ marginBottom: 12 }}><label style={lS}>{l}</label><input className="search-glow" style={iS} value={f[k]} onChange={e => { setF({ ...f, [k]: e.target.value }); setSaved(false); }} placeholder={l} /></div>
      ))}
      <button className="btn-press" disabled={saving} onClick={async () => { setSaving(true); try { await onSave(f); setSaved(true); } catch(e) { console.error(e); } setSaving(false); }}
        style={{ width: "100%", padding: 14, borderRadius: T.radiusSm, border: "none", background: saving ? T.primaryLighter : T.primary, color: "#fff", fontSize: 15, fontWeight: 700, cursor: saving ? "wait" : "pointer", fontFamily: T.font, boxShadow: "0 4px 14px rgba(27,67,50,0.3)" }}>
        {saving ? "Enregistrement..." : saved ? "✓ Enregistré" : "Enregistrer"}
      </button>
    </div>
    <div className="fade-up fade-up-2" style={{ background: T.bgCard, borderRadius: T.radius, padding: 16, boxShadow: T.shadow, marginBottom: 14 }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: T.textMuted, textTransform: "uppercase", marginBottom: 8 }}>Ces informations apparaissent sur</div>
      <div style={{ fontSize: 13, color: T.text, lineHeight: 1.8 }}>📄 Vos devis PDF<br/>🧾 Vos factures PDF</div>
    </div>

    {/* ── Abonnement ── */}
    <div style={{ fontSize: 12, fontWeight: 700, color: T.textMuted, textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 14, marginTop: 22 }}>Abonnement</div>
    <div className="fade-up" style={{ background: isPro ? `linear-gradient(135deg, ${T.primary}, ${T.primaryLighter})` : T.bgCard, color: isPro ? "#fff" : T.text, borderRadius: T.radius, padding: 18, boxShadow: T.shadow, marginBottom: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <div style={{ fontSize: 18, fontWeight: 800 }}>{isPro ? "⭐ FactuPro Pro" : "Formule Gratuite"}</div>
        <div style={{ fontSize: 12, fontWeight: 700, padding: "4px 10px", borderRadius: 20, background: isPro ? "rgba(255,255,255,0.2)" : T.primaryPale, color: isPro ? "#fff" : T.primary }}>{isPro ? "Actif" : "Free"}</div>
      </div>
      {isPro ? (
        <>
          <div style={{ fontSize: 13, opacity: 0.9, lineHeight: 1.7, marginBottom: 4 }}>Devis & factures illimités · support prioritaire</div>
          {subscription?.status === "past_due" && <div style={{ fontSize: 12, background: "rgba(255,255,255,0.18)", borderRadius: 8, padding: "8px 10px", marginBottom: 10 }}>⚠️ Paiement en attente — mettez à jour votre moyen de paiement.</div>}
          {subscription?.current_period_end && <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 12 }}>Prochain renouvellement : {dfr(subscription.current_period_end)}</div>}
          <button className="btn-press" onClick={onManage} style={{ width: "100%", padding: 13, borderRadius: T.radiusSm, border: "1.5px solid rgba(255,255,255,0.5)", background: "rgba(255,255,255,0.12)", color: "#fff", fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: T.font }}>Gérer mon abonnement</button>
        </>
      ) : (
        <>
          <div style={{ fontSize: 13, color: T.textMuted, lineHeight: 1.8, marginBottom: 14 }}>
            La formule Gratuite est limitée à <strong>{freeLimit} devis et {freeLimit} factures par mois</strong>.<br/><br/>
            Passez à <strong style={{ color: T.primary }}>Pro pour 9 €/mois</strong> :<br/>
            ✓ Devis & factures illimités<br/>
            ✓ Support prioritaire
          </div>
          <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
            {[["Devis", devisMois], ["Factures", facturesMois]].map(([l, n]) => (
              <div key={l} style={{ flex: 1, background: T.bgElevated, borderRadius: T.radiusXs, padding: "8px 10px", textAlign: "center" }}>
                <div style={{ fontSize: 11, color: T.textMuted }}>{l} ce mois</div>
                <div style={{ fontSize: 15, fontWeight: 800, color: n >= freeLimit ? T.danger : T.primary }}>{n}/{freeLimit}</div>
              </div>
            ))}
          </div>
          <button className="btn-press" onClick={onUpgrade} style={{ width: "100%", padding: 14, borderRadius: T.radiusSm, border: "none", background: T.primary, color: "#fff", fontSize: 15, fontWeight: 700, cursor: "pointer", fontFamily: T.font, boxShadow: "0 4px 14px rgba(27,67,50,0.3)" }}>⭐ Passer à Pro</button>
        </>
      )}
    </div>

    {/* ── Journal d'activité (piste d'audit) ── */}
    <div style={{ fontSize: 12, fontWeight: 700, color: T.textMuted, textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 14, marginTop: 22 }}>Journal d'activité</div>
    <div className="fade-up" style={{ background: T.bgCard, borderRadius: T.radius, padding: 16, boxShadow: T.shadow, marginBottom: 14 }}>
      <div style={{ fontSize: 11, color: T.textMuted, marginBottom: 10 }}>Historique inaltérable des opérations sur vos devis et factures (piste d'audit légale).</div>
      {audit.length === 0
        ? <div style={{ fontSize: 13, color: T.textLight, textAlign: "center", padding: "12px 0" }}>Aucune opération enregistrée</div>
        : audit.slice(0, 20).map(a => (
          <div key={a.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, padding: "7px 0", borderBottom: `1px solid ${T.borderLight}` }}>
            <span style={{ fontSize: 12, color: T.text }}>{auditLabel(a)}</span>
            <span style={{ fontSize: 10, color: T.textLight, whiteSpace: "nowrap" }}>{new Date(a.created_at).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</span>
          </div>
        ))}
    </div>

    {/* ── Archivage & données (conformité) ── */}
    <div style={{ fontSize: 12, fontWeight: 700, color: T.textMuted, textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 14, marginTop: 22 }}>Archivage & données</div>
    <div className="fade-up" style={{ background: T.bgCard, borderRadius: T.radius, padding: 16, boxShadow: T.shadow, marginBottom: 14 }}>
      <div style={{ fontSize: 11, color: T.textMuted, marginBottom: 12 }}>Clôtures annuelles : fige les totaux d'une année et les chaîne par signature (intégrité légale). Une clôture est définitive.</div>
      <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
        {[anneePrec, anneeCourante].map(a => (
          <button key={a} className="btn-press" disabled={dejaCloture(a)} onClick={() => onCloture?.(a)}
            style={{ flex: 1, minWidth: 120, padding: 11, borderRadius: T.radiusSm, border: `1px solid ${T.border}`, background: dejaCloture(a) ? T.bgElevated : T.bgCard, color: dejaCloture(a) ? T.textLight : T.text, fontSize: 13, fontWeight: 600, cursor: dejaCloture(a) ? "default" : "pointer", fontFamily: T.font }}>
            {dejaCloture(a) ? `✓ ${a} clôturée` : `🔒 Clôturer ${a}`}
          </button>
        ))}
      </div>
      {clotures.length > 0 && clotures.map(c => (
        <div key={c.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "7px 0", borderBottom: `1px solid ${T.borderLight}` }}>
          <span style={{ fontSize: 12, fontWeight: 600 }}>Clôture {c.annee}</span>
          <span style={{ fontSize: 11, color: T.textMuted }}>{fmt(parseFloat(c.total_ttc))} TTC · {c.nb_factures} fact.</span>
        </div>
      ))}
      <button className="btn-press" onClick={onExport} style={{ width: "100%", marginTop: 14, padding: 12, borderRadius: T.radiusSm, border: `1px solid ${T.border}`, background: T.bgElevated, fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: T.font }}>📦 Exporter toutes mes données (JSON)</button>
      <div style={{ fontSize: 10, color: T.textLight, marginTop: 8, lineHeight: 1.5 }}>Vos données sont conservées et exportables (portabilité RGPD). Les factures sont conservées 10 ans (obligation légale).</div>
    </div>

    <button className="btn-press" onClick={onSignOut} style={{ width: "100%", padding: 14, borderRadius: T.radiusSm, border: "1.5px solid #FECACA", background: T.dangerPale, color: "#991B1B", fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: T.font }}>Déconnexion</button>
  </div>;
}

function CataloguePage({ catalogue, onAdd, onUpdate, onDelete }) {
  const [edit, setEdit] = useState(null); // null | 'new' | item
  const [f, setF] = useState({ categorie: "", description: "", unite: "forfait", prix_unitaire: 0, actif: true });
  const [saving, setSaving] = useState(false);
  const iS = { width: "100%", padding: "8px 10px", borderRadius: T.radiusXs, border: `1px solid ${T.border}`, fontSize: 13, fontFamily: T.font, color: T.text, outline: "none", boxSizing: "border-box", background: T.bgElevated };
  const cats = [...new Set(catalogue.map(x => x.categorie))];

  function openNew() { setF({ categorie: "", description: "", unite: "forfait", prix_unitaire: 0, actif: true }); setEdit("new"); }
  function openEdit(item) { setF({ categorie: item.categorie, description: item.description, unite: item.unite, prix_unitaire: item.prix_unitaire, actif: item.actif }); setEdit(item); }

  if (edit) return <div>
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
      <button className="btn-press" onClick={() => setEdit(null)} style={{ width: 36, height: 36, borderRadius: 10, border: `1px solid ${T.border}`, background: T.bgCard, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>‹</button>
      <h2 style={{ fontSize: 18, fontWeight: 700 }}>{edit === "new" ? "Nouvel article" : "Modifier"}</h2>
    </div>
    {[["categorie","Catégorie"],["description","Description"]].map(([k,l]) => <div key={k} style={{ marginBottom: 12 }}><label style={{ fontSize: 11, fontWeight: 600, color: T.textMuted, textTransform: "uppercase", marginBottom: 4, display: "block" }}>{l}</label><input className="search-glow" style={iS} value={f[k]} onChange={e => setF({ ...f, [k]: e.target.value })} /></div>)}
    <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
      <div style={{ flex: 1 }}><label style={{ fontSize: 11, fontWeight: 600, color: T.textMuted, textTransform: "uppercase", marginBottom: 4, display: "block" }}>Unité</label><select className="search-glow" style={iS} value={f.unite} onChange={e => setF({ ...f, unite: e.target.value })}>{["forfait","m²","ml","unité","heure","jour"].map(u => <option key={u}>{u}</option>)}</select></div>
      <div style={{ flex: 1 }}><label style={{ fontSize: 11, fontWeight: 600, color: T.textMuted, textTransform: "uppercase", marginBottom: 4, display: "block" }}>Prix (€ HT)</label><input className="search-glow" style={iS} type="number" value={f.prix_unitaire} onChange={e => setF({ ...f, prix_unitaire: parseFloat(e.target.value) || 0 })} /></div>
    </div>
    <div style={{ display: "flex", gap: 8, marginBottom: 16, alignItems: "center" }}>
      <input type="checkbox" id="actif" checked={f.actif} onChange={e => setF({ ...f, actif: e.target.checked })} />
      <label htmlFor="actif" style={{ fontSize: 13, color: T.textMuted }}>Article actif (visible dans le catalogue)</label>
    </div>
    <button className="btn-press" disabled={saving} onClick={async () => {
      if (!f.description.trim() || !f.categorie.trim()) return;
      setSaving(true);
      if (edit === "new") await onAdd({ categorie: f.categorie, description: f.description, unite: f.unite, prix_unitaire: f.prix_unitaire, actif: f.actif });
      else await onUpdate(edit.id, { categorie: f.categorie, description: f.description, unite: f.unite, prix_unitaire: f.prix_unitaire, actif: f.actif });
      setSaving(false); setEdit(null);
    }} style={{ width: "100%", padding: 14, borderRadius: T.radiusSm, border: "none", background: T.primary, color: "#fff", fontSize: 15, fontWeight: 700, cursor: "pointer", fontFamily: T.font }}>
      {saving ? "Enregistrement..." : "Enregistrer"}
    </button>
  </div>;

  return <div>
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: T.textMuted, textTransform: "uppercase", letterSpacing: 0.8 }}>Catalogue ({catalogue.length})</div>
      <button className="btn-press" onClick={openNew} style={{ padding: "8px 14px", borderRadius: T.radiusSm, border: "none", background: T.primary, color: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: T.font }}>+ Ajouter</button>
    </div>
    {cats.map(cat => <div key={cat} style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: T.primary, textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 6, paddingLeft: 2 }}>{cat}</div>
      {catalogue.filter(x => x.categorie === cat).map(item => <div key={item.id} className="card-hover" style={{ background: T.bgCard, borderRadius: T.radiusSm, padding: "12px 14px", marginBottom: 6, boxShadow: T.shadow, display: "flex", alignItems: "center", gap: 10, opacity: item.actif ? 1 : 0.5 }}>
        <div style={{ flex: 1 }}><div style={{ fontSize: 13, fontWeight: 600 }}>{item.description}</div><div style={{ fontSize: 11, color: T.textMuted }}>{item.unite} · {!item.actif && <span style={{ color: T.danger }}>Inactif · </span>}</div></div>
        <div style={{ fontWeight: 700, fontSize: 13, color: T.primary }}>{fmt(parseFloat(item.prix_unitaire))}</div>
        <button className="btn-press" onClick={() => openEdit(item)} style={{ padding: "5px 10px", borderRadius: T.radiusXs, border: `1px solid ${T.border}`, background: T.bgCard, fontSize: 11, fontWeight: 600, cursor: "pointer", fontFamily: T.font }}>✏</button>
        <button className="btn-press" onClick={() => onDelete(item.id)} style={{ padding: "5px 10px", borderRadius: T.radiusXs, border: "none", background: T.dangerPale, fontSize: 11, fontWeight: 600, cursor: "pointer", fontFamily: T.font, color: "#991B1B" }}>🗑</button>
      </div>)}
    </div>)}
    {catalogue.length === 0 && <div style={{ textAlign: "center", padding: 30, color: T.textMuted }}><div style={{ fontSize: 36, marginBottom: 8 }}>📋</div><div style={{ fontWeight: 600 }}>Catalogue vide</div><div style={{ fontSize: 13, marginTop: 4 }}>Ajoutez vos prestations habituelles</div></div>}
  </div>;
}

function FactureDirecteForm({ clients, catalogue, onSave, onNo, init }) {
  const [cId, setCId] = useState(init?.clientId || clients[0]?.id || "");
  const [ls, setLs] = useState(init?.lignes?.map(l => ({ ...l })) || [{ desc: "", qte: 1, unite: "forfait", pu: 0 }]);
  const [tv, setTv] = useState(init?.tva || 20);
  const [typeOp, setTypeOp] = useState(init?.typeOp || "services");
  const [remiseType, setRemiseType] = useState(init?.remiseType || "montant");
  const [remiseValeur, setRemiseValeur] = useState(init?.remiseValeur || 0);
  const [notes, setNotes] = useState(init?.notes || "");
  const [echeance, setEcheance] = useState(in30());
  const [showC, setShowC] = useState(false);
  const [saving, setSaving] = useState(false);
  const uL = (i, k, v) => { const n = [...ls]; n[i] = { ...n[i], [k]: k === "qte" || k === "pu" ? parseFloat(v) || 0 : v }; setLs(n); };
  const inputStyle = { width: "100%", padding: "8px 10px", borderRadius: T.radiusXs, border: `1px solid ${T.border}`, fontSize: 14, fontFamily: T.font, fontWeight: 600, color: T.text, outline: "none", boxSizing: "border-box", background: T.bgElevated };

  return <div>
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
      <button className="btn-press" onClick={onNo} style={{ width: 36, height: 36, borderRadius: 10, border: `1px solid ${T.border}`, background: T.bgCard, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>‹</button>
      <h2 style={{ fontSize: 18, fontWeight: 700 }}>{init ? "Dupliquer la facture" : "Nouvelle facture"}</h2>
    </div>
    <div style={{ marginBottom: 12 }}><label style={{ fontSize: 11, fontWeight: 600, color: T.textMuted, textTransform: "uppercase", marginBottom: 4, display: "block" }}>Client</label><select className="search-glow" style={{ ...inputStyle, fontWeight: 400 }} value={cId} onChange={e => setCId(e.target.value)}>{clients.map(c => <option key={c.id} value={c.id}>{c.nom}</option>)}</select></div>
    <div style={{ marginBottom: 12 }}><label style={{ fontSize: 11, fontWeight: 600, color: T.textMuted, textTransform: "uppercase", marginBottom: 4, display: "block" }}>Date d'échéance</label><input className="search-glow" style={{ ...inputStyle, fontWeight: 400 }} type="date" value={echeance} onChange={e => setEcheance(e.target.value)} /></div>
    <div style={{ marginBottom: 12 }}><label style={{ fontSize: 11, fontWeight: 600, color: T.textMuted, textTransform: "uppercase", marginBottom: 6, display: "block" }}>TVA</label><Chips opts={[0, 5.5, 10, 20].map(t => ({ v: t, l: t + "%" }))} val={tv} set={setTv} /></div>
    <div style={{ marginBottom: 12 }}><label style={{ fontSize: 11, fontWeight: 600, color: T.textMuted, textTransform: "uppercase", marginBottom: 6, display: "block" }}>Type d'opération</label><Chips opts={[{ v: "services", l: "Services" }, { v: "biens", l: "Biens" }, { v: "mixte", l: "Mixte" }]} val={typeOp} set={setTypeOp} /></div>
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
      <label style={{ fontSize: 11, fontWeight: 600, color: T.textMuted, textTransform: "uppercase" }}>Prestations</label>
      <button className="btn-press" onClick={() => setShowC(true)} style={{ padding: "5px 10px", borderRadius: T.radiusXs, border: `1px solid ${T.border}`, background: T.bgCard, fontSize: 11, fontWeight: 600, cursor: "pointer", fontFamily: T.font }}>📋 Catalogue</button>
    </div>
    {ls.map((l, i) => <div key={i} style={{ background: T.bgCard, borderRadius: T.radiusSm, padding: 12, marginBottom: 8, boxShadow: T.shadow }}>
      <input className="search-glow" style={{ ...inputStyle, marginBottom: 6 }} placeholder="Description" value={l.desc} onChange={e => uL(i, "desc", e.target.value)} />
      <div style={{ display: "flex", gap: 6 }}>
        <div style={{ width: 55 }}><label style={{ fontSize: 9, fontWeight: 600, color: T.textLight }}>Qté</label><input className="search-glow" style={{ ...inputStyle, fontWeight: 400, padding: "6px 8px", fontSize: 13 }} type="number" value={l.qte} onChange={e => uL(i, "qte", e.target.value)} /></div>
        <div style={{ flex: 1 }}><label style={{ fontSize: 9, fontWeight: 600, color: T.textLight }}>Unité</label><select className="search-glow" style={{ ...inputStyle, fontWeight: 400, padding: "6px 8px", fontSize: 13 }} value={l.unite} onChange={e => uL(i, "unite", e.target.value)}>{["forfait","m²","ml","unité","heure","jour"].map(u => <option key={u}>{u}</option>)}</select></div>
        <div style={{ width: 75 }}><label style={{ fontSize: 9, fontWeight: 600, color: T.textLight }}>P.U.</label><input className="search-glow" style={{ ...inputStyle, fontWeight: 400, padding: "6px 8px", fontSize: 13 }} type="number" value={l.pu} onChange={e => uL(i, "pu", e.target.value)} /></div>
        <button onClick={() => ls.length > 1 && setLs(ls.filter((_, j) => j !== i))} style={{ alignSelf: "flex-end", background: "none", border: "none", color: T.danger, cursor: "pointer", padding: 6, fontSize: 14 }}>×</button>
      </div>
    </div>)}
    <button className="btn-press" onClick={() => setLs([...ls, { desc: "", qte: 1, unite: "forfait", pu: 0 }])} style={{ width: "100%", padding: 12, borderRadius: T.radiusSm, border: `1.5px dashed ${T.border}`, background: "transparent", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: T.font, color: T.textMuted, marginBottom: 14 }}>+ Ajouter une ligne</button>
    <div style={{ marginBottom: 12 }}>
      <label style={{ fontSize: 11, fontWeight: 600, color: T.textMuted, textTransform: "uppercase", marginBottom: 6, display: "block" }}>Remise (optionnel)</label>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <Chips opts={[{ v: "montant", l: "€" }, { v: "pourcent", l: "%" }]} val={remiseType} set={setRemiseType} />
        <input className="search-glow" style={{ ...inputStyle, fontWeight: 400, width: 110 }} type="number" min="0" value={remiseValeur} onChange={e => setRemiseValeur(parseFloat(e.target.value) || 0)} />
      </div>
    </div>
    <div style={{ background: T.bgCard, borderRadius: T.radius, padding: 14, marginBottom: 14, boxShadow: T.shadow }}>
      {(() => { const t = totals({ lignes: ls, tva: tv, remiseType, remiseValeur }); return <>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: T.textMuted, marginBottom: 2 }}><span>Total HT</span><span>{fmt(t.brut)}</span></div>
        {t.remise > 0 && <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: T.danger, marginBottom: 2 }}><span>Remise</span><span>−{fmt(t.remise)}</span></div>}
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: T.textMuted, marginBottom: 4 }}><span>TVA {t.tv}%</span><span>{fmt(t.tva)}</span></div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 18, fontWeight: 800, color: T.primary }}><span>TTC</span><span>{fmt(t.ttc)}</span></div>
      </>; })()}
    </div>
    <div style={{ marginBottom: 14 }}><label style={{ fontSize: 11, fontWeight: 600, color: T.textMuted, textTransform: "uppercase", marginBottom: 4, display: "block" }}>Notes (optionnel)</label><textarea className="search-glow" style={{ width: "100%", padding: "10px 12px", borderRadius: T.radiusXs, border: `1px solid ${T.border}`, fontSize: 14, fontFamily: T.font, color: T.text, outline: "none", boxSizing: "border-box", background: T.bgElevated, minHeight: 70, resize: "vertical" }} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Conditions de paiement, IBAN..." /></div>
    <button className="btn-press" disabled={saving} onClick={async () => {
      const vl = ls.filter(l => l.desc.trim()); if (!vl.length || !cId) return;
      setSaving(true); await onSave({ clientId: cId, tva: tv, typeOp, remiseType, remiseValeur, echeance, lignes: vl, notes }); setSaving(false);
    }} style={{ width: "100%", padding: 14, borderRadius: T.radiusSm, border: "none", background: saving ? T.primaryLighter : T.primary, color: "#fff", fontSize: 15, fontWeight: 700, cursor: saving ? "wait" : "pointer", fontFamily: T.font, boxShadow: "0 4px 14px rgba(27,67,50,0.3)" }}>{saving ? "Enregistrement..." : "Créer la facture"}</button>
    {showC && <CatPicker cat={catalogue} onSel={x => setLs([...ls, { desc: x.desc, qte: 1, unite: x.unite, pu: x.pu }])} onClose={() => setShowC(false)} />}
  </div>;
}

/* ══════════════ APP (connected to Supabase) ══════════════ */
const NAV_ITEMS = [
  { id: "dashboard", label: "Accueil", icon: "⌂" },
  { id: "clients", label: "Clients", icon: "👥" },
  { id: "devis", label: "Devis", icon: "📄" },
  { id: "factures", label: "Factures", icon: "🧾" },
  { id: "catalogue", label: "Catalogue", icon: "📋" },
  { id: "profil", label: "Profil", icon: "⚙️" },
];

export default function FactuPro() {
  const { entreprise, signOut, updateEntreprise } = useAuth();
  const { clients: rawClients, addClient, updateClient } = useClients(entreprise?.id);
  const { devis: rawDevis, addDevis, updateDevis, updateDevisComplet, deleteDevis, signerDevis, reload: reloadDevis } = useDevis(entreprise?.id);
  const { factures: rawFactures, creerDepuisDevis, addFactureDirecte, creerAvoir, marquerPayee, validerFacture, supprimerBrouillon, envoyerRelance } = useFactures(entreprise?.id);
  const { catalogue: rawCat, addItem: addCatItem, updateItem: updateCatItem, deleteItem: deleteCatItem } = useCatalogue(entreprise?.id);
  const { subscription, plan, isPro, reload: reloadSub } = useSubscription(entreprise?.id);
  const { entries: auditEntries } = useAudit(entreprise?.id);
  const { clotures, creerCloture } = useClotures(entreprise?.id);
  const { recurrences, addRecurrence, updateRecurrence, deleteRecurrence } = useRecurrences(entreprise?.id);

  // Normalize data for UI — useMemo évite de recréer les tableaux à chaque render
  const cls = useMemo(() => rawClients.map(normClient), [rawClients]);
  const dvs = useMemo(() => rawDevis.map(normDevis), [rawDevis]);
  const fcs = useMemo(() => rawFactures.map(normFacture), [rawFactures]);
  const cat = useMemo(() => rawCat.map(normCat), [rawCat]);

  const [pg, setPg] = useState("dashboard");
  const [selD, setSelD] = useState(null);
  const [selF, setSelF] = useState(null);
  const [selC, setSelC] = useState(null);
  const [profC, setProfC] = useState(null);
  const [editC, setEditC] = useState(false);
  const [showSig, setShowSig] = useState(false);
  const [pdf, setPdf] = useState(null);
  const [conf, setConf] = useState(null);
  const [dup, setDup] = useState(null);
  const [editD, setEditD] = useState(null);
  const [dupF, setDupF] = useState(null);
  const [recForm, setRecForm] = useState(null); // { } (new) | recurrence (edit)
  const [toast, setToast] = useState(null);
  const [payPick, setPayPick] = useState(null);
  const [emailModal, setEmailModal] = useState(null); // { type, doc, client, signature }
  const [avoirModal, setAvoirModal] = useState(null); // facture sélectionnée pour avoir

  const fl = m => { setToast(m); setTimeout(() => setToast(null), 2000); };
  const nav = p => { setPg(p); setSelD(null); setSelF(null); setSelC(null); setProfC(null); setEditC(false); setDup(null); setEditD(null); setDupF(null); setRecForm(null); };
  const tab = ["nouveau_devis","edit_devis"].includes(pg) ? "devis" : ["nouvelle_facture","recurrences","rec_form"].includes(pg) ? "factures" : pg;
  const retC = fcs.filter(f => f.statut === "en_retard").length;

  // ── Quota formule Gratuite : 5 devis + 5 factures / mois (illimité en Pro) ──
  const FREE_LIMIT = 5;
  const _now = new Date();
  const sameMonth = ds => { if (!ds) return false; const d = new Date(ds); return d.getMonth() === _now.getMonth() && d.getFullYear() === _now.getFullYear(); };
  const devisMois = dvs.filter(d => sameMonth(d.date)).length;
  const facturesMois = fcs.filter(f => sameMonth(f.date)).length;
  const goNewDevis = () => {
    if (!isPro && devisMois >= FREE_LIMIT) { setConf({ m: `Limite atteinte : ${FREE_LIMIT} devis ce mois-ci en formule Gratuite. Passez à Pro pour un usage illimité.`, fn: () => nav("profil") }); return; }
    nav("nouveau_devis");
  };
  const goNewFacture = () => {
    if (!isPro && facturesMois >= FREE_LIMIT) { setConf({ m: `Limite atteinte : ${FREE_LIMIT} factures ce mois-ci en formule Gratuite. Passez à Pro pour un usage illimité.`, fn: () => nav("profil") }); return; }
    nav("nouvelle_facture");
  };
  // Routage avec garde-quota (utilisé par le dashboard)
  const navGuarded = p => p === "nouveau_devis" ? goNewDevis() : p === "nouvelle_facture" ? goNewFacture() : nav(p);

  // Sync selD quand rawDevis est rechargé (après reloadDevis)
  useEffect(() => {
    if (!selD) return;
    const updated = dvs.find(d => d.dbId === selD.dbId);
    if (updated && (updated.statut !== selD.statut || updated.signature !== selD.signature)) {
      setSelD(updated);
    }
  }, [dvs]);

  // Sync selF quand les factures sont rechargées (ex. après "marquer payée")
  useEffect(() => {
    if (!selF) return;
    const updated = fcs.find(f => f.dbId === selF.dbId);
    if (updated && (updated.statut !== selF.statut || updated.paiement !== selF.paiement || updated.datePaiement !== selF.datePaiement)) {
      setSelF(updated);
    }
  }, [fcs]);

  // Mise à jour live via Supabase Realtime : tant qu'un devis non terminal
  // est ouvert, on s'abonne aux changements de SA ligne uniquement.
  // Événementiel (pas d'intervalle) → aucune boucle de re-render possible.
  // On fusionne juste statut + signature dans le selD courant (on garde les
  // lignes déjà chargées). Nécessite la réplication activée sur la table devis.
  useEffect(() => {
    if (!selD || ['accepte', 'refuse', 'facture'].includes(selD.statut)) return;
    const dbId = selD.dbId;
    const ch = supabase
      .channel(`devis-${dbId}`)
      .on('postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'devis', filter: `id=eq.${dbId}` },
        (payload) => {
          const n = payload.new;
          setSelD(prev => (prev && prev.dbId === dbId)
            ? { ...prev, statut: n.statut, signature: n.signature_url }
            : prev);
          if (n.statut === 'accepte') fl('✅ Devis signé par le client !');
          else if (n.statut === 'refuse') fl('❌ Devis refusé par le client');
        })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [selD?.dbId, selD?.statut]);

  // Retour depuis Stripe Checkout (?checkout=success|cancel)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const co = params.get("checkout");
    if (!co) return;
    window.history.replaceState({}, "", "/app");
    if (co === "success") {
      fl("Paiement confirmé, activation en cours…");
      // Le webhook met à jour la base ; on recharge quelques fois le temps qu'il arrive
      let n = 0;
      const iv = setInterval(async () => {
        await reloadSub();
        if (++n >= 5) clearInterval(iv);
      }, 1500);
    } else {
      fl("Paiement annulé");
    }
  }, []);

  // Sauvegarde la session avant de quitter l'app vers Stripe (persistSession:false
  // => sans ça, le retour recharge la page et déconnecte l'utilisateur).
  const stashSession = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (session) sessionStorage.setItem("sb-checkout-session", JSON.stringify({
      access_token: session.access_token, refresh_token: session.refresh_token,
    }));
  };

  // Lance le checkout Stripe (abonnement Pro)
  const startCheckout = async () => {
    try {
      fl("Redirection vers le paiement…");
      const { data, error } = await supabase.functions.invoke("create-checkout-session", {
        body: { origin: window.location.origin },
      });
      if (error) throw new Error(error?.context?.json?.error || error.message);
      if (data?.error) throw new Error(data.error);
      if (data?.url) { await stashSession(); window.location.href = data.url; }
    } catch (e) { fl("Erreur paiement : " + e.message); }
  };

  // Ouvre le portail de gestion d'abonnement Stripe
  const openPortal = async () => {
    try {
      const { data, error } = await supabase.functions.invoke("customer-portal", {
        body: { origin: window.location.origin },
      });
      if (error) throw new Error(error?.context?.json?.error || error.message);
      if (data?.error) throw new Error(data.error);
      if (data?.url) { await stashSession(); window.location.href = data.url; }
    } catch (e) { fl("Erreur : " + e.message); }
  };

  return (
    <div style={{ fontFamily: T.font, background: T.bg, color: T.text, minHeight: "100vh", display: "flex", flexDirection: "column", maxWidth: 480, margin: "0 auto", position: "relative" }}>
      <style>{CSS}</style>
      <Toast m={toast} />
      {conf && <Confirm msg={conf.m} onOk={() => { conf.fn(); setConf(null); }} onNo={() => setConf(null)} />}
      {pdf && <PDFPrev {...pdf} onClose={() => setPdf(null)} />}
      {showSig && <SigPad onNo={() => setShowSig(false)} onSave={async sig => {
        await signerDevis(selD.dbId, sig);
        setShowSig(false); fl("Devis signé ✓");
      }} />}
      {emailModal && <EmailModal {...emailModal} entreprise={entreprise} onClose={() => setEmailModal(null)} />}
      {payPick && <PayPicker onClose={() => setPayPick(null)} onSel={async mode => {
        await marquerPayee(payPick, mode);
        setPayPick(null); fl("Paiement enregistré ✓");
      }} />}

      {avoirModal && <AvoirModal facture={avoirModal} onClose={() => setAvoirModal(null)} onConfirm={async (custom) => {
        try {
          const orig = avoirModal._raw;
          const av = await creerAvoir(orig, custom);
          const lignes = custom
            ? [{ description: custom.motif || "Avoir", quantite: 1, unite: "forfait", prix_unitaire: -Math.abs(custom.montant || 0) }]
            : (orig.facture_lignes || []).map(l => ({ ...l, prix_unitaire: -Math.abs(parseFloat(l.prix_unitaire)) }));
          setAvoirModal(null);
          setSelF(normFacture({ ...av, facture_lignes: lignes }));
          fl("Avoir créé ✓");
        } catch (e) { setAvoirModal(null); fl("Erreur: " + e.message); }
      }} />}

      {/* Header */}
      <div className="gradient-header" style={{ color: "#fff", padding: "18px 20px 16px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", position: "relative", zIndex: 2 }}>
          <div>
            <div style={{ fontSize: 20, fontWeight: 800, letterSpacing: -0.5, display: "flex", alignItems: "center", gap: 6 }}><span style={{ fontSize: 22 }}>⚡</span> FactuPro</div>
            <div style={{ fontSize: 11, opacity: 0.7, marginTop: 1 }}>Devis & facturation · b36</div>
          </div>
          <div onClick={() => nav("profil")} style={{ textAlign: "right", cursor: "pointer" }}>
            <div style={{ fontSize: 11, fontWeight: 600, opacity: 0.9 }}>{entreprise?.nom}</div>
            <div style={{ fontSize: 10, opacity: 0.6 }}>{entreprise?.siret || "Configurer →"}</div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div style={{ flex: 1, padding: "14px 14px 90px", overflowY: "auto" }}>
        {pg === "dashboard" && <Dashboard devis={dvs} factures={fcs} clients={cls} onNav={navGuarded}
          onSelectDevis={d => { setSelD(d); setPg("devis"); }}
          onSelectFacture={f => { setSelF(f); setPg("factures"); }}
        />}

        {pg === "clients" && !editC && !selC && !profC && <ClientsList clients={cls} onSelect={c => setProfC(c)} onAdd={() => setEditC("new")} />}
        {pg === "clients" && profC && !editC && !selC && <ClientProfil client={profC} devis={dvs} factures={fcs} onBack={() => setProfC(null)} onEdit={() => { setSelC(profC); setProfC(null); }} />}
        {pg === "clients" && (editC || selC) && <ClientForm client={selC} onNo={() => { setSelC(null); setEditC(false); }}
          onSave={async c => {
            try {
              if (c.id) { await updateClient(c.id, { nom: c.nom, tel: c.tel, email: c.email, adresse: c.adresse, notes: c.notes, siret: c.siret }); setProfC(null); }
              else { await addClient({ nom: c.nom, tel: c.tel, email: c.email, adresse: c.adresse, notes: c.notes, siret: c.siret }); }
              setSelC(null); setEditC(false); fl("Client enregistré ✓");
            } catch (e) { fl("Erreur: " + e.message); }
          }} />}

        {pg === "devis" && !selD && <DevisList devis={dvs} clients={cls} onSelect={d => setSelD(d)} onNew={goNewDevis} />}
        {pg === "devis" && selD && <DevisDetail devis={selD} client={cls.find(c => c.id === selD.clientId)}
          onBack={() => { setSelD(null); reloadDevis(); }}
          onSign={() => setShowSig(true)}
          onPDF={() => setPdf({ type: "devis", doc: selD, client: cls.find(c => c.id === selD.clientId), signature: selD.signature, entreprise })}
          onEmail={() => setEmailModal({ type: "devis", doc: selD, client: cls.find(c => c.id === selD.clientId), signature: selD.signature })}
          onDup={() => { if (!isPro && devisMois >= FREE_LIMIT) { setConf({ m: `Limite atteinte : ${FREE_LIMIT} devis ce mois-ci en formule Gratuite. Passez à Pro pour un usage illimité.`, fn: () => nav("profil") }); return; } setDup(selD); setSelD(null); setPg("nouveau_devis"); }}
          onEdit={() => { setEditD(selD); setSelD(null); setPg("edit_devis"); }}
          onConvert={async () => {
            fl("Création de la facture…");
            try {
              const raw = selD._raw;
              if (!raw || !raw.id) { fl("Données du devis manquantes, rechargez la page"); return; }
              const newFac = await creerDepuisDevis(raw);
              await reloadDevis();
              // Construire la facture normalisée avec les lignes du devis
              const newFacNorm = normFacture({
                ...newFac,
                facture_lignes: raw.devis_lignes || [],
              });
              const client = cls.find(c => c.id === selD.clientId);
              setSelD(null);
              setPg("factures");
              fl("Facture créée ✓");
              // Ouvrir la modale email pour envoyer la facture au client
              setEmailModal({ type: "facture", doc: newFacNorm, client, signature: null });
            } catch (e) { console.error("Facturer:", e); fl("Erreur facturation : " + (e?.message || e)); }
          }}
          onDelete={() => setConf({ m: `Supprimer ${selD.id} ?`, fn: async () => {
            await deleteDevis(selD.dbId); setSelD(null); fl("Supprimé");
          } })}
          onViewFacture={() => {
            const facture = fcs.find(f => f.devisId === selD.dbId);
            if (facture) { setSelF(facture); setSelD(null); setPg("factures"); }
            else fl("Facture introuvable");
          }}
          onSendSignLink={() => {
            const signUrl = `${window.location.origin}/sign/${selD.dbId}`;
            const client = cls.find(c => c.id === selD.clientId);
            const e = entreprise || {};
            const msg = `Bonjour ${client?.nom || ""},\n\nVeuillez trouver ci-dessous votre devis ${selD.id}.\n\nPour l'accepter et le signer électroniquement, cliquez sur le lien ci-dessous :\n👉 ${signUrl}\n\nCordialement,\n${e.nom || ""}`;
            setEmailModal({ type: "devis", doc: selD, client, signature: selD.signature, defaultMessage: msg });
          }}
          onRefresh={async () => {
            try {
              const { supabase: sb } = await import('../lib/supabase');
              const { data, error } = await sb
                .from('devis')
                .select('*, devis_lignes(*)')
                .eq('id', selD.dbId)
                .single();
              if (error) throw error;
              const fresh = normDevis(data);
              setSelD(fresh);
              if (fresh.statut === 'accepte' && selD.statut !== 'accepte') fl("✅ Devis signé par le client !");
              else if (fresh.statut === 'refuse' && selD.statut !== 'refuse') fl("❌ Devis refusé par le client");
              else fl("Actualisé ✓");
              reloadDevis();
            } catch(e) { fl("Erreur : " + e.message); }
          }}
        />}

        {pg === "nouveau_devis" && <DevisForm clients={cls} catalogue={cat} init={dup}
          onNo={() => { setDup(null); nav("devis"); }}
          onSave={async d => {
            try {
              await addDevis(
                { client_id: d.clientId, date_devis: tod(), date_validite: in30(), taux_tva: d.tva, type_operation: d.typeOp, remise_type: d.remiseType, remise_valeur: d.remiseValeur, notes: d.notes },
                d.lignes.map(l => ({ description: l.desc, quantite: l.qte, unite: l.unite, prix_unitaire: l.pu }))
              );
              setDup(null); nav("devis"); fl("Devis créé ✓");
            } catch (e) { fl("Erreur: " + e.message); }
          }}
        />}

        {pg === "edit_devis" && editD && <DevisForm clients={cls} catalogue={cat} init={editD} mode="edit"
          onNo={() => { setEditD(null); nav("devis"); }}
          onSave={async d => {
            try {
              await updateDevisComplet(
                editD.dbId,
                { client_id: d.clientId, date_validite: editD.validite, taux_tva: d.tva, type_operation: d.typeOp, remise_type: d.remiseType, remise_valeur: d.remiseValeur, notes: d.notes },
                d.lignes.map(l => ({ description: l.desc, quantite: l.qte, unite: l.unite, prix_unitaire: l.pu }))
              );
              setEditD(null); nav("devis"); fl("Devis modifié ✓");
            } catch (e) { fl("Erreur: " + e.message); }
          }}
        />}

        {pg === "nouvelle_facture" && <FactureDirecteForm clients={cls} catalogue={cat} init={dupF}
          onNo={() => nav("factures")}
          onSave={async d => {
            try {
              await addFactureDirecte(
                { client_id: d.clientId, date_echeance: d.echeance, taux_tva: d.tva, type_operation: d.typeOp, remise_type: d.remiseType, remise_valeur: d.remiseValeur, notes: d.notes },
                d.lignes.map(l => ({ description: l.desc, quantite: l.qte, unite: l.unite, prix_unitaire: l.pu }))
              );
              nav("factures"); fl("Facture créée ✓");
            } catch (e) { fl("Erreur: " + e.message); }
          }}
        />}

        {pg === "recurrences" && (isPro
          ? <RecurrencesList recurrences={recurrences} clients={cls} factures={fcs}
              onNew={() => { setRecForm({}); setPg("rec_form"); }}
              onEdit={r => { setRecForm(r); setPg("rec_form"); }}
              onToggle={async r => { try { await updateRecurrence(r.id, { statut: r.statut === "active" ? "en_pause" : "active" }); fl("Mis à jour ✓"); } catch (e) { fl("Erreur: " + e.message); } }}
              onStop={r => setConf({ m: `Arrêter la récurrence « ${r.libelle || "sans nom"} » ? Elle ne générera plus de factures.`, fn: async () => { try { await updateRecurrence(r.id, { statut: "terminee" }); fl("Récurrence arrêtée"); } catch (e) { fl("Erreur: " + e.message); } } })}
            />
          : <ProLock titre="Récurrences" desc="Automatisez vos factures régulières (maintenance, abonnements) : un gabarit génère une facture brouillon à chaque échéance, que vous validez avant envoi. Passez à Pro pour activer les récurrences." onUpgrade={startCheckout} />
        )}

        {pg === "rec_form" && recForm && <RecurrenceForm clients={cls} catalogue={cat} init={recForm.id ? recForm : null}
          onNo={() => nav("recurrences")}
          onSave={async r => {
            try {
              if (recForm.id) await updateRecurrence(recForm.id, r);
              else await addRecurrence({ ...r, prochaine_generation: r.date_debut, statut: "active" });
              nav("recurrences"); fl(recForm.id ? "Récurrence modifiée ✓" : "Récurrence créée ✓");
            } catch (e) { fl("Erreur: " + e.message); }
          }}
        />}

        {pg === "factures" && !selF && <FacturesList factures={fcs} clients={cls}
          onSelect={f => setSelF(f)}
          onPDF={f => setPdf({ type: "facture", doc: f, client: cls.find(c => c.id === f.clientId), signature: null, entreprise })}
          onEmail={f => setEmailModal({ type: "facture", doc: f, client: cls.find(c => c.id === f.clientId), signature: null })}
          onPay={id => setPayPick(id)}
          onNew={goNewFacture}
          onRecurrences={() => nav("recurrences")}
        />}
        {pg === "factures" && selF && <FactureDetail
          facture={selF}
          client={cls.find(c => c.id === selF.clientId)}
          onBack={() => setSelF(null)}
          onPDF={() => setPdf({ type: "facture", doc: selF, client: cls.find(c => c.id === selF.clientId), signature: null, entreprise })}
          onEmail={() => setEmailModal({ type: "facture", doc: selF, client: cls.find(c => c.id === selF.clientId), signature: null })}
          onPay={id => setPayPick(id)}
          onAvoir={() => setAvoirModal(selF)}
          onDup={() => { if (!isPro && facturesMois >= FREE_LIMIT) { setConf({ m: `Limite atteinte : ${FREE_LIMIT} factures ce mois-ci en formule Gratuite. Passez à Pro pour un usage illimité.`, fn: () => nav("profil") }); return; } setDupF(selF); setSelF(null); setPg("nouvelle_facture"); }}
          onValider={() => setConf({ m: `Valider et émettre cette facture ? Un numéro définitif lui sera attribué et elle deviendra inaltérable.`, fn: async () => { try { const v = await validerFacture(selF.dbId); setSelF(normFacture({ ...selF._raw, ...v, facture_lignes: selF._raw.facture_lignes })); fl("Facture émise ✓"); } catch (e) { fl("Erreur: " + e.message); } } })}
          onDelete={() => setConf({ m: `Supprimer ce brouillon ?`, fn: async () => { try { await supprimerBrouillon(selF.dbId); setSelF(null); fl("Brouillon supprimé"); } catch (e) { fl("Erreur: " + e.message); } } })}
        />}

        {pg === "catalogue" && <CataloguePage catalogue={rawCat} onAdd={addCatItem} onUpdate={updateCatItem} onDelete={deleteCatItem} />}

        {pg === "relances" && (isPro
          ? <Relances factures={fcs} clients={cls}
              onRelance={f => {
                const client = cls.find(c => c.id === f.clientId);
                setEmailModal({ type: "facture", doc: f, client, signature: null, relance: true,
                  defaultMessage: defaultMessage("relance", f, client, entreprise),
                  onSent: () => { envoyerRelance(f.dbId); } });
              }}
              onPaid={id => setPayPick(id)}
            />
          : <ProLock titre="Relances" desc="Relancez vos clients en retard de paiement par email en un clic, avec un message pré-rempli et la facture jointe. Passez à Pro pour activer les relances." onUpgrade={startCheckout} />
        )}

        {pg === "analytics" && <Analytics factures={fcs} devis={dvs} clients={cls}
          onExportFactures={() => { exportCSV(fcs, cls); fl("Export factures téléchargé ✓"); }}
          onExportDevis={() => { exportDevisCSV(dvs, cls); fl("Export devis téléchargé ✓"); }}
        />}

        {pg === "profil" && <ProfilPage entreprise={entreprise} plan={plan} isPro={isPro} subscription={subscription} devisMois={devisMois} facturesMois={facturesMois} freeLimit={FREE_LIMIT} audit={auditEntries} clotures={clotures}
          onCloture={(annee) => setConf({ m: `Clôturer l'année ${annee} ? Les totaux seront figés définitivement.`, fn: async () => { try { await creerCloture(annee); fl("Année clôturée ✓"); } catch (e) { fl("Erreur: " + e.message); } } })}
          onExport={async () => {
            try {
              fl("Préparation de l'export…");
              const data = await collectExportData();
              const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a"); a.href = url; a.download = `factupro-export-${new Date().toISOString().slice(0, 10)}.json`; a.click();
              URL.revokeObjectURL(url);
              fl("Export téléchargé ✓");
            } catch (e) { fl("Erreur: " + e.message); }
          }}
          onUpgrade={startCheckout} onManage={openPortal} onSaveLogo={async (url) => { try { await updateEntreprise({ logo_url: url }); fl(url ? "Logo enregistré ✓" : "Logo retiré"); } catch (e) { fl("Erreur: " + e.message); } }} onSignOut={async () => { try { await signOut(); } catch(e) { window.location.reload(); } }} onSave={async (data) => { await updateEntreprise(data); fl("Profil enregistré ✓"); }} />}
      </div>

      {/* Nav */}
      <div style={{ display: "flex", background: T.bgCard, borderTop: `1px solid ${T.borderLight}`, padding: "2px 0 env(safe-area-inset-bottom, 6px)", position: "sticky", bottom: 0, zIndex: 10, boxShadow: "0 -4px 20px rgba(0,0,0,0.04)" }}>
        {NAV_ITEMS.map(item => (
          <button key={item.id} className="btn-press" onClick={() => nav(item.id)} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 1, padding: "8px 0 6px", fontSize: 9, fontWeight: tab === item.id ? 700 : 500, color: tab === item.id ? T.primary : T.textLight, background: "none", border: "none", cursor: "pointer", fontFamily: T.font, letterSpacing: 0.3, textTransform: "uppercase", position: "relative" }}>
            {tab === item.id && <div style={{ position: "absolute", top: 0, left: "25%", right: "25%", height: 3, borderRadius: "0 0 3px 3px", background: T.primary }} />}
            <span style={{ fontSize: 18, lineHeight: 1 }}>{item.icon}</span>
            {item.id === "relances" && retC > 0 && <span style={{ position: "absolute", top: 2, right: "calc(50% - 16px)", background: T.danger, color: "#fff", fontSize: 8, fontWeight: 800, borderRadius: 10, width: 14, height: 14, display: "flex", alignItems: "center", justifyContent: "center" }}>{retC}</span>}
            {item.label}
          </button>
        ))}
      </div>
    </div>
  );
}
