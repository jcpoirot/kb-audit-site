/**
 * Coherence entre les donnees structurees et le contenu reellement affiche.
 * Google penalise (voire ignore) un balisage qui decrit autre chose que la page.
 */
import { issue } from '../issues.js';
import { collectNodes } from '../extract.js';
import { ancestorsOf, isKnownType } from '../vocabulary.js';

const CATEGORY = 'Coherence page / balisage';
const POLICIES = 'https://developers.google.com/search/docs/appearance/structured-data/sd-policies';

function isA(types, target) {
  return types.some((t) => (isKnownType(t) ? ancestorsOf(t).includes(target) : t === target));
}

function normalize(text) {
  return String(text ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // marques diacritiques combinantes
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Proportion des mots de `needle` presents dans `haystack`. */
function coverage(needle, haystack) {
  const words = normalize(needle).split(' ').filter((w) => w.length > 2);
  if (words.length === 0) return 1;
  const bag = new Set(normalize(haystack).split(' '));
  return words.filter((w) => bag.has(w)).length / words.length;
}

function absolutize(value, base) {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    return new URL(value, base).href;
  } catch {
    return null;
  }
}

/** Compare deux URLs en ignorant le slash final et la casse de l'hote. */
function sameUrl(a, b) {
  if (!a || !b) return false;
  const clean = (u) => u.replace(/\/+$/, '').toLowerCase();
  return clean(a) === clean(b);
}

export function checkCoherence(page) {
  const issues = [];
  const nodes = collectNodes(page);
  const roots = nodes.filter((n) => n.isRoot);
  const h1 = page.headings.find((h) => h.level === 1)?.text ?? null;
  const canonical = absolutize(page.head.canonical, page.url);

  // --- Entite principale : name / description / url ---
  const main = roots.find((n) => !isA(n.types, 'BreadcrumbList') && !isA(n.types, 'WebSite')) ?? null;

  if (main) {
    const { node, where } = main;

    if (typeof node.name === 'string' && h1) {
      const ratio = coverage(node.name, h1);
      if (ratio < 0.5) {
        issues.push(
          issue({
            severity: 'warning',
            id: 'coherence-name-h1',
            category: CATEGORY,
            title: 'name des donnees structurees eloigne du H1',
            detail: `name : « ${node.name} » — H1 : « ${h1} ». Seuls ${Math.round(ratio * 100)} % des mots du name se retrouvent dans le H1.`,
            path: `${where} > name`,
            fix: 'Aligner le libelle structure sur le titre visible de la page.',
            docs: POLICIES,
          }),
        );
      }
    }

    if (typeof node.name === 'string' && !h1) {
      issues.push(
        issue({
          severity: 'warning',
          id: 'coherence-no-h1',
          category: CATEGORY,
          title: 'Aucun H1 sur la page',
          detail: 'Impossible de verifier la coherence entre le balisage et le titre visible.',
          fix: 'Ajouter un H1 unique reprenant le nom du programme ou du lot.',
        }),
      );
    }

    if (typeof node.description === 'string' && page.head.description) {
      if (coverage(page.head.description, node.description) < 0.5) {
        issues.push(
          issue({
            severity: 'info',
            id: 'coherence-description-meta',
            category: CATEGORY,
            title: 'description structuree differente de la meta description',
            detail:
              'Ce n\'est pas une erreur, mais deux descriptions divergentes signalent souvent deux sources de donnees non synchronisees.',
            path: `${where} > description`,
            fix: 'Verifier que les deux proviennent du meme champ metier.',
          }),
        );
      }
    }

    const declaredUrl = absolutize(node.url ?? node['@id'], page.url);
    if (declaredUrl && canonical && !sameUrl(declaredUrl, canonical)) {
      issues.push(
        issue({
          severity: 'warning',
          id: 'coherence-url-canonical',
          category: CATEGORY,
          title: 'url du balisage differente de la canonique',
          detail: `Balisage : ${declaredUrl} — canonique : ${canonical}.`,
          path: `${where} > url`,
          fix: 'Faire pointer url et @id vers l\'URL canonique absolue.',
          docs: POLICIES,
        }),
      );
    }
    if (declaredUrl && !sameUrl(declaredUrl, page.url) && !canonical) {
      issues.push(
        issue({
          severity: 'info',
          id: 'coherence-url-page',
          category: CATEGORY,
          title: 'url du balisage differente de l\'URL analysee',
          detail: `Balisage : ${declaredUrl} — page : ${page.url}.`,
          path: `${where} > url`,
          fix: 'Verifier la generation de l\'URL cote back-office.',
        }),
      );
    }
  }

  // --- Fil d'Ariane : le dernier maillon doit designer la page courante ---
  for (const entry of nodes.filter((n) => isA(n.types, 'BreadcrumbList'))) {
    const items = Array.isArray(entry.node.itemListElement) ? entry.node.itemListElement : [];
    const last = items.at(-1);
    if (!last) continue;
    const target = typeof last.item === 'string' ? last.item : last.item?.['@id'] ?? last.item?.url;
    const resolved = absolutize(target, page.url);
    if (!resolved) continue;
    if (!sameUrl(resolved, canonical ?? page.url)) {
      issues.push(
        issue({
          severity: 'warning',
          id: 'coherence-breadcrumb-last',
          category: CATEGORY,
          title: 'Dernier maillon du fil d\'Ariane different de la page courante',
          detail: `Fil d'Ariane : ${resolved} — page : ${canonical ?? page.url}. Google peut alors ignorer tout le fil d'Ariane.`,
          path: `${entry.where} > itemListElement[${items.length - 1}].item`,
          value: target,
          fix: 'Faire pointer le dernier maillon vers l\'URL canonique de la page, ou omettre item sur ce maillon.',
          docs: 'https://developers.google.com/search/docs/appearance/structured-data/breadcrumb',
        }),
      );
    }
  }

  // --- Prix : la valeur balisee doit etre visible sur la page ---
  const priceNodes = nodes.filter((n) => isA(n.types, 'Offer'));
  const digits = page.visibleText.replace(/[\s  .,]/g, '');
  for (const entry of priceNodes) {
    for (const prop of ['price', 'lowPrice', 'highPrice']) {
      const raw = entry.node[prop];
      if (raw == null) continue;
      const amount = String(Math.round(Number(raw)));
      if (!Number.isFinite(Number(raw))) continue;
      if (!digits.includes(amount)) {
        issues.push(
          issue({
            severity: 'warning',
            id: 'coherence-price-hidden',
            category: CATEGORY,
            title: `${prop} (${amount}) introuvable dans le texte visible`,
            detail:
              "Google exige que les donnees structurees decrivent un contenu visible par l'internaute. Un prix balise mais absent de la page est un motif d'action manuelle.",
            path: `${entry.where} > ${prop}`,
            fix: 'Afficher le prix sur la page, ou retirer la propriete du balisage.',
            docs: POLICIES,
          }),
        );
      }
    }
  }

  // --- Image principale vs og:image ---
  if (main) {
    const images = main.node.image == null ? [] : Array.isArray(main.node.image) ? main.node.image : [main.node.image];
    const firstImage = typeof images[0] === 'string' ? images[0] : images[0]?.url ?? null;
    const ogImage = page.head.og.images[0] ?? null;
    if (firstImage && ogImage && !sameUrl(absolutize(firstImage, page.url), absolutize(ogImage, page.url))) {
      issues.push(
        issue({
          severity: 'info',
          id: 'coherence-image-og',
          category: CATEGORY,
          title: 'Image structuree differente de og:image',
          detail: `JSON-LD : ${firstImage} — og:image : ${ogImage}.`,
          path: `${main.where} > image`,
          fix: 'Aligner les deux sur le meme visuel principal.',
        }),
      );
    }
  }

  // --- Balisage concurrent ---
  if (page.otherMarkup.itemscope > 0) {
    issues.push(
      issue({
        severity: 'info',
        id: 'coherence-microdata',
        category: CATEGORY,
        title: `Microdata detecte en plus du JSON-LD (${page.otherMarkup.itemscope} itemscope)`,
        detail:
          page.otherMarkup.itemtypes.length
            ? `Types microdata : ${page.otherMarkup.itemtypes.join(', ')}.`
            : 'Deux syntaxes de balisage coexistent sur la page.',
        fix: 'Verifier que les deux balisages ne se contredisent pas ; Google recommande de n\'en garder qu\'un.',
        docs: POLICIES,
      }),
    );
  }

  return issues;
}
