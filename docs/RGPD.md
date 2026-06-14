# RGPD — FactuPro

> Dernière mise à jour : 2026-06-12
> ⚠️ Base de travail, à faire valider (idéalement par un DPO/juriste).

## 1. Responsable de traitement
FactuPro (éditeur). Contact : contact@factupro.fr

## 2. Données traitées
- **Artisans (utilisateurs)** : email, mot de passe (haché par Supabase Auth), infos entreprise (nom, SIRET, adresse, tél, IBAN, TVA intra).
- **Clients des artisans** : nom, adresse, email, téléphone, SIRET, notes.
- **Documents** : devis, factures, avoirs, lignes, paiements, signatures.
- **Abonnement** : identifiants Stripe (customer/subscription), statut, plan.
- **Journal d'audit & clôtures** : opérations horodatées, totaux.

## 3. Finalités & base légale
| Finalité | Base légale |
|---------|-------------|
| Fournir le service de devis/facturation | Exécution du contrat |
| Facturation de l'abonnement | Exécution du contrat |
| Mentions légales / inaltérabilité / archivage | Obligation légale (CGI, Code de commerce, loi anti-fraude TVA) |
| Envoi d'emails (devis/factures) | Exécution du contrat / intérêt légitime |

## 4. Sous-traitants (hébergeurs & services)
| Sous-traitant | Rôle | Localisation |
|---------------|------|--------------|
| **Supabase** | Base de données, authentification, Edge Functions | UE (Irlande) |
| **Azure Static Web Apps** | Hébergement du front | À confirmer (région UE) |
| **Resend** | Envoi des emails transactionnels | À vérifier (UE/US) |
| **Stripe** | Paiement de l'abonnement | UE/US (clauses contractuelles types) |
| **Plateforme Agréée (future)** | Transmission des factures électroniques | UE (à choisir) |

> À formaliser : un accord de sous-traitance (DPA) avec chacun.

## 5. Durées de conservation
- **Factures / avoirs / clôtures** : **10 ans** (Code de commerce) — non supprimables (inaltérabilité).
- **Devis** : durée d'utilité (ex. 3 ans) puis archivage/suppression.
- **Compte utilisateur** : pendant la durée d'utilisation + obligations légales.
- **Données de paiement (Stripe)** : selon obligations comptables/fiscales.

## 6. Droits des personnes
- **Accès / portabilité** : export complet des données au format JSON depuis Profil → « Exporter mes données ».
- **Rectification** : modification des profils entreprise/clients (les factures émises restent inaltérables — correction par avoir).
- **Effacement** : possible **sauf** pour les documents soumis à conservation légale (factures 10 ans). L'effacement du compte n'efface pas les factures durant la période légale.
- **Opposition / limitation** : sur demande à contact@factupro.fr.

## 7. Sécurité
- Données hébergées en Europe, chiffrées en transit (HTTPS) et au repos.
- Cloisonnement par **RLS** (chaque artisan n'accède qu'à ses données).
- Plan/abonnement infalsifiable (écrit uniquement par webhook).
- Journal d'audit et clôtures **inaltérables**.

## 8. À faire (reste)
- [ ] Politique de confidentialité publique (page web) + bandeau cookies si applicable.
- [ ] DPA signés avec les sous-traitants.
- [ ] Procédure de suppression de compte (en respectant la conservation légale des factures).
- [ ] Registre des traitements formel (ce document en est l'amorce).
