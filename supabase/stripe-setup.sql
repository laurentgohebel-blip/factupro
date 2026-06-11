-- ═══════════════════════════════════════════════════════
-- FactuPro — Abonnements Stripe (Phase 1)
-- À exécuter dans Supabase > SQL Editor > New Query
-- ═══════════════════════════════════════════════════════

-- État d'abonnement, 1 ligne par entreprise.
-- IMPORTANT : écrite UNIQUEMENT par le webhook Stripe (service role).
-- L'artisan peut la LIRE mais pas la modifier → impossible de s'auto-upgrade.
CREATE TABLE IF NOT EXISTS subscriptions (
  entreprise_id UUID PRIMARY KEY REFERENCES entreprises(id) ON DELETE CASCADE,
  plan TEXT NOT NULL DEFAULT 'free',          -- 'free' | 'pro'
  status TEXT,                                 -- active | trialing | past_due | canceled | incomplete
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  current_period_end TIMESTAMPTZ,
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;

-- Lecture seule pour le propriétaire. Pas de policy INSERT/UPDATE/DELETE
-- => seules les requêtes en service_role (le webhook) peuvent écrire.
DROP POLICY IF EXISTS "read own subscription" ON subscriptions;
CREATE POLICY "read own subscription" ON subscriptions
  FOR SELECT USING (
    entreprise_id IN (SELECT id FROM entreprises WHERE user_id = auth.uid())
  );

-- Crée une ligne 'free' par défaut pour chaque entreprise existante
INSERT INTO subscriptions (entreprise_id, plan)
SELECT id, 'free' FROM entreprises
ON CONFLICT (entreprise_id) DO NOTHING;

-- Crée automatiquement une ligne 'free' à chaque nouvelle entreprise
CREATE OR REPLACE FUNCTION create_default_subscription()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO subscriptions (entreprise_id, plan)
  VALUES (NEW.id, 'free')
  ON CONFLICT (entreprise_id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_entreprise_subscription ON entreprises;
CREATE TRIGGER trg_entreprise_subscription
  AFTER INSERT ON entreprises
  FOR EACH ROW EXECUTE FUNCTION create_default_subscription();
