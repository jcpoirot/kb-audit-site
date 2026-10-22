# Boîte à outils SEO — kaufmanbroad.fr

Application web locale qui audite une page du site : **données structurées (JSON-LD)** en priorité,
puis le `<head>`, la structure éditoriale et la santé HTTP.

Le même moteur alimente un **audit automatique bihebdomadaire** (lundi et jeudi matin) qui tourne en
routine cloud Claude Code et envoie une synthèse par e-mail : voir
[Audit automatique](#audit-automatique-routine-cloud).

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

### Données structurées — poids 0,7

| Famille | Contrôles |
| --- | --- |
| **Syntaxe JSON-LD** | parsing, `@context`, `@type` manquant, valeurs vides, HTML/entités dans les valeurs, URLs relatives, types dupliqués entre blocs |
| **Vocabulaire schema.org** | types et propriétés réellement existants, appartenance de la propriété au domaine du type (héritage compris), compatibilité des `rangeIncludes`, termes obsolètes (`supersededBy`) |
| **Résultats enrichis Google** | champs requis et recommandés pour `BreadcrumbList`, `Product`, `Offer`/`AggregateOffer`, `Organization` ; tableau d'éligibilité par type de résultat |
| **Qualité des données** | `PostalAddress` (ISO 3166, code postal, `addressRegion`), `GeoCoordinates`, format des prix et devises (ISO 4217), téléphones E.164, valeurs d'énumération, images (largeur, nombre de ratios), longueurs de textes |
| **Cohérence page / balisage** | `name` vs H1, `url`/`@id` vs canonique, dernier maillon du fil d'Ariane vs page courante, prix balisé effectivement visible, image vs `og:image`, microdata concurrent |
| **Gabarit Kaufman & Broad** | entité principale attendue selon la page d'accueil (`Organization`, `WebSite`), `/programme/{id}` ou `/lot/{type}/{id}`, propriétés métier recommandées (surface, pièces, étage, rattachement au programme, DPE…) |

La page d'accueil n'est soumise ni au fil d'Ariane ni au DPE.

### Head & meta — poids 0,3

`title`, meta description, `rel=canonical` (présence **et** caractère absolu), `robots`, `lang`,
viewport, Open Graph, Twitter Card, `hreflang`, unicité du H1, hiérarchie des titres, attributs `alt`.

### HTTP & indexation — poids 0,2

Code HTTP, redirections, `Content-Type`, en-tête `X-Robots-Tag`, **détection d'une page de blocage**
(WAF, CDN, challenge JavaScript Azure Front Door), temps de réponse (alerte au-delà de 3 s), poids du
HTML (au-delà de 1,5 Mo), présence du conteneur Google Tag Manager attendu (`GTM-5V98P2X`) et absence
de conteneur supplémentaire.

Les poids sont normalisés : 0,7 / 0,3 / 0,2 correspondent à environ 58 % / 25 % / 17 % du score.

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
  fetch-page.js           téléchargement du HTML servi (+ en-tête X-Audit-Token vers kaufmanbroad.fr)
  extract.js              HTML -> { head, headings, images, blocks JSON-LD } + parcours des nœuds
  html.js                 extraction de balises sans DOM
  issues.js               modèle de constat, sévérités, pondération du score
  vocabulary.js           accès au vocabulaire schema.org (hiérarchie, domaines, ranges, suggestions)
  checks/
    syntax.js  vocabulary.js  google.js  quality.js  coherence.js  expectations.js  meta.js  http.js
public/                   interface (HTML/CSS/JS natifs, sans framework)
data/
  schemaorg-current-https.jsonld   vocabulaire officiel (source, 1,5 Mo)
  schema-index.json                index compact généré
scripts/
  build-vocabulary.mjs    régénère l'index                          (npm run vocab)
  audit-site.mjs          audit multi-pages + site + comparaison    (npm run audit)
  build-email.mjs         mail de synthèse HTML + CSV, sans envoi   (npm run email)
audit-config.json         pages, destinataires et liens de l'audit automatique
ROUTINE.md                consignes suivies par la routine cloud
reports/                  rapports versionnés (AAAA-MM-JJ.json, .csv, .synthese.md)
synthese-audit.txt        synthèse de l'audit initial, prête à diffuser
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

## Audit automatique (routine cloud)

Chaque **lundi et jeudi vers 7 h** (heure de Paris ; 6 h en heure d'hiver, le cron étant en UTC), une
routine cloud Claude Code clone ce dépôt, audite le site, rédige une synthèse et l'envoie par e-mail.
Elle tourne chez Anthropic : le poste peut être éteint.

| Élément | Valeur |
| --- | --- |
| Routine | « Audit SEO kaufmanbroad.fr » — https://claude.ai/code/routines/trig_01DCJ78uHiEg4zGB6i2KAxs9 |
| Planification | cron `0 5 * * 1,4` (UTC) |
| Dépôt | https://github.com/jcpoirot/kb-audit-site, branche `main` |
| Environnement cloud | « Default » |
| Modèle | Claude Sonnet 5.5 |
| Envoi | connecteur Gmail, depuis jcpoirot@dimake.io |
| Destinataires | `email.to` de `audit-config.json` |

### Déroulement

Le prompt de la routine se contente de renvoyer vers [`ROUTINE.md`](ROUTINE.md), versionné ici : modifier
ce fichier suffit pour changer le comportement de la routine, sans toucher à sa configuration.

```
npm run audit   ->  reports/AAAA-MM-JJ.json       (contrôles + comparaison au rapport précédent)
Claude          ->  reports/AAAA-MM-JJ.synthese.md (verdict, alertes, changements, 3 actions)
npm run email   ->  reports/AAAA-MM-JJ.csv         (versionné, lié depuis le mail)
                    reports/AAAA-MM-JJ.email.html + .email.json (non versionnés)
git push        ->  le rapport sert de référence au prochain audit ; les liens du mail fonctionnent
Gmail           ->  envoi du HTML généré, tel quel
```

Si `npm run audit` échoue, la routine envoie un mail « ÉCHEC » : l'absence de mail n'est jamais un
signe que tout va bien.

### Pages auditées

| Emplacement | Page |
| --- | --- |
| `home` | page d'accueil |
| `programme-temoin` | programme fixe (Orly, 28071) — sert à mesurer l'évolution d'un audit à l'autre |
| `lot-temoin` | lot fixe (Orly, 28071_58) |
| `programme-aleatoire` | programme tiré au hasard dans le sitemap, **parmi les programmes diffusés** |
| `lot-aleatoire` | lot tiré au hasard, dont le programme est diffusé |

Un **programme diffusé** est, dans l'export marketing `programs.csv` : publié en B2C
(`isProgramPublishedB2C = 1`), non archivé (`statutBackbone ≠ archive`) et sans programme parent
(`parentOperationCode` vide ou égal à son propre identifiant). Les programmes enfants sont écartés :
ils doivent répondre en 301 vers leur parent. Si le CSV n'est pas lisible, le tirage porte sur tout le
sitemap et le rapport le signale (`site-programs-csv-unreachable`).

### Contrôles de niveau site

- `robots.txt` : disponible, pas de `Disallow: /`, pas de blocage des gabarits stratégiques, sitemap déclaré.
- Sitemap : lisible, nombre d'URL comparé au rapport précédent (alerte au-delà de 10 % de baisse),
  doublons, URL en `http://`, échantillon de 10 URL qui doivent répondre 200 sans redirection.
- Chaque page auditée doit figurer dans le sitemap.

### Comparaison et alertes

- Les constats sont comparés au **dernier rapport valide** (un audit entièrement bloqué n'est jamais
  pris comme référence), par clé `id + chemin`.
- La structure du JSON-LD et les balises du `<head>` ne sont comparées que si l'URL est la même : deux
  lots différents n'ont pas les mêmes champs. Pour les pages tirées au hasard, les écarts sont indicatifs.
- **Alertes** en tête de mail : erreurs de site, défauts critiques nouveaux (page en erreur, `noindex`,
  JSON-LD disparu ou invalide, canonique absente ou croisée, GTM absent) et changements de structure.
- **Page bloquée** par le WAF : exclue du score, des comparaisons et des alertes, signalée par une seule
  alerte « Page non analysée » et un bandeau « Audit incomplet ». Si **toutes** les pages sont bloquées,
  le mail se réduit à « AUDIT NON RÉALISÉ » avec un extrait de la réponse reçue.
- Le score global est la moyenne des pages lisibles, le score du site comptant comme une page. Les
  pages tirées au hasard le font légèrement varier d'un audit à l'autre.

### Configuration — `audit-config.json`

| Clé | Rôle |
| --- | --- |
| `site`, `robots`, `sitemap` | URLs de référence |
| `fixedPages` | pages témoins (`slot`, `label`, `url`) |
| `randomPages` | tirages au hasard (`slot`, `label`, `pattern` cherché dans les URL du sitemap) |
| `sitemapSampleSize` | nombre d'URL du sitemap vérifiées à chaque audit |
| `sitemapDropAlertPercent` | seuil d'alerte sur la baisse du sitemap |
| `email.to` | destinataires |
| `reportsUrl` | base des liens vers les rapports sur GitHub |
| `routineUrl` | lien « Modifier la routine » en pied de mail |

### Variables d'environnement (environnement cloud « Default »)

Les secrets se déclarent sur claude.ai/code, dans les paramètres de l'environnement, **jamais dans le dépôt**.

| Variable | Rôle |
| --- | --- |
| `AUDIT_TOKEN` | jeton envoyé dans l'en-tête `X-Audit-Token`, qui exempte l'audit de la règle anti-robots du WAF (voir ci-dessous). Envoyé aux seuls hôtes `*.kaufmanbroad.fr` ; les redirections sont suivies à la main pour qu'il ne parte jamais vers un autre domaine. |
| `PROGRAMS_CSV_URL` | URL SAS **en lecture seule**, limitée au fichier `programs.csv` du compte de stockage `outilsmarketing`. Jamais écrite dans les rapports ni dans le mail. |
| `REPORT_TO` | facultatif : remplace les destinataires de `audit-config.json` |

Le rapport indique si le jeton a été envoyé (`tokenSent`) et quelle liste de programmes a été utilisée
(`programs` : nombre de programmes diffusés, date de mise à jour du CSV).

### Prérequis de l'environnement cloud

| Réglage | Valeur |
| --- | --- |
| Accès réseau | « Personnalisé », liste par défaut des gestionnaires de paquets incluse |
| Domaines autorisés | `www.kaufmanbroad.fr` (le nom exact compte : `kaufmanbroad.fr` ne couvre pas `www.`), `outilsmarketing.blob.core.windows.net` |
| GitHub | application Claude installée sur le dépôt, avec droit d'écriture (push des rapports) |
| Connecteur | Gmail, attaché à la routine |

### Règle WAF côté site

Le Bot Manager d'Azure Front Door (`Microsoft_BotManagerRuleSet-1.1-UnknownBots-Bot300600`) classe les
IP Google Cloud de la routine comme robots inconnus et leur renvoie un **challenge JavaScript**, que
l'audit (sans exécution de script) ne peut pas passer : 403 et page « Azure WAF ». Une règle
personnalisée de la politique `kbwebsiteproductionwaf` exempte l'audit :

| Paramètre | Valeur |
| --- | --- |
| Nom | `AllowSeoAudit` |
| Type / priorité | Match, avant les autres règles personnalisées |
| Condition | `RequestHeader` `X-Audit-Token` **Equal** valeur de `AUDIT_TOKEN` |
| Action | Allow |

Les IP cloud changent à chaque exécution : une liste blanche d'IP ne fonctionnerait pas. Googlebot et
Bingbot relèvent des robots *connus* et ne sont pas concernés par cette règle.

**Renouveler le jeton** : générer une valeur
(`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` ou `openssl rand -hex 32`),
puis la reporter à l'identique dans la règle WAF et dans `AUDIT_TOKEN`.

### Exploitation

| Besoin | Où |
| --- | --- |
| Lister, mettre en pause, lancer à la demande, consulter les exécutions | https://claude.ai/code/routines |
| Changer jours ou heure | page de la routine (cron en UTC) |
| Changer les destinataires ou les pages témoins | `audit-config.json`, puis push |
| Changer le contenu de la synthèse | `ROUTINE.md`, puis push |
| Tester sans déranger les destinataires | réduire temporairement `email.to`, pousser, lancer la routine, puis rétablir |

En local, `npm run audit` puis `npm run email` produisent le rapport et l'aperçu du mail
(`reports/AAAA-MM-JJ.email.html`) sans rien envoyer. Sur le réseau de l'entreprise, ajouter
`--use-system-ca` à Node pour lire le CSV Azure (le proxy intercepte le TLS).

### Dépannage de la routine

| Symptôme | Cause et correction |
| --- | --- |
| 403 « Host not in allowlist: … » | domaine absent des domaines autorisés de l'environnement : l'ajouter, au nom exact |
| 403 « Azure WAF … enable JavaScript » | challenge du Bot Manager : vérifier la règle `AllowSeoAudit` et `AUDIT_TOKEN` (`tokenSent` dans le rapport). La référence affichée permet à l'équipe WAF de retrouver la requête dans ses journaux. |
| `site-programs-csv-unreachable` | `PROGRAMS_CSV_URL` absente, expirée ou domaine non autorisé ; le tirage se fait alors sur tout le sitemap |
| Push refusé (403 GitHub) | l'application Claude n'a pas accès au dépôt ; les liens du mail sont alors en 404 |
| `SELF_SIGNED_CERT_IN_CHAIN` en local | proxy TLS de l'entreprise : `node --use-system-ca …` |

### Sécurité

- Aucun secret dans le dépôt : `AUDIT_TOKEN` et `PROGRAMS_CSV_URL` vivent dans l'environnement cloud.
- La SAS de `PROGRAMS_CSV_URL` doit être en **lecture seule** (`sp=r`) et porter sur le seul fichier
  (`sr=b`). Ne pas réutiliser la SAS `racwdl` du projet `outilsMarketing`, qui donne l'écriture et la
  suppression sur tout le conteneur.
- Les destinataires sans accès au dépôt GitHub lisent le mail mais pas les liens CSV / JSON.

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
