-- ═══════════════════════════════════════════════════════
-- FactuPro — Remise sur devis et factures
-- À exécuter dans Supabase > SQL Editor > New Query
-- ═══════════════════════════════════════════════════════
-- Remise appliquée sur le total HT : montant fixe (€) ou pourcentage (%).

ALTER TABLE devis    ADD COLUMN IF NOT EXISTS remise_type   TEXT DEFAULT 'montant';   -- 'montant' | 'pourcent'
ALTER TABLE devis    ADD COLUMN IF NOT EXISTS remise_valeur NUMERIC(12,2) DEFAULT 0;
ALTER TABLE factures ADD COLUMN IF NOT EXISTS remise_type   TEXT DEFAULT 'montant';
ALTER TABLE factures ADD COLUMN IF NOT EXISTS remise_valeur NUMERIC(12,2) DEFAULT 0;
