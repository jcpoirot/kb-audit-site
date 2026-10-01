/**
 * Eligibilite aux resultats enrichis Google.
 * Reference : https://developers.google.com/search/docs/appearance/structured-data/search-gallery
 *
 * Deux sorties :
 *  - `issues`   : champs requis / recommandes manquants sur les entites detectees
 *  - `features` : tableau de bord d'eligibilite par type de resultat enrichi
 */
import { issue } from '../issues.js';
import { collectNodes } from '../extract.js';
import { ancestorsOf, isKnownType } from '../vocabulary.js';

const CATEGORY = 'Resultats enrichis Google';
const GALLERY = 'https://developers.google.com/search/docs/appearance/structured-data/search-gallery';

const first = (value) => (Array.isArray(value) ? value[0] : value);
const has = (node, prop) => {
  const value = node?.[prop];
  if (value == null) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'string') return value.trim() !== '';
  return true;
};
const hasAny = (node, props) => props.some((p) => has(node, p));

/** true si le noeud est du type demande ou d'un sous-type. */
function isA(types, target) {
  return types.some((t) => (isKnownType(t) ? ancestorsOf(t).includes(target) : t === target));
}

// ---------------------------------------------------------------------------
// Fil d'Ariane
// ---------------------------------------------------------------------------

function checkBreadcrumb(entry, issues) {
  const { node, where } = entry;
  const items = node.itemListElement;

  if (!Array.isArray(items) || items.length === 0) {
    issues.push(
      issue({
        severity: 'error',
        id: 'google-breadcrumb-empty',
        category: CATEGORY,
        title: 'BreadcrumbList sans itemListElement',
        detail: 'Google exige au moins un ListItem pour afficher un fil d\'Ariane.',
        path: where,
        fix: 'Renseigner itemListElement avec la liste ordonnee des ListItem.',
        docs: 'https://developers.google.com/search/docs/appearance/structured-data/breadcrumb',
      }),
    );
    return;
  }

  const positions = [];
  items.forEach((item, i) => {
    const itemPath = `${where} > itemListElement[${i}]`;
    const isLast = i === items.length - 1;

    if (!has(item, 'name')) {
      issues.push(
        issue({
          severity: 'error',
          id: 'google-breadcrumb-item-name',
          category: CATEGORY,
          title: `ListItem ${i + 1} sans name`,
          detail: 'Le libelle affiche dans le fil d\'Ariane est obligatoire.',
          path: itemPath,
          fix: 'Ajouter la propriete name (ou item.name si item est un objet).',
          docs: 'https://developers.google.com/search/docs/appearance/structured-data/breadcrumb',
        }),
      );
    }
    if (!has(item, 'position')) {
      issues.push(
        issue({
          severity: 'error',
          id: 'google-breadcrumb-item-position',
          category: CATEGORY,
          title: `ListItem ${i + 1} sans position`,
          path: itemPath,
          fix: 'Ajouter position (entier commencant a 1).',
          docs: 'https://developers.google.com/search/docs/appearance/structured-data/breadcrumb',
        }),
      );
    } else {
      positions.push(Number(item.position));
    }
    if (!has(item, 'item') && !isLast) {
      issues.push(
        issue({
          severity: 'error',
          id: 'google-breadcrumb-item-url',
          category: CATEGORY,
          title: `ListItem ${i + 1} sans item (URL)`,
          detail: 'Seul le dernier maillon peut omettre item, car il correspond a la page courante.',
          path: itemPath,
          fix: 'Ajouter item avec l\'URL absolue de l\'etape.',
          docs: 'https://developers.google.com/search/docs/appearance/structured-data/breadcrumb',
        }),
      );
    }
  });

  const expected = positions.map((_, i) => i + 1);
  if (positions.length && positions.join(',') !== expected.join(',')) {
    issues.push(
      issue({
        severity: 'error',
        id: 'google-breadcrumb-positions',
        category: CATEGORY,
        title: 'Positions du fil d\'Ariane non sequentielles',
        detail: `Positions lues : ${positions.join(', ')}. Google attend 1, 2, 3… sans trou ni doublon.`,
        path: `${where} > itemListElement`,
        fix: 'Renumeroter les positions a partir de 1.',
        docs: 'https://developers.google.com/search/docs/appearance/structured-data/breadcrumb',
      }),
    );
  }
}

// ---------------------------------------------------------------------------
// Produit / Offre
// ---------------------------------------------------------------------------

const PRODUCT_RECOMMENDED = [
  ['image', 'Image du produit, indispensable pour un visuel dans le SERP.'],
  ['description', 'Description courte affichee sous le titre.'],
  ['aggregateRating', 'Note moyenne : declenche les etoiles dans le SERP.'],
  ['review', 'Avis clients.'],
];

function checkProduct(entry, issues) {
  const { node, where } = entry;

  if (!has(node, 'name')) {
    issues.push(
      issue({
        severity: 'error',
        id: 'google-product-name',
        category: CATEGORY,
        title: 'Product sans name',
        detail: 'name est obligatoire pour tout extrait produit.',
        path: where,
        fix: 'Ajouter name.',
        docs: 'https://developers.google.com/search/docs/appearance/structured-data/product',
      }),
    );
  }

  if (!hasAny(node, ['offers', 'review', 'aggregateRating'])) {
    issues.push(
      issue({
        severity: 'error',
        id: 'google-product-no-offer',
        category: CATEGORY,
        title: 'Product sans offers, review ni aggregateRating',
        detail: 'Google exige au moins l\'un des trois pour afficher un extrait produit.',
        path: where,
        fix: 'Ajouter offers avec price et priceCurrency.',
        docs: 'https://developers.google.com/search/docs/appearance/structured-data/product',
      }),
    );
  }

  if (!hasAny(node, ['sku', 'gtin', 'gtin8', 'gtin12', 'gtin13', 'gtin14', 'mpn', 'productID', 'isbn'])) {
    issues.push(
      issue({
        severity: 'warning',
        id: 'google-product-no-identifier',
        category: CATEGORY,
        title: 'Product sans identifiant (sku, gtin, mpn)',
        detail: 'Un identifiant stable permet a Google de rapprocher le produit entre les sources.',
        path: where,
        fix: 'Ajouter sku (ou productID) avec la reference du lot.',
        docs: 'https://developers.google.com/search/docs/appearance/structured-data/product',
      }),
    );
  }

  for (const [prop, why] of PRODUCT_RECOMMENDED) {
    if (has(node, prop)) continue;
    issues.push(
      issue({
        severity: 'info',
        id: `google-product-recommended-${prop.toLowerCase()}`,
        category: CATEGORY,
        title: `Product : ${prop} recommande`,
        detail: why,
        path: where,
        fix: `Ajouter ${prop}.`,
        docs: 'https://developers.google.com/search/docs/appearance/structured-data/product',
      }),
    );
  }
}

function checkOffer(entry, issues, { aggregate }) {
  const { node, where } = entry;

  if (aggregate) {
    for (const prop of ['lowPrice', 'priceCurrency']) {
      if (has(node, prop)) continue;
      issues.push(
        issue({
          severity: 'error',
          id: `google-aggregateoffer-${prop.toLowerCase()}`,
          category: CATEGORY,
          title: `AggregateOffer sans ${prop}`,
          path: where,
          fix: `Ajouter ${prop}.`,
          docs: 'https://developers.google.com/search/docs/appearance/structured-data/product',
        }),
      );
    }
    const low = Number(node.lowPrice);
    const high = Number(node.highPrice);
    if (Number.isFinite(low) && Number.isFinite(high) && low > high) {
      issues.push(
        issue({
          severity: 'error',
          id: 'google-aggregateoffer-range',
          category: CATEGORY,
          title: 'lowPrice superieur a highPrice',
          path: `${where} > lowPrice / highPrice`,
          value: `${low} > ${high}`,
          fix: 'Inverser les deux valeurs.',
          docs: 'https://schema.org/AggregateOffer',
        }),
      );
    }
    if (!has(node, 'offerCount')) {
      issues.push(
        issue({
          severity: 'info',
          id: 'google-aggregateoffer-count',
          category: CATEGORY,
          title: 'AggregateOffer sans offerCount',
          detail: 'offerCount indique le nombre de lots disponibles : utile et recommande.',
          path: where,
          fix: 'Ajouter offerCount.',
          docs: 'https://schema.org/AggregateOffer',
        }),
      );
    }
  } else {
    for (const prop of ['price', 'priceCurrency']) {
      if (has(node, prop)) continue;
      issues.push(
        issue({
          severity: 'error',
          id: `google-offer-${prop.toLowerCase()}`,
          category: CATEGORY,
          title: `Offer sans ${prop}`,
          detail: 'price et priceCurrency sont requis pour un extrait avec prix.',
          path: where,
          fix: `Ajouter ${prop}.`,
          docs: 'https://developers.google.com/search/docs/appearance/structured-data/product',
        }),
      );
    }
  }

  if (!has(node, 'availability')) {
    issues.push(
      issue({
        severity: 'warning',
        id: 'google-offer-availability',
        category: CATEGORY,
        title: 'Offre sans availability',
        detail: 'Sans availability, Google ne peut pas afficher « En stock » / « Epuise ».',
        path: where,
        fix: 'Ajouter availability: "https://schema.org/InStock".',
        docs: 'https://schema.org/ItemAvailability',
      }),
    );
  }
  if (!has(node, 'priceValidUntil') && !aggregate) {
    issues.push(
      issue({
        severity: 'info',
        id: 'google-offer-pricevaliduntil',
        category: CATEGORY,
        title: 'Offer sans priceValidUntil',
        detail: 'Google avertit sur ce champ : sans lui, le prix peut etre considere comme perime.',
        path: where,
        fix: 'Ajouter priceValidUntil au format AAAA-MM-JJ.',
        docs: 'https://developers.google.com/search/docs/appearance/structured-data/product',
      }),
    );
  }
  if (!has(node, 'url')) {
    issues.push(
      issue({
        severity: 'info',
        id: 'google-offer-url',
        category: CATEGORY,
        title: 'Offre sans url',
        detail: "L'URL de l'offre leve toute ambiguite sur la page de destination.",
        path: where,
        fix: 'Ajouter url avec l\'URL canonique de la page.',
        docs: 'https://schema.org/Offer',
      }),
    );
  }
}

// ---------------------------------------------------------------------------
// Organisation
// ---------------------------------------------------------------------------

function checkOrganization(entry, issues) {
  const { node, where } = entry;
  if (!has(node, 'name')) {
    issues.push(
      issue({
        severity: 'error',
        id: 'google-org-name',
        category: CATEGORY,
        title: 'Organization sans name',
        path: where,
        fix: 'Ajouter name.',
        docs: 'https://developers.google.com/search/docs/appearance/structured-data/organization',
      }),
    );
  }
  if (entry.isRoot && !has(node, 'logo')) {
    issues.push(
      issue({
        severity: 'warning',
        id: 'google-org-logo',
        category: CATEGORY,
        title: 'Organization sans logo',
        detail: 'logo alimente le panneau de connaissances et le badge marque.',
        path: where,
        fix: 'Ajouter logo (image carree, min. 112x112 px).',
        docs: 'https://developers.google.com/search/docs/appearance/structured-data/organization',
      }),
    );
  }
  if (entry.isRoot && !has(node, 'sameAs')) {
    issues.push(
      issue({
        severity: 'info',
        id: 'google-org-sameas',
        category: CATEGORY,
        title: 'Organization sans sameAs',
        detail: 'sameAs relie la marque a ses profils officiels (LinkedIn, Wikipedia, reseaux sociaux).',
        path: where,
        fix: 'Ajouter sameAs avec les profils officiels.',
        docs: 'https://developers.google.com/search/docs/appearance/structured-data/organization',
      }),
    );
  }
}

// ---------------------------------------------------------------------------
// Tableau d'eligibilite
// ---------------------------------------------------------------------------

/** Types schema.org qui ne declenchent aucun resultat enrichi Google connu. */
const NO_RICH_RESULT = new Set([
  'Accommodation', 'Apartment', 'House', 'SingleFamilyResidence', 'Residence',
  'ApartmentComplex', 'HousingComplex', 'GatedResidenceCommunity', 'RealEstateListing', 'Place',
]);

function buildFeatures(page, nodes, issues) {
  const errorsIn = (prefix) => issues.filter((i) => i.severity === 'error' && i.id.startsWith(prefix)).length;

  const detected = (target) => nodes.filter((n) => isA(n.types, target));

  const features = [];

  const breadcrumbs = detected('BreadcrumbList');
  features.push({
    key: 'breadcrumb',
    label: "Fil d'Ariane",
    detected: breadcrumbs.length > 0,
    eligible: breadcrumbs.length > 0 && errorsIn('google-breadcrumb') === 0,
    types: ['BreadcrumbList'],
    note: breadcrumbs.length
      ? 'BreadcrumbList detecte.'
      : "Aucun BreadcrumbList : le SERP affichera l'URL brute au lieu du chemin de navigation.",
  });

  const products = detected('Product');
  features.push({
    key: 'product',
    label: 'Extrait produit (prix, disponibilite)',
    detected: products.length > 0,
    eligible: products.length > 0 && errorsIn('google-product') === 0 && errorsIn('google-offer') === 0,
    types: ['Product'],
    note: products.length
      ? 'Type Product detecte.'
      : "Google n'affiche un prix dans le SERP que via @type Product. Les types immobiliers (Apartment, HousingComplex) ne declenchent aucun resultat enrichi.",
  });

  const orgs = detected('Organization');
  features.push({
    key: 'organization',
    label: 'Organisation / marque',
    detected: orgs.length > 0,
    eligible: orgs.length > 0 && errorsIn('google-org') === 0,
    types: ['Organization'],
    note: orgs.length ? 'Organization detectee.' : 'Aucune entite Organization sur la page.',
  });

  const faq = detected('FAQPage');
  features.push({
    key: 'faq',
    label: 'FAQ',
    detected: faq.length > 0,
    eligible: faq.length > 0,
    types: ['FAQPage'],
    note: faq.length
      ? 'FAQPage detectee.'
      : 'Aucune FAQPage. Utile si la page comporte des questions/reponses reelles et visibles.',
  });

  const video = detected('VideoObject');
  features.push({
    key: 'video',
    label: 'Video',
    detected: video.length > 0,
    eligible: video.length > 0,
    types: ['VideoObject'],
    note: video.length ? 'VideoObject detecte.' : 'Aucun VideoObject.',
  });

  const site = detected('WebSite');
  features.push({
    key: 'website',
    label: 'WebSite / Sitelinks searchbox',
    detected: site.length > 0,
    eligible: site.some((n) => has(n.node, 'potentialAction')),
    types: ['WebSite'],
    note: site.length ? 'WebSite detecte.' : 'Aucune entite WebSite (a placer plutot sur la page d\'accueil).',
  });

  const noRich = nodes.filter((n) => n.isRoot && n.types.some((t) => NO_RICH_RESULT.has(t)));
  if (noRich.length) {
    features.push({
      key: 'realestate',
      label: 'Types immobiliers (hors galerie Google)',
      detected: true,
      eligible: null,
      types: [...new Set(noRich.flatMap((n) => n.types))],
      note: "Ces types sont valides schema.org et exploites par les moteurs semantiques et les IA, mais ne figurent pas dans la galerie de resultats enrichis Google.",
    });
  }

  return features;
}

// ---------------------------------------------------------------------------

function isHomePage(url) {
  try {
    return new URL(url).pathname.replace(/\/+$/, '') === '';
  } catch {
    return false;
  }
}

export function checkGoogle(page) {
  const issues = [];
  const nodes = collectNodes(page);

  for (const entry of nodes) {
    if (isA(entry.types, 'BreadcrumbList')) checkBreadcrumb(entry, issues);
    if (isA(entry.types, 'Product')) checkProduct(entry, issues);
    if (entry.types.includes('AggregateOffer')) checkOffer(entry, issues, { aggregate: true });
    else if (isA(entry.types, 'Offer')) checkOffer(entry, issues, { aggregate: false });
    if (isA(entry.types, 'Organization')) checkOrganization(entry, issues);
  }

  // Une offre portee par une entite qui n'est pas un Product n'ouvre aucun droit
  // a l'extrait produit : c'est l'erreur la plus courante en immobilier.
  for (const entry of nodes) {
    if (!has(entry.node, 'offers')) continue;
    if (isA(entry.types, 'Product') || isA(entry.types, 'Service') || isA(entry.types, 'Event')) continue;
    const offer = first(entry.node.offers);
    issues.push(
      issue({
        severity: 'warning',
        id: 'google-offers-on-non-product',
        category: CATEGORY,
        title: `offers porte par ${entry.types.join(' + ') || 'un noeud sans type'}, pas par un Product`,
        detail:
          "Google ne lit price / priceCurrency / availability que sur Product, Service, Event et leurs sous-types. Sur un type immobilier, l'offre est ignoree et aucun prix n'apparait dans le SERP.",
        path: `${entry.where} > offers`,
        value: offer ? JSON.stringify(offer).slice(0, 160) : null,
        fix: `Declarer un type mixte : "@type": ["${entry.types[0] ?? 'Apartment'}", "Product"], ou ajouter un noeud Product distinct relie par isSimilarTo / mainEntity.`,
        docs: 'https://developers.google.com/search/docs/appearance/structured-data/product',
      }),
    );
  }

  // La page d'accueil est la racine du site : elle n'a pas de fil d'Ariane.
  if (!isHomePage(page.url) && !nodes.some((n) => isA(n.types, 'BreadcrumbList'))) {
    issues.push(
      issue({
        severity: 'warning',
        id: 'google-breadcrumb-missing',
        category: CATEGORY,
        title: "Pas de fil d'Ariane structure",
        detail: "Sans BreadcrumbList, Google affiche l'URL brute sous le titre du resultat.",
        fix: 'Ajouter un BreadcrumbList reprenant le chemin region > departement > ville > programme.',
        docs: 'https://developers.google.com/search/docs/appearance/structured-data/breadcrumb',
      }),
    );
  }

  return { issues, features: buildFeatures(page, nodes, issues), docs: GALLERY };
}
