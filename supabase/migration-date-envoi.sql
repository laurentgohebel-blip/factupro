-- ═══════════════════════════════════════════════════════════════════
-- FactuPro — Traçabilité des envois par email
-- À lancer une fois dans Supabase → SQL Editor. Idempotent.
--
-- Pourquoi : jusqu'ici, un envoi réussi n'écrivait rien en base. Aucune
-- date, aucun journal. Impossible de savoir quelles factures sont
-- réellement parties — c'est ce qui a rendu l'incident synapserh.fr
-- invisible pendant des jours.
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE factures ADD COLUMN IF NOT EXISTS date_envoi TIMESTAMPTZ;
ALTER TABLE devis    ADD COLUMN IF NOT EXISTS date_envoi TIMESTAMPTZ;

COMMENT ON COLUMN factures.date_envoi IS
  'Horodatage du dernier envoi email accepté par le fournisseur (Resend). NULL = jamais envoyé.';
COMMENT ON COLUMN devis.date_envoi IS
  'Horodatage du dernier envoi email accepté par le fournisseur (Resend). NULL = jamais envoyé.';

-- Index partiel : retrouver vite les documents émis jamais envoyés.
CREATE INDEX IF NOT EXISTS idx_factures_jamais_envoyees
  ON factures (entreprise_id, date_facture)
  WHERE date_envoi IS NULL AND statut <> 'brouillon';


-- ── Vérification : la contrainte d'inaltérabilité laisse-t-elle passer ? ──
-- Le trigger protège numero, date_facture, client_id, entreprise_id,
-- taux_tva, type_operation et devis_id. date_envoi n'en fait pas partie :
-- une facture émise peut donc être marquée comme envoyée. Rien à modifier.


-- ═══════════════════════════════════════════════════════════════════
-- AUDIT DE L'EXISTANT — à lancer après la migration
-- ═══════════════════════════════════════════════════════════════════

-- 1. Factures récurrentes générées par le cron (auto-envoi) :
--    numérotées, verrouillées, marquées envoyées — mais réellement reçues ?
--    À recouper avec la liste Emails de Resend.
SELECT f.numero,
       f.date_facture,
       f.date_echeance,
       f.statut,
       c.nom   AS client,
       c.email AS email_client
FROM factures f
LEFT JOIN clients c ON c.id = f.client_id
WHERE f.recurrence_id IS NOT NULL
  AND f.numero IS NOT NULL
  AND f.statut <> 'brouillon'
ORDER BY f.date_facture DESC;

-- 2. Toutes les factures émises sans trace d'envoi.
--    Juste après la migration, elles le seront toutes (la colonne vient
--    d'être créée). L'intérêt commence au prochain envoi.
SELECT f.numero, f.date_facture, f.statut, c.nom AS client, c.email
FROM factures f
LEFT JOIN clients c ON c.id = f.client_id
WHERE f.date_envoi IS NULL
  AND f.statut <> 'brouillon'
ORDER BY f.date_facture DESC;

-- 3. Clients sans email : ceux-là ne pourront jamais rien recevoir.
SELECT c.nom, c.id
FROM clients c
WHERE c.email IS NULL OR btrim(c.email) = ''
ORDER BY c.nom;
