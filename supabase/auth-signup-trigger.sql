-- ═══════════════════════════════════════════════════════
-- FactuPro — Création automatique de l'entreprise à l'inscription
-- À exécuter dans Supabase > SQL Editor > New Query
-- ═══════════════════════════════════════════════════════
-- Corrige l'échec d'inscription "violates row-level security" : on ne crée
-- plus l'entreprise côté client (pas de session si email à confirmer), mais
-- via un trigger SECURITY DEFINER sur auth.users qui bypasse la RLS.
-- Le nom / SIRET sont lus depuis les métadonnées d'inscription (options.data).
-- Le trigger entreprises -> subscriptions (free) se déclenche ensuite en cascade.

CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  v_ent_id UUID;
BEGIN
  INSERT INTO entreprises (user_id, nom, siret, email)
  VALUES (
    NEW.id,
    COALESCE(NULLIF(NEW.raw_user_meta_data->>'nom', ''), 'Mon entreprise'),
    COALESCE(NEW.raw_user_meta_data->>'siret', ''),
    NEW.email
  )
  RETURNING id INTO v_ent_id;

  -- Catalogue de démarrage
  INSERT INTO catalogue (entreprise_id, categorie, description, unite, prix_unitaire) VALUES
    (v_ent_id, 'Déplacement', 'Déplacement zone locale', 'forfait', 45),
    (v_ent_id, 'Déplacement', 'Déplacement hors zone', 'forfait', 75),
    (v_ent_id, 'Main d''œuvre', 'Main d''œuvre qualifiée', 'heure', 55),
    (v_ent_id, 'Main d''œuvre', 'Main d''œuvre apprenti', 'heure', 30);

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();
