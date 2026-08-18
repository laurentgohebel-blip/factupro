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
