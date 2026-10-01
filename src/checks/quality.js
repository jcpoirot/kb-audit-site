/**
 * Qualite des donnees elles-memes : adresses, coordonnees, prix, devises,
 * telephones, enumerations, images, longueurs de textes.
 */
import { issue } from '../issues.js';
import { collectNodes, walkValues } from '../extract.js';
import { ancestorsOf, enumerationOf, getProperty, isEnumerationType, isKnownType } from '../vocabulary.js';

const CATEGORY = 'Qualite des donnees';

const ISO_4217 = /^[A-Z]{3}$/;
const E164 = /^\+[1-9]\d{6,14}$/;
const FR_POSTAL = /^\d{5}$/;

function isA(types, target) {
  return types.some((t) => (isKnownType(t) ? ancestorsOf(t).includes(target) : t === target));
}

function checkAddress(entry, issues) {
  const { node, where } = entry;
  const required = [
    ['streetAddress', 'warning', 'Numero et voie.'],
    ['addressLocality', 'error', 'Commune.'],
    ['postalCode', 'warning', 'Code postal.'],
    ['addressCountry', 'warning', 'Pays au format ISO 3166-1 alpha-2.'],
  ];
  for (const [prop, severity, why] of required) {
    if (node[prop] != null && String(node[prop]).trim() !== '') continue;
    issues.push(
      issue({
        severity,
        id: `address-missing-${prop.toLowerCase()}`,
        category: CATEGORY,
        title: `PostalAddress sans ${prop}`,
        detail: why,
        path: `${where} > ${prop}`,
        fix: `Ajouter ${prop}.`,
        docs: 'https://schema.org/PostalAddress',
      }),
    );
  }

  const country = node.addressCountry;
  if (typeof country === 'string' && country.trim() && !/^[A-Z]{2}$/.test(country.trim())) {
    issues.push(
      issue({
        severity: 'warning',
        id: 'address-country-format',
        category: CATEGORY,
        title: 'addressCountry hors format ISO 3166-1 alpha-2',
        detail: 'Google recommande le code a deux lettres (FR) plutot que le nom du pays.',
        path: `${where} > addressCountry`,
        value: country,
        fix: 'Utiliser "FR".',
        docs: 'https://schema.org/addressCountry',
      }),
    );
  }

  const region = node.addressRegion;
  if (typeof region === 'string' && /^\d+$/.test(region.trim())) {
    issues.push(
      issue({
        severity: 'warning',
        id: 'address-region-numeric',
        category: CATEGORY,
        title: 'addressRegion contient un code numerique',
        detail:
          "addressRegion attend le nom de la region ou de l'etat (« Ile-de-France »), pas le numero de departement.",
        path: `${where} > addressRegion`,
        value: region,
        fix: 'Remplacer par le nom de region, et deplacer le departement dans une propriete dediee ou l\'omettre.',
        docs: 'https://schema.org/addressRegion',
      }),
    );
  }

  const postal = node.postalCode;
  if (typeof postal === 'string' && postal.trim() && String(country).trim() === 'FR' && !FR_POSTAL.test(postal.trim())) {
    issues.push(
      issue({
        severity: 'warning',
        id: 'address-postalcode-format',
        category: CATEGORY,
        title: 'Code postal francais mal forme',
        detail: 'Un code postal francais compte exactement 5 chiffres.',
        path: `${where} > postalCode`,
        value: postal,
        fix: 'Corriger le code postal.',
        docs: 'https://schema.org/postalCode',
      }),
    );
  }
}

function checkGeo(entry, issues) {
  const { node, where } = entry;
  for (const [prop, min, max] of [
    ['latitude', -90, 90],
    ['longitude', -180, 180],
  ]) {
    const raw = node[prop];
    if (raw == null) {
      issues.push(
        issue({
          severity: 'error',
          id: `geo-missing-${prop}`,
          category: CATEGORY,
          title: `GeoCoordinates sans ${prop}`,
          path: `${where} > ${prop}`,
          fix: `Ajouter ${prop}.`,
          docs: 'https://schema.org/GeoCoordinates',
        }),
      );
      continue;
    }
    const value = Number(raw);
    if (!Number.isFinite(value) || value < min || value > max) {
      issues.push(
        issue({
          severity: 'error',
          id: `geo-invalid-${prop}`,
          category: CATEGORY,
          title: `${prop} hors bornes`,
          detail: `Valeur attendue entre ${min} et ${max}.`,
          path: `${where} > ${prop}`,
          value: String(raw),
          fix: 'Corriger la coordonnee.',
          docs: 'https://schema.org/GeoCoordinates',
        }),
      );
      continue;
    }
    const decimals = String(raw).split('.')[1]?.length ?? 0;
    if (decimals > 8) {
      issues.push(
        issue({
          severity: 'info',
          id: `geo-precision-${prop}`,
          category: CATEGORY,
          title: `Precision excessive sur ${prop}`,
          detail: `${decimals} decimales, soit une precision sub-millimetrique sans interet. 6 decimales suffisent (~10 cm).`,
          path: `${where} > ${prop}`,
          value: String(raw),
          fix: 'Arrondir a 6 decimales.',
        }),
      );
    }
  }
}

function checkPrices(entry, issues) {
  const { node, where } = entry;
  for (const prop of ['price', 'lowPrice', 'highPrice']) {
    const raw = node[prop];
    if (raw == null) continue;
    if (typeof raw === 'string') {
      if (/[^\d.]/.test(raw.trim())) {
        issues.push(
          issue({
            severity: 'error',
            id: 'price-format',
            category: CATEGORY,
            title: `${prop} contient autre chose qu'un nombre`,
            detail:
              "Google impose un nombre sans symbole monetaire, sans espace insecable et avec le point comme separateur decimal.",
            path: `${where} > ${prop}`,
            value: raw,
            fix: 'Serialiser la valeur numerique brute (ex. 369000).',
            docs: 'https://developers.google.com/search/docs/appearance/structured-data/product',
          }),
        );
      }
    }
  }

  const currency = node.priceCurrency;
  if (currency != null && !ISO_4217.test(String(currency).trim())) {
    issues.push(
      issue({
        severity: 'error',
        id: 'price-currency-format',
        category: CATEGORY,
        title: 'priceCurrency hors format ISO 4217',
        detail: 'Trois lettres majuscules attendues (EUR).',
        path: `${where} > priceCurrency`,
        value: String(currency),
        fix: 'Utiliser "EUR".',
        docs: 'https://schema.org/priceCurrency',
      }),
    );
  }
}

function checkContact(entry, issues) {
  const { node, where } = entry;
  const phone = node.telephone;
  if (typeof phone === 'string' && phone.trim() && !E164.test(phone.replace(/[\s.\-()]/g, ''))) {
    issues.push(
      issue({
        severity: 'info',
        id: 'contact-phone-format',
        category: CATEGORY,
        title: 'telephone hors format E.164',
        detail: 'Le format international +33… est le plus surement interprete.',
        path: `${where} > telephone`,
        value: phone,
        fix: 'Utiliser le format +33XXXXXXXXX.',
        docs: 'https://schema.org/telephone',
      }),
    );
  }
}

/** Verifie les valeurs de proprietes dont le range est une enumeration schema.org. */
function checkEnumerations(page, issues) {
  for (const block of page.blocks) {
    if (block.parseError) continue;
    for (const root of block.roots) {
      for (const { property, value, path } of walkValues(root)) {
        if (typeof value !== 'string') continue;
        const def = getProperty(property);
        if (!def) continue;
        const enumRanges = def.ranges.filter(isEnumerationType);
        if (enumRanges.length === 0 || enumRanges.length !== def.ranges.length) continue;

        const member = value.replace(/^https?:\/\/schema\.org\//, '').replace(/^schema:/, '').trim();
        const belongsTo = enumerationOf(member);
        const valid = belongsTo && enumRanges.some((r) => ancestorsOf(belongsTo).includes(r) || belongsTo === r);
        if (!valid) {
          issues.push(
            issue({
              severity: 'error',
              id: 'enum-invalid-value',
              category: CATEGORY,
              title: `Valeur non reconnue pour ${property}`,
              detail: `schema.org attend un membre de ${enumRanges.join(' | ')}.`,
              path: `${block.label} > ${path}`,
              value,
              fix: `Utiliser une URL d'enumeration valide, par ex. https://schema.org/InStock.`,
              docs: `https://schema.org/${enumRanges[0]}`,
            }),
          );
        } else if (!/^https?:\/\/schema\.org\//.test(value.trim())) {
          issues.push(
            issue({
              severity: 'info',
              id: 'enum-short-form',
              category: CATEGORY,
              title: `${property} en forme courte`,
              detail: 'Google accepte la forme courte, mais recommande l\'URL complete de l\'enumeration.',
              path: `${block.label} > ${path}`,
              value,
              fix: `Utiliser "https://schema.org/${member}".`,
              docs: `https://schema.org/${enumRanges[0]}`,
            }),
          );
        }
      }
    }
  }
}

function checkTexts(entry, issues) {
  const { node, where, types } = entry;
  const name = typeof node.name === 'string' ? node.name : null;
  const description = typeof node.description === 'string' ? node.description : null;

  if (name && name.length > 110) {
    issues.push(
      issue({
        severity: 'info',
        id: 'text-name-long',
        category: CATEGORY,
        title: `name tres long (${name.length} caracteres)`,
        detail: 'Au-dela d\'une centaine de caracteres, le libelle est tronque dans les resultats enrichis.',
        path: `${where} > name`,
        fix: 'Raccourcir le libelle.',
      }),
    );
  }
  if (description && description.length > 5000) {
    issues.push(
      issue({
        severity: 'warning',
        id: 'text-description-long',
        category: CATEGORY,
        title: `description tres longue (${description.length} caracteres)`,
        detail: 'Les descriptions au-dela de 5 000 caracteres sont tronquees par Google.',
        path: `${where} > description`,
        fix: 'Resumer la description.',
      }),
    );
  }
  if (description && name && description.trim() === name.trim()) {
    issues.push(
      issue({
        severity: 'warning',
        id: 'text-description-equals-name',
        category: CATEGORY,
        title: 'description identique a name',
        path: `${where} > description`,
        fix: 'Rediger une description distincte.',
      }),
    );
  }
  if (entry.isRoot && !description && (isA(types, 'Product') || isA(types, 'Place'))) {
    issues.push(
      issue({
        severity: 'info',
        id: 'text-description-missing',
        category: CATEGORY,
        title: 'Entite principale sans description',
        path: where,
        fix: 'Ajouter description.',
      }),
    );
  }
}

function checkImages(entry, issues) {
  const { node, where } = entry;
  if (!entry.isRoot) return;
  const images = node.image == null ? [] : Array.isArray(node.image) ? node.image : [node.image];
  if (images.length === 0) return;
  if (images.length < 3) {
    issues.push(
      issue({
        severity: 'info',
        id: 'image-single-ratio',
        category: CATEGORY,
        title: `Une seule image fournie (${images.length})`,
        detail:
          'Google recommande plusieurs images de la meme scene en 16:9, 4:3 et 1:1 pour couvrir tous les formats de resultat.',
        path: `${where} > image`,
        fix: 'Fournir un tableau de 3 URLs (16:9, 4:3, 1:1), largeur minimale 1200 px.',
        docs: 'https://developers.google.com/search/docs/appearance/structured-data/product',
      }),
    );
  }
  for (const [i, img] of images.entries()) {
    const url = typeof img === 'string' ? img : img?.url ?? img?.contentUrl;
    if (typeof url !== 'string') continue;
    const width = /(?:^|[/_,])w_(\d+)/.exec(url)?.[1];
    if (width && Number(width) < 1200) {
      issues.push(
        issue({
          severity: 'warning',
          id: 'image-too-small',
          category: CATEGORY,
          title: `Image ${i + 1} en dessous de 1200 px de large`,
          detail: `Largeur demandee dans l'URL : ${width} px. Google exige 1200 px minimum pour les resultats enrichis.`,
          path: `${where} > image[${i}]`,
          value: url,
          fix: 'Servir une transformation d\'au moins 1200 px de large.',
          docs: 'https://developers.google.com/search/docs/appearance/structured-data/product',
        }),
      );
    }
  }
}

export function checkQuality(page) {
  const issues = [];
  for (const entry of collectNodes(page)) {
    if (isA(entry.types, 'PostalAddress')) checkAddress(entry, issues);
    if (isA(entry.types, 'GeoCoordinates')) checkGeo(entry, issues);
    if (isA(entry.types, 'Offer')) checkPrices(entry, issues);
    if (isA(entry.types, 'ContactPoint') || isA(entry.types, 'Organization')) checkContact(entry, issues);
    checkTexts(entry, issues);
    checkImages(entry, issues);
  }
  checkEnumerations(page, issues);
  return issues;
}
