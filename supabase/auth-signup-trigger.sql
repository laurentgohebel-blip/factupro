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
