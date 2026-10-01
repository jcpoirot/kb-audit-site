/**
 * Orchestration de l'analyse.
 *
 * Chaque outil SEO est une entree du registre TOOLS : { key, label, weight, run(page) }.
 * `run` renvoie soit un tableau de constats, soit { issues, extras }.
 * Ajouter un outil = ajouter une entree ici.
 */
import { fetchPage } from './fetch-page.js';
import { extractPage } from './extract.js';
import { countBySeverity, scoreOf, sortIssues } from './issues.js';
import { checkSyntax } from './checks/syntax.js';
import { checkVocabulary } from './checks/vocabulary.js';
import { checkGoogle } from './checks/google.js';
import { checkQuality } from './checks/quality.js';
import { checkCoherence } from './checks/coherence.js';
import { checkExpectations } from './checks/expectations.js';
import { checkMeta } from './checks/meta.js';
import { checkHttp } from './checks/http.js';

export const TOOLS = [
  {
    key: 'structured-data',
    label: 'Donnees structurees',
    description: 'JSON-LD : syntaxe, vocabulaire schema.org, eligibilite aux resultats enrichis Google, coherence avec la page.',
    weight: 0.7,
    run(page) {
      const google = checkGoogle(page);
      const expectations = checkExpectations(page);
      return {
        issues: [
          ...checkSyntax(page),
          ...checkVocabulary(page),
          ...google.issues,
          ...checkQuality(page),
          ...checkCoherence(page),
          ...expectations.issues,
        ],
        extras: {
          features: google.features,
          template: expectations.template,
        },
      };
    },
  },
  {
    key: 'head-meta',
    label: 'Head & meta',
    description: 'Title, meta description, canonique, Open Graph, Twitter Card, hierarchie de titres, attributs alt.',
    weight: 0.3,
    run(page) {
      return { issues: checkMeta(page), extras: {} };
    },
  },
  {
    key: 'http-indexing',
    label: 'HTTP & indexation',
    description: 'Code HTTP, redirections, X-Robots-Tag, page de blocage, temps de reponse, poids du HTML, conteneur GTM.',
    weight: 0.2,
    run(page) {
      return { issues: checkHttp(page), extras: {} };
    },
  },
];

function runTool(tool, page) {
  const started = Date.now();
  let raw;
  try {
    raw = tool.run(page);
  } catch (err) {
    return {
      key: tool.key,
      label: tool.label,
      description: tool.description,
      score: 0,
      counts: { error: 1, warning: 0, info: 0, success: 0 },
      issues: [
        {
          severity: 'error',
          id: 'tool-crash',
          category: 'Interne',
          title: `L'outil « ${tool.label} » a echoue`,
          detail: err.stack ?? err.message,
          path: null,
          fix: null,
          docs: null,
          value: null,
        },
      ],
      extras: {},
      elapsedMs: Date.now() - started,
    };
  }

  const issues = sortIssues(Array.isArray(raw) ? raw : raw.issues);
  return {
    key: tool.key,
    label: tool.label,
    description: tool.description,
    score: scoreOf(issues),
    counts: countBySeverity(issues),
    issues,
    extras: Array.isArray(raw) ? {} : (raw.extras ?? {}),
    elapsedMs: Date.now() - started,
  };
}

/** Resume par categorie, pour l'affichage en colonnes. */
function summarizeByCategory(issues) {
  const map = new Map();
  for (const item of issues) {
    if (!map.has(item.category)) map.set(item.category, { category: item.category, error: 0, warning: 0, info: 0, success: 0 });
    map.get(item.category)[item.severity] += 1;
  }
  return [...map.values()].sort((a, b) => b.error - a.error || b.warning - a.warning);
}

/**
 * Analyse une page a partir de son HTML deja recupere.
 * @param {string} html
 * @param {string} url URL finale (base de resolution des liens relatifs)
 * @param {object} [meta] informations de telechargement a reporter dans le rapport
 */
export function analyzeHtml(html, url, meta = {}) {
  const page = extractPage(html, url);
  page.fetch = meta;
  const tools = TOOLS.map((tool) => runTool(tool, page));
  const allIssues = tools.flatMap((t) => t.issues);

  const totalWeight = TOOLS.reduce((sum, t) => sum + t.weight, 0);
  const score = Math.round(
    tools.reduce((sum, t, i) => sum + t.score * TOOLS[i].weight, 0) / totalWeight,
  );

  return {
    url,
    fetchedAt: new Date().toISOString(),
    fetch: meta,
    score,
    counts: countBySeverity(allIssues),
    byCategory: summarizeByCategory(allIssues),
    tools,
    head: page.head,
    headings: page.headings.map((h) => ({ level: h.level, text: h.text.slice(0, 120) })),
    otherMarkup: page.otherMarkup,
    blocks: page.blocks.map((b) => ({
      label: b.label,
      line: b.line,
      types: b.types,
      parseError: b.parseError,
      raw: b.raw,
      pretty: b.parsed ? JSON.stringify(b.parsed, null, 2) : b.raw,
    })),
  };
}

/** Telecharge puis analyse une URL. */
export async function analyzeUrl(url) {
  const res = await fetchPage(url);
  return analyzeHtml(res.html, res.finalUrl, {
    requestedUrl: res.requestedUrl,
    finalUrl: res.finalUrl,
    status: res.status,
    redirected: res.redirected,
    contentType: res.contentType,
    xRobotsTag: res.xRobotsTag,
    elapsedMs: res.elapsedMs,
    bytes: res.bytes,
  });
}
