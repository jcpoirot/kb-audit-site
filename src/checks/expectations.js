/**
 * Attentes propres aux gabarits kaufmanbroad.fr : page programme et page lot.
 * Detecte le gabarit depuis l'URL puis verifie que le balisage decrit bien
 * l'entite attendue, avec les proprietes metier utiles a l'immobilier neuf.
 */
import { issue } from '../issues.js';
import { collectNodes } from '../extract.js';
import { ancestorsOf, isKnownType } from '../vocabulary.js';

const CATEGORY = 'Gabarit Kaufman & Broad';

function isA(types, target) {
  return types.some((t) => (isKnownType(t) ? ancestorsOf(t).includes(target) : t === target));
}

const has = (node, prop) => {
  const value = node?.[prop];
  if (value == null) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'string') return value.trim() !== '';
  return true;
};

/**
 * Gabarits reconnus. `match` s'applique au chemin de l'URL.
 */
const TEMPLATES = [
  {
    key: 'programme',
    label: 'Page programme',
    match: /\/programme\/[^/]+\/?$/i,
    expectedTypes: ['Residence'],
    expectedLabel: 'ApartmentComplex, ou un autre sous-type de Residence',
    recommended: [
      ['numberOfAccommodationUnits', 'Nombre de logements du programme.'],
      ['amenityFeature', 'Prestations (parking, balcon, local velo…).'],
      ['photo', 'Perspectives du programme, en complement de image.'],
      ['containsPlace', 'Lien vers les lots disponibles, pour relier programme et lots dans le graphe.'],
      ['address', 'Adresse postale complete.'],
      ['geo', 'Coordonnees geographiques.'],
    ],
  },
  {
    key: 'lot',
    label: 'Page lot',
    match: /\/lot\/[^/]+\/[^/]+\/?$/i,
    expectedTypes: ['Accommodation'],
    expectedLabel: 'Apartment / House (sous-types de Accommodation)',
    recommended: [
      ['floorSize', 'Surface habitable, avec unitCode MTK.'],
      ['numberOfRooms', 'Nombre de pieces.'],
      ['numberOfBedrooms', 'Nombre de chambres.'],
      ['numberOfBathroomsTotal', 'Nombre de salles de bain / salles d\'eau.'],
      ['floorLevel', 'Etage du lot.'],
      ['isPartOf', 'Rattachement au programme parent.'],
      ['yearBuilt', 'Annee de livraison prevue.'],
      ['tourBookingPage', 'Page de prise de rendez-vous, si elle existe.'],
    ],
  },
  {
    key: 'home',
    label: "Page d'accueil",
    match: /^\/?$/,
    expectedTypes: ['Organization'],
    expectedLabel: 'Organization (ou RealEstateAgent)',
    recommended: [
      ['logo', 'Logo de la marque, repris dans le panneau de connaissances Google.'],
      ['sameAs', 'Profils officiels (reseaux sociaux, Wikipedia) pour consolider l\'entite de marque.'],
      ['url', 'URL du site.'],
      ['contactPoint', 'Point de contact commercial (telephone, type de contact).'],
      ['address', 'Adresse du siege.'],
    ],
  },
];

export function detectTemplate(url) {
  let path = url;
  try {
    path = new URL(url).pathname;
  } catch {
    /* url deja sous forme de chemin */
  }
  return TEMPLATES.find((tpl) => tpl.match.test(path)) ?? null;
}

export function checkExpectations(page) {
  const issues = [];
  const template = detectTemplate(page.url);
  const nodes = collectNodes(page);
  const roots = nodes.filter((n) => n.isRoot);

  // Entites transverses attendues sur tout le site.
  if (!nodes.some((n) => isA(n.types, 'Organization'))) {
    issues.push(
      issue({
        severity: 'info',
        id: 'kb-no-organization',
        category: CATEGORY,
        title: 'Aucune entite Organization sur la page',
        detail:
          'Declarer Kaufman & Broad (RealEstateAgent ou Organization) avec logo et sameAs consolide l\'entite de marque aupres de Google.',
        fix: 'Ajouter un bloc Organization racine, ou le referencer via @id depuis les autres entites.',
        docs: 'https://developers.google.com/search/docs/appearance/structured-data/organization',
      }),
    );
  }

  if (!template) {
    issues.push(
      issue({
        severity: 'info',
        id: 'kb-template-unknown',
        category: CATEGORY,
        title: 'Gabarit non reconnu',
        detail:
          "L'URL ne correspond ni a la page d'accueil, ni a une page programme (/programme/{id}), ni a une page lot (/lot/{type}/{id}). Seuls les controles generiques sont appliques.",
        value: page.url,
      }),
    );
    return { issues, template: null };
  }

  const main = roots.find((n) => template.expectedTypes.some((t) => isA(n.types, t))) ?? null;

  if (!main) {
    const found = roots.flatMap((n) => n.types).join(', ') || 'aucun type racine';
    issues.push(
      issue({
        severity: 'error',
        id: 'kb-main-entity-missing',
        category: CATEGORY,
        title: `${template.label} sans entite ${template.expectedLabel}`,
        detail: `Types racines detectes : ${found}.`,
        fix: `Declarer l'entite principale avec un type approprie (${template.expectedLabel}).`,
        docs: 'https://schema.org/Accommodation',
      }),
    );
    return { issues, template: { ...template, mainType: null } };
  }

  for (const [prop, why] of template.recommended) {
    if (has(main.node, prop)) continue;
    issues.push(
      issue({
        severity: 'info',
        id: `kb-recommended-${prop.toLowerCase()}`,
        category: CATEGORY,
        title: `${prop} absent sur ${main.types.join(' + ')}`,
        detail: why,
        path: main.where,
        fix: `Ajouter ${prop}.`,
        docs: `https://schema.org/${prop}`,
      }),
    );
  }

  if (template.key === 'home' && !nodes.some((n) => isA(n.types, 'WebSite'))) {
    issues.push(
      issue({
        severity: 'info',
        id: 'kb-home-no-website',
        category: CATEGORY,
        title: "Pas d'entite WebSite sur la page d'accueil",
        detail: 'WebSite porte le nom du site affiche par Google et, avec une SearchAction, le champ de recherche interne.',
        fix: 'Ajouter un bloc WebSite (name, url, potentialAction SearchAction) sur la page d\'accueil.',
        docs: 'https://developers.google.com/search/docs/appearance/site-names',
      }),
    );
  }

  // Le DPE est une donnee obligatoire des annonces immobilieres : schema.org sait la porter.
  if (template.key !== 'home' && !has(main.node, 'hasEnergyConsumptionDetails') && !has(main.node, 'energyEfficiencyScaleMin')) {
    issues.push(
      issue({
        severity: 'info',
        id: 'kb-dpe-missing',
        category: CATEGORY,
        title: 'Performance energetique (DPE) non balisee',
        detail:
          "Le DPE / GES est affiche sur la page et obligatoire dans les annonces : le baliser via hasEnergyConsumptionDetails (EnergyConsumptionDetails) le rend exploitable par les moteurs et les agregateurs.",
        path: main.where,
        fix: 'Ajouter hasEnergyConsumptionDetails avec energyEfficiencyScaleMin / energyEfficiencyScaleMax.',
        docs: 'https://schema.org/EnergyConsumptionDetails',
      }),
    );
  }

  if (template.key === 'lot' && !has(main.node, 'isPartOf') && !has(main.node, 'containedInPlace')) {
    issues.push(
      issue({
        severity: 'warning',
        id: 'kb-lot-orphan',
        category: CATEGORY,
        title: 'Lot non rattache a son programme',
        detail: 'Sans lien vers le programme parent, les deux entites restent isolees dans le graphe.',
        path: main.where,
        fix: 'Ajouter isPartOf avec le @id du programme.',
        docs: 'https://schema.org/isPartOf',
      }),
    );
  }

  if (template.key === 'programme') {
    const hasAggregate = nodes.some((n) => n.types.includes('AggregateOffer'));
    if (!hasAggregate) {
      issues.push(
        issue({
          severity: 'info',
          id: 'kb-programme-no-aggregateoffer',
          category: CATEGORY,
          title: 'Pas de fourchette de prix (AggregateOffer)',
          detail: 'Une AggregateOffer lowPrice/highPrice resume l\'offre du programme.',
          fix: 'Ajouter une AggregateOffer sur une entite compatible Product.',
          docs: 'https://schema.org/AggregateOffer',
        }),
      );
    }
  }

  return {
    issues,
    template: { key: template.key, label: template.label, mainType: main.types.join(' + '), mainPath: main.where },
  };
}
