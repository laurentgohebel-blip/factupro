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
