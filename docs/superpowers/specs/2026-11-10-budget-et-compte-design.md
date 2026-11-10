# Budget mensuel + compte en ligne — conception

Date : 2026-11-10 · Branche : `budget-et-compte`

## Pourquoi

Anna est micro-entrepreneuse, revenus irréguliers (pas de « salaire »). Elle veut :
1. **Budgéter chaque mois** son coût de vie (charges fixes, provisions annuelles, dépenses courantes, épargne) et savoir si ses encaissements le couvrent.
2. **Ne jamais perdre ses données** et les retrouver sur n'importe quel appareil : un compte, données stockées en ligne.

Le dépôt GitHub est **public** : aucune donnée personnelle (montants, noms) ne va dans le code. Ses données passent par un fichier d'import local.

## Non-objectifs / anti-objectifs

- Pas d'agrégation bancaire automatique (l'import CSV existe déjà).
- Pas de multi-utilisateur, partage, ou budget « à la catégorie près » sur le passé.
- Anti-objectif : une synchro qui écrase silencieusement des données. Toute divergence entre l'appareil et le cloud est montrée et tranchée par Anna.
- Anti-objectif : compter deux fois la même dépense (une charge saisie comme échéance ET comme ligne de budget ; TVA ou impôt saisis à la main alors qu'ils sont calculés).

## A. Budget (onglet « Budget »)

### Modèle

- **Charges à date** = les échéances récurrentes existantes (`items`, `kind:"out"`, `recur` ≠ `none`). Elles restent dans l'échéancier (dates, « Payé ») et sont reprises automatiquement dans le budget, ramenées au mois (trimestriel ÷ 3, annuel ÷ 12). Aucune double saisie.
- **Enveloppes** = nouvelles lignes `budget[]` sans date : `{id, label, group, amount, per, note}`
  - `group` : `provision` (dépense annuelle lissée : vacances, train, vêtements…), `courant` (courses, sorties…), `epargne`.
  - `per` : `month` | `year`. Montant mensuel = `amount` ou `amount/12`.
- **Impôt sur le revenu, URSSAF, TVA** : jamais des lignes de budget. Ils sont déjà réservés sur chaque encaissement (« Impôts déjà dus »). Le budget l'affiche en une phrase.
- **Acomptes d'impôt sur le revenu** (prélèvement à la source, ex. 480 €/mois) : une échéance `category:"tax"` avec `irAcompte:true` (case à cocher dans le formulaire). Les acomptes datés de l'année *y* sont déduits de la ligne calculée « Impôt sur le revenu *y* » : montant − tous les acomptes de *y*, réserve − acomptes de *y* déjà payés (planchers à 0). Dans le budget ils sont affichés à part (« déjà couverts par la réserve d'impôt sur tes encaissements »), pas ajoutés au coût de vie.

### Écran

1. Quatre chiffres :
   - **Coût de vie / mois** = charges à date (mensualisées) + enveloppes.
   - **À encaisser pour le couvrir (TTC / mois)** = coût de vie ÷ part « vraiment à toi » d'un encaissement (`splitIncome(1000, tvaRate).mine / 1000`).
   - **Gardé net** : somme de `split.mine` des paiements clients reçus, ce mois-ci + moyenne des 12 derniers mois. C'est son « salaire ».
   - **Couvert jusqu'au** : `disponible ÷ coût de vie` mois à partir d'aujourd'hui (« — » si solde non saisi ou disponible ≤ 0 → message d'alerte).
2. Tableau par groupe (Charges à date / Provisions / Courant / Épargne) : libellé, montant saisi, par mois, total du groupe. Enveloppes modifiables (dialogue), charges à date → lien « modifier dans l'échéancier ».
3. Si des relevés sont importés : colonne « dépensé ce mois » pour les enveloppes reliées à une catégorie de dépenses (`spend` : liste de catégories `SPEND_CATS`, optionnelle).

### Projection 90 jours

Les enveloppes sont déduites le 1er de chaque mois dans le graphique (le mois en cours : au prorata des jours restants, aujourd'hui). Sans ça la projection est irréaliste. Elles n'apparaissent pas dans la liste des échéances. Note sous le graphique.

### Import de lignes (fusion)

Réglages › « Ajouter depuis un fichier » : un JSON `{app:"echeancier", kind:"ajout", items:[…], budget:[…]}` est **ajouté** aux données (jamais remplacé). Doublon ignoré si même libellé + date + montant (items) ou même libellé (budget). Confirmation avec le décompte avant d'ajouter. Sert à charger ses données sans les mettre dans le dépôt public.

### Format de données

`DATA_VERSION` 1 → 2, `migrate()` ajoute `budget: []`. Une ancienne page encore ouverte passe en lecture seule au lieu d'effacer `budget` (mécanisme existant).

## B. Compte en ligne (Supabase)

### Choix (décision de Claude)

Supabase : authentification + Postgres, offre gratuite, fonctionne depuis une page statique GitHub Pages. Clé publique (« anon ») dans le code : c'est prévu pour, la sécurité vient des règles RLS par utilisateur. Bibliothèque `@supabase/supabase-js@2.45.4` (jsDelivr, version figée), chargée seulement si le cloud est configuré.

Connexion par **lien magique envoyé par e-mail** (pas de mot de passe à gérer).

### Base

- `echeancier(user_id uuid pk = auth.uid(), data jsonb, rev bigint, updated_at timestamptz)`, RLS : chacun ne lit/écrit que sa ligne.
- `echeancier_history` : un trigger copie l'ancienne version à chaque mise à jour, garde les 60 dernières. Protège contre un déploiement bogué qui écrirait de mauvaises données.
- Script SQL complet : `docs/supabase.sql`.

### Synchro

- Le navigateur garde sa copie locale (fonctionne hors ligne, copies de secours quotidiennes inchangées).
- État local séparé (`echeancier.cloud` : `rev` connu, `dirty`), hors du format de données.
- Écriture : après chaque modification (délai 1,5 s), `update … where rev = rev connu` → `rev+1`. Zéro ligne modifiée = quelqu'un d'autre a écrit → on relit et on traite comme une divergence.
- Lecture : à l'ouverture, à la connexion, au retour sur l'onglet.
  - pas de ligne en ligne → on envoie la copie locale ;
  - copie locale sans modification non envoyée → on prend celle en ligne (après copie de secours locale) ;
  - copie locale modifiée ET version en ligne changée → **bandeau** : « Garder la version en ligne » / « Garder celle de cet appareil ». Rien n'est écrasé avant le choix.
- Données en ligne d'une version plus récente → lecture seule (comme aujourd'hui).
- Statut dans l'en-tête : « ✓ En ligne », « Envoi… », « Hors ligne ».

### Configuration (à faire par Anna, une fois)

Créer le projet Supabase, exécuter `docs/supabase.sql`, régler l'URL du site dans Authentication, donner l'URL du projet + la clé anon. Tant que ce n'est pas fait, l'appli fonctionne comme avant et Réglages affiche « Compte en ligne : pas encore configuré ».

## Tests

`tests/data-safety.html` doit rester vert, plus :
- v1 → v2 conserve tout et ajoute `budget` ;
- calculs du budget (mensualisation, coût de vie, encaissement nécessaire, gardé net) ;
- import-fusion : ajoute, ignore les doublons, ne remplace rien ;
- synchro avec un faux client Supabase : envoi, réception, divergence → bandeau sans écrasement, conflit de `rev`.

## Laissé au constructeur

Mise en page fine, libellés, ordre des colonnes.
