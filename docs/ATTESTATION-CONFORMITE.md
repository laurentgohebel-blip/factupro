# Attestation individuelle de conformité — FactuPro

> ⚠️ **MODÈLE À COMPLÉTER, VALIDER JURIDIQUEMENT ET SIGNER.**
> Ce document est un brouillon technique. Il engage la responsabilité de l'éditeur :
> à faire relire par un conseil (avocat / expert-comptable) avant diffusion aux clients.

---

## Attestation de conformité d'un logiciel de facturation
### au regard de la loi anti-fraude à la TVA (art. 286-I-3° bis du CGI)

Je soussigné(e) **[Nom Prénom du signataire]**, agissant en qualité de **[fonction]**
de la société **[Raison sociale de l'éditeur]**, SIRET **[SIRET]**, dont le siège est
situé **[adresse]**,

**éditeur du logiciel de facturation « FactuPro »** (version **[n° de version / build]**),

atteste que ce logiciel satisfait aux conditions d'**inaltérabilité, de sécurisation,
de conservation et d'archivage** des données prévues par le 3° bis du I de l'article
286 du Code général des impôts (doctrine : BOI-TVA-DECLA-30-10-30).

### 1. Inaltérabilité
Les données de règlement enregistrées sont **inaltérables** :
- une facture émise ne peut plus être **supprimée** ni voir ses champs essentiels
  (numéro, date, client, taux de TVA, type d'opération) **modifiés** (contrôles au
  niveau de la base de données) ;
- les lignes d'une facture émise sont **figées** ;
- toute correction s'effectue exclusivement par l'émission d'un **avoir** (note de crédit).

### 2. Sécurisation
- Numérotation **séquentielle, chronologique et sans rupture** (compteur dédié par
  type de document et par année).
- **Piste d'audit** : journal horodaté et **inaltérable** des opérations (création,
  changement de statut, paiement, avoir) — table en écriture réservée à des procédures
  internes, en lecture seule pour l'utilisateur.
- **Cloisonnement des données** par utilisateur (Row Level Security) : chaque
  professionnel n'accède qu'à ses propres données.
- Données chiffrées **en transit** (HTTPS) et **au repos**, hébergées dans l'Union
  européenne.

### 3. Conservation
Les factures, avoirs et données associées sont **conservés** dans le système pendant
la durée légale (**10 ans**, Code de commerce) et **ne peuvent pas être supprimés**.

### 4. Archivage
- **Clôtures périodiques** (annuelles) figeant les totaux (HT, TVA, TTC, nombre de
  documents) et un **cumul perpétuel** ;
- chaque clôture est **chaînée par empreinte (hash)** à la précédente, garantissant
  la **détection de toute altération** de la séquence ;
- **export intégral** des données possible à tout moment (portabilité / archivage).

---

**Rappels importants pour le professionnel utilisateur :**
Cette attestation ne dispense pas l'utilisateur du respect de ses propres obligations
(conservation de ses documents, exactitude des mentions, etc.). Elle porte uniquement
sur les caractéristiques techniques du logiciel FactuPro dans la version indiquée.

Fait à **[lieu]**, le **[date]**.

**[Nom Prénom]** — **[fonction]**
Signature :

_______________________________

---

### Références
- Article **286-I-3° bis** du Code général des impôts (obligation d'un logiciel/système
  de caisse ou de facturation conforme).
- **BOI-TVA-DECLA-30-10-30** (doctrine administrative : conditions d'inaltérabilité,
  sécurisation, conservation, archivage).
- Alternative à l'attestation individuelle : **certification** par un organisme accrédité
  (ex. référentiel type NF525) — non retenue ici, l'attestation éditeur étant admise.
