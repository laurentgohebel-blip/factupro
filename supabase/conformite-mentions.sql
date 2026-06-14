-- ═══════════════════════════════════════════════════════
-- FactuPro — Mentions obligatoires 2026 (SIRET client + type d'opération)
-- À exécuter dans Supabase > SQL Editor > New Query
-- ═══════════════════════════════════════════════════════
-- Réforme facturation électronique : à partir du 1er sept. 2026, la facture
-- doit porter le SIREN/SIRET du client et le type d'opération.

-- SIRET du client (B2B ; vide pour les particuliers)
ALTER TABLE clients ADD COLUMN IF NOT EXISTS siret TEXT;

-- Type d'opération : 'biens' | 'services' | 'mixte' (défaut services)
ALTER TABLE factures ADD COLUMN IF NOT EXISTS type_operation TEXT DEFAULT 'services';
ALTER TABLE devis    ADD COLUMN IF NOT EXISTS type_operation TEXT DEFAULT 'services';
