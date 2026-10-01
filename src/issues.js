/**
 * Modele commun des constats produits par les controles.
 */

export const SEVERITY = {
  error: { label: 'Erreur', weight: 10, rank: 0 },
  warning: { label: 'Avertissement', weight: 4, rank: 1 },
  info: { label: 'Info', weight: 1, rank: 2 },
  success: { label: 'OK', weight: 0, rank: 3 },
};

/**
 * @param {object} spec
 * @param {'error'|'warning'|'info'|'success'} spec.severity
 * @param {string} spec.id        identifiant stable de la regle
 * @param {string} spec.category  regroupement affiche dans l'UI
 * @param {string} spec.title     resume court
 * @param {string} [spec.detail]  explication
 * @param {string} [spec.path]    chemin dans le JSON-LD (ex. "bloc 1 > offers.price")
 * @param {string} [spec.fix]     correction suggeree
 * @param {string} [spec.docs]    lien de reference
 * @param {*}      [spec.value]   valeur fautive, affichee telle quelle
 */
export function issue(spec) {
  return {
    severity: spec.severity,
    id: spec.id,
    category: spec.category,
    title: spec.title,
    detail: spec.detail ?? null,
    path: spec.path ?? null,
    fix: spec.fix ?? null,
    docs: spec.docs ?? null,
    value: formatValue(spec.value),
  };
}

/** La valeur fautive est toujours restituee sous forme de chaine affichable. */
function formatValue(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

export function sortIssues(issues) {
  return [...issues].sort((a, b) => {
    const bySeverity = SEVERITY[a.severity].rank - SEVERITY[b.severity].rank;
    if (bySeverity !== 0) return bySeverity;
    return (a.path ?? '').localeCompare(b.path ?? '');
  });
}

export function countBySeverity(issues) {
  const counts = { error: 0, warning: 0, info: 0, success: 0 };
  for (const item of issues) counts[item.severity] += 1;
  return counts;
}

/** Score 0-100 : 100 moins la somme ponderee des constats, plancher a 0. */
export function scoreOf(issues) {
  const penalty = issues.reduce((sum, item) => sum + SEVERITY[item.severity].weight, 0);
  return Math.max(0, 100 - penalty);
}
