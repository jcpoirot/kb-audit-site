/**
 * Compile le vocabulaire officiel schema.org (schemaorg-current-https.jsonld)
 * en un index compact utilisable au runtime.
 *
 * Source : https://schema.org/version/latest/schemaorg-current-https.jsonld
 * Sortie  : data/schema-index.json
 *
 *   npm run vocab
 */
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE_URL = 'https://schema.org/version/latest/schemaorg-current-https.jsonld';
const SOURCE_FILE = join(ROOT, 'data', 'schemaorg-current-https.jsonld');
const OUT_FILE = join(ROOT, 'data', 'schema-index.json');

/** "schema:Apartment" -> "Apartment" ; ignore les termes hors namespace schema. */
function localName(id) {
  if (typeof id !== 'string') return null;
  if (id.startsWith('schema:')) return id.slice(7);
  if (id.startsWith('https://schema.org/')) return id.slice(19);
  if (id.startsWith('http://schema.org/')) return id.slice(18);
  return null;
}

/** Les champs du graphe sont tantot un objet, tantot un tableau d'objets. */
function asArray(value) {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function idsOf(value) {
  return asArray(value)
    .map((entry) => localName(typeof entry === 'string' ? entry : entry?.['@id']))
    .filter(Boolean);
}

async function loadSource() {
  try {
    return JSON.parse(await readFile(SOURCE_FILE, 'utf8'));
  } catch {
    process.stdout.write(`Telechargement de ${SOURCE_URL}\n`);
    const res = await fetch(SOURCE_URL);
    if (!res.ok) throw new Error(`schema.org a repondu ${res.status}`);
    const text = await res.text();
    await writeFile(SOURCE_FILE, text, 'utf8');
    return JSON.parse(text);
  }
}

const source = await loadSource();
const graph = source['@graph'] ?? [];

const types = {};
const properties = {};
const enumerationMembers = {};

for (const node of graph) {
  const name = localName(node['@id']);
  if (!name) continue;
  const nodeTypes = asArray(node['@type']).map((t) => (typeof t === 'string' ? t : t?.['@id']));
  const supersededBy = localName(node['schema:supersededBy']?.['@id'] ?? node['schema:supersededBy']);

  if (nodeTypes.includes('rdfs:Class')) {
    types[name] = {
      parents: idsOf(node['rdfs:subClassOf']),
      dataType: nodeTypes.includes('schema:DataType'),
      ...(supersededBy ? { supersededBy } : {}),
    };
  } else if (nodeTypes.includes('rdf:Property')) {
    properties[name] = {
      domains: idsOf(node['schema:domainIncludes']),
      ranges: idsOf(node['schema:rangeIncludes']),
      ...(supersededBy ? { supersededBy } : {}),
    };
  } else {
    // Membre d'enumeration : @type pointe vers la classe d'enumeration.
    const enumType = nodeTypes.map(localName).find(Boolean);
    if (enumType) enumerationMembers[name] = enumType;
  }
}

const index = {
  source: SOURCE_URL,
  types,
  properties,
  enumerationMembers,
};

await writeFile(OUT_FILE, JSON.stringify(index), 'utf8');

process.stdout.write(
  `Index ecrit dans ${OUT_FILE}\n` +
    `  ${Object.keys(types).length} types\n` +
    `  ${Object.keys(properties).length} proprietes\n` +
    `  ${Object.keys(enumerationMembers).length} membres d'enumeration\n`,
);
