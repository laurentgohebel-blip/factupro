-- ═══════════════════════════════════════════════════════
-- FactuPro — SETUP COMPLET (toutes les migrations, idempotent)
-- À exécuter dans Supabase > SQL Editor. Sûr même si déjà partiellement lancé.
-- N'inclut PAS schema.sql (initial) ni les scripts cron (qui exigent un secret).
-- ═══════════════════════════════════════════════════════


-- ▼▼▼ stripe-setup.sql ▼▼▼
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
-- ▲▲▲ fin stripe-setup.sql ▲▲▲


-- ▼▼▼ auth-signup-trigger.sql ▼▼▼
-- ═══════════════════════════════════════════════════════
-- FactuPro — Création automatique de l'entreprise à l'inscription
-- À exécuter dans Supabase > SQL Editor > New Query
-- ═══════════════════════════════════════════════════════
-- Corrige "violates row-level security" ET "Database error saving new user".
-- Les fonctions SECURITY DEFINER déclenchées depuis auth.users doivent
-- DÉFINIR search_path = public (sinon elles ne trouvent pas les tables
-- public.entreprises / public.subscriptions → l'inscription échoue).
-- On qualifie aussi les tables en public.* par sécurité.

-- 1) Création entreprise + catalogue à l'inscription
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ent_id UUID;
BEGIN
  INSERT INTO public.entreprises (user_id, nom, siret, email)
  VALUES (
    NEW.id,
    COALESCE(NULLIF(NEW.raw_user_meta_data->>'nom', ''), 'Mon entreprise'),
    COALESCE(NEW.raw_user_meta_data->>'siret', ''),
    NEW.email
  )
  RETURNING id INTO v_ent_id;

  INSERT INTO public.catalogue (entreprise_id, categorie, description, unite, prix_unitaire) VALUES
    (v_ent_id, 'Déplacement', 'Déplacement zone locale', 'forfait', 45),
    (v_ent_id, 'Déplacement', 'Déplacement hors zone', 'forfait', 75),
    (v_ent_id, 'Main d''œuvre', 'Main d''œuvre qualifiée', 'heure', 55),
    (v_ent_id, 'Main d''œuvre', 'Main d''œuvre apprenti', 'heure', 30);

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- 2) Re-crée la fonction d'abonnement free AVEC search_path (même piège)
CREATE OR REPLACE FUNCTION create_default_subscription()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.subscriptions (entreprise_id, plan)
  VALUES (NEW.id, 'free')
  ON CONFLICT (entreprise_id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_entreprise_subscription ON public.entreprises;
CREATE TRIGGER trg_entreprise_subscription
  AFTER INSERT ON public.entreprises
  FOR EACH ROW EXECUTE FUNCTION create_default_subscription();
-- ▲▲▲ fin auth-signup-trigger.sql ▲▲▲


-- ▼▼▼ conformite-mentions.sql ▼▼▼
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
-- ▲▲▲ fin conformite-mentions.sql ▲▲▲


-- ▼▼▼ audit-log.sql ▼▼▼
-- ═══════════════════════════════════════════════════════
-- FactuPro — Piste d'audit (journal horodaté inaltérable)
-- À exécuter dans Supabase > SQL Editor > New Query
-- ═══════════════════════════════════════════════════════
-- Conformité loi anti-fraude TVA : journal append-only des opérations sur
-- les documents (factures, devis). Écrit UNIQUEMENT par des triggers
-- SECURITY DEFINER ; lisible par le propriétaire ; aucune policy
-- INSERT/UPDATE/DELETE => inaltérable depuis l'application.

CREATE TABLE IF NOT EXISTS audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entreprise_id UUID,
  user_id UUID,
  table_name TEXT NOT NULL,          -- 'factures' | 'devis'
  action TEXT NOT NULL,              -- 'INSERT' | 'UPDATE' | 'DELETE'
  record_id UUID,
  numero TEXT,
  statut_avant TEXT,
  statut_apres TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_entreprise_date
  ON audit_log (entreprise_id, created_at DESC);

ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

-- Lecture seule pour le propriétaire. PAS de policy INSERT/UPDATE/DELETE
-- => seuls les triggers (service/definer) écrivent ; personne ne peut altérer.
DROP POLICY IF EXISTS "read own audit" ON audit_log;
CREATE POLICY "read own audit" ON audit_log
  FOR SELECT USING (
    entreprise_id IN (SELECT id FROM entreprises WHERE user_id = auth.uid())
  );

-- Fonction de journalisation
CREATE OR REPLACE FUNCTION log_doc_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  rec RECORD;
BEGIN
  rec := COALESCE(NEW, OLD);
  INSERT INTO audit_log (entreprise_id, user_id, table_name, action, record_id, numero, statut_avant, statut_apres)
  VALUES (
    rec.entreprise_id,
    auth.uid(),
    TG_TABLE_NAME,
    TG_OP,
    rec.id,
    rec.numero,
    CASE WHEN TG_OP = 'UPDATE' THEN OLD.statut ELSE NULL END,
    CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE NEW.statut END
  );
  RETURN rec;
END;
$$;

-- Triggers sur factures et devis
DROP TRIGGER IF EXISTS trg_audit_factures ON factures;
CREATE TRIGGER trg_audit_factures
  AFTER INSERT OR UPDATE OR DELETE ON factures
  FOR EACH ROW EXECUTE FUNCTION log_doc_change();

DROP TRIGGER IF EXISTS trg_audit_devis ON devis;
CREATE TRIGGER trg_audit_devis
  AFTER INSERT OR UPDATE OR DELETE ON devis
  FOR EACH ROW EXECUTE FUNCTION log_doc_change();
-- ▲▲▲ fin audit-log.sql ▲▲▲


-- ▼▼▼ inalterabilite.sql ▼▼▼
-- ═══════════════════════════════════════════════════════
-- FactuPro — Inaltérabilité des factures (loi anti-fraude TVA)
-- À exécuter dans Supabase > SQL Editor > New Query
-- ═══════════════════════════════════════════════════════
-- Une facture émise ne peut plus être supprimée ni voir ses champs
-- essentiels modifiés. Seuls le statut et les infos de paiement évoluent.
-- La correction se fait par AVOIR (note de crédit), pas par modification.

-- Factures : bloque DELETE + modification des champs immuables
CREATE OR REPLACE FUNCTION protect_facture()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Une facture émise ne peut pas être supprimée (inaltérabilité). Créez un avoir pour la corriger.';
  END IF;

  IF NEW.numero        IS DISTINCT FROM OLD.numero
  OR NEW.date_facture  IS DISTINCT FROM OLD.date_facture
  OR NEW.client_id     IS DISTINCT FROM OLD.client_id
  OR NEW.entreprise_id IS DISTINCT FROM OLD.entreprise_id
  OR NEW.taux_tva      IS DISTINCT FROM OLD.taux_tva
  OR NEW.type_operation IS DISTINCT FROM OLD.type_operation
  OR NEW.devis_id      IS DISTINCT FROM OLD.devis_id THEN
    RAISE EXCEPTION 'Champs immuables d''une facture émise (inaltérabilité). Seuls le statut et le paiement peuvent évoluer.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_facture_upd ON factures;
CREATE TRIGGER trg_protect_facture_upd
  BEFORE UPDATE ON factures
  FOR EACH ROW EXECUTE FUNCTION protect_facture();

DROP TRIGGER IF EXISTS trg_protect_facture_del ON factures;
CREATE TRIGGER trg_protect_facture_del
  BEFORE DELETE ON factures
  FOR EACH ROW EXECUTE FUNCTION protect_facture();

-- Lignes de facture : immuables une fois créées (ni UPDATE ni DELETE)
CREATE OR REPLACE FUNCTION protect_facture_lignes()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Les lignes d''une facture émise sont inaltérables (inaltérabilité).';
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_facture_lignes ON facture_lignes;
CREATE TRIGGER trg_protect_facture_lignes
  BEFORE UPDATE OR DELETE ON facture_lignes
  FOR EACH ROW EXECUTE FUNCTION protect_facture_lignes();
-- ▲▲▲ fin inalterabilite.sql ▲▲▲


-- ▼▼▼ avoir.sql ▼▼▼
-- ═══════════════════════════════════════════════════════
-- FactuPro — Avoir (note de crédit)
-- À exécuter dans Supabase > SQL Editor > New Query
-- ═══════════════════════════════════════════════════════
-- L'avoir est le moyen LÉGAL de corriger/annuler une facture émise
-- (qui est désormais inaltérable). C'est une facture de type 'avoir'
-- avec des montants négatifs, référençant la facture d'origine.

ALTER TABLE factures ADD COLUMN IF NOT EXISTS type TEXT DEFAULT 'facture';   -- 'facture' | 'avoir'
ALTER TABLE factures ADD COLUMN IF NOT EXISTS facture_origine_id UUID REFERENCES factures(id) ON DELETE SET NULL;

-- Numérotation : préfixe A- pour les avoirs (compteur dédié)
CREATE OR REPLACE FUNCTION prochain_numero(
  p_entreprise_id UUID,
  p_type TEXT -- 'devis' | 'facture' | 'avoir'
) RETURNS TEXT AS $$
DECLARE
  v_annee INT := EXTRACT(YEAR FROM CURRENT_DATE);
  v_num INT;
  v_prefixe TEXT;
BEGIN
  v_prefixe := CASE p_type WHEN 'devis' THEN 'D' WHEN 'avoir' THEN 'A' ELSE 'F' END;

  INSERT INTO compteurs (entreprise_id, type, annee, dernier_numero)
  VALUES (p_entreprise_id, p_type, v_annee, 1)
  ON CONFLICT (entreprise_id, type, annee)
  DO UPDATE SET dernier_numero = compteurs.dernier_numero + 1
  RETURNING dernier_numero INTO v_num;

  RETURN v_prefixe || '-' || v_annee || '-' || LPAD(v_num::TEXT, 3, '0');
END;
$$ LANGUAGE plpgsql;
-- ▲▲▲ fin avoir.sql ▲▲▲


-- ▼▼▼ archivage.sql ▼▼▼
-- ═══════════════════════════════════════════════════════
-- FactuPro — Archivage / clôtures annuelles (anti-fraude TVA)
-- À exécuter dans Supabase > SQL Editor > New Query
-- ═══════════════════════════════════════════════════════
-- Clôture = figer les totaux d'une année + cumul perpétuel (grand total),
-- chaînés par hash (chaque clôture inclut le hash de la précédente).
-- Inaltérable : table en lecture seule, écrite uniquement par la fonction
-- SECURITY DEFINER. Garantit l'intégrité de la séquence (détection de toute
-- altération a posteriori).

CREATE TABLE IF NOT EXISTS clotures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entreprise_id UUID NOT NULL REFERENCES entreprises(id) ON DELETE CASCADE,
  annee INT NOT NULL,
  date_cloture TIMESTAMPTZ NOT NULL DEFAULT now(),
  nb_factures INT NOT NULL,
  total_ht NUMERIC(14,2) NOT NULL,
  total_tva NUMERIC(14,2) NOT NULL,
  total_ttc NUMERIC(14,2) NOT NULL,
  cumul_ttc NUMERIC(16,2) NOT NULL,     -- grand total perpétuel
  hash_precedent TEXT NOT NULL,
  hash TEXT NOT NULL,
  UNIQUE (entreprise_id, annee)
);

ALTER TABLE clotures ENABLE ROW LEVEL SECURITY;

-- Lecture seule pour le propriétaire ; aucune policy INSERT/UPDATE/DELETE
DROP POLICY IF EXISTS "read own clotures" ON clotures;
CREATE POLICY "read own clotures" ON clotures
  FOR SELECT USING (
    entreprise_id IN (SELECT id FROM entreprises WHERE user_id = auth.uid())
  );

-- Crée la clôture d'une année (idempotence : une seule par année)
CREATE OR REPLACE FUNCTION creer_cloture_annuelle(p_entreprise_id UUID, p_annee INT)
RETURNS clotures
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_prev clotures;
  v_ht NUMERIC; v_tva NUMERIC; v_ttc NUMERIC; v_nb INT;
  v_cumul NUMERIC; v_hash TEXT; v_prev_hash TEXT;
  v_row clotures;
BEGIN
  -- Autorisation : l'entreprise doit appartenir à l'utilisateur
  IF NOT EXISTS (SELECT 1 FROM entreprises WHERE id = p_entreprise_id AND user_id = auth.uid()) THEN
    RAISE EXCEPTION 'Non autorisé';
  END IF;

  IF EXISTS (SELECT 1 FROM clotures WHERE entreprise_id = p_entreprise_id AND annee = p_annee) THEN
    RAISE EXCEPTION 'Année % déjà clôturée', p_annee;
  END IF;

  -- Totaux de l'année (factures + avoirs ; les avoirs portent des montants négatifs)
  WITH f AS (
    SELECT fa.taux_tva,
      COALESCE((SELECT SUM(quantite * prix_unitaire) FROM facture_lignes WHERE facture_id = fa.id), 0) AS ht
    FROM factures fa
    WHERE fa.entreprise_id = p_entreprise_id
      AND EXTRACT(YEAR FROM fa.date_facture) = p_annee
  )
  SELECT COALESCE(SUM(ht), 0),
         COALESCE(SUM(ht * taux_tva / 100), 0),
         COALESCE(SUM(ht * (1 + taux_tva / 100)), 0),
         COUNT(*)
  INTO v_ht, v_tva, v_ttc, v_nb
  FROM f;

  -- Chaînage : récupère la dernière clôture (toutes années confondues)
  SELECT * INTO v_prev FROM clotures
  WHERE entreprise_id = p_entreprise_id
  ORDER BY annee DESC LIMIT 1;

  v_prev_hash := COALESCE(v_prev.hash, 'GENESIS');
  v_cumul := COALESCE(v_prev.cumul_ttc, 0) + v_ttc;
  v_hash := md5(p_annee || '|' || v_ht || '|' || v_tva || '|' || v_ttc || '|' || v_nb || '|' || v_cumul || '|' || v_prev_hash);

  INSERT INTO clotures (entreprise_id, annee, nb_factures, total_ht, total_tva, total_ttc, cumul_ttc, hash_precedent, hash)
  VALUES (p_entreprise_id, p_annee, v_nb, v_ht, v_tva, v_ttc, v_cumul, v_prev_hash, v_hash)
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;
-- ▲▲▲ fin archivage.sql ▲▲▲


-- ▼▼▼ remise.sql ▼▼▼
-- ═══════════════════════════════════════════════════════
-- FactuPro — Remise sur devis et factures
-- À exécuter dans Supabase > SQL Editor > New Query
-- ═══════════════════════════════════════════════════════
-- Remise appliquée sur le total HT : montant fixe (€) ou pourcentage (%).

ALTER TABLE devis    ADD COLUMN IF NOT EXISTS remise_type   TEXT DEFAULT 'montant';   -- 'montant' | 'pourcent'
ALTER TABLE devis    ADD COLUMN IF NOT EXISTS remise_valeur NUMERIC(12,2) DEFAULT 0;
ALTER TABLE factures ADD COLUMN IF NOT EXISTS remise_type   TEXT DEFAULT 'montant';
ALTER TABLE factures ADD COLUMN IF NOT EXISTS remise_valeur NUMERIC(12,2) DEFAULT 0;
-- ▲▲▲ fin remise.sql ▲▲▲


-- ▼▼▼ recurrences.sql ▼▼▼
-- ═══════════════════════════════════════════════════════
-- FactuPro — Récurrences + statut brouillon (facturation récurrente)
-- À exécuter dans Supabase > SQL Editor > New Query
-- ═══════════════════════════════════════════════════════
-- Une récurrence est un gabarit. Le moteur (cron) génère à chaque échéance
-- une facture en statut 'brouillon' (non émise, non numérotée, modifiable),
-- que l'artisan VALIDE ensuite (attribution du numéro + verrouillage).

-- ── 1. Gabarits de récurrence ──
CREATE TABLE IF NOT EXISTS recurrences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entreprise_id UUID NOT NULL REFERENCES entreprises(id) ON DELETE CASCADE,
  client_id UUID REFERENCES clients(id) ON DELETE SET NULL,
  libelle TEXT,
  lignes JSONB NOT NULL DEFAULT '[]',   -- [{description,quantite,unite,prix_unitaire}]
  taux_tva NUMERIC(4,2) DEFAULT 20,
  type_operation TEXT DEFAULT 'services',
  remise_type TEXT DEFAULT 'montant',
  remise_valeur NUMERIC(12,2) DEFAULT 0,
  delai_echeance INT DEFAULT 30,
  notes TEXT,
  frequence TEXT NOT NULL DEFAULT 'mensuelle',   -- mensuelle | trimestrielle | annuelle
  date_debut DATE NOT NULL,
  date_fin DATE,                                  -- fin par date (NULL = pas de date de fin définie)
  prochaine_generation DATE NOT NULL,
  statut TEXT NOT NULL DEFAULT 'active',          -- active | en_pause | terminee
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE recurrences ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "own recurrences" ON recurrences;
CREATE POLICY "own recurrences" ON recurrences
  FOR ALL USING (entreprise_id IN (SELECT id FROM entreprises WHERE user_id = auth.uid()));

-- ── 2. Liens sur les factures + brouillon ──
ALTER TABLE factures ADD COLUMN IF NOT EXISTS recurrence_id UUID REFERENCES recurrences(id) ON DELETE SET NULL;
ALTER TABLE factures ADD COLUMN IF NOT EXISTS periode TEXT;        -- ex '2026-06' (idempotence)
ALTER TABLE factures ALTER COLUMN numero DROP NOT NULL;           -- brouillon = pas encore de numéro

-- Idempotence : une seule facture par (récurrence, période)
CREATE UNIQUE INDEX IF NOT EXISTS uq_facture_recurrence_periode
  ON factures (recurrence_id, periode) WHERE recurrence_id IS NOT NULL;

-- ── 3. Inaltérabilité : EXEMPTER les brouillons ──
-- Un brouillon n'est pas une donnée émise : il reste modifiable/supprimable.
-- Le verrouillage s'applique dès que le statut n'est plus 'brouillon'.
CREATE OR REPLACE FUNCTION protect_facture()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.statut = 'brouillon' THEN RETURN OLD; END IF;   -- brouillon supprimable
    RAISE EXCEPTION 'Une facture émise ne peut pas être supprimée (inaltérabilité). Créez un avoir pour la corriger.';
  END IF;

  -- UPDATE : un brouillon reste librement modifiable (y compris sa validation)
  IF OLD.statut = 'brouillon' THEN RETURN NEW; END IF;

  IF NEW.numero        IS DISTINCT FROM OLD.numero
  OR NEW.date_facture  IS DISTINCT FROM OLD.date_facture
  OR NEW.client_id     IS DISTINCT FROM OLD.client_id
  OR NEW.entreprise_id IS DISTINCT FROM OLD.entreprise_id
  OR NEW.taux_tva      IS DISTINCT FROM OLD.taux_tva
  OR NEW.type_operation IS DISTINCT FROM OLD.type_operation
  OR NEW.devis_id      IS DISTINCT FROM OLD.devis_id THEN
    RAISE EXCEPTION 'Champs immuables d''une facture émise (inaltérabilité).';
  END IF;

  RETURN NEW;
END;
$$;

-- Lignes : modifiables uniquement tant que la facture parente est un brouillon
CREATE OR REPLACE FUNCTION protect_facture_lignes()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM factures
    WHERE id = COALESCE(NEW.facture_id, OLD.facture_id) AND statut = 'brouillon'
  ) THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  RAISE EXCEPTION 'Les lignes d''une facture émise sont inaltérables (inaltérabilité).';
END;
$$;
-- ▲▲▲ fin recurrences.sql ▲▲▲

