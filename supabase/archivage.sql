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
