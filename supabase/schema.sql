-- ═══════════════════════════════════════════════════════
-- FactuPro — Schéma de base de données Supabase
-- ═══════════════════════════════════════════════════════
-- Exécuter dans Supabase > SQL Editor > New Query
-- ═══════════════════════════════════════════════════════

-- ── Profil entreprise (lié à l'auth Supabase) ──
CREATE TABLE entreprises (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL UNIQUE,
  nom TEXT NOT NULL,
  siret TEXT,
  adresse TEXT,
  tel TEXT,
  email TEXT,
  ape TEXT,
  tva_intra TEXT,
  logo_url TEXT,
  iban TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ── Clients ──
CREATE TABLE clients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entreprise_id UUID REFERENCES entreprises(id) ON DELETE CASCADE NOT NULL,
  nom TEXT NOT NULL,
  tel TEXT,
  email TEXT,
  adresse TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ── Catalogue de prestations ──
CREATE TABLE catalogue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entreprise_id UUID REFERENCES entreprises(id) ON DELETE CASCADE NOT NULL,
  categorie TEXT NOT NULL,
  description TEXT NOT NULL,
  unite TEXT NOT NULL DEFAULT 'forfait',
  prix_unitaire NUMERIC(10,2) NOT NULL DEFAULT 0,
  actif BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ── Devis ──
CREATE TABLE devis (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entreprise_id UUID REFERENCES entreprises(id) ON DELETE CASCADE NOT NULL,
  client_id UUID REFERENCES clients(id) ON DELETE SET NULL,
  numero TEXT NOT NULL, -- ex: D-2026-001
  date_devis DATE NOT NULL DEFAULT CURRENT_DATE,
  date_validite DATE NOT NULL,
  statut TEXT NOT NULL DEFAULT 'en_attente',
  -- en_attente | accepte | refuse | facture
  taux_tva NUMERIC(4,2) NOT NULL DEFAULT 10.00,
  signature_url TEXT, -- base64 ou URL stockée
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ── Lignes de devis ──
CREATE TABLE devis_lignes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  devis_id UUID REFERENCES devis(id) ON DELETE CASCADE NOT NULL,
  description TEXT NOT NULL,
  quantite NUMERIC(10,2) NOT NULL DEFAULT 1,
  unite TEXT NOT NULL DEFAULT 'forfait',
  prix_unitaire NUMERIC(10,2) NOT NULL DEFAULT 0,
  ordre INT NOT NULL DEFAULT 0
);

-- ── Factures ──
CREATE TABLE factures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entreprise_id UUID REFERENCES entreprises(id) ON DELETE CASCADE NOT NULL,
  client_id UUID REFERENCES clients(id) ON DELETE SET NULL,
  devis_id UUID REFERENCES devis(id) ON DELETE SET NULL,
  numero TEXT NOT NULL, -- ex: F-2026-001
  date_facture DATE NOT NULL DEFAULT CURRENT_DATE,
  date_echeance DATE NOT NULL,
  statut TEXT NOT NULL DEFAULT 'envoyee',
  -- envoyee | payee | en_retard
  taux_tva NUMERIC(4,2) NOT NULL DEFAULT 10.00,
  mode_paiement TEXT, -- virement | cheque | especes | cb
  date_paiement DATE,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ── Lignes de facture ──
CREATE TABLE facture_lignes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  facture_id UUID REFERENCES factures(id) ON DELETE CASCADE NOT NULL,
  description TEXT NOT NULL,
  quantite NUMERIC(10,2) NOT NULL DEFAULT 1,
  unite TEXT NOT NULL DEFAULT 'forfait',
  prix_unitaire NUMERIC(10,2) NOT NULL DEFAULT 0,
  ordre INT NOT NULL DEFAULT 0
);

-- ── Relances ──
CREATE TABLE relances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  facture_id UUID REFERENCES factures(id) ON DELETE CASCADE NOT NULL,
  date_relance DATE NOT NULL DEFAULT CURRENT_DATE,
  type TEXT NOT NULL DEFAULT 'email', -- email | courrier | tel
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ── Compteur numérotation (séquentiel sans trou) ──
CREATE TABLE compteurs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entreprise_id UUID REFERENCES entreprises(id) ON DELETE CASCADE NOT NULL,
  type TEXT NOT NULL, -- 'devis' | 'facture'
  annee INT NOT NULL,
  dernier_numero INT NOT NULL DEFAULT 0,
  UNIQUE(entreprise_id, type, annee)
);

-- ═══════════════════════════════════════════════════════
-- FONCTIONS
-- ═══════════════════════════════════════════════════════

-- Génère le prochain numéro séquentiel
CREATE OR REPLACE FUNCTION prochain_numero(
  p_entreprise_id UUID,
  p_type TEXT -- 'devis' ou 'facture'
) RETURNS TEXT AS $$
DECLARE
  v_annee INT := EXTRACT(YEAR FROM CURRENT_DATE);
  v_num INT;
  v_prefixe TEXT;
BEGIN
  v_prefixe := CASE p_type WHEN 'devis' THEN 'D' ELSE 'F' END;
  
  INSERT INTO compteurs (entreprise_id, type, annee, dernier_numero)
  VALUES (p_entreprise_id, p_type, v_annee, 1)
  ON CONFLICT (entreprise_id, type, annee)
  DO UPDATE SET dernier_numero = compteurs.dernier_numero + 1
  RETURNING dernier_numero INTO v_num;
  
  RETURN v_prefixe || '-' || v_annee || '-' || LPAD(v_num::TEXT, 3, '0');
END;
$$ LANGUAGE plpgsql;

-- Met à jour updated_at automatiquement
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_clients_updated BEFORE UPDATE ON clients FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_devis_updated BEFORE UPDATE ON devis FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_factures_updated BEFORE UPDATE ON factures FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ═══════════════════════════════════════════════════════
-- ROW LEVEL SECURITY (chaque artisan voit uniquement ses données)
-- ═══════════════════════════════════════════════════════

ALTER TABLE entreprises ENABLE ROW LEVEL SECURITY;
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE catalogue ENABLE ROW LEVEL SECURITY;
ALTER TABLE devis ENABLE ROW LEVEL SECURITY;
ALTER TABLE devis_lignes ENABLE ROW LEVEL SECURITY;
ALTER TABLE factures ENABLE ROW LEVEL SECURITY;
ALTER TABLE facture_lignes ENABLE ROW LEVEL SECURITY;
ALTER TABLE relances ENABLE ROW LEVEL SECURITY;
ALTER TABLE compteurs ENABLE ROW LEVEL SECURITY;

-- Policies entreprises
CREATE POLICY "Users see own entreprise" ON entreprises
  FOR ALL USING (user_id = auth.uid());

-- Policies clients
CREATE POLICY "Users see own clients" ON clients
  FOR ALL USING (entreprise_id IN (SELECT id FROM entreprises WHERE user_id = auth.uid()));

-- Policies catalogue
CREATE POLICY "Users see own catalogue" ON catalogue
  FOR ALL USING (entreprise_id IN (SELECT id FROM entreprises WHERE user_id = auth.uid()));

-- Policies devis
CREATE POLICY "Users see own devis" ON devis
  FOR ALL USING (entreprise_id IN (SELECT id FROM entreprises WHERE user_id = auth.uid()));

-- Policies devis_lignes
CREATE POLICY "Users see own devis_lignes" ON devis_lignes
  FOR ALL USING (devis_id IN (SELECT id FROM devis WHERE entreprise_id IN (SELECT id FROM entreprises WHERE user_id = auth.uid())));

-- Policies factures
CREATE POLICY "Users see own factures" ON factures
  FOR ALL USING (entreprise_id IN (SELECT id FROM entreprises WHERE user_id = auth.uid()));

-- Policies facture_lignes
CREATE POLICY "Users see own facture_lignes" ON facture_lignes
  FOR ALL USING (facture_id IN (SELECT id FROM factures WHERE entreprise_id IN (SELECT id FROM entreprises WHERE user_id = auth.uid())));

-- Policies relances
CREATE POLICY "Users see own relances" ON relances
  FOR ALL USING (facture_id IN (SELECT id FROM factures WHERE entreprise_id IN (SELECT id FROM entreprises WHERE user_id = auth.uid())));

-- Policies compteurs
CREATE POLICY "Users see own compteurs" ON compteurs
  FOR ALL USING (entreprise_id IN (SELECT id FROM entreprises WHERE user_id = auth.uid()));

-- ═══════════════════════════════════════════════════════
-- MIGRATIONS
-- ═══════════════════════════════════════════════════════
-- À exécuter si la base existe déjà :
-- ALTER TABLE entreprises ADD COLUMN IF NOT EXISTS iban TEXT;

-- ═══════════════════════════════════════════════════════
-- DONNÉES DE DÉMO (optionnel, à supprimer en prod)
-- ═══════════════════════════════════════════════════════
-- Les données de démo seront créées automatiquement
-- lors de la première inscription d'un utilisateur
-- via la fonction seed_demo_data() dans l'app.
