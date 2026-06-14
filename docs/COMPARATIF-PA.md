# Comparatif Plateformes Agréées (PA) — choix pour FactuPro

> Dernière mise à jour : 2026-06-12
> ⚠️ Base de travail, pas un avis juridique/commercial. Vérifier l'immatriculation
> et les conditions à jour auprès de chaque fournisseur et sur les sources officielles.

## 1. Rappel du besoin

FactuPro est une **« Solution Compatible »** : il produit des factures conformes mais
**ne peut pas transmettre lui-même** les données à l'administration. Il doit se
**connecter par API à une Plateforme Agréée (PA, ex-PDP)** qui gère :
- l'**émission** (transmission au destinataire via l'annuaire + format structuré) ;
- la **réception** des factures fournisseurs ;
- l'**e-reporting** (B2C / international + données de paiement) ;
- les **statuts du cycle de vie**.

> ❗ Devenir PA soi-même = exclu (immatriculation, audits, infrastructure, coûts).
> On **s'intègre** à une PA partenaire.

## 2. Critères de choix

| Critère | Pourquoi c'est important |
|--------|--------------------------|
| **API émission + réception + e-reporting** | Couvre les 3 obligations (les artisans font beaucoup de B2C → e-reporting indispensable) |
| **Génération Factur-X (PDF/A-3 + XML EN 16931)** | Évite de devoir construire le Factur-X soi-même |
| **Formats** Factur-X / UBL / CII | Interopérabilité avec les autres PA |
| **Modèle éditeur / white-label** | Intégration transparente sous la marque FactuPro |
| **Tarification au volume** | Adaptée à des TPE à faible volume (coût par facture/par entreprise) |
| **Statut d'immatriculation** | Doit être immatriculée (ou « sous réserve ») par la DGFiP |
| **Hébergement FR/UE + sécurité** | Cohérent avec l'hébergement Europe actuel (RGPD) |
| **Conformité API XP Z12-013** | Standard d'API officiel pour relier les SI aux PA |
| **Sandbox de test** | Pouvoir intégrer/tester avant de s'engager |
| **Support / documentation** | Critique pour un éditeur solo |

## 3. Candidates orientées API / éditeur (à creuser)

> Liste **non exhaustive** et **non un classement** : ce sont des PA positionnées
> « API-first » / éditeur, à mettre en concurrence. À confirmer (immatriculation, prix).

- **IOPOLE** — positionnement API-first, offre **white-label** pour éditeurs, formats UBL/CII/Factur-X, émission/réception/e-reporting. A priori un bon candidat pour un SaaS.
- **Docoon** — propose une **Plateforme Agréée en marque blanche**.
- **B2BRouter** — orienté intégration/API, expérience Factur-X et international.
- **Comarch** — acteur établi, API e-invoicing (plutôt orienté ETI/grands comptes).

Autres familles (souvent orientées utilisateur final plutôt qu'éditeur, à vérifier s'ils
ouvrent une API éditeur) : Pennylane, Qonto, Sage, Cegid, Sellsy, etc.

## 4. Le standard d'API XP Z12-013

Un référentiel d'API (norme **XP Z12-013**) cadre les échanges SI ↔ PA (sécurité,
temps réel, formats). Privilégier une PA qui s'y conforme pour limiter le couplage à un
seul fournisseur et faciliter un éventuel changement de PA plus tard.

## 5. Sources officielles (liste à jour des PA)

- **impots.gouv.fr** — [facturation électronique et plateformes agréées](https://www.impots.gouv.fr/facturation-electronique-et-plateformes-agreees)
- **data.gouv.fr** — [jeu de données des PA immatriculées (DGFiP enrichi)](https://www.data.gouv.fr/datasets/plateformes-agreees-pa-ex-pdp-pour-la-facturation-electronique-liste-dgfip-enrichie-2026)
- **economie.gouv.fr** — [annonce de la liste des plateformes agréées](https://www.economie.gouv.fr/actualites/facturation-electronique-la-liste-des-101-premieres-plateformes-agreees-est-disponible)

> Au printemps 2026, ~130+ PA immatriculées (ou sous réserve).

## 6. Recommandation / prochaine action

1. **Présélectionner 2-3 PA API-first / éditeur** (ex. IOPOLE, Docoon, B2BRouter) en
   vérifiant leur **immatriculation** sur la liste officielle.
2. **Demander un devis éditeur** (modèle de prix au volume / par entreprise cliente) et
   l'**accès sandbox** + la **doc API** (émission, réception, e-reporting, statuts, Factur-X).
3. **Évaluer l'intégration** : effort pour brancher l'API depuis les Edge Functions
   Supabase, génération Factur-X côté PA ou côté FactuPro, gestion de l'annuaire.
4. **Décider**, puis lancer la **Phase 1** (#17 : vrai Factur-X + réception) puis la
   **Phase 2** (#18 : émission + e-reporting + statuts).

> Critère décisif pour FactuPro (TPE, faible volume, éditeur solo) : **API claire +
> e-reporting B2C + tarif au volume raisonnable + bonne doc/sandbox**.

---

Sources : [Pennylane — liste des PA](https://www.pennylane.com/fr/fiches-pratiques/facture-electronique/liste-des-pdp) ·
[Tool-Advisor — liste des PA](https://tool-advisor.fr/logiciel-facturation/comparatif/liste-pa-plateforme-agree/) ·
[IOPOLE — facturation par API](https://www.iopole.com/en/pdp-france) ·
[B2BRouter — Factur-X](https://www.b2brouter.net/global/factur-x-accounting-and-it/) ·
[Comarch — réforme France / API](https://www.comarch.com/trade-and-services/data-management/legal-regulation-changes/france-advances-b2b-e-invoicing-reform-with-new-api-standard/)
