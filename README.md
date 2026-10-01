# Boîte à outils SEO — kaufmanbroad.fr

Application web locale qui audite une page du site : **données structurées (JSON-LD)** en priorité,
puis le `<head>` et la structure éditoriale.

Aucune dépendance npm, aucune étape de build — Node 20+ suffit. La validation des types et des
propriétés s'appuie sur le **vocabulaire officiel schema.org** embarqué, pas sur une liste écrite
à la main.

## Démarrage

```bash
npm start            # http://localhost:4173
PORT=5000 npm start  # autre port
```

Coller l'URL d'une page, ou cliquer sur l'un des deux exemples pré-câblés (page programme, page lot).
L'URL peut aussi être passée dans le lien : `http://localhost:4173/?url=https://…`
Les URLs analysées sont mémorisées dans le navigateur et proposées en autocomplétion.

## L'interface

- **Score global** sur 100, avec le détail par outil.
- **Éligibilité aux résultats enrichis Google** : une carte par type de résultat (fil d'Ariane,
  extrait produit, organisation, FAQ, vidéo, WebSite), avec son état — éligible, incomplet, absent —
  et l'explication.
- **Un onglet par outil**, les constats groupés par famille, filtrables par sévérité. Chaque constat
  affiche le chemin exact dans le JSON-LD (`bloc 1 > offers.price`), la valeur fautive, la correction
  suggérée et un lien vers la documentation de référence.
- **JSON-LD brut** reformaté, et **Head lu** : toutes les valeurs effectivement extraites du document.
- **Export** du rapport complet en JSON, ou copie d'une synthèse texte dans le presse-papier.

## Ce qui est contrôlé

### Données structurées — poids 70 % du score

| Famille | Contrôles |
| --- | --- |
| **Syntaxe JSON-LD** | parsing, `@context`, `@type` manquant, valeurs vides, HTML/entités dans les valeurs, URLs relatives, types dupliqués entre blocs |
| **Vocabulaire schema.org** | types et propriétés réellement existants, appartenance de la propriété au domaine du type (héritage compris), compatibilité des `rangeIncludes`, termes obsolètes (`supersededBy`) |
| **Résultats enrichis Google** | champs requis et recommandés pour `BreadcrumbList`, `Product`, `Offer`/`AggregateOffer`, `Organization` ; tableau d'éligibilité par type de résultat |
| **Qualité des données** | `PostalAddress` (ISO 3166, code postal, `addressRegion`), `GeoCoordinates`, format des prix et devises (ISO 4217), téléphones E.164, valeurs d'énumération, images (largeur, nombre de ratios), longueurs de textes |
| **Cohérence page / balisage** | `name` vs H1, `url`/`@id` vs canonique, dernier maillon du fil d'Ariane vs page courante, prix balisé effectivement visible, image vs `og:image`, microdata concurrent |
| **Gabarit Kaufman & Broad** | entité principale attendue selon `/programme/{id}` ou `/lot/{type}/{id}`, propriétés métier recommandées (surface, pièces, étage, rattachement au programme, DPE…) |

### Head & meta — poids 30 % du score

`title`, meta description, `rel=canonical` (présence **et** caractère absolu), `robots`, `lang`,
viewport, Open Graph, Twitter Card, `hreflang`, unicité du H1, hiérarchie des titres, attributs `alt`.

### Calcul du score

Chaque constat porte une sévérité pondérée ; le score d'un outil vaut `100 − Σ poids`, avec un
plancher à 0. Le score global est la moyenne des scores d'outils pondérée par leur poids.

| Sévérité | Poids | Signification |
| --- | --- | --- |
| Erreur | 10 | le balisage est cassé ou ignoré par les moteurs |
| Avertissement | 4 | JSON valide mais hors spécification, ou à risque |
| Info | 1 | recommandation d'amélioration |

## API

Le serveur expose une API JSON, pratique pour scripter un lot d'URLs :

```bash
curl "http://localhost:4173/api/analyze?url=https://www.kaufmanbroad.fr/…/programme/28071" > rapport.json
curl -s -X POST http://localhost:4173/api/analyze \
  -H "content-type: application/json" -d '{"url":"https://…"}'
curl http://localhost:4173/api/tools
```

Structure du rapport :

```jsonc
{
  "url": "…", "fetchedAt": "…",
  "fetch":   { "status": 200, "redirected": false, "bytes": 162368, "elapsedMs": 377 },
  "score": 55,
  "counts": { "error": 3, "warning": 9, "info": 13 },
  "byCategory": [ { "category": "Vocabulaire schema.org", "error": 1, "warning": 5 } ],
  "tools": [
    {
      "key": "structured-data", "score": 47,
      "issues": [ { "severity": "error", "id": "schema-unknown-type", "category": "…",
                    "title": "…", "detail": "…", "path": "bloc 1 > isPartOf",
                    "value": "HousingComplex", "fix": "…", "docs": "…" } ],
      "extras": { "features": [ … ], "template": { "key": "lot", "mainType": "Apartment" } }
    }
  ],
  "head": { … }, "headings": [ … ],
  "blocks": [ { "label": "bloc 1", "line": 412, "types": ["Apartment"], "pretty": "…" } ]
}
```

Une URL malformée renvoie `400`, une page inatteignable `502`.

## Architecture

```
server.js                 serveur HTTP + API (node:http, zéro dépendance)
src/
  analyze.js              registre des outils + orchestration + score
  fetch-page.js           téléchargement du HTML servi
  extract.js              HTML -> { head, headings, images, blocks JSON-LD } + parcours des nœuds
  html.js                 extraction de balises sans DOM
  issues.js               modèle de constat, sévérités, pondération du score
  vocabulary.js           accès au vocabulaire schema.org (hiérarchie, domaines, ranges, suggestions)
  checks/
    syntax.js  vocabulary.js  google.js  quality.js  coherence.js  expectations.js  meta.js
public/                   interface (HTML/CSS/JS natifs, sans framework)
data/
  schemaorg-current-https.jsonld   vocabulaire officiel (source, 1,5 Mo)
  schema-index.json                index compact généré
scripts/build-vocabulary.mjs       régénère l'index  (npm run vocab)
synthese-audit.txt                 synthèse de l'audit initial, prête à diffuser
```

Le flux : `fetch-page` → `extract` → chaque outil du registre `TOOLS` → constats → score → UI/API.

### Ajouter un outil SEO

1. Créer `src/checks/mon-outil.js` exportant une fonction qui renvoie un tableau de constats
   construits avec `issue({ severity, id, category, title, detail, path, fix, docs, value })`.
2. Ajouter une entrée dans `TOOLS` (`src/analyze.js`) : `{ key, label, description, weight, run(page) }`.

L'onglet, le score, les filtres et l'export apparaissent automatiquement dans l'interface.

### Ajouter un gabarit de page

`src/checks/expectations.js` reconnaît les gabarits du site via le tableau `TEMPLATES`, à partir du
chemin de l'URL. Une entrée déclare sa regex `match`, les `expectedTypes` de l'entité principale et
les propriétés `recommended` avec leur justification.

### Mettre à jour le vocabulaire schema.org

```bash
rm data/schemaorg-current-https.jsonld   # facultatif : force le retéléchargement
npm run vocab
```

`src/vocabulary.js` charge `data/schema-index.json` au démarrage et échoue explicitement s'il
est absent.

## Développement

Pas de suite de tests ni de linter. La vérification se fait ainsi :

```bash
# syntaxe de tous les modules
node --check server.js
for f in src/*.js src/checks/*.js public/app.js; do node --check "$f"; done

# analyse directe, sans passer par le serveur — boucle d'itération la plus rapide
node -e "import('./src/analyze.js').then(async m => {
  const r = await m.analyzeUrl('https://www.kaufmanbroad.fr/…/lot/Appartement/28071_58');
  for (const t of r.tools) for (const i of t.issues) console.log(i.severity, i.id, i.title);
})"
```

Le rendu de l'interface peut être capturé sans navigateur interactif, le paramètre `?url=`
déclenchant l'analyse au chargement :

```bash
chrome --headless=new --virtual-time-budget=20000 --window-size=1400,2800 \
  --screenshot=out.png "http://localhost:4173/?url=<URL encodée>"
```

## Dépannage

| Symptôme | Cause |
| --- | --- |
| `data/schema-index.json est absent ou illisible` | lancer `npm run vocab` |
| `EADDRINUSE` au démarrage | port 4173 déjà pris — `PORT=5000 npm start` |
| `0 bloc JSON-LD` sur une page qui en affiche | le balisage est injecté en JavaScript : l'outil lit le HTML servi, sans exécuter de script |
| `Délai dépassé (20s)` | le site distant ne répond pas ; le délai est fixé dans `src/fetch-page.js` |

## Résultats de l'audit initial

Audit réalisé sur 8 pages (plusieurs régions, plusieurs programmes, appartements et maisons) :
**52/100** sur une page programme, **55/100** sur une page lot. Les constats sont identiques
partout — ils viennent des gabarits.

Les trois points bloquants :

1. `HousingComplex`, entité principale de toutes les pages programme, **n'existe pas dans
   schema.org** (`Residence` n'a que `ApartmentComplex` et `GatedResidenceCommunity` comme
   sous-types) — l'entité est ignorée par les moteurs, et le rattachement lot → programme est cassé.
2. `offers` / `sku` / `brand` / `category` sont portés par `Apartment` et `HousingComplex`, jamais
   par `Product` — aucun prix ne peut remonter dans les résultats enrichis Google.
3. `rel=canonical` et `og:url` sont servis en URL relative sur les deux gabarits.

Synthèse complète, rédigée pour diffusion interne : [`synthese-audit.txt`](synthese-audit.txt).

## Limites connues

- Le HTML analysé est celui **servi par le serveur**, sans exécution JavaScript. Un balisage injecté
  côté client par un script ne sera pas vu (ce n'est pas le cas des pages programme et lot, dont le
  JSON-LD est présent dans le HTML initial).
- La vérification « prix visible sur la page » compare des chaînes de chiffres dans le texte extrait :
  un prix affiché uniquement dans une image ou après interaction sera signalé comme absent.
- L'appartenance d'une propriété au domaine d'un type suit `domainIncludes` de schema.org. Certains
  moteurs sont plus tolérants ; ces constats sont classés en avertissement, pas en erreur.
