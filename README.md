# ON'SPORT — Application de gestion de salle de sport

Application statique (HTML/CSS/JS, aucun build nécessaire) connectée à Supabase,
hébergeable gratuitement sur GitHub Pages.

## 1. Base de données Supabase

Dans l'éditeur SQL de votre projet Supabase, exécutez **dans cet ordre** :

1. Votre schéma d'origine (tables `sports`, `members`, `memberships`, etc.)
2. `corrections_schema_salle_sport.sql` (contraintes, index, `updated_at`, RLS de base)
3. `supabase-roles-rls.sql` (droits précis admin / coach — **remplace** les
   politiques génériques de l'étape 2)

Puis créez votre premier compte administrateur :

1. Supabase Dashboard → Authentication → Users → **Add user** (email + mot de passe),
   ou laissez-vous vous inscrire depuis la page ON'SPORT (onglet "Demande d'accès coach").
2. Copiez l'UUID de ce compte.
3. Dans l'éditeur SQL :
   ```sql
   UPDATE public.app_users
   SET role = 'admin', is_active = true
   WHERE user_id = 'UUID_DU_COMPTE';
   ```

Sans cette dernière étape, personne ne peut se connecter à l'espace admin.

## 2. Connecter le site à votre projet Supabase

Ouvrez `js/supabaseClient.js` et remplacez :

```js
export const SUPABASE_URL = 'https://VOTRE-PROJET.supabase.co';
export const SUPABASE_ANON_KEY = 'VOTRE_CLE_ANON_PUBLIQUE';
```

par les valeurs de **Project Settings → API** dans Supabase.
La clé `anon` est publique par conception (protégée par les policies RLS) :
elle peut être commitée dans un dépôt GitHub public sans risque, à condition
que les politiques RLS (étape 1) soient bien actives.

## 3. Déployer sur GitHub Pages

```bash
# Depuis le dossier onsport/
git init
git add .
git commit -m "ON'SPORT - v1"
git branch -M main
git remote add origin https://github.com/VOTRE-COMPTE/onsport.git
git push -u origin main
```

Puis sur GitHub : **Settings → Pages → Source: Deploy from branch → main / (root)**.
Le site sera disponible à `https://VOTRE-COMPTE.github.io/onsport/`.

Aucune étape de build n'est nécessaire : les fichiers sont servis tels quels,
et Supabase JS est chargé directement depuis un CDN (`esm.sh`) dans le navigateur.

## 4. Fonctionnement des rôles

- **Inscription libre** (page de connexion, onglet "Demande d'accès coach") crée
  un compte avec le rôle `coach` et `is_active = false`.
- Un **admin** doit l'activer dans l'onglet **Utilisateurs** du back-office
  (et peut changer son rôle si besoin).
- Une fois activé, le coach doit avoir une **fiche coach** créée dans l'onglet
  **Coachs**, puis être **affecté à un ou plusieurs créneaux** — c'est cette
  affectation qui détermine ce qu'il voit dans son espace "Présences".
- L'admin gère tout : sports, plannings, inscriptions, paiements, coachs.
  Le coach ne voit et ne modifie que les présences de ses propres créneaux.

### Inscriptions (écran unique)

Il n'y a plus de menus séparés "Membres" et "Tuteurs" : l'onglet **Inscriptions**
regroupe tout sur un seul écran :
- les informations du membre (identité, naissance, école, notes médicales...),
- les informations du parent / tuteur (obligatoires : prénom, nom, téléphone —
  possibilité de réutiliser un tuteur déjà existant, par ex. pour un 2ᵉ enfant),
- le(s) sport(s) choisis (un membre peut être inscrit à **plusieurs sports** en
  même temps, chacun avec son créneau et ses frais propres).

Décocher un sport n'efface pas l'historique : l'inscription à ce sport passe
au statut "cancelled" (les paiements/présences déjà enregistrés sont conservés).

### Paiements en dinars tunisiens (TND)

Tous les montants (frais d'inscription, cotisations, paiements) sont exprimés
en **dinars tunisiens (TND)**. La méthode de paiement "Carte" a été retirée du
formulaire ; seules les méthodes Espèces, Virement, En ligne et Chèque sont
proposées. Le tableau de bord n'affiche plus de total de revenus.

### Créer une fiche coach

Dans l'onglet **Coachs**, le bouton **+ Nouvelle fiche coach** liste tous les
comptes activés avec le rôle "coach" (ou "assistant_coach") qui n'ont pas
encore de fiche : sélectionnez le compte, renseignez la spécialité et la date
d'embauche. La fiche apparaît ensuite dans la liste et devient disponible dans
le sélecteur "Coach" du formulaire **+ Nouvelle affectation**.

## 5. Structure du projet

```
onsport/
├── index.html              connexion / demande d'accès
├── admin.html               back-office (plannings, inscriptions, paiements...)
├── coach.html                espace coach (présences uniquement)
├── css/styles.css            identité visuelle ON'SPORT (vert & bleu)
├── js/
│   ├── supabaseClient.js     configuration Supabase (à renseigner)
│   ├── guard.js               vérification de session + rôle
│   ├── admin.js                logique complète du back-office
│   └── coach.js                logique de saisie des présences
└── assets/logo-inline.js      logo SVG ON'SPORT réutilisable
```

## 6. Pistes d'évolution (non incluses)

- Génération de reçus de paiement en PDF
- Export CSV des présences et paiements
- Notifications par e-mail (rappels de cotisation, confirmation d'inscription)
