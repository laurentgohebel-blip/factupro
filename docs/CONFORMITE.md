# Plan de conformité — FactuPro

> Dernière mise à jour : 2026-06-12
> ⚠️ Document de travail, pas un avis juridique. Le calendrier de la réforme a déjà
> été reporté plusieurs fois — à faire valider par un expert-comptable et via les
> sources officielles ([impots.gouv.fr](https://www.impots.gouv.fr/facturation-electronique-et-plateformes-agreees)).

---

## 1. Contexte réglementaire (mi-2026)

### Réforme de la facturation électronique (B2B domestique)
- **1er sept. 2026** : toutes les entreprises assujetties à la TVA doivent pouvoir
  **recevoir** des factures électroniques via une **Plateforme Agréée (PA, ex-PDP)**.
  Les grandes entreprises et ETI doivent **émettre**.
- **1er sept. 2027** : les **TPE / PME / micro-entreprises** (= la cible de FactuPro)
  doivent **émettre** leurs factures électroniques + faire de l'**e-reporting**.

### Modèle (modifié fin 2024)
Le portail public gratuit (PPF) a été abandonné pour l'échange de factures. Désormais
**tout transite par une Plateforme Agréée** immatriculée par l'État ; le PPF n'est plus
qu'un annuaire / infrastructure de supervision. Un logiciel de facturation est une
**« Solution Compatible » (SC, ex-OD)** : il peut *produire* des factures conformes
mais **ne peut pas transmettre lui-même les données fiscales à l'administration** — il
doit se connecter à une PA.

### Formats conformes (norme EN 16931)
- **Factur-X** : PDF/A-3 avec XML embarqué (le plus répandu chez les TPE/PME).
- **UBL** et **CII** : XML pur.

### Nouvelles mentions obligatoires (à partir du 1er sept. 2026)
- **SIREN/SIRET du client** (SIRET préféré).
- **Type d'opération** : livraison de biens / prestation de services / mixte.
- **Option pour le paiement de la TVA d'après les débits** (si applicable).
- **Adresse de livraison** si différente de l'adresse de facturation.

### Autres obligations (déjà en vigueur, indépendantes de la réforme)
- **Loi anti-fraude TVA** (art. 286-I-3°bis CGI, depuis 2018) : un logiciel qui
  enregistre des paiements (notamment B2C) doit garantir **inaltérabilité,
  sécurisation, conservation, archivage** et l'éditeur doit pouvoir fournir une
  **attestation individuelle de conformité** (ou certification type NF525).
- **Conservation / archivage** : 10 ans (Code de commerce), intégrité garantie.
- **RGPD** : données personnelles des clients.

---

## 2. Diagnostic de l'existant

| Élément | État | Détail |
|--------|------|--------|
| Numérotation séquentielle sans rupture | ✅ | `prochain_numero` (RPC) |
| Mentions légales de base | ✅ | pénalités L.441-10, SIRET vendeur, TVA, échéance |
| Factur-X réel (PDF/A-3 + XML embarqué) | ❌ | PDF (jsPDF) et XML CII **séparés** ; `downloadFacturX` télécharge un `.xml` à part → **non conforme** |
| SIREN/SIRET du **client** | ❌ | non collecté ni affiché (nouvelle mention 2026) |
| Type d'opération paramétrable | ⚠️ | codé en dur « Prestation de services » |
| Connexion à une Plateforme Agréée | ❌ | inexistante (cœur de la réforme) |
| E-reporting (B2C / international) | ❌ | inexistant — or les artisans font beaucoup de B2C |
| Statuts du cycle de vie de la facture | ❌ | inexistants |
| Inaltérabilité / attestation éditeur | ❌ | factures librement modifiables/supprimables (Supabase) ; pas de piste d'audit |
| Affirmations « conforme » (Landing) | ⚠️ | surpromesses (« Factur-X EN 16931 », « conforme aux obligations légales ») → risque tant que non vrai |

Fichiers concernés (repère) : `src/components/FactuPro.jsx`
(`generateFacturXml`, `downloadFacturX`, `generatePDFAttachment`, mentions dans
`generatePDFHtml`), `src/pages/Landing.jsx`, `src/lib/data.js`.

---

## 3. Décision stratégique clé

**Devenir Plateforme Agréée soi-même → NON** (immatriculation, audits, infrastructure,
sécurité, coûts élevés : hors de portée d'une TPE-SaaS).

**➡️ Recommandation : s'intégrer à une Plateforme Agréée existante via API.**
FactuPro reste une « Solution Compatible » branchée sur une PA partenaire (émission,
réception, e-reporting, et souvent génération du Factur-X). C'est le choix nº 1 qui
conditionne tout le reste.

---

## 4. Plan en phases

### Phase 0 — Immédiat (déjà obligatoire)
- [ ] **Inaltérabilité** : verrouiller une facture « validée/émise » (interdire
      modif/suppression ; corriger via avoir/annulation). Statut `validee`/`emise` figé.
- [ ] **Piste d'audit** : journal horodaté des opérations (création, validation, paiement, avoir).
- [ ] **Attestation éditeur** (loi anti-fraude TVA) : document + garanties techniques.
- [ ] **Mentions** : collecter et afficher le **SIREN/SIRET client** ; rendre le **type d'opération** paramétrable.
- [ ] **Honnêteté marketing** : retirer/atténuer « Factur-X / conforme » de la Landing tant que non réel.

### Phase 1 — Avant sept. 2026 (réception + émission structurée)
- [ ] **Vrai Factur-X** : PDF/A-3 avec XML EN 16931 **embarqué** (un seul fichier).
- [ ] **Réception** de factures électroniques via la PA (ingestion + affichage).
- [ ] Compléter les mentions 2026 (option TVA sur les débits, adresse de livraison conditionnelle).

### Phase 2 — Avant sept. 2027 (émission + e-reporting)
- [ ] **Émission** via la PA (transmission au format structuré + résolution annuaire destinataire).
- [ ] **E-reporting** des opérations B2C / internationales + données de paiement (encaissement).
- [ ] **Statuts du cycle de vie** (déposée, rejetée, encaissée…) synchronisés avec la PA.

### Transverse
- [ ] **Archivage légal** (conservation 10 ans, intégrité).
- [ ] **RGPD** (registre, durées de conservation, droit à l'effacement, sous-traitants).

---

## 5. Prochaine action

Lancer une **étude comparative des Plateformes Agréées** proposant une API éditeur
(critères : API émission/réception/e-reporting, génération Factur-X, formats supportés,
tarifs éditeur/volume, support, statut d'immatriculation). Ce choix débloque les Phases 1 et 2.

---

## Sources
- [impots.gouv.fr — facturation électronique et plateformes agréées](https://www.impots.gouv.fr/facturation-electronique-et-plateformes-agreees)
- [economie.gouv.fr — ouverture de l'annuaire](https://www.economie.gouv.fr/actualites/facturation-electronique-ouverture-de-lannuaire-dedie)
- [Bpifrance — réforme à anticiper 2026](https://conseil.bpifrance.fr/publications/facturation-electronique-obligatoire-un-tournant-digital-pour-les-entreprises-francaises)
- [Cegid — calendrier 2026-2027](https://www.cegid.com/fr/facture-electronique-obligatoire/calendrier-facture-electronique/)
- [KPMG Avocats — modification du schéma PPF/PDP (oct. 2024)](https://kpmg.com/av/fr/avocats/eclairages/2024/10/facturation-electronique-le-schema-initialement-prevu-est-modifie.html)
