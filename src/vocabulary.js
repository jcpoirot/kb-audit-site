/**
 * Acces au vocabulaire schema.org compile (data/schema-index.json).
 * Resout la hierarchie des types et les proprietes autorisees par heritage.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

let index;
try {
  index = JSON.parse(readFileSync(join(ROOT, 'data', 'schema-index.json'), 'utf8'));
} catch (err) {
  throw new Error(
    "data/schema-index.json est absent ou illisible. Lancez `npm run vocab` pour le generer.\n" + err.message,
  );
}

const { types, properties, enumerationMembers } = index;

const ancestorCache = new Map();
const allowedPropsCache = new Map();

/** Types de donnees scalaires de schema.org. */
export const DATA_TYPES = new Set(
  Object.entries(types)
    .filter(([, def]) => def.dataType)
    .map(([name]) => name),
);

export function isKnownType(type) {
  return Object.hasOwn(types, type);
}

export function isKnownProperty(prop) {
  return Object.hasOwn(properties, prop);
}

export function getProperty(prop) {
  return properties[prop] ?? null;
}

export function getType(type) {
  return types[type] ?? null;
}

/** Le type lui-meme suivi de tous ses ancetres (ordre de decouverte, sans doublon). */
export function ancestorsOf(type) {
  if (ancestorCache.has(type)) return ancestorCache.get(type);
  const seen = new Set();
  const queue = [type];
  while (queue.length) {
    const current = queue.shift();
    if (seen.has(current) || !types[current]) continue;
    seen.add(current);
    queue.push(...types[current].parents);
  }
  const result = [...seen];
  ancestorCache.set(type, result);
  return result;
}

/** true si `candidate` est `type` ou l'un de ses ancetres. */
export function isTypeOrAncestor(candidate, type) {
  return ancestorsOf(type).includes(candidate);
}

/** Ensemble des proprietes declarees pour ce type ou l'un de ses ancetres. */
export function allowedPropertiesOf(type) {
  if (allowedPropsCache.has(type)) return allowedPropsCache.get(type);
  const family = new Set(ancestorsOf(type));
  const allowed = new Set();
  for (const [name, def] of Object.entries(properties)) {
    if (def.domains.some((domain) => family.has(domain))) allowed.add(name);
  }
  allowedPropsCache.set(type, allowed);
  return allowed;
}

/** Un noeud peut porter plusieurs @type : on prend l'union des proprietes autorisees. */
export function allowedPropertiesOfTypes(typeList) {
  const union = new Set();
  for (const type of typeList) {
    if (!isKnownType(type)) continue;
    for (const prop of allowedPropertiesOf(type)) union.add(prop);
  }
  return union;
}

/** Classe d'enumeration d'un membre ("InStock" -> "ItemAvailability"). */
export function enumerationOf(member) {
  return enumerationMembers[member] ?? null;
}

/** true si le type donne est une enumeration schema.org. */
export function isEnumerationType(type) {
  return isKnownType(type) && ancestorsOf(type).includes('Enumeration');
}

/** Distance de Levenshtein bornee, utilisee pour suggerer une correction de frappe. */
function distance(a, b) {
  if (Math.abs(a.length - b.length) > 3) return 99;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  const row = new Array(b.length + 1);
  for (let i = 1; i <= a.length; i += 1) {
    row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      row[j] = Math.min(row[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    prev.splice(0, prev.length, ...row);
  }
  return prev[b.length];
}

/** Decoupe un terme camelCase en mots minuscules. */
function tokens(term) {
  return term
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 2);
}

/**
 * Suggestion en deux passes : faute de frappe (Levenshtein), puis
 * proximite semantique par mots partages ("HousingComplex" -> "ApartmentComplex").
 * @returns {string[]} au plus 3 candidats, du plus proche au moins proche
 */
function closest(term, candidates) {
  const needle = term.toLowerCase();
  const typos = [];
  for (const candidate of candidates) {
    const score = distance(needle, candidate.toLowerCase());
    if (score < 3) typos.push({ candidate, score });
  }
  if (typos.length) {
    return typos.sort((a, b) => a.score - b.score).slice(0, 3).map((t) => t.candidate);
  }

  const wanted = new Set(tokens(term));
  if (wanted.size === 0) return [];
  const shared = [];
  for (const candidate of candidates) {
    const overlap = tokens(candidate).filter((t) => wanted.has(t)).length;
    if (overlap > 0) shared.push({ candidate, overlap });
  }
  // A nombre de mots partages egal, l'ordre alphabetique garde un resultat stable
  // (la longueur du terme ne dit rien de sa pertinence).
  return shared
    .sort((a, b) => b.overlap - a.overlap || a.candidate.localeCompare(b.candidate))
    .slice(0, 3)
    .map((s) => s.candidate);
}

/** @returns {string[]} types schema.org les plus proches du terme fourni */
export function suggestType(type) {
  return closest(type, Object.keys(types));
}

/**
 * Suggestion restreinte aux proprietes valides pour les types du noeud, si possible.
 * @returns {string[]}
 */
export function suggestProperty(prop, typeList = []) {
  const scoped = allowedPropertiesOfTypes(typeList);
  return closest(prop, scoped.size ? scoped : Object.keys(properties));
}

export const vocabularySource = index.source;
