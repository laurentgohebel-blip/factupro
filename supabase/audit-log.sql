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
