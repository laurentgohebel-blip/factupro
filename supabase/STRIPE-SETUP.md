# Configuration Stripe — Abonnement Pro (Phase 1)

Suis ces étapes **dans l'ordre**. Tout se fait en **mode Test** d'abord (aucun vrai paiement).

> ⚠️ Ne colle JAMAIS tes clés Stripe dans un chat. Elles vont uniquement
> dans le dashboard Stripe et les secrets Supabase.

---

## 1. Créer le compte Stripe
1. Va sur https://stripe.com → **Démarrer**
2. Crée ton compte (email + mot de passe). Le **mode Test** est actif par défaut (interrupteur en haut à droite).

## 2. Créer le produit "FactuPro Pro"
1. Dashboard Stripe → **Produits** → **+ Ajouter un produit**
2. Nom : `FactuPro Pro`
3. Tarif : **Récurrent**, `9,00 €`, période **Mensuel**
4. Enregistre → clique sur le tarif créé → **copie l'ID du tarif** (commence par `price_...`)

## 3. Récupérer la clé secrète
1. Dashboard Stripe → **Développeurs** → **Clés API**
2. Copie la **Clé secrète** (`sk_test_...`)

## 4. Lancer le SQL
Dans Supabase → **SQL Editor** → colle le contenu de `supabase/stripe-setup.sql` → **Run**.

## 5. Déployer les 3 Edge Functions
Dans Supabase → **Edge Functions**, crée/déploie (copier-coller du code) :
- `create-checkout-session`
- `customer-portal`
- `stripe-webhook` → **⚠️ désactive "Verify JWT"** pour celle-ci uniquement
  (Stripe l'appelle sans token utilisateur ; la sécurité vient de la signature).

## 6. Ajouter les secrets Supabase
Supabase → **Edge Functions** → **Manage secrets** → ajoute :
| Nom | Valeur |
|-----|--------|
| `STRIPE_SECRET_KEY` | `sk_test_...` (étape 3) |
| `STRIPE_PRICE_PRO` | `price_...` (étape 2) |
| `STRIPE_WEBHOOK_SECRET` | `whsec_...` (étape 7) |

> `SUPABASE_URL`, `SUPABASE_ANON_KEY` et `SUPABASE_SERVICE_ROLE_KEY` sont
> injectés automatiquement par Supabase — pas besoin de les ajouter.

## 7. Créer le webhook Stripe
1. Dashboard Stripe → **Développeurs** → **Webhooks** → **+ Ajouter un endpoint**
2. URL : `https://nbbqteyqxzaseaecibss.supabase.co/functions/v1/stripe-webhook`
3. Événements à écouter :
   - `checkout.session.completed`
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
4. Crée l'endpoint → **copie le "Secret de signature"** (`whsec_...`)
5. Mets-le dans le secret Supabase `STRIPE_WEBHOOK_SECRET` (étape 6) → redéploie la fonction `stripe-webhook`.

## 8. Tester
1. Ouvre l'app → **Profil** → **Passer à Pro**
2. Sur la page Stripe, paie avec la carte de test : `4242 4242 4242 4242`, date future, CVC `123`
3. Retour sur l'app → le profil doit passer à **⭐ FactuPro Pro** (quelques secondes le temps du webhook).
4. Vérifie dans Supabase → table `subscriptions` que `plan = 'pro'`.

## Passage en production (plus tard)
- Bascule Stripe en mode **Live**, recrée le produit + webhook en Live,
  remplace les secrets par les clés `sk_live_...` / `whsec_...` Live.
