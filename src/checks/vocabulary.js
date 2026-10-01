/**
 * Conformite au vocabulaire schema.org : types connus, proprietes valides
 * pour le type porteur (heritage compris), coherence des ranges, termes obsoletes.
 */
import { issue } from '../issues.js';
import { typesOf, walkNodes } from '../extract.js';
import {
  DATA_TYPES,
  allowedPropertiesOfTypes,
  ancestorsOf,
  getProperty,
  getType,
  isEnumerationType,
  isKnownProperty,
  isKnownType,
  suggestProperty,
  suggestType,
} from '../vocabulary.js';

const CATEGORY = 'Vocabulaire schema.org';
const docsForType = (type) => `https://schema.org/${type}`;

const NUMERIC_RANGES = new Set(['Number', 'Integer', 'Float']);
const TEXTUAL_RANGES = new Set(['Text', 'URL', 'Date', 'DateTime', 'Time', 'Duration', 'CssSelectorType', 'XPathType', 'PronounceableText']);

/** Les moteurs tolerent ces cles JSON-LD hors vocabulaire. */
const RESERVED_KEYS = new Set(['@context', '@type', '@id', '@graph', '@reverse', '@language', '@value', '@list', '@set']);

function isUrlLike(value) {
  return typeof value === 'string' && /^(https?:)?\/\//i.test(value);
}

/**
 * Verifie qu'une valeur est compatible avec au moins un des ranges declares.
 * Volontairement permissif : on ne signale que les incompatibilites franches.
 */
function rangeVerdict(ranges, value) {
  if (ranges.length === 0) return 'ok';

  if (Array.isArray(value)) return 'ok'; // chaque element est verifie separement par le walker

  if (value && typeof value === 'object') {
    const valueTypes = typesOf(value);
    if (valueTypes.length === 0) return 'ok'; // noeud sans type : deja signale ailleurs
    const compatible = valueTypes.some((vt) =>
      isKnownType(vt) ? ancestorsOf(vt).some((a) => ranges.includes(a)) : true,
    );
    return compatible ? 'ok' : 'object-mismatch';
  }

  if (typeof value === 'number') {
    if (ranges.some((r) => NUMERIC_RANGES.has(r) || r === 'Text')) return 'ok';
    return 'number-mismatch';
  }

  if (typeof value === 'boolean') {
    return ranges.includes('Boolean') || ranges.includes('Text') ? 'ok' : 'boolean-mismatch';
  }

  if (typeof value === 'string') {
    if (ranges.some((r) => TEXTUAL_RANGES.has(r) || DATA_TYPES.has(r))) return 'ok';
    // Une URL peut referencer n'importe quelle entite (identifiant JSON-LD).
    if (isUrlLike(value)) return 'ok';
    // Un membre d'enumeration peut etre donne sous forme de chaine.
    if (ranges.some((r) => isEnumerationType(r))) return 'ok';
    if (ranges.some((r) => NUMERIC_RANGES.has(r)) && /^-?\d+([.,]\d+)?$/.test(value.trim())) {
      return 'number-as-string';
    }
    return 'string-mismatch';
  }

  return 'ok';
}

export function checkVocabulary(page) {
  const issues = [];
  const reportedUnknownTypes = new Set();

  for (const block of page.blocks) {
    if (block.parseError) continue;

    for (const root of block.roots) {
      for (const { node, path, types } of walkNodes(root)) {
        const where = path ? `${block.label} > ${path}` : block.label;

        // --- Types ---
        for (const type of types) {
          if (!isKnownType(type)) {
            const key = `${type}@${where}`;
            if (reportedUnknownTypes.has(key)) continue;
            reportedUnknownTypes.add(key);
            const suggestions = suggestType(type);
            issues.push(
              issue({
                severity: 'error',
                id: 'schema-unknown-type',
                category: CATEGORY,
                title: `Type inconnu : ${type}`,
                detail:
                  "Ce type n'existe pas dans le vocabulaire schema.org publie : le noeud est ignore par les moteurs. " +
                  'Verifier qu\'il ne provient pas d\'une extension « pending » non validee.',
                path: where,
                value: type,
                fix: suggestions.length
                  ? `Remplacer par un type existant : ${suggestions.join(', ')}.`
                  : 'Utiliser un type existant de schema.org.',
                docs: 'https://schema.org/docs/full.html',
              }),
            );
            continue;
          }
          const def = getType(type);
          if (def?.supersededBy) {
            issues.push(
              issue({
                severity: 'warning',
                id: 'schema-deprecated-type',
                category: CATEGORY,
                title: `Type obsolete : ${type}`,
                detail: `schema.org remplace ${type} par ${def.supersededBy}.`,
                path: where,
                fix: `Migrer vers ${def.supersededBy}.`,
                docs: docsForType(type),
              }),
            );
          }
        }

        const knownTypes = types.filter(isKnownType);
        const allowed = allowedPropertiesOfTypes(knownTypes);

        // --- Proprietes ---
        for (const [property, value] of Object.entries(node)) {
          if (RESERVED_KEYS.has(property)) continue;

          if (!isKnownProperty(property)) {
            const suggestions = suggestProperty(property, knownTypes);
            issues.push(
              issue({
                severity: 'error',
                id: 'schema-unknown-property',
                category: CATEGORY,
                title: `Propriete inconnue : ${property}`,
                detail: "Cette propriete n'existe pas dans schema.org : elle est ignoree par les moteurs.",
                path: `${where} > ${property}`,
                value: typeof value === 'object' ? JSON.stringify(value).slice(0, 120) : String(value).slice(0, 120),
                fix: suggestions.length
                  ? `Remplacer par une propriete existante : ${suggestions.join(', ')}.`
                  : 'Supprimer la propriete ou utiliser un terme du vocabulaire.',
                docs: 'https://schema.org/docs/full.html',
              }),
            );
            continue;
          }

          const def = getProperty(property);

          if (def.supersededBy) {
            issues.push(
              issue({
                severity: 'warning',
                id: 'schema-deprecated-property',
                category: CATEGORY,
                title: `Propriete obsolete : ${property}`,
                detail: `schema.org remplace ${property} par ${def.supersededBy}.`,
                path: `${where} > ${property}`,
                fix: `Migrer vers ${def.supersededBy}.`,
                docs: `https://schema.org/${property}`,
              }),
            );
          }

          if (knownTypes.length > 0 && !allowed.has(property)) {
            const validOn = def.domains.slice(0, 4).join(', ');
            issues.push(
              issue({
                severity: 'warning',
                id: 'schema-property-out-of-domain',
                category: CATEGORY,
                title: `${property} n'est pas une propriete de ${knownTypes.join(' + ')}`,
                detail: `schema.org declare ${property} sur : ${validOn}${def.domains.length > 4 ? '…' : ''}. Hors domaine, la propriete est ignoree (et signalee par le Rich Results Test).`,
                path: `${where} > ${property}`,
                fix: `Ajouter un type compatible au noeud (ex. "@type": ["${knownTypes[0]}", "${def.domains[0]}"]) ou deplacer la propriete.`,
                docs: `https://schema.org/${property}`,
              }),
            );
          }

          // --- Ranges ---
          const values = Array.isArray(value) ? value : [value];
          for (const [i, item] of values.entries()) {
            const suffix = Array.isArray(value) ? `[${i}]` : '';
            const verdict = rangeVerdict(def.ranges, item);
            if (verdict === 'ok') continue;
            const expected = def.ranges.join(' | ');
            const messages = {
              'object-mismatch': `objet de type ${typesOf(item).join(', ') || '?'}`,
              'number-mismatch': 'nombre',
              'boolean-mismatch': 'booleen',
              'string-mismatch': 'chaine de caracteres',
              'number-as-string': 'nombre encode en chaine',
            };
            issues.push(
              issue({
                severity: verdict === 'number-as-string' ? 'info' : 'warning',
                id: 'schema-range-mismatch',
                category: CATEGORY,
                title: `Type de valeur inattendu pour ${property}`,
                detail: `schema.org attend ${expected}, la valeur fournie est un ${messages[verdict]}.`,
                path: `${where} > ${property}${suffix}`,
                value: typeof item === 'object' ? JSON.stringify(item).slice(0, 120) : String(item).slice(0, 120),
                fix:
                  verdict === 'number-as-string'
                    ? 'Serialiser la valeur en nombre JSON, sans guillemets.'
                    : `Fournir une valeur de type ${def.ranges[0]}.`,
                docs: `https://schema.org/${property}`,
              }),
            );
          }
        }
      }
    }
  }

  return issues;
}
