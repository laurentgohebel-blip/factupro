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
