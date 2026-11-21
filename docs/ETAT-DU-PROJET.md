# FactuPro — État du projet (synthèse)

> Document de reprise. Dernière MàJ : 2026-06 (version app **b37**).
> But : permettre de reprendre le projet sans relire tout l'historique.

## 1. Vue d'ensemble
SaaS de **devis & facturation pour artisans français**.
- **Front** : React 18 + Vite (SPA, React Router), PWA installable.
- **Back** : Supabase (Postgres + RLS, Auth, Edge Functions Deno, pg_cron).
- **Hébergement** : Azure Static Web Apps (déployé depuis la branche `main` via GitHub Actions). **URL de prod** : https://thankful-hill-0596efe10.8.azurestaticapps.net (app sous `/app`). L'ancienne app `calm-ocean-0b2292a10.2.azurestaticapps.net` est **abandonnée** (plus déployée depuis nov. 2026, figée sur une vieille version) — ne pas s'y fier.
- **Emails** : Resend (domaine d'envoi `osmosetechnologies.fr`, secret `FROM_ADDRESS` ; l'ancien `synapserh.fr` n'est plus utilisé). **Paiement** : Stripe (abonnement).

## 2. ⚠️ À savoir avant de coder
- **Dépôt** : `…\Documents\Dev info\Synapse\factupro-azure-free` (le projet a été déplacé ; un ancien chemin sans `Synapse` peut traîner — ignorer). Remote GitHub : `laurentgohebel-blip/factupro`.
- **Édition GitHub directe** : le propriétaire édite parfois sur GitHub entre deux sessions → **toujours `git pull` d'abord**.
- **Marqueur de version** : un tag `b NN` (ex. `b41`) est affiché dans l'en-tête de l'app (sous « ⚡ FactuPro »). **À incrémenter à chaque changement front** — sert à détecter le **cache PWA** sur mobile (si le fix « ne marche pas », vérifier ce numéro avant tout).
- **Statut des factures** : en base, `statut = 'envoyee'` est posé dès l'émission (numérotation), pas à l'envoi. L'affichage est dérivé dans `normFacture` : `envoyee` sans `date_envoi` → badge **« Émise »** ; avec `date_envoi` → « Envoyée » ; échéance dépassée → « En retard ». Ne pas changer la valeur en base (les relances et le cron filtrent dessus).
- **`persistSession: false`** : la session Supabase est en mémoire (déconnexion au refresh). Les allers-retours externes (Stripe) stashent/restaurent la session via `sessionStorage` (voir `auth.jsx`).
- **PDF** : la pièce jointe email côté app est en **jsPDF natif** (PAS html2canvas → il rend blanc sur mobile). Côté serveur (auto-envoi récurrent), le PDF est en **pdf-lib** (Deno, sans DOM).
- **Ne jamais** réintroduire d'insert d'entreprise côté client après signup (RLS) → passe par le trigger `handle_new_user`.

## 3. Fonctionnalités livrées
**Devis** : création, **édition** (tant que « en attente »), duplication, PDF, email, **signature électronique** publique (`/sign/:id`, mise à jour live via Realtime), acceptation/refus.
**Factures** : création directe, depuis devis, **duplication**, marquer payée, PDF, email, **avoir** (total ou partiel), **inaltérabilité** (verrouillage à l'émission), **brouillon → valider**.
**Récurrences** : gabarits (fréquence mens./trim./ann., début/fin), génération auto quotidienne (cron) en **brouillon** ou **auto-envoi** (facture émise + email + PDF joint). Réservé **Pro**.
**Remises** (€ ou %), **logo** entreprise sur les documents, **type d'opération** + **SIRET client** (mentions 2026), tri chronologique.
**Relances** : en 1 clic par email (Pro). Auto planifiées = **code prêt, non déployé**.
**Abonnement Stripe** : Free (5 devis + 5 factures/mois) / Pro 9€, quota gating, portail client.
**Conformité anti-fraude** : inaltérabilité, **piste d'audit** (journal chaîné), **clôtures annuelles** chaînées par hash, export RGPD, **attestation éditeur** (modèle). Voir `docs/CONFORMITE.md`.

## 4. Backend Supabase

### Migrations SQL (dans `supabase/`)
Tout est regroupé et idempotent dans **`setup-complet.sql`** (à lancer en une fois, hors initial et hors cron). Ordre : stripe-setup → auth-signup-trigger → conformite-mentions → audit-log → inalterabilite → avoir → archivage → remise → recurrences.
- En plus : `ALTER TABLE recurrences ADD COLUMN IF NOT EXISTS auto_envoi BOOLEAN DEFAULT false;` (inclus dans recurrences.sql).
- **Realtime** (à part) : `alter publication supabase_realtime add table devis;`
- **Cron** (à part, exigent `CRON_SECRET` + fonctions déployées) : `relances-auto-cron.sql`, `recurrences-cron.sql`.

### Edge Functions (dashboard) — réglage « Verify JWT »
| Fonction | JWT | Déployée | Rôle |
|----------|-----|----------|------|
| `get-devis-public` | OFF | ✅ | lecture devis pour page signature |
| `save-signature-public` | OFF | ✅ | enregistre signature / refus |
| `send-email` | ON | ✅ | envoi email (Resend) |
| `create-checkout-session` | ON | ✅ | Stripe checkout abonnement |
| `customer-portal` | ON | ✅ | portail Stripe |
| `stripe-webhook` | **OFF** | ✅ | maj plan (signature Stripe) |
| `generer-factures-recurrentes` | **OFF** | ✅ | cron récurrences (brouillon/auto-envoi + PDF) |
| `relance-auto` | OFF | ❌ **à déployer** | cron relances échelonnées J+7/15/30 |

### Secrets Supabase
`STRIPE_SECRET_KEY`, `STRIPE_PRICE_PRO`, `STRIPE_WEBHOOK_SECRET`, `RESEND_API_KEY` (⚠️ nommé **`Resend email`** dans le dashboard — le code lit les deux), `CRON_SECRET`, `FROM_EMAIL` (optionnel). Les `SUPABASE_*` sont auto-injectés.

### Cron actifs (pg_cron)
- `generer-factures-recurrentes` : **actif**, tous les jours 07:00 UTC.
- `relances-auto-quotidiennes` : à programmer (après déploiement de `relance-auto`).

## 5. Reste à faire (dépend du propriétaire)
- **Relances auto** : **volontairement non déployées** (décision du propriétaire, nov. 2026 : coût). Ne pas déployer `relance-auto` ni lancer `relances-auto-cron.sql` sans son accord ; les relances se font à la main depuis l'app. Un rappel quotidien (tâche planifiée) existe.
- **Attestation éditeur** : compléter/valider juridiquement/signer `docs/ATTESTATION-CONFORMITE.md`.
- **Phase 1/2 conformité** : vrai Factur-X (PDF/A-3 + XML EN 16931) + réception + e-reporting → nécessite de **choisir une Plateforme Agréée** (cf. `docs/COMPARATIF-PA.md`).
- **Stripe Connect** (Phase 2 paiement) : encaissement des clients de l'artisan.
- **Passage prod Stripe** : basculer en mode Live (produit + webhook + clés `sk_live`/`whsec` Live).
- **Idées** : remises (fait), auto-envoi récurrent (fait), avoir partiel (fait). À venir éventuel : logo hébergé (Storage) pour l'email.

## 6. Déploiement
- **Front** : `git push origin main` → GitHub Actions build (Vite) → Azure. **Un seul workflow : `.github/workflows/deploy.yml`** ; le secret GitHub `AZURE_STATIC_WEB_APPS_API_TOKEN` contient le jeton de déploiement de l'app `thankful-hill`. Si Azure rajoute un workflow `azure-static-web-apps-*.yml`, le supprimer (doublon, échoue : mauvais dossier de sortie et pas de variables Supabase). Erreur « No matching Static Web App was found or the api key was invalid » = jeton périmé → le recopier depuis Azure (Vue d'ensemble → Gérer le jeton de déploiement). `staticwebapp.config.json` est dans **`public/`** (sinon les liens profonds type `/sign/*` renvoient une 404 Azure).
- **Edge Functions / SQL** : manuels via le dashboard Supabase (le CLI ne tourne pas dans l'environnement de dev).
- **Si l'URL du site change** : mettre à jour Supabase → Authentication → URL Configuration (Site URL + Redirect URLs), le secret `APP_URL` des Edge Functions (retours Stripe : `create-checkout-session`, `customer-portal`), et réinstaller la PWA.

## 7. Docs de référence
- `docs/CONFORMITE.md` — plan de conformité facturation électronique.
- `docs/COMPARATIF-PA.md` — choix d'une Plateforme Agréée.
- `docs/RGPD.md` — registre traitements / droits.
- `docs/ATTESTATION-CONFORMITE.md` — modèle attestation éditeur.
- `supabase/setup-complet.sql` — toutes les migrations d'un coup.
