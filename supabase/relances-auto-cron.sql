-- ═══════════════════════════════════════════════════════
-- FactuPro — Planification des relances automatiques (pg_cron)
-- À exécuter dans Supabase > SQL Editor > New Query
-- ═══════════════════════════════════════════════════════
-- Prérequis :
--   1) Déployer l'Edge Function "relance-auto" (Verify JWT DÉSACTIVÉ).
--   2) Définir le secret CRON_SECRET dans Supabase > Edge Functions > Secrets
--      (une valeur aléatoire que tu choisis).
--   3) Remplacer ci-dessous <CRON_SECRET> par cette même valeur.

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- (Ré)installe le job : tous les jours à 08:00 UTC
SELECT cron.unschedule('relances-auto-quotidiennes')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'relances-auto-quotidiennes');

SELECT cron.schedule(
  'relances-auto-quotidiennes',
  '0 8 * * *',
  $$
  SELECT net.http_post(
    url := 'https://nbbqteyqxzaseaecibss.supabase.co/functions/v1/relance-auto',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', '<CRON_SECRET>'
    )
  );
  $$
);

-- Pour vérifier : SELECT * FROM cron.job;
-- Pour désactiver : SELECT cron.unschedule('relances-auto-quotidiennes');
