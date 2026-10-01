/**
 * Sante HTTP et indexabilite de la page telechargee : code de reponse, redirections,
 * X-Robots-Tag, page de blocage (WAF / CDN), temps de reponse, poids du HTML,
 * presence du conteneur Google Tag Manager.
 *
 * S'appuie sur `page.fetch` (informations de telechargement). Si le HTML a ete
 * fourni sans telechargement, seuls les controles portant sur le HTML s'appliquent.
 */
import { issue } from '../issues.js';

const CATEGORY = 'HTTP & indexation';
const TRACKING = 'Tracking';

/** Conteneur GTM attendu sur toutes les pages de kaufmanbroad.fr. */
const EXPECTED_GTM = 'GTM-5V98P2X';

const SLOW_MS = 3000;
const VERY_SLOW_MS = 8000;
const HEAVY_BYTES = 1.5 * 1024 * 1024;

/**
 * Signatures de pages de blocage ou de challenge servies a la place du contenu.
 * Un audit lance depuis une IP cloud peut tomber dessus : il faut le dire plutot
 * que rapporter des dizaines de faux defauts.
 */
const BLOCK_MARKERS = [
  /cf-challenge|cf_chl_|challenge-platform/i,
  /<title>\s*(access denied|attention required|just a moment|403 forbidden|request blocked)/i,
  /The request is blocked\./i,
  /captcha-delivery|geo\.captcha/i,
  /Our services aren't available right now/i,
];

export function looksBlocked(html, status) {
  if ([401, 403, 429].includes(status)) return true;
  return BLOCK_MARKERS.some((re) => re.test(html.slice(0, 20000)));
}

export function checkHttp(page) {
  const issues = [];
  const fetch = page.fetch ?? {};
  const status = fetch.status;

  if (status != null) {
    if (looksBlocked(page.html, status)) {
      issues.push(
        issue({
          severity: 'error',
          id: 'http-blocked',
          category: CATEGORY,
          title: 'Page de blocage servie a la place du contenu',
          detail:
            "Le serveur (WAF / CDN) a renvoye une page de challenge ou de refus. Les autres constats de cette page ne sont pas fiables.",
          value: `HTTP ${status}`,
          fix: "Autoriser l'IP ou le user-agent de l'audit, ou verifier qu'un robot d'exploration legitime n'est pas bloque lui aussi.",
        }),
      );
    } else if (status >= 400) {
      issues.push(
        issue({
          severity: 'error',
          id: 'http-status-error',
          category: CATEGORY,
          title: `La page repond HTTP ${status}`,
          detail: 'Une page en erreur sort de l\'index.',
          value: fetch.finalUrl,
          fix: 'Corriger la page, ou rediriger en 301 vers son remplacant et la retirer du sitemap.',
        }),
      );
    }

    if (fetch.redirected && fetch.requestedUrl && fetch.finalUrl && fetch.requestedUrl !== fetch.finalUrl) {
      issues.push(
        issue({
          severity: 'warning',
          id: 'http-redirected',
          category: CATEGORY,
          title: 'URL redirigee',
          detail: `${fetch.requestedUrl} -> ${fetch.finalUrl}. Les liens internes et le sitemap doivent pointer directement vers l'URL finale.`,
          value: fetch.finalUrl,
          fix: "Remplacer l'URL d'origine par l'URL finale dans le sitemap et le maillage interne.",
        }),
      );
    }

    if (fetch.contentType && !/text\/html/i.test(fetch.contentType)) {
      issues.push(
        issue({
          severity: 'warning',
          id: 'http-content-type',
          category: CATEGORY,
          title: 'Content-Type inattendu',
          value: fetch.contentType,
          fix: 'Servir la page en text/html; charset=utf-8.',
        }),
      );
    }

    if (fetch.xRobotsTag && /noindex|none/i.test(fetch.xRobotsTag)) {
      issues.push(
        issue({
          severity: 'error',
          id: 'http-x-robots-noindex',
          category: CATEGORY,
          title: 'En-tete X-Robots-Tag noindex',
          detail: "L'en-tete HTTP interdit l'indexation, meme si la balise meta robots l'autorise.",
          value: fetch.xRobotsTag,
          fix: "Retirer noindex de l'en-tete X-Robots-Tag sur ce gabarit.",
          docs: 'https://developers.google.com/search/docs/crawling-indexing/robots-meta-tag#xrobotstag',
        }),
      );
    }

    if (fetch.elapsedMs >= SLOW_MS) {
      issues.push(
        issue({
          severity: fetch.elapsedMs >= VERY_SLOW_MS ? 'warning' : 'info',
          id: 'http-slow',
          category: CATEGORY,
          title: `Temps de reponse eleve : ${(fetch.elapsedMs / 1000).toFixed(1)} s`,
          detail: `Mesure depuis le poste d'audit, telechargement du HTML compris. Seuil : ${SLOW_MS / 1000} s.`,
          value: `${fetch.elapsedMs} ms`,
          fix: 'Verifier le cache serveur / CDN de ce gabarit.',
        }),
      );
    }

    if (fetch.bytes >= HEAVY_BYTES) {
      issues.push(
        issue({
          severity: 'info',
          id: 'http-html-heavy',
          category: CATEGORY,
          title: `HTML volumineux : ${(fetch.bytes / 1024 / 1024).toFixed(1)} Mo`,
          detail: 'Un HTML tres lourd ralentit le rendu et le crawl.',
          value: `${fetch.bytes} octets`,
          fix: 'Alleger les donnees serialisees dans la page (etat Next.js, listes completes).',
        }),
      );
    }
  }

  // --- Google Tag Manager ---
  const containers = [...new Set(page.html.match(/GTM-[A-Z0-9]{4,10}/g) ?? [])];
  if (!containers.includes(EXPECTED_GTM)) {
    issues.push(
      issue({
        severity: 'error',
        id: 'tracking-gtm-missing',
        category: TRACKING,
        title: `Conteneur ${EXPECTED_GTM} absent du HTML`,
        detail: 'Sans le conteneur, aucune mesure d\'audience ni de conversion sur cette page.',
        value: containers.join(', ') || null,
        fix: `Verifier que le composant GTM (gtmId ${EXPECTED_GTM}) est bien rendu sur ce gabarit.`,
      }),
    );
  }
  const others = containers.filter((id) => id !== EXPECTED_GTM);
  if (others.length) {
    issues.push(
      issue({
        severity: 'warning',
        id: 'tracking-gtm-unexpected',
        category: TRACKING,
        title: 'Conteneur GTM supplementaire',
        detail: 'Un second conteneur peut doubler les hits ou declencher des balises non maitrisees.',
        value: others.join(', '),
        fix: 'Confirmer que ce conteneur est attendu, sinon le retirer.',
      }),
    );
  }

  return issues;
}
