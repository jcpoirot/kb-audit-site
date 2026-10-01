/**
 * Audit du <head> et de la structure editoriale : title, meta, canonique,
 * Open Graph, Twitter Card, hierarchie de titres, attributs alt.
 */
import { issue } from '../issues.js';

const CATEGORY = 'Head & meta';

const TITLE_MIN = 30;
const TITLE_MAX = 65;
const DESC_MIN = 70;
const DESC_MAX = 160;

function absolutize(value, base) {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    return new URL(value, base).href;
  } catch {
    return null;
  }
}

function isAbsolute(value) {
  return typeof value === 'string' && /^https?:\/\//i.test(value.trim());
}

export function checkMeta(page) {
  const issues = [];
  const { head } = page;

  // --- title ---
  if (!head.title) {
    issues.push(
      issue({
        severity: 'error',
        id: 'meta-title-missing',
        category: CATEGORY,
        title: 'Balise <title> absente',
        fix: 'Ajouter un title unique et descriptif.',
      }),
    );
  } else {
    const len = head.title.length;
    if (len < TITLE_MIN || len > TITLE_MAX) {
      issues.push(
        issue({
          severity: len > TITLE_MAX ? 'warning' : 'info',
          id: 'meta-title-length',
          category: CATEGORY,
          title: `Longueur du title : ${len} caracteres`,
          detail: `Cible ${TITLE_MIN}-${TITLE_MAX} caracteres. Au-dela, Google tronque l'affichage.`,
          value: head.title,
          fix: 'Ajuster la longueur du title.',
        }),
      );
    }
  }

  // --- meta description ---
  if (!head.description) {
    issues.push(
      issue({
        severity: 'warning',
        id: 'meta-description-missing',
        category: CATEGORY,
        title: 'Meta description absente',
        detail: 'Google genere alors un extrait arbitraire depuis le contenu.',
        fix: 'Ajouter une meta description unique.',
      }),
    );
  } else {
    const len = head.description.length;
    if (len < DESC_MIN || len > DESC_MAX) {
      issues.push(
        issue({
          severity: 'info',
          id: 'meta-description-length',
          category: CATEGORY,
          title: `Longueur de la meta description : ${len} caracteres`,
          detail: `Cible ${DESC_MIN}-${DESC_MAX} caracteres.`,
          value: head.description,
          fix: 'Ajuster la longueur de la description.',
        }),
      );
    }
  }

  // --- canonique ---
  if (!head.canonical) {
    issues.push(
      issue({
        severity: 'warning',
        id: 'meta-canonical-missing',
        category: CATEGORY,
        title: 'Balise canonique absente',
        fix: 'Ajouter <link rel="canonical" href="URL absolue">.',
        docs: 'https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls',
      }),
    );
  } else if (!isAbsolute(head.canonical)) {
    issues.push(
      issue({
        severity: 'error',
        id: 'meta-canonical-relative',
        category: CATEGORY,
        title: 'Balise canonique en URL relative',
        detail:
          "Google recommande explicitement une URL absolue pour rel=canonical : une URL relative peut etre mal resolue et pointer vers une page inexistante.",
        value: head.canonical,
        fix: `Utiliser ${absolutize(head.canonical, page.url) ?? 'l\'URL absolue'}.`,
        docs: 'https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls',
      }),
    );
  } else {
    const canonical = absolutize(head.canonical, page.url);
    if (canonical && canonical.replace(/\/+$/, '') !== page.url.replace(/\/+$/, '')) {
      issues.push(
        issue({
          severity: 'info',
          id: 'meta-canonical-cross',
          category: CATEGORY,
          title: 'Canonique pointant vers une autre URL',
          detail: `Page analysee : ${page.url} — canonique : ${canonical}.`,
          value: canonical,
          fix: 'Verifier que la desindexation de cette URL est bien voulue.',
        }),
      );
    }
  }

  // --- robots ---
  if (head.robots && /noindex/i.test(head.robots)) {
    issues.push(
      issue({
        severity: 'error',
        id: 'meta-robots-noindex',
        category: CATEGORY,
        title: 'Page en noindex',
        detail: 'La page est explicitement exclue de l\'index : aucun resultat enrichi possible.',
        value: head.robots,
        fix: 'Retirer noindex si la page doit etre indexee.',
      }),
    );
  }

  // --- langue ---
  if (!head.lang) {
    issues.push(
      issue({
        severity: 'warning',
        id: 'meta-lang-missing',
        category: CATEGORY,
        title: 'Attribut lang absent sur <html>',
        fix: 'Ajouter lang="fr".',
      }),
    );
  }

  if (!head.viewport) {
    issues.push(
      issue({
        severity: 'warning',
        id: 'meta-viewport-missing',
        category: CATEGORY,
        title: 'Meta viewport absente',
        detail: 'Indispensable pour l\'indexation mobile-first.',
        fix: 'Ajouter <meta name="viewport" content="width=device-width, initial-scale=1">.',
      }),
    );
  }

  // --- Open Graph ---
  const ogRequired = [
    ['title', 'warning'],
    ['description', 'warning'],
    ['url', 'warning'],
    ['type', 'warning'],
    ['siteName', 'info'],
    ['locale', 'info'],
  ];
  for (const [key, severity] of ogRequired) {
    if (head.og[key]) continue;
    const tag = key === 'siteName' ? 'og:site_name' : `og:${key}`;
    issues.push(
      issue({
        severity,
        id: `meta-og-${key.toLowerCase()}`,
        category: CATEGORY,
        title: `${tag} absent`,
        detail: 'Utilise pour les partages sociaux et par certains agregateurs immobiliers.',
        fix: `Ajouter <meta property="${tag}" content="…">.`,
        docs: 'https://ogp.me/',
      }),
    );
  }
  if (head.og.url && !isAbsolute(head.og.url)) {
    issues.push(
      issue({
        severity: 'error',
        id: 'meta-og-url-relative',
        category: CATEGORY,
        title: 'og:url en URL relative',
        detail: 'Open Graph exige une URL absolue ; les partages sociaux seront casses.',
        value: head.og.url,
        fix: `Utiliser ${absolutize(head.og.url, page.url) ?? 'l\'URL absolue'}.`,
        docs: 'https://ogp.me/',
      }),
    );
  }
  if (head.og.images.length === 0) {
    issues.push(
      issue({
        severity: 'warning',
        id: 'meta-og-image-missing',
        category: CATEGORY,
        title: 'og:image absent',
        fix: 'Ajouter une image de partage de 1200x630 px.',
        docs: 'https://ogp.me/',
      }),
    );
  } else if (!head.og.imageWidth || !head.og.imageHeight) {
    issues.push(
      issue({
        severity: 'info',
        id: 'meta-og-image-dimensions',
        category: CATEGORY,
        title: 'Dimensions og:image non declarees',
        detail: 'og:image:width et og:image:height evitent un rendu differe du partage.',
        fix: 'Ajouter og:image:width et og:image:height.',
      }),
    );
  }

  // --- Twitter Card ---
  if (!head.twitter.card) {
    issues.push(
      issue({
        severity: 'info',
        id: 'meta-twitter-card',
        category: CATEGORY,
        title: 'twitter:card absent',
        fix: 'Ajouter <meta name="twitter:card" content="summary_large_image">.',
      }),
    );
  }

  // --- hreflang ---
  if (head.alternates.length > 0 && !head.alternates.some((a) => a.hreflang.toLowerCase() === 'x-default')) {
    issues.push(
      issue({
        severity: 'info',
        id: 'meta-hreflang-xdefault',
        category: CATEGORY,
        title: 'hreflang sans x-default',
        detail: `${head.alternates.length} alternatives declarees, aucune x-default.`,
        fix: 'Ajouter <link rel="alternate" hreflang="x-default" href="…">.',
      }),
    );
  }

  // --- titres ---
  const h1s = page.headings.filter((h) => h.level === 1);
  if (h1s.length === 0) {
    issues.push(
      issue({
        severity: 'error',
        id: 'meta-h1-missing',
        category: CATEGORY,
        title: 'Aucun H1',
        fix: 'Ajouter un H1 unique.',
      }),
    );
  } else if (h1s.length > 1) {
    issues.push(
      issue({
        severity: 'warning',
        id: 'meta-h1-multiple',
        category: CATEGORY,
        title: `${h1s.length} balises H1`,
        detail: h1s.map((h) => `« ${h.text.slice(0, 60)} »`).join(' / '),
        fix: 'Ne conserver qu\'un seul H1.',
      }),
    );
  }

  const skipped = [];
  let previous = 0;
  for (const heading of page.headings) {
    if (previous && heading.level > previous + 1) {
      skipped.push(`H${previous} → H${heading.level} (« ${heading.text.slice(0, 40)} »)`);
    }
    previous = heading.level;
  }
  if (skipped.length) {
    issues.push(
      issue({
        severity: 'info',
        id: 'meta-heading-skip',
        category: CATEGORY,
        title: `Niveaux de titres sautes (${skipped.length})`,
        detail: skipped.slice(0, 5).join(' ; '),
        fix: 'Respecter la progression H1 > H2 > H3.',
      }),
    );
  }

  // --- images ---
  const withoutAlt = page.images.filter((img) => img.alt === null || img.alt.trim() === '');
  if (page.images.length && withoutAlt.length) {
    issues.push(
      issue({
        severity: 'info',
        id: 'meta-img-alt',
        category: CATEGORY,
        title: `${withoutAlt.length} image(s) sur ${page.images.length} sans attribut alt`,
        detail: 'Le texte alternatif alimente Google Images et l\'accessibilite.',
        fix: 'Renseigner alt sur les visuels porteurs de sens.',
      }),
    );
  }

  return issues;
}
