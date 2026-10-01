/**
 * Utilitaires d'extraction HTML sans dependance externe.
 * Volontairement tolerant : on cible des balises bien formees (head, meta, script)
 * plutot que de construire un DOM complet.
 */

const NAMED_ENTITIES = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  eacute: 'é',
  egrave: 'è',
  agrave: 'à',
  ccedil: 'ç',
  ocirc: 'ô',
  ecirc: 'ê',
  ugrave: 'ù',
  laquo: '«',
  raquo: '»',
  euro: '€',
  hellip: '…',
  rsquo: '’',
  deg: '°',
  sup2: '²',
};

export function decodeEntities(text) {
  if (typeof text !== 'string') return text;
  return text.replace(/&(#x?[0-9a-f]+|[a-z][a-z0-9]*);/gi, (match, entity) => {
    if (entity[0] === '#') {
      const code = entity[1] === 'x' || entity[1] === 'X'
        ? Number.parseInt(entity.slice(2), 16)
        : Number.parseInt(entity.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    const named = NAMED_ENTITIES[entity.toLowerCase()];
    return named ?? match;
  });
}

/** Parse les attributs d'une balise ouvrante. */
export function parseAttributes(tag) {
  const attrs = {};
  const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
  // On saute le nom de la balise elle-meme.
  const body = tag.replace(/^<\s*[a-zA-Z0-9-]+/, '');
  let match;
  while ((match = re.exec(body)) !== null) {
    const value = match[2] ?? match[3] ?? match[4] ?? '';
    attrs[match[1].toLowerCase()] = decodeEntities(value);
  }
  return attrs;
}

/** Blocs <script type="application/ld+json"> avec leur contenu brut. */
export function extractJsonLdBlocks(html) {
  const blocks = [];
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
  let match;
  while ((match = re.exec(html)) !== null) {
    const attrs = parseAttributes(`<script ${match[1]}`);
    const type = (attrs.type ?? '').toLowerCase().trim();
    if (type !== 'application/ld+json') continue;
    blocks.push({
      raw: match[2].trim(),
      offset: match.index,
      line: html.slice(0, match.index).split('\n').length,
    });
  }
  return blocks;
}

/** Toutes les balises meta du document, sous forme de liste d'attributs. */
export function extractMetaTags(html) {
  const metas = [];
  const re = /<meta\b[^>]*>/gi;
  let match;
  while ((match = re.exec(html)) !== null) metas.push(parseAttributes(match[0]));
  return metas;
}

export function extractLinkTags(html) {
  const links = [];
  const re = /<link\b[^>]*>/gi;
  let match;
  while ((match = re.exec(html)) !== null) links.push(parseAttributes(match[0]));
  return links;
}

/** Recherche une meta par name= ou property= (insensible a la casse). */
export function findMeta(metas, key) {
  const needle = key.toLowerCase();
  const hit = metas.find(
    (meta) =>
      (meta.name ?? '').toLowerCase() === needle ||
      (meta.property ?? '').toLowerCase() === needle ||
      (meta['http-equiv'] ?? '').toLowerCase() === needle,
  );
  return hit ? (hit.content ?? '') : null;
}

/** Toutes les occurrences d'une meta (utile pour og:image multiples). */
export function findAllMeta(metas, key) {
  const needle = key.toLowerCase();
  return metas
    .filter(
      (meta) =>
        (meta.name ?? '').toLowerCase() === needle || (meta.property ?? '').toLowerCase() === needle,
    )
    .map((meta) => meta.content ?? '');
}

export function extractTitle(html) {
  const match = /<title\b[^>]*>([\s\S]*?)<\/title\s*>/i.exec(html);
  return match ? decodeEntities(match[1]).trim() : null;
}

export function extractHtmlLang(html) {
  const match = /<html\b[^>]*>/i.exec(html);
  return match ? (parseAttributes(match[0]).lang ?? null) : null;
}

/** Titres h1..h6 avec leur niveau et leur texte. */
export function extractHeadings(html) {
  const headings = [];
  const re = /<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1\s*>/gi;
  let match;
  while ((match = re.exec(html)) !== null) {
    headings.push({ level: Number(match[1]), text: toText(match[2]) });
  }
  return headings;
}

export function extractImages(html) {
  const images = [];
  const re = /<img\b[^>]*>/gi;
  let match;
  while ((match = re.exec(html)) !== null) {
    const attrs = parseAttributes(match[0]);
    images.push({ src: attrs.src ?? attrs['data-src'] ?? '', alt: attrs.alt ?? null, loading: attrs.loading ?? null });
  }
  return images;
}

/** Detection de microdata / RDFa, pour signaler un balisage concurrent au JSON-LD. */
export function detectOtherMarkup(html) {
  const itemscope = (html.match(/\bitemscope\b/gi) ?? []).length;
  const itemtypes = [...html.matchAll(/\bitemtype\s*=\s*["']([^"']+)["']/gi)].map((m) => m[1]);
  const rdfa = (html.match(/\btypeof\s*=\s*["']/gi) ?? []).length;
  return { itemscope, itemtypes: [...new Set(itemtypes)], rdfa };
}

/** Texte visible approximatif : scripts, styles et balises retires. */
export function toText(html) {
  return decodeEntities(
    String(html)
      .replace(/<script\b[\s\S]*?<\/script\s*>/gi, ' ')
      .replace(/<style\b[\s\S]*?<\/style\s*>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/\s+/g, ' ')
    .trim();
}
