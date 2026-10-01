/**
 * Controles de syntaxe et d'hygiene des blocs JSON-LD :
 * parsing, @context, @type, valeurs vides, HTML echappe, URLs relatives.
 */
import { issue } from '../issues.js';
import { typesOf, walkValues } from '../extract.js';
import { getProperty } from '../vocabulary.js';

const CATEGORY = 'Syntaxe JSON-LD';
const DOCS = 'https://json-ld.org/spec/latest/json-ld/';

/** Proprietes dont schema.org attend une URL (ou identifiant JSON-LD). */
function expectsUrl(property) {
  if (property === '@id') return true;
  const def = getProperty(property);
  return Boolean(def && def.ranges.includes('URL') && !def.ranges.includes('Text'));
}

const HTML_TAG = /<\/?[a-z][a-z0-9]*\b[^>]*>/i;
const HTML_ENTITY = /&(?:[a-z][a-z0-9]{1,10}|#x?[0-9a-f]{2,6});/i;

export function checkSyntax(page) {
  const issues = [];

  if (page.blocks.length === 0) {
    issues.push(
      issue({
        severity: 'error',
        id: 'jsonld-absent',
        category: CATEGORY,
        title: 'Aucun bloc JSON-LD sur la page',
        detail:
          "La page ne contient aucun <script type=\"application/ld+json\">. Sans donnees structurees, aucun resultat enrichi n'est possible.",
        fix: 'Ajouter un bloc JSON-LD decrivant l\'entite principale de la page.',
        docs: 'https://developers.google.com/search/docs/appearance/structured-data/intro-structured-data',
      }),
    );
    return issues;
  }

  const seenRootTypes = new Map();

  for (const block of page.blocks) {
    if (block.parseError) {
      issues.push(
        issue({
          severity: 'error',
          id: 'jsonld-parse-error',
          category: CATEGORY,
          title: `${block.label} : JSON invalide`,
          detail: block.parseError,
          path: `${block.label} (ligne ${block.line})`,
          fix: 'Corriger la syntaxe JSON (guillemets, virgules, caracteres de controle non echappes).',
          docs: DOCS,
        }),
      );
      continue;
    }

    const context = block.parsed?.['@context'];
    const contextValues = (Array.isArray(context) ? context : [context]).filter(
      (c) => typeof c === 'string',
    );
    if (contextValues.length === 0) {
      issues.push(
        issue({
          severity: 'error',
          id: 'jsonld-context-missing',
          category: CATEGORY,
          title: `${block.label} : @context manquant`,
          detail: 'Sans @context, les termes ne sont pas resolus vers le vocabulaire schema.org.',
          path: block.label,
          fix: 'Ajouter "@context": "https://schema.org".',
          docs: DOCS,
        }),
      );
    } else if (contextValues.some((c) => c.startsWith('http://schema.org'))) {
      issues.push(
        issue({
          severity: 'info',
          id: 'jsonld-context-http',
          category: CATEGORY,
          title: `${block.label} : @context en http://`,
          detail: 'schema.org recommande la forme https:// depuis 2019.',
          path: `${block.label} > @context`,
          value: contextValues.join(', '),
          fix: 'Utiliser "https://schema.org".',
          docs: DOCS,
        }),
      );
    }

    for (const [i, root] of block.roots.entries()) {
      const rootTypes = typesOf(root);
      const rootPath = block.roots.length > 1 ? `${block.label}[${i}]` : block.label;

      if (rootTypes.length === 0) {
        issues.push(
          issue({
            severity: 'error',
            id: 'jsonld-type-missing',
            category: CATEGORY,
            title: `${rootPath} : @type manquant sur la racine`,
            detail: "Un noeud sans @type n'est interprete par aucun moteur.",
            path: rootPath,
            fix: 'Declarer le @type schema.org correspondant a l\'entite decrite.',
            docs: DOCS,
          }),
        );
      }
      for (const type of rootTypes) {
        const previous = seenRootTypes.get(type);
        if (previous) {
          issues.push(
            issue({
              severity: 'warning',
              id: 'jsonld-duplicate-root-type',
              category: CATEGORY,
              title: `Type ${type} declare dans deux blocs`,
              detail: `Egalement present dans ${previous}. Des entites dupliquees peuvent creer des conflits d'interpretation.`,
              path: rootPath,
              fix: 'Fusionner les blocs, ou differencier les entites via @id.',
              docs: DOCS,
            }),
          );
        } else {
          seenRootTypes.set(type, rootPath);
        }
      }
    }

    // Hygiene des valeurs scalaires.
    for (const root of block.roots) {
      for (const { property, value, path } of walkValues(root)) {
        const where = `${block.label} > ${path}`;

        if (value === null || value === '' || (typeof value === 'string' && value.trim() === '')) {
          issues.push(
            issue({
              severity: 'warning',
              id: 'jsonld-empty-value',
              category: CATEGORY,
              title: `Valeur vide : ${property}`,
              detail: 'Une propriete vide vaut mieux etre omise : elle peut invalider le noeud entier.',
              path: where,
              value: JSON.stringify(value),
              fix: `Supprimer la propriete ${property} ou la renseigner.`,
            }),
          );
          continue;
        }

        if (typeof value !== 'string') continue;

        if (HTML_TAG.test(value) || HTML_ENTITY.test(value)) {
          issues.push(
            issue({
              severity: 'warning',
              id: 'jsonld-html-in-value',
              category: CATEGORY,
              title: `HTML ou entite HTML dans ${property}`,
              detail:
                "Les valeurs JSON-LD doivent etre du texte brut. Les balises et entites sont affichees telles quelles dans les resultats enrichis.",
              path: where,
              value: excerpt(value),
              fix: 'Decoder les entites et retirer les balises avant la serialisation JSON.',
              docs: 'https://developers.google.com/search/docs/appearance/structured-data/sd-policies',
            }),
          );
        }

        if (value !== value.trim()) {
          issues.push(
            issue({
              severity: 'info',
              id: 'jsonld-whitespace',
              category: CATEGORY,
              title: `Espaces superflus dans ${property}`,
              detail: 'Espace en debut ou fin de valeur.',
              path: where,
              value: JSON.stringify(excerpt(value)),
              fix: 'Appliquer un trim a la source.',
            }),
          );
        }

        if (expectsUrl(property) && !/^(https?:)?\/\//i.test(value) && !/^[a-z][a-z0-9+.-]*:/i.test(value)) {
          issues.push(
            issue({
              severity: 'error',
              id: 'jsonld-relative-url',
              category: CATEGORY,
              title: `URL relative dans ${property}`,
              detail:
                "Les URLs des donnees structurees doivent etre absolues : les moteurs ne resolvent pas systematiquement le chemin relatif.",
              path: where,
              value,
              fix: `Prefixer par l'origine du site (https://www.kaufmanbroad.fr...).`,
              docs: 'https://developers.google.com/search/docs/appearance/structured-data/sd-policies',
            }),
          );
        }
      }
    }
  }

  return issues;
}

function excerpt(text, max = 140) {
  const flat = String(text).replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}
