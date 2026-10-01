/**
 * Transforme le HTML brut en une representation exploitable par les controles :
 * blocs JSON-LD parses, meta/head, titres, images, balisage concurrent.
 */
import {
  detectOtherMarkup,
  extractHeadings,
  extractHtmlLang,
  extractImages,
  extractJsonLdBlocks,
  extractLinkTags,
  extractMetaTags,
  extractTitle,
  findAllMeta,
  findMeta,
  toText,
} from './html.js';

/** Normalise @type en tableau de chaines. */
export function typesOf(node) {
  const raw = node?.['@type'];
  if (raw == null) return [];
  return (Array.isArray(raw) ? raw : [raw])
    .filter((t) => typeof t === 'string')
    .map((t) => t.replace(/^https?:\/\/schema\.org\//, '').replace(/^schema:/, ''));
}

/** Racines d'un document JSON-LD : tableau, @graph ou objet unique. */
export function rootsOf(parsed) {
  if (Array.isArray(parsed)) return parsed.filter((n) => n && typeof n === 'object');
  if (parsed && typeof parsed === 'object') {
    if (Array.isArray(parsed['@graph'])) return parsed['@graph'].filter((n) => n && typeof n === 'object');
    return [parsed];
  }
  return [];
}

/**
 * Parcourt en profondeur tous les objets d'un noeud JSON-LD.
 * @yields {{node: object, path: string, types: string[], depth: number}}
 */
export function* walkNodes(node, path = '', depth = 0) {
  if (!node || typeof node !== 'object' || Array.isArray(node)) return;
  yield { node, path, types: typesOf(node), depth };
  for (const [key, value] of Object.entries(node)) {
    if (key.startsWith('@') && key !== '@graph') continue;
    const childPath = path ? `${path}.${key}` : key;
    if (Array.isArray(value)) {
      for (const [i, item] of value.entries()) {
        yield* walkNodes(item, `${childPath}[${i}]`, depth + 1);
      }
    } else {
      yield* walkNodes(value, childPath, depth + 1);
    }
  }
}

/** Parcourt toutes les valeurs scalaires, avec leur chemin et leur propriete. */
export function* walkValues(node, path = '') {
  if (!node || typeof node !== 'object') return;
  for (const [key, value] of Object.entries(node)) {
    const childPath = path ? `${path}.${key}` : key;
    if (Array.isArray(value)) {
      for (const [i, item] of value.entries()) {
        const itemPath = `${childPath}[${i}]`;
        if (item && typeof item === 'object') yield* walkValues(item, itemPath);
        else yield { property: key, value: item, path: itemPath, parent: node };
      }
    } else if (value && typeof value === 'object') {
      yield* walkValues(value, childPath);
    } else {
      yield { property: key, value, path: childPath, parent: node };
    }
  }
}

/**
 * Aplatit tous les noeuds de tous les blocs valides d'une page.
 * @returns {{node: object, types: string[], path: string, depth: number, block: object, isRoot: boolean}[]}
 */
export function collectNodes(page) {
  const collected = [];
  for (const block of page.blocks) {
    if (block.parseError) continue;
    for (const root of block.roots) {
      for (const entry of walkNodes(root)) {
        collected.push({
          ...entry,
          block,
          isRoot: entry.depth === 0,
          where: entry.path ? `${block.label} > ${entry.path}` : block.label,
        });
      }
    }
  }
  return collected;
}

/** Noeuds dont le @type correspond a l'un des types demandes. */
export function nodesOfType(page, ...wanted) {
  const set = new Set(wanted);
  return collectNodes(page).filter((entry) => entry.types.some((t) => set.has(t)));
}

function parseBlocks(html) {
  return extractJsonLdBlocks(html).map((block, i) => {
    const label = `bloc ${i + 1}`;
    try {
      const parsed = JSON.parse(block.raw);
      const roots = rootsOf(parsed);
      return {
        index: i,
        label,
        line: block.line,
        raw: block.raw,
        parsed,
        parseError: null,
        roots,
        types: roots.flatMap(typesOf),
      };
    } catch (err) {
      return {
        index: i,
        label,
        line: block.line,
        raw: block.raw,
        parsed: null,
        parseError: err.message,
        roots: [],
        types: [],
      };
    }
  });
}

/**
 * @param {string} html
 * @param {string} finalUrl URL apres redirections, sert de base pour resoudre les liens relatifs
 */
export function extractPage(html, finalUrl) {
  const metas = extractMetaTags(html);
  const links = extractLinkTags(html);
  const headings = extractHeadings(html);
  const canonicalLink = links.find((l) => (l.rel ?? '').toLowerCase() === 'canonical');
  const alternates = links.filter((l) => (l.rel ?? '').toLowerCase() === 'alternate' && l.hreflang);

  // Le texte visible sert aux controles de coherence contenu / donnees structurees.
  const bodyMatch = /<body\b[^>]*>([\s\S]*)<\/body\s*>/i.exec(html);
  const visibleText = toText(bodyMatch ? bodyMatch[1] : html);

  return {
    url: finalUrl,
    html,
    visibleText,
    head: {
      title: extractTitle(html),
      lang: extractHtmlLang(html),
      description: findMeta(metas, 'description'),
      robots: findMeta(metas, 'robots'),
      viewport: findMeta(metas, 'viewport'),
      canonical: canonicalLink?.href ?? null,
      alternates: alternates.map((l) => ({ hreflang: l.hreflang, href: l.href ?? '' })),
      og: {
        title: findMeta(metas, 'og:title'),
        description: findMeta(metas, 'og:description'),
        url: findMeta(metas, 'og:url'),
        type: findMeta(metas, 'og:type'),
        siteName: findMeta(metas, 'og:site_name'),
        locale: findMeta(metas, 'og:locale'),
        images: findAllMeta(metas, 'og:image'),
        imageWidth: findMeta(metas, 'og:image:width'),
        imageHeight: findMeta(metas, 'og:image:height'),
        imageAlt: findMeta(metas, 'og:image:alt'),
      },
      twitter: {
        card: findMeta(metas, 'twitter:card'),
        title: findMeta(metas, 'twitter:title'),
        description: findMeta(metas, 'twitter:description'),
        image: findMeta(metas, 'twitter:image'),
        site: findMeta(metas, 'twitter:site'),
      },
    },
    headings,
    images: extractImages(html),
    otherMarkup: detectOtherMarkup(html),
    blocks: parseBlocks(html),
  };
}
