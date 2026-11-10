# Échéancier

Outil de trésorerie pour micro-entrepreneuse : solde « vraiment à toi », URSSAF et TVA calculées automatiquement, budget mensuel, projection sur 90 jours, import de relevés CSV, export calendrier, compte en ligne facultatif.

**Utiliser l'appli : https://annabalaguy.github.io/echeancier/**

- Un seul fichier (`index.html`), aucune dépendance, aucun serveur.
- Les données restent dans le navigateur (localStorage). Avec le compte en ligne (Supabase, connexion par lien e-mail), elles sont aussi enregistrées en ligne et synchronisées entre appareils. Mise en place : [docs/supabase.sql](docs/supabase.sql), puis renseigner `CLOUD` dans `index.html`.
- Le dépôt est public : aucune donnée personnelle dans le code.
- Mode d'emploi détaillé : [LISEZMOI.txt](LISEZMOI.txt).
