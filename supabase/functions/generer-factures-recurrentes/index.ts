import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ⚠️ Déployer avec "Verify JWT" DÉSACTIVÉ (déclenché par pg_cron).
// Sécurité : header x-cron-secret == CRON_SECRET.
// Génère, à chaque échéance, une facture BROUILLON depuis chaque récurrence
// active des entreprises Pro. Idempotent via l'index unique (recurrence_id, periode).

const admin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);
const CRON_SECRET = Deno.env.get("CRON_SECRET");

const MONTHS: Record<string, number> = { mensuelle: 1, trimestrielle: 3, annuelle: 12 };

// Ajoute n mois à une date 'YYYY-MM-DD' (jour ramené à la fin du mois si besoin).
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

serve(async (req) => {
  if (CRON_SECRET && req.headers.get("x-cron-secret") !== CRON_SECRET) {
    return new Response("Non autorisé", { status: 401 });
  }

  try {
    const today = new Date().toISOString().slice(0, 10);

    // Entreprises Pro
    const { data: subs } = await admin.from("subscriptions").select("entreprise_id").eq("plan", "pro");
    const proIds = new Set((subs || []).map((s) => s.entreprise_id));
    if (proIds.size === 0) return json({ generated: 0, message: "Aucune entreprise Pro" });

    // Récurrences actives dont l'échéance est atteinte
    const { data: recs } = await admin
      .from("recurrences")
      .select("*")
      .eq("statut", "active")
      .lte("prochaine_generation", today);

    let generated = 0;
    const errors: string[] = [];

    for (const r of recs || []) {
      if (!proIds.has(r.entreprise_id)) continue;

      // Terminée si l'échéance dépasse la date de fin
      if (r.date_fin && r.prochaine_generation > r.date_fin) {
        await admin.from("recurrences").update({ statut: "terminee" }).eq("id", r.id);
        continue;
      }

      const periode = r.prochaine_generation.slice(0, 7); // 'YYYY-MM'

      // Crée le brouillon (idempotent grâce à l'index unique recurrence_id+periode)
      const { data: fac, error: facErr } = await admin
        .from("factures")
        .insert({
          entreprise_id: r.entreprise_id,
          client_id: r.client_id,
          recurrence_id: r.id,
          periode,
          numero: null,
          statut: "brouillon",
          date_facture: r.prochaine_generation,
          date_echeance: addDays(r.prochaine_generation, r.delai_echeance || 30),
          taux_tva: r.taux_tva,
          type_operation: r.type_operation || "services",
          remise_type: r.remise_type || "montant",
          remise_valeur: r.remise_valeur || 0,
          notes: r.libelle || "",
        })
        .select()
        .single();

      if (facErr) {
        // 23505 = doublon (déjà généré pour cette période) → on avance quand même
        if (facErr.code !== "23505") { errors.push(`${r.id}: ${facErr.message}`); continue; }
      } else {
        const lignes = (r.lignes || []).map((l: any, i: number) => ({
          facture_id: fac.id,
          description: l.description,
          quantite: l.quantite,
          unite: l.unite,
          prix_unitaire: l.prix_unitaire,
          ordre: i,
        }));
        if (lignes.length) await admin.from("facture_lignes").insert(lignes);
        generated++;
      }

      // Avance la prochaine génération ; termine si au-delà de la date de fin
      const next = addMonths(r.prochaine_generation, MONTHS[r.frequence] || 1);
      const statut = (r.date_fin && next > r.date_fin) ? "terminee" : "active";
      await admin.from("recurrences").update({ prochaine_generation: next, statut }).eq("id", r.id);
    }

    return json({ generated, errors });
  } catch (err) {
    return json({ error: err.message }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
