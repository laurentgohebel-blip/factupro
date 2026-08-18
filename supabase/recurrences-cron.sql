-- ═══════════════════════════════════════════════════════
-- FactuPro — Planification de la génération des factures récurrentes
-- À exécuter dans Supabase > SQL Editor > New Query
-- ═══════════════════════════════════════════════════════
-- Prérequis :
--   1) recurrences.sql exécuté.
--   2) Edge Function "generer-factures-recurrentes" déployée (Verify JWT OFF).
--   3) Secret CRON_SECRET défini (le même que pour les relances auto).
--   4) Remplacer <CRON_SECRET> ci-dessous.

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

SELECT cron.unschedule('generer-factures-recurrentes')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'generer-factures-recurrentes');

-- Tous les jours à 07:00 UTC
SELECT cron.schedule(
  'generer-factures-recurrentes',
  '0 7 * * *',
  $$
  SELECT net.http_post(
    url := 'https://nbbqteyqxzaseaecibss.supabase.co/functions/v1/generer-factures-recurrentes',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', '<CRON_SECRET>'
    )
  );
  $$
);

-- Vérifier : SELECT * FROM cron.job;
-- Désactiver : SELECT cron.unschedule('generer-factures-recurrentes');
