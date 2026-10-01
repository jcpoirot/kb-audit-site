# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm start                # serveur + UI sur http://localhost:4173
PORT=5000 npm start      # autre port
npm run vocab            # regenere data/schema-index.json depuis le JSON-LD schema.org
npm run audit            # audit quotidien multi-pages -> reports/AAAA-MM-JJ.json (+ diff avec la veille)
npm run email            # prepare le mail (reports/AAAA-MM-JJ.email.html + .email.json + .csv), sans l'envoyer
```

Il n'y a **ni suite de tests, ni linter, ni etape de build**. La verification se fait ainsi :

```bash
# syntaxe de tous les modules
node --check server.js && for f in src/*.js src/checks/*.js public/app.js; do node --check "$f"; done

# execution d'une analyse sans passer par le serveur (boucle d'iteration la plus rapide)
node -e "import('./src/analyze.js').then(async m => {
  const r = await m.analyzeUrl('https://www.kaufmanbroad.fr/achat-immobilier-neuf/ile-de-france/val-de-marne/orly/lot/Appartement/28071_58');
  for (const t of r.tools) for (const i of t.issues) console.log(i.severity, i.id, i.title, '|', i.path);
})"

# analyse via l'API (serveur demarre)
curl "http://localhost:4173/api/analyze?url=https://…" | jq '.score, .counts'
```

Pour valider le rendu de l'UI sans navigateur interactif, Chrome headless suffit — l'URL accepte
un parametre `?url=` qui declenche l'analyse au chargement :

```bash
chrome --headless=new --virtual-time-budget=20000 --window-size=1400,2800 \
  --screenshot=out.png "http://localhost:4173/?url=<URL encodee>"
```

## Contraintes structurantes

- **Zero dependance npm, et c'est volontaire.** Pas de `node_modules`, pas d'etape de build.
  Node 20+ fournit `fetch`, `node:http` et les modules ES. Avant d'ajouter une dependance
  (cheerio, express, un validateur JSON Schema…), verifier qu'un utilitaire de `src/html.js`
  ou `src/vocabulary.js` ne fait pas deja le travail.
- **Le HTML analyse est celui servi par le serveur distant, sans execution JavaScript.**
  L'extraction est faite par expressions regulieres dans `src/html.js`, sans DOM. Un balisage
  injecte cote client est invisible pour l'outil (ce n'est pas le cas des pages programme et lot
  de kaufmanbroad.fr, dont le JSON-LD est present dans le HTML initial).
- **Le front-end est du HTML/CSS/JS natif servi tel quel** depuis `public/`. Pas de framework,
  pas de transpilation. Le helper `el()` de `public/app.js` construit tout le DOM.

## Architecture

### Chaine de traitement

```
fetch-page.js  ->  extract.js  ->  TOOLS[].run(page)  ->  issues[]  ->  score  ->  UI / API
   HTML brut       page {head,          checks/*.js       issue()      issues.js
                   headings, blocks}
```

`src/analyze.js` est le chef d'orchestre et **le seul point d'extension** : le tableau `TOOLS`
liste les outils SEO sous la forme `{ key, label, description, weight, run(page) }`. `run` renvoie
soit un tableau de constats, soit `{ issues, extras }` — `extras` est passe tel quel a l'UI
(c'est ainsi que le tableau d'eligibilite Google et le gabarit detecte remontent a l'ecran).

Ajouter un outil = ajouter une entree dans `TOOLS`. L'onglet, le score, les filtres par severite
et l'export apparaissent automatiquement : rien a toucher dans `public/`.

`runTool()` capture les exceptions de chaque outil et les transforme en constat `tool-crash`,
pour qu'un outil defaillant ne fasse pas tomber tout le rapport.

### Le modele de constat

Tout controle renvoie des objets construits par `issue()` (`src/issues.js`) :
`{ severity, id, category, title, detail, path, fix, docs, value }`.

Le score en decoule mecaniquement : `100 - Σ poids`, plancher a 0, avec `error: 10`,
`warning: 4`, `info: 1`. Le score global est la moyenne des scores d'outils ponderee par
`TOOLS[].weight` (actuellement 0.7 donnees structurees / 0.3 head & meta / 0.2 HTTP & indexation, normalises).

Convention de severite, a respecter pour tout nouveau controle :

| Severite | Signification |
| --- | --- |
| `error` | le balisage est casse ou ignore par les moteurs (JSON invalide, type inexistant, canonique relative) |
| `warning` | JSON valide mais hors specification ou a risque (propriete hors domaine, incoherence page/balisage) |
| `info` | recommandation d'amelioration (champ recommande absent, precision excessive) |

`category` regroupe les constats dans l'UI ; garder les libelles existants plutot que d'en creer
de nouveaux pour un controle proche.

### Le vocabulaire schema.org

C'est la piece la moins evidente du projet. La validation des types et proprietes n'est **pas**
une liste ecrite a la main : elle s'appuie sur le vocabulaire officiel.

```
data/schemaorg-current-https.jsonld   source telechargee (1,5 Mo, 3219 noeuds)
        |  scripts/build-vocabulary.mjs   (npm run vocab)
        v
data/schema-index.json                index compact : types, properties, enumerationMembers
        |  src/vocabulary.js              chargement synchrone a l'import + caches
        v
    ancestorsOf() / allowedPropertiesOf() / rangeVerdict() / suggestType()
```

`src/vocabulary.js` **jette a l'import** si `data/schema-index.json` est absent : le message
indique de lancer `npm run vocab`. Si `scripts/build-vocabulary.mjs` ne trouve pas le fichier
source, il le retelecharge depuis schema.org.

Consequence pratique : un type ou une propriete signale « inconnu » l'est reellement au regard
de la version publiee de schema.org. Ne pas « corriger » un controle qui signale un terme absent
sans avoir verifie dans `data/schema-index.json`.

### Parcours des noeuds JSON-LD

`src/extract.js` fournit les primitives que tous les controles reutilisent :

- `rootsOf(parsed)` — gere les trois formes racine : objet, tableau, `@graph`
- `walkNodes(node)` — tous les objets en profondeur, avec `path` et `types`
- `walkValues(node)` — toutes les valeurs scalaires, avec leur propriete porteuse
- `collectNodes(page)` — a plat, tous les noeuds de tous les blocs valides, avec `block`,
  `isRoot` et `where` (le chemin affichable, ex. `bloc 1 > offers.price`)
- `typesOf(node)` — normalise `@type` (chaine ou tableau, prefixes `schema:` / `https://schema.org/`)

Un helper local `isA(types, target)` est **duplique dans quatre modules de `checks/`**
(`google.js`, `quality.js`, `coherence.js`, `expectations.js`). Si un cinquieme controle en a
besoin, le moment est venu de le remonter dans `vocabulary.js`.

### Les controles

| Module | Perimetre |
| --- | --- |
| `checks/syntax.js` | parsing, `@context`, `@type`, valeurs vides, HTML/entites dans les valeurs, URLs relatives, types dupliques entre blocs |
| `checks/vocabulary.js` | types et proprietes existants, appartenance au domaine (heritage), `rangeIncludes`, termes obsoletes |
| `checks/google.js` | champs requis/recommandes de la galerie de resultats enrichis ; produit aussi `features` (tableau d'eligibilite) |
| `checks/quality.js` | adresses, coordonnees, prix, devises, telephones, enumerations, images, longueurs de textes |
| `checks/coherence.js` | balisage vs contenu affiche : H1, canonique, fil d'Ariane, prix visible, `og:image` |
| `checks/expectations.js` | attentes par gabarit kaufmanbroad.fr ; produit aussi `template` (gabarit detecte) |
| `checks/meta.js` | `<head>` et structure editoriale — c'est le second outil du registre |
| `checks/http.js` | troisieme outil : code HTTP, redirections, X-Robots-Tag, page de blocage WAF, temps de reponse, poids du HTML, conteneur GTM attendu. Lit `page.fetch` (pose par `analyzeHtml`) |

`checks/expectations.js` detecte le gabarit depuis le chemin de l'URL via le tableau `TEMPLATES`
(`/programme/{id}` et `/lot/{type}/{id}`). Ajouter un gabarit du site = ajouter une entree avec
sa regex `match`, ses `expectedTypes` et ses proprietes `recommended`.

`rangeVerdict()` dans `checks/vocabulary.js` est deliberement permissif : il ne signale que les
incompatibilites franches (une chaine la ou seul un type complexe est admis, un objet la ou seul
un scalaire l'est). Toute valeur ressemblant a une URL est acceptee, car une URL peut referencer
n'importe quelle entite en JSON-LD.

## Audit quotidien (routine cloud)

`scripts/audit-site.mjs` analyse, chaque jour, les pages de `audit-config.json` : pages temoins fixes
(home, un programme, un lot) et pages tirees au hasard dans le sitemap. Il controle aussi robots.txt et
le sitemap (constats `site-`), puis compare au rapport precedent de `reports/` :

- les constats sont compares par cle `id|path` (index de tableaux neutralises) ;
- la structure JSON-LD (chemins types sans valeurs) et la forme du head ne sont comparees que si
  l'URL est la meme que la veille (`samePage`) : deux lots differents n'ont pas les memes champs ;
- `alerts` = erreurs de site + defauts critiques nouveaux + changements de structure.

`scripts/build-email.mjs` met en forme le mail (HTML + CSV versionne et lie depuis le mail) sans l'envoyer :
l'envoi est fait par la routine via le connecteur Gmail. La synthese redigee par Claude est lue dans `reports/AAAA-MM-JJ.synthese.md`.
Le deroulement de la routine est decrit dans `ROUTINE.md` ; les rapports JSON sont commites pour
servir de reference au lendemain.

## Conventions

- Identifiants et noms de fonctions en anglais, commentaires et messages utilisateur en francais.
- Les chaines cote serveur (`src/`, `scripts/`) sont ecrites **sans accents** ; le front-end
  (`public/`) utilise la typographie francaise complete. Conserver cette separation.
- Chaque `issue()` doit porter un `id` stable en kebab-case prefixe par sa famille
  (`jsonld-`, `schema-`, `google-`, `address-`, `coherence-`, `meta-`, `kb-`, `http-`, `tracking-`, `site-`). Certains controles
  comptent les erreurs par prefixe d'`id` — voir `errorsIn()` dans `checks/google.js`.
- Renseigner `fix` avec une action concrete et `docs` avec l'URL de reference : l'UI les affiche
  systematiquement.

## Piege connu dans l'UI

`public/styles.css` definit `[hidden] { display: none !important; }` en tete de feuille. Ce n'est
pas une precaution superflue : `.loading`, `.features` et consorts declarent `display: flex/grid`,
ce qui ecrase le style navigateur de l'attribut `hidden` et laisse les sections masquees visibles.
Ne pas retirer cette regle.

## Etat du site audite (constate, pas suppose)

Utile pour ne pas prendre un vrai defaut du site pour un bug de l'outil. Verifie sur 8 pages
(plusieurs regions, programmes, appartements et maisons) :

- `HousingComplex`, entite principale de toutes les pages programme, **n'existe pas dans
  schema.org** (0 occurrence dans le vocabulaire officiel ; `Residence` n'a que `ApartmentComplex`
  et `GatedResidenceCommunity` comme sous-types).
- `developer` n'est pas une propriete schema.org.
- `offers` / `sku` / `brand` / `category` sont portes par `Apartment` et `HousingComplex`, jamais
  par `Product` : aucun prix ne peut remonter dans les resultats enrichis Google.
- `rel=canonical` et `og:url` sont servis en URL relative sur les deux gabarits.
- Sur les pages lot, le dernier maillon du fil d'Ariane pointe vers une URL differente de la page.

La synthese redigee pour diffusion interne est dans `synthese-audit.txt`.
