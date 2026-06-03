# ⚡ FactuPro — Déploiement Azure 100% Gratuit

Application de devis & facturation pour artisans.
Hébergée sur Azure, base de données sur Supabase. **Coût : 0€/mois.**

## Architecture

```
┌──────────────────────────┐     ┌──────────────────────┐
│  Azure Static Web Apps   │     │     Supabase (free)   │
│  ┌────────────────────┐  │     │  ┌────────────────┐  │
│  │   React / Vite     │──┼─────┼─▸│  PostgreSQL     │  │
│  │   PWA installable  │  │     │  │  Auth (JWT)     │  │
│  └────────────────────┘  │     │  │  Row Level Sec. │  │
│        GRATUIT           │     │  └────────────────┘  │
└──────────────────────────┘     │       GRATUIT         │
                                 └──────────────────────┘
```

| Service | Rôle | Coût |
|---------|------|------|
| Azure Static Web Apps | Hébergement frontend + PWA | **Gratuit** |
| Supabase | BDD PostgreSQL + Auth + RLS | **Gratuit** (500 MB) |
| GitHub Actions | CI/CD automatique | **Gratuit** |

---

## 🚀 Déploiement en 15 minutes

### Étape 1 — Créer la base Supabase (5 min)

1. Va sur [supabase.com](https://supabase.com) → **Start your project** (gratuit)
2. Crée un nouveau projet, choisis une région EU (ex: Frankfurt)
3. Attends ~2 min que le projet se crée
4. Va dans **SQL Editor** → **New Query**
5. Copie-colle le contenu de `supabase/schema.sql` → clique **Run**
6. Va dans **Settings** → **API** et note :
   - **Project URL** : `https://xxxx.supabase.co`
   - **anon public key** : `eyJhbG...`

### Étape 2 — Configurer l'auth Supabase (1 min)

1. Dans Supabase → **Authentication** → **Providers**
2. Vérifie que **Email** est activé (c'est le cas par défaut)
3. C'est tout ! L'inscription et la connexion marchent.

### Étape 3 — Tester en local (3 min)

```bash
cd factupro

# Installer
npm install

# Configurer
cp .env.example .env
# Éditer .env avec ton URL et ta clé Supabase

# Lancer
npm run dev
```

Ouvre http://localhost:5173 → crée un compte → c'est parti !

### Étape 4 — Push sur GitHub (2 min)

```bash
git init
git add .
git commit -m "FactuPro v1"
git remote add origin https://github.com/TON_USER/factupro.git
git push -u origin main
```

### Étape 5 — Créer Azure Static Web App (5 min)

1. Va sur [portal.azure.com](https://portal.azure.com) (compte gratuit)
2. Cherche **Static Web Apps** → **Create**
3. Remplis :
   - **Subscription** : ton abonnement
   - **Resource group** : `factupro-rg` (Create new)
   - **Name** : `factupro`
   - **Plan** : **Free**
   - **Region** : `West Europe`
   - **Source** : **GitHub** → autorise → sélectionne ton repo
   - **Build preset** : **Custom**
   - **App location** : `/`
   - **Output location** : `dist`
4. Clique **Review + Create** → **Create**

Azure crée automatiquement un GitHub Action et lance le premier déploiement.

### Étape 6 — Ajouter les secrets GitHub (2 min)

Dans ton repo GitHub → **Settings** → **Secrets and variables** → **Actions** :

| Secret | Valeur |
|--------|--------|
| `VITE_SUPABASE_URL` | `https://xxxx.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | `eyJhbG...` |

Le token Azure (`AZURE_STATIC_WEB_APPS_API_TOKEN`) est ajouté automatiquement par Azure.

### Étape 7 — Redéployer (1 min)

```bash
git commit --allow-empty -m "trigger deploy"
git push
```

Ton app est en ligne sur `https://factupro-xxxx.azurestaticapps.net` 🎉

### Étape 8 — Configurer Supabase redirect (1 min)

Dans Supabase → **Authentication** → **URL Configuration** :
- **Site URL** : `https://factupro-xxxx.azurestaticapps.net`
- **Redirect URLs** : ajoute la même URL

---

## 📁 Structure

```
factupro/
├── .github/workflows/
│   └── deploy.yml             ← CI/CD Azure
├── supabase/
│   └── schema.sql             ← Schéma BDD (9 tables + RLS)
├── src/
│   ├── components/
│   │   └── FactuPro.jsx       ← UI complète
│   ├── lib/
│   │   ├── supabase.js        ← Client Supabase
│   │   ├── auth.jsx           ← Contexte auth
│   │   └── data.js            ← Hooks CRUD
│   ├── pages/
│   │   └── Login.jsx          ← Page connexion
│   ├── App.jsx
│   └── main.jsx
├── staticwebapp.config.json   ← Config Azure SWA
├── vite.config.js             ← Vite + PWA
└── .env.example
```

---

## 📱 Installer sur téléphone (PWA)

1. Ouvre l'app dans Chrome sur mobile
2. Menu ⋮ → **Ajouter à l'écran d'accueil**
3. L'icône ⚡ apparaît — ça fonctionne comme une app native

---

## 🔒 Sécurité

- **Supabase RLS** : chaque artisan ne voit que ses données
- **JWT** : tokens signés, refresh automatique
- **Numérotation** : séquentielle sans trou (fonction PostgreSQL)
- **HTTPS** : automatique sur Azure Static Web Apps

---

## 💰 Limites du gratuit

| Service | Limite gratuite | Suffisant pour... |
|---------|----------------|-------------------|
| Azure SWA | 100 GB bande passante/mois | ~10 000 utilisateurs |
| Supabase | 500 MB stockage, 50k auth/mois | ~500 artisans |
| GitHub Actions | 2000 min/mois | Déploiements illimités |

Quand tu dépasses, Supabase Pro = 25$/mois, Azure SWA Standard = 9$/mois.

---

## 🛣️ Roadmap

- [ ] Envoi email de relance (Supabase Edge Functions + Resend)
- [ ] Export comptable FEC
- [ ] Acomptes et paiements partiels
- [ ] Photos chantier
- [ ] Domaine personnalisé (factupro.fr)

---

Fait avec ⚡ — 0€/mois pour démarrer.
