/**
 * Audit quotidien du site : controles de niveau site (robots.txt, sitemap) puis analyse
 * complete d'un jeu de pages (pages temoins fixes + pages tirees au hasard dans le sitemap),
 * et comparaison avec le rapport precedent.
 *
 * Usage : npm run audit [-- --config audit-config.json] [--date AAAA-MM-JJ]
 * Sortie : reports/AAAA-MM-JJ.json, et un resume texte sur la sortie standard.
 */
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeHtml } from '../src/analyze.js';
import { fetchPage } from '../src/fetch-page.js';
import { issue, countBySeverity, scoreOf, sortIssues } from '../src/issues.js';
import { looksBlocked } from '../src/checks/http.js';
import { toText } from '../src/html.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPORTS_DIR = join(ROOT, 'reports');
const CATEGORY = 'Site';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

/** Date du jour a Paris, au format AAAA-MM-JJ. */
function todayInParis() {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Paris' }).format(new Date());
}

function pickRandom(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function sample(list, n) {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, n);
}

/** URL comparables : sans slash final, sans fragment. */
function normalizeUrl(url) {
  try {
    const u = new URL(url);
    u.hash = '';
    return u.href.replace(/\/+$/, '');
  } catch {
    return url;
  }
}

async function loadPreviousReport(date) {
  let files = [];
  try {
    files = await readdir(REPORTS_DIR);
  } catch {
    return null;
  }
  const candidates = files
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f) && f.slice(0, 10) < date)
    .sort()
    .reverse();
  // Un audit bloque (WAF, proxy) ne decrit pas le site : il ne sert jamais de reference.
  for (const file of candidates) {
    const report = JSON.parse(await readFile(join(REPORTS_DIR, file), 'utf8'));
    if (!report.blocked) return report;
  }
  return null;
}

/** Debut du texte d'une reponse, pour identifier qui bloque (proxy sortant, WAF du site...). */
function responseSample(html) {
  return toText(html).replace(/\s+/g, ' ').trim().slice(0, 300);
}

// ---------------------------------------------------------------------------
// Controles de niveau site
// ---------------------------------------------------------------------------

async function checkRobots(config, issues) {
  let res;
  try {
    res = await fetchPage(config.robots);
  } catch (err) {
    issues.push(issue({ severity: 'error', id: 'site-robots-unreachable', category: CATEGORY, title: 'robots.txt injoignable', value: err.message }));
    return;
  }
  if (res.status !== 200 || looksBlocked(res.html, res.status)) {
    issues.push(
      issue({
        severity: 'error',
        id: 'site-robots-status',
        category: CATEGORY,
        title: `robots.txt repond HTTP ${res.status}`,
        fix: 'Servir un robots.txt en 200.',
        docs: 'https://developers.google.com/search/docs/crawling-indexing/robots/intro',
      }),
    );
    return;
  }

  // Regles du groupe User-agent: * (ou Googlebot)
  const lines = res.html.split(/\r?\n/).map((l) => l.replace(/#.*/, '').trim());
  let inGroup = false;
  const disallow = [];
  for (const line of lines) {
    const [rawKey, ...rest] = line.split(':');
    const key = rawKey?.toLowerCase();
    const value = rest.join(':').trim();
    if (key === 'user-agent') inGroup = value === '*' || /googlebot/i.test(value);
    else if (inGroup && key === 'disallow' && value) disallow.push(value);
  }
  if (disallow.includes('/')) {
    issues.push(
      issue({
        severity: 'error',
        id: 'site-robots-disallow-all',
        category: CATEGORY,
        title: 'robots.txt bloque tout le site (Disallow: /)',
        fix: 'Retirer la regle Disallow: / du groupe User-agent: *.',
      }),
    );
  }
  for (const rule of disallow) {
    if (/programme|lot|achat-immobilier-neuf/i.test(rule)) {
      issues.push(
        issue({
          severity: 'error',
          id: 'site-robots-blocks-template',
          category: CATEGORY,
          title: 'robots.txt bloque un gabarit strategique',
          value: `Disallow: ${rule}`,
          fix: 'Retirer cette regle, sauf blocage voulu.',
        }),
      );
    }
  }
  if (!/^sitemap:\s*\S+/im.test(res.html)) {
    issues.push(
      issue({
        severity: 'warning',
        id: 'site-robots-no-sitemap',
        category: CATEGORY,
        title: "robots.txt ne declare pas le sitemap",
        fix: `Ajouter "Sitemap: ${config.sitemap}".`,
      }),
    );
  }
  return { disallow };
}

/** Telecharge le sitemap ; suit un niveau d'index de sitemaps si besoin. */
async function loadSitemap(url) {
  const res = await fetchPage(url);
  if (res.status !== 200 || looksBlocked(res.html, res.status)) {
    throw new Error(`HTTP ${res.status}`);
  }
  const locs = [...res.html.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1].replace(/&amp;/g, '&'));
  if (/<sitemapindex\b/i.test(res.html)) {
    const nested = [];
    for (const child of locs) nested.push(...(await loadSitemap(child)));
    return nested;
  }
  return locs;
}

async function checkSitemap(config, previous, issues) {
  let urls;
  try {
    urls = await loadSitemap(config.sitemap);
  } catch (err) {
    issues.push(
      issue({
        severity: 'error',
        id: 'site-sitemap-unreachable',
        category: CATEGORY,
        title: 'Sitemap illisible',
        value: err.message,
        fix: 'Verifier que le sitemap repond en 200 avec un XML valide.',
      }),
    );
    return { urls: [], stats: null };
  }

  const stats = {
    total: urls.length,
    programmes: urls.filter((u) => u.includes('/programme/')).length,
    lots: urls.filter((u) => u.includes('/lot/')).length,
    duplicates: urls.length - new Set(urls.map(normalizeUrl)).size,
  };

  if (!urls.length) {
    issues.push(issue({ severity: 'error', id: 'site-sitemap-empty', category: CATEGORY, title: 'Sitemap vide' }));
  }
  if (stats.duplicates > 0) {
    issues.push(
      issue({
        severity: 'info',
        id: 'site-sitemap-duplicates',
        category: CATEGORY,
        title: `${stats.duplicates} URL en double dans le sitemap`,
        fix: 'Dedoublonner les URL du sitemap.',
      }),
    );
  }
  const httpUrls = urls.filter((u) => u.startsWith('http:'));
  if (httpUrls.length) {
    issues.push(
      issue({
        severity: 'warning',
        id: 'site-sitemap-http',
        category: CATEGORY,
        title: `${httpUrls.length} URL en http:// dans le sitemap`,
        value: httpUrls[0],
        fix: 'Lister uniquement les URL https canoniques.',
      }),
    );
  }

  const before = previous?.site?.sitemap;
  if (before?.total) {
    for (const key of ['total', 'programmes', 'lots']) {
      const drop = before[key] ? ((before[key] - stats[key]) / before[key]) * 100 : 0;
      if (drop >= config.sitemapDropAlertPercent) {
        issues.push(
          issue({
            severity: 'error',
            id: `site-sitemap-drop-${key}`,
            category: CATEGORY,
            title: `Chute du sitemap (${key}) : ${before[key]} -> ${stats[key]} (-${drop.toFixed(0)} %)`,
            detail: 'Une baisse brutale du nombre d\'URL signale souvent une generation de sitemap defaillante.',
            fix: 'Verifier la generation du sitemap et la mise en ligne recente.',
          }),
        );
      }
    }
  }

  // Echantillon d'URL du sitemap : elles doivent repondre en 200 sans redirection.
  const checked = [];
  for (const url of sample(urls, config.sitemapSampleSize)) {
    try {
      const res = await fetchPage(url);
      const entry = { url, status: res.status, finalUrl: res.finalUrl, elapsedMs: res.elapsedMs };
      checked.push(entry);
      if (res.status >= 400) {
        issues.push(
          issue({
            severity: 'error',
            id: 'site-sitemap-url-error',
            category: CATEGORY,
            title: `URL du sitemap en erreur HTTP ${res.status}`,
            value: url,
            fix: 'Retirer du sitemap les pages supprimees (lots vendus, programmes clos).',
          }),
        );
      } else if (normalizeUrl(res.finalUrl) !== normalizeUrl(url)) {
        issues.push(
          issue({
            severity: 'warning',
            id: 'site-sitemap-url-redirect',
            category: CATEGORY,
            title: 'URL du sitemap redirigee',
            value: `${url} -> ${res.finalUrl}`,
            fix: "Lister l'URL finale dans le sitemap.",
          }),
        );
      }
    } catch (err) {
      checked.push({ url, status: null, error: err.message });
      issues.push(issue({ severity: 'error', id: 'site-sitemap-url-unreachable', category: CATEGORY, title: 'URL du sitemap injoignable', value: `${url} : ${err.message}` }));
    }
  }

  return { urls, stats: { ...stats, sampleChecked: checked } };
}

// ---------------------------------------------------------------------------
// Pages
// ---------------------------------------------------------------------------

/** Squelette du JSON-LD : types et chemins de proprietes, sans les valeurs. */
function structureOf(blocks) {
  const paths = new Set();
  const visit = (value, path) => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item, `${path}[]`);
      return;
    }
    if (!value || typeof value !== 'object') {
      paths.add(path);
      return;
    }
    const type = value['@type'] ? `<${[].concat(value['@type']).join('+')}>` : '';
    for (const [key, child] of Object.entries(value)) {
      if (key === '@context' || key === '@type') continue;
      visit(child, path ? `${path}${type}.${key}` : `${type}${key}`);
    }
  };
  for (const block of blocks) {
    if (block.parseError) {
      paths.add(`${block.label}: JSON invalide`);
      continue;
    }
    visit(JSON.parse(block.pretty), '');
  }
  return [...paths].sort();
}

/** Balises du head presentes (pas leurs valeurs), plus la directive robots. */
function headShapeOf(head) {
  const present = [];
  const walk = (obj, prefix) => {
    for (const [key, value] of Object.entries(obj)) {
      if (value && typeof value === 'object' && !Array.isArray(value)) walk(value, `${prefix}${key}.`);
      else if (Array.isArray(value) ? value.length : value) present.push(`${prefix}${key}`);
    }
  };
  walk(head, '');
  if (head.robots) present.push(`robots=${head.robots.toLowerCase().replace(/\s+/g, '')}`);
  return present.sort();
}

async function auditPage(spec, sitemapSet) {
  const base = { slot: spec.slot, label: spec.label, kind: spec.kind, requestedUrl: spec.url };
  let report;
  let res;
  try {
    res = await fetchPage(spec.url);
    report = analyzeHtml(res.html, res.finalUrl, {
      requestedUrl: res.requestedUrl,
      finalUrl: res.finalUrl,
      status: res.status,
      redirected: res.redirected,
      contentType: res.contentType,
      xRobotsTag: res.xRobotsTag,
      elapsedMs: res.elapsedMs,
      bytes: res.bytes,
    });
  } catch (err) {
    const issues = [issue({ severity: 'error', id: 'site-page-unreachable', category: CATEGORY, title: 'Page injoignable', value: err.message })];
    return { ...base, url: spec.url, error: err.message, score: 0, counts: countBySeverity(issues), tools: [], issues, structure: [], headShape: [] };
  }

  const issues = report.tools.flatMap((t) => t.issues.map((i) => ({ ...i, tool: t.key })));
  if (sitemapSet.size && !sitemapSet.has(normalizeUrl(report.url))) {
    issues.push({
      ...issue({
        severity: 'warning',
        id: 'site-page-not-in-sitemap',
        category: CATEGORY,
        title: 'Page absente du sitemap',
        value: report.url,
        fix: 'Ajouter la page au sitemap, ou verifier qu\'elle doit toujours etre en ligne.',
      }),
      tool: 'site',
    });
  }

  const template = report.tools.find((t) => t.key === 'structured-data')?.extras?.template;
  const blocked = issues.some((i) => i.id === 'http-blocked');
  return {
    ...base,
    blocked,
    responseSample: blocked || res.status >= 400 ? responseSample(res.html) : undefined,
    url: report.url,
    template: template?.key ?? null,
    mainType: template?.mainType ?? null,
    fetch: report.fetch,
    score: report.score,
    counts: countBySeverity(issues),
    tools: report.tools.map((t) => ({ key: t.key, label: t.label, score: t.score, counts: t.counts })),
    issues: sortIssues(issues),
    structure: structureOf(report.blocks),
    headShape: headShapeOf(report.head),
  };
}

// ---------------------------------------------------------------------------
// Comparaison avec la veille
// ---------------------------------------------------------------------------

/** Cle stable d'un constat : les index de tableaux et les valeurs sont ignores. */
const issueKey = (i) => `${i.id}|${(i.path ?? '').replace(/\[\d+\]/g, '[]')}`;

function diffIssues(current, previous) {
  const before = new Map(previous.map((i) => [issueKey(i), i]));
  const after = new Map(current.map((i) => [issueKey(i), i]));
  const pick = (i) => ({ severity: i.severity, id: i.id, title: i.title, path: i.path, value: i.value, fix: i.fix });
  return {
    added: [...after].filter(([k]) => !before.has(k)).map(([, i]) => pick(i)),
    resolved: [...before].filter(([k]) => !after.has(k)).map(([, i]) => pick(i)),
  };
}

function diffList(current, previous) {
  const before = new Set(previous);
  const after = new Set(current);
  return { added: current.filter((x) => !before.has(x)), removed: previous.filter((x) => !after.has(x)) };
}

function buildDiff(current, previous) {
  if (!previous) return null;
  const pages = current.pages.map((page) => {
    const prev = previous.pages.find((p) => p.slot === page.slot);
    if (!prev) return { slot: page.slot, isNew: true };
    const samePage = normalizeUrl(prev.url) === normalizeUrl(page.url);
    const entry = {
      slot: page.slot,
      samePage,
      previousUrl: samePage ? undefined : prev.url,
      scoreBefore: prev.score,
      scoreAfter: page.score,
      issues: diffIssues(page.issues, prev.issues),
    };
    // La structure n'est comparable que sur une meme URL : un autre lot a d'autres champs.
    if (samePage) {
      entry.structure = diffList(page.structure, prev.structure);
      entry.headShape = diffList(page.headShape, prev.headShape);
    }
    return entry;
  });
  return {
    previousDate: previous.date,
    scoreBefore: previous.score,
    scoreAfter: current.score,
    site: diffIssues(current.site.issues, previous.site.issues),
    sitemap: previous.site.sitemap && current.site.sitemap
      ? {
          total: [previous.site.sitemap.total, current.site.sitemap.total],
          programmes: [previous.site.sitemap.programmes, current.site.sitemap.programmes],
          lots: [previous.site.sitemap.lots, current.site.sitemap.lots],
        }
      : null,
    pages,
  };
}

/** Regressions qui justifient une alerte en tete de mail. */
function buildAlerts(report) {
  const alerts = [];
  const CRITICAL = new Set([
    'http-blocked',
    'http-status-error',
    'http-x-robots-noindex',
    'meta-robots-noindex',
    'jsonld-absent',
    'jsonld-parse-error',
    'meta-canonical-missing',
    'meta-canonical-cross',
    'tracking-gtm-missing',
    'site-page-unreachable',
  ]);
  for (const i of report.site.issues) {
    if (i.severity === 'error') alerts.push({ scope: 'site', id: i.id, title: i.title, value: i.value });
  }
  for (const page of report.pages) {
    const pageDiff = report.diff?.pages.find((p) => p.slot === page.slot);
    const newKeys = pageDiff?.issues ? new Set(pageDiff.issues.added.map(issueKey)) : null;
    for (const i of page.issues) {
      if (!CRITICAL.has(i.id)) continue;
      // Sans historique, tout defaut critique est signale ; ensuite, seulement les nouveaux.
      if (newKeys && !newKeys.has(issueKey(i)) && pageDiff.samePage !== false) continue;
      alerts.push({ scope: page.slot, id: i.id, title: i.title, value: i.value });
    }
    if (pageDiff?.structure && (pageDiff.structure.added.length || pageDiff.structure.removed.length)) {
      alerts.push({
        scope: page.slot,
        id: 'change-jsonld-structure',
        title: `Structure JSON-LD modifiee depuis la veille (+${pageDiff.structure.added.length} / -${pageDiff.structure.removed.length} chemins)`,
        value: null,
      });
    }
    if (pageDiff?.headShape && (pageDiff.headShape.added.length || pageDiff.headShape.removed.length)) {
      alerts.push({
        scope: page.slot,
        id: 'change-head',
        title: 'Balises du head modifiees depuis la veille',
        value: [...pageDiff.headShape.added.map((x) => `+${x}`), ...pageDiff.headShape.removed.map((x) => `-${x}`)].join(', '),
      });
    }
  }
  return alerts;
}

// ---------------------------------------------------------------------------

function printSummary(report) {
  const out = [];
  if (report.blocked) {
    out.push(`AUDIT BLOQUE ${report.date} : ${report.blocked.reason}`);
    for (const s of report.blocked.statuses) out.push(`  ${s.slot} : ${s.status ?? s.error}`);
    out.push(`Extrait de la reponse : ${report.blocked.sample}`);
    console.log(out.join('\n'));
    return;
  }
  out.push(`Audit ${report.date} - score global ${report.score}/100${report.diff ? ` (veille ${report.diff.scoreBefore})` : ' (pas d\'historique)'}`);
  if (report.site.sitemap) {
    const s = report.site.sitemap;
    out.push(`Sitemap : ${s.total} URL, ${s.programmes} programmes, ${s.lots} lots`);
  }
  out.push(`Alertes : ${report.alerts.length}`);
  for (const a of report.alerts) out.push(`  ! [${a.scope}] ${a.title}${a.value ? ` (${a.value})` : ''}`);
  out.push('Site :');
  for (const i of report.site.issues) out.push(`  ${i.severity} ${i.id} ${i.title}`);
  for (const page of report.pages) {
    const d = report.diff?.pages.find((p) => p.slot === page.slot);
    out.push(`${page.slot} - ${page.score}/100 - ${page.url}`);
    out.push(`  ${page.counts.error} erreurs, ${page.counts.warning} avertissements, ${page.counts.info} infos`);
    if (d?.issues) {
      for (const i of d.issues.added) out.push(`  + ${i.severity} ${i.id} ${i.title}`);
      for (const i of d.issues.resolved) out.push(`  - resolu ${i.id} ${i.title}`);
    }
  }
  console.log(out.join('\n'));
}

async function main() {
  const configPath = resolve(ROOT, arg('config', 'audit-config.json'));
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  const date = arg('date', todayInParis());
  const previous = await loadPreviousReport(date);
  const started = Date.now();

  const siteIssues = [];
  await checkRobots(config, siteIssues);
  const { urls, stats } = await checkSitemap(config, previous, siteIssues);
  const sitemapSet = new Set(urls.map(normalizeUrl));

  const specs = config.fixedPages.map((p) => ({ ...p, kind: 'fixe' }));
  const fixedSet = new Set(specs.map((p) => normalizeUrl(p.url)));
  for (const rule of config.randomPages) {
    const candidates = urls.filter((u) => u.includes(rule.pattern) && !fixedSet.has(normalizeUrl(u)));
    if (!candidates.length) {
      siteIssues.push(
        issue({
          severity: 'error',
          id: 'site-no-candidate',
          category: CATEGORY,
          title: `Aucune URL "${rule.pattern}" dans le sitemap pour le tirage au hasard`,
          value: rule.slot,
        }),
      );
      continue;
    }
    specs.push({ ...rule, url: pickRandom(candidates), kind: 'aleatoire' });
  }

  const pages = [];
  for (const spec of specs) pages.push(await auditPage(spec, sitemapSet));

  const site = {
    issues: sortIssues(siteIssues),
    score: scoreOf(siteIssues),
    sitemap: stats,
  };
  const pageScores = pages.map((p) => p.score);
  const report = {
    date,
    generatedAt: new Date().toISOString(),
    elapsedMs: Date.now() - started,
    config: { site: config.site, sitemap: config.sitemap },
    // Score global : moyenne des pages, le score site comptant comme une page.
    score: Math.round([...pageScores, site.score].reduce((a, b) => a + b, 0) / (pageScores.length + 1)),
    site,
    pages,
  };
  // Si aucune page n'a pu etre lue normalement, l'audit ne dit rien du site : on le marque
  // comme bloque plutot que de produire des dizaines de faux defauts et une fausse tendance.
  if (pages.length && pages.every((p) => p.blocked || p.error)) {
    const sample = pages.find((p) => p.responseSample)?.responseSample ?? pages.find((p) => p.error)?.error ?? null;
    report.blocked = {
      reason: "Aucune page du site n'a pu etre lue : reponses de blocage ou erreurs reseau.",
      statuses: pages.map((p) => ({ slot: p.slot, url: p.url, status: p.fetch?.status ?? null, error: p.error ?? null })),
      sample,
    };
    report.diff = null;
    report.alerts = [{ scope: 'site', id: 'audit-blocked', title: 'Audit non realise : acces au site bloque', value: sample }];
  } else {
    report.diff = buildDiff(report, previous);
    report.alerts = buildAlerts(report);
  }

  await mkdir(REPORTS_DIR, { recursive: true });
  const file = join(REPORTS_DIR, `${date}.json`);
  await writeFile(file, `${JSON.stringify(report, null, 2)}\n`);
  printSummary(report);
  console.log(`\nRapport ecrit : ${file}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
