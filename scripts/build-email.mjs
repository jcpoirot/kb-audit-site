/**
 * Preparation du mail de synthese de l'audit quotidien.
 *
 * Le script n'envoie rien : l'envoi est fait par la routine Claude via le connecteur Gmail
 * (compte de l'utilisateur), a partir des fichiers produits ici.
 *
 * Usage :
 *   npm run email                                rapport du jour (reports/AAAA-MM-JJ.json)
 *   npm run email -- --date 2026-10-01           rapport d'une date donnee
 *   npm run email -- --failure "message"         mail d'alerte quand l'audit n'a pas pu tourner
 *
 * Entrees : reports/AAAA-MM-JJ.json et, facultative, la synthese redigee reports/AAAA-MM-JJ.synthese.md
 * Sorties :
 *   reports/AAAA-MM-JJ.email.html   corps HTML du mail (non versionne)
 *   reports/AAAA-MM-JJ.email.json   { to, subject, htmlFile } : ce que la routine doit envoyer
 *   reports/AAAA-MM-JJ.csv          tous les constats ; versionne, et lie depuis le mail
 *
 * Variable d'environnement facultative : REPORT_TO (destinataires separes par des virgules).
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPORTS_DIR = join(ROOT, 'reports');

const SLOT_LABELS = {
  home: "Page d'accueil",
  'programme-temoin': 'Programme temoin',
  'lot-temoin': 'Lot temoin',
  'programme-aleatoire': 'Programme au hasard',
  'lot-aleatoire': 'Lot au hasard',
};

const COLORS = { error: '#c62828', warning: '#ef6c00', info: '#1565c0', ok: '#2e7d32', muted: '#666666', line: '#e0e0e0' };
const SEVERITY_LABELS = { error: 'Erreur', warning: 'Avertissement', info: 'Info' };

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : fallback;
}

function todayInParis() {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Paris' }).format(new Date());
}

const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

function scoreColor(score) {
  if (score >= 80) return COLORS.ok;
  if (score >= 60) return COLORS.warning;
  return COLORS.error;
}

function delta(before, after) {
  if (before == null || after == null) return '';
  const d = after - before;
  if (d === 0) return '<span style="color:#666">=</span>';
  return `<span style="color:${d > 0 ? COLORS.ok : COLORS.error}">${d > 0 ? '+' : ''}${d}</span>`;
}

/** Markdown minimal (titres ##, listes -, gras **, paragraphes) vers HTML. */
function markdownToHtml(md) {
  const inline = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/`(.+?)`/g, '<code>$1</code>');
  const html = [];
  let list = false;
  for (const raw of md.split(/\r?\n/)) {
    const line = raw.trim();
    const item = /^[-*]\s+(.*)/.exec(line);
    if (!item && list) {
      html.push('</ul>');
      list = false;
    }
    if (!line) continue;
    if (item) {
      if (!list) html.push('<ul style="margin:6px 0 10px;padding-left:20px">');
      list = true;
      html.push(`<li style="margin:3px 0">${inline(item[1])}</li>`);
    } else if (/^#{1,6}\s/.test(line)) {
      html.push(`<h3 style="font-size:15px;margin:14px 0 6px">${inline(line.replace(/^#+\s*/, ''))}</h3>`);
    } else {
      html.push(`<p style="margin:6px 0">${inline(line)}</p>`);
    }
  }
  if (list) html.push('</ul>');
  return html.join('\n');
}

function section(title, body) {
  return `<h2 style="font-size:17px;margin:26px 0 8px;padding-bottom:4px;border-bottom:2px solid ${COLORS.line}">${esc(title)}</h2>${body}`;
}

function issueLine(i, prefix = '') {
  const color = COLORS[i.severity] ?? COLORS.muted;
  const value = i.value ? ` <span style="color:${COLORS.muted}">(${esc(String(i.value).slice(0, 120))})</span>` : '';
  return `<li style="margin:3px 0">${prefix}<strong style="color:${color}">${esc(SEVERITY_LABELS[i.severity] ?? i.severity)}</strong> ${esc(i.title)}${value} <code style="color:${COLORS.muted};font-size:11px">${esc(i.id)}</code></li>`;
}

const ul = (items) => (items.length ? `<ul style="margin:6px 0;padding-left:20px">${items.join('')}</ul>` : '');

/** Liens vers le detail complet, publie dans le depot avec le rapport. */
function detailLinks(report, { reportsUrl }) {
  if (!reportsUrl) return 'Le detail de tous les constats (infos comprises) est dans le dossier reports/ du depot.';
  const base = reportsUrl.replace(/\/?$/, '/');
  return `Detail de tous les constats, infos comprises :
    <a href="${esc(`${base}${report.date}.csv`)}" style="color:${COLORS.info}">CSV</a> -
    <a href="${esc(`${base}${report.date}.json`)}" style="color:${COLORS.info}">rapport JSON</a>.`;
}

function buildHtml(report, synthese, options = {}) {
  const diff = report.diff;
  const parts = [];

  // En-tete
  parts.push(`
    <p style="margin:0;color:${COLORS.muted}">Audit SEO bihebdomadaire - ${esc(report.config.site)}</p>
    <h1 style="font-size:22px;margin:4px 0 12px">Rapport du ${esc(report.date)}</h1>
    <p style="font-size:16px;margin:0">Score global :
      <strong style="font-size:26px;color:${scoreColor(report.score)}">${report.score}/100</strong>
      ${diff ? `&nbsp;${delta(diff.scoreBefore, diff.scoreAfter)} <span style="color:${COLORS.muted}">depuis le ${esc(diff.previousDate)}</span>` : `<span style="color:${COLORS.muted}">(premier rapport, pas de comparaison)</span>`}
    </p>`);

  // Alertes
  if (report.alerts.length) {
    const items = report.alerts.map(
      (a) =>
        `<li style="margin:4px 0"><strong>${esc(SLOT_LABELS[a.scope] ?? a.scope)}</strong> : ${esc(a.title)}${a.value ? ` <span style="color:${COLORS.muted}">(${esc(String(a.value).slice(0, 200))})</span>` : ''}</li>`,
    );
    parts.push(`
      <div style="margin:18px 0;padding:12px 16px;background:#fdecea;border-left:4px solid ${COLORS.error}">
        <strong style="color:${COLORS.error}">${report.alerts.length} alerte${report.alerts.length > 1 ? 's' : ''}</strong>
        <ul style="margin:6px 0 0;padding-left:20px">${items.join('')}</ul>
      </div>`);
  } else {
    parts.push(`<div style="margin:18px 0;padding:10px 16px;background:#e8f5e9;border-left:4px solid ${COLORS.ok}">Aucune regression critique detectee.</div>`);
  }

  // Synthese redigee
  if (synthese) parts.push(section('Synthese', markdownToHtml(synthese)));

  // Pages
  const rows = report.pages.map((p) => {
    const d = diff?.pages.find((x) => x.slot === p.slot);
    return `<tr>
      <td style="padding:6px 8px;border-bottom:1px solid ${COLORS.line}"><strong>${esc(SLOT_LABELS[p.slot] ?? p.slot)}</strong><br>
        <a href="${esc(p.url)}" style="color:${COLORS.info};font-size:12px;word-break:break-all">${esc(p.url.replace(/^https?:\/\/[^/]+/, '') || '/')}</a></td>
      <td style="padding:6px 8px;border-bottom:1px solid ${COLORS.line};text-align:center"><strong style="color:${scoreColor(p.score)}">${p.score}</strong>
        ${d && d.samePage ? `<br><span style="font-size:12px">${delta(d.scoreBefore, d.scoreAfter)}</span>` : ''}</td>
      <td style="padding:6px 8px;border-bottom:1px solid ${COLORS.line};text-align:center;color:${COLORS.error}">${p.counts.error}</td>
      <td style="padding:6px 8px;border-bottom:1px solid ${COLORS.line};text-align:center;color:${COLORS.warning}">${p.counts.warning}</td>
      <td style="padding:6px 8px;border-bottom:1px solid ${COLORS.line};text-align:center;color:${COLORS.info}">${p.counts.info}</td>
    </tr>`;
  });
  parts.push(
    section(
      'Pages analysees',
      `<table cellspacing="0" cellpadding="0" style="border-collapse:collapse;width:100%;font-size:14px">
        <tr style="background:#f5f5f5"><th style="padding:6px 8px;text-align:left">Page</th><th style="padding:6px 8px">Score</th>
        <th style="padding:6px 8px;color:${COLORS.error}">Err.</th><th style="padding:6px 8px;color:${COLORS.warning}">Avert.</th><th style="padding:6px 8px;color:${COLORS.info}">Info</th></tr>
        ${rows.join('')}
      </table>`,
    ),
  );

  // Changements depuis le rapport precedent
  if (diff) {
    const blocks = [];
    for (const d of diff.pages) {
      if (d.isNew || !d.issues) continue;
      const items = [
        ...d.issues.added.filter((i) => i.severity !== 'info').map((i) => issueLine(i, '<span style="color:#c62828">nouveau</span> ')),
        ...d.issues.resolved.filter((i) => i.severity !== 'info').map((i) => issueLine(i, '<span style="color:#2e7d32">resolu</span> ')),
      ];
      if (d.structure) {
        for (const x of d.structure.added) items.push(`<li>JSON-LD : chemin ajoute <code>${esc(x)}</code></li>`);
        for (const x of d.structure.removed) items.push(`<li>JSON-LD : chemin supprime <code>${esc(x)}</code></li>`);
      }
      if (!items.length) continue;
      const note = d.samePage ? '' : ` <span style="color:${COLORS.muted};font-size:12px">(page differente du rapport precedent : ecarts indicatifs)</span>`;
      blocks.push(`<p style="margin:12px 0 2px"><strong>${esc(SLOT_LABELS[d.slot] ?? d.slot)}</strong>${note}</p>${ul(items.slice(0, 25))}`);
    }
    const siteItems = [
      ...diff.site.added.map((i) => issueLine(i, '<span style="color:#c62828">nouveau</span> ')),
      ...diff.site.resolved.map((i) => issueLine(i, '<span style="color:#2e7d32">resolu</span> ')),
    ];
    if (siteItems.length) blocks.unshift(`<p style="margin:12px 0 2px"><strong>Site</strong></p>${ul(siteItems)}`);
    parts.push(
      section(
        `Changements depuis le ${diff.previousDate}`,
        blocks.length ? blocks.join('') : `<p style="color:${COLORS.muted}">Aucun changement d'erreur ou d'avertissement (les infos ne sont pas listees).</p>`,
      ),
    );
  }

  // Site : robots / sitemap
  const s = report.site.sitemap;
  const siteBody = [];
  if (s) {
    const sd = diff?.sitemap;
    const fmt = (key) => `${s[key]}${sd ? ` <span style="font-size:12px">${delta(sd[key][0], sd[key][1])}</span>` : ''}`;
    siteBody.push(
      `<p style="margin:6px 0">Sitemap : <strong>${fmt('total')}</strong> URL, dont ${fmt('programmes')} programmes et ${fmt('lots')} lots.
       ${s.sampleChecked.length} URL tirees au hasard verifiees : ${s.sampleChecked.filter((c) => c.status === 200).length} en 200.</p>`,
    );
  }
  siteBody.push(report.site.issues.length ? ul(report.site.issues.map((i) => issueLine(i))) : `<p style="margin:6px 0;color:${COLORS.ok}">robots.txt et sitemap conformes.</p>`);
  parts.push(section('Site (robots.txt, sitemap)', siteBody.join('')));

  // Defauts persistants : erreurs et avertissements regroupes par regle et par titre.
  // Les nombres du titre sont neutralises (« Longueur du title : 66 / 71 caracteres » = un seul defaut),
  // mais un meme id peut porter des titres differents selon le gabarit (kb-main-entity-missing).
  const byId = new Map();
  for (const p of report.pages) {
    for (const i of p.issues) {
      if (i.severity === 'info') continue;
      const key = `${i.id}|${i.title.replace(/\d+/g, '#')}`;
      if (!byId.has(key)) byId.set(key, { issue: i, slots: new Set() });
      byId.get(key).slots.add(SLOT_LABELS[p.slot] ?? p.slot);
    }
  }
  const persistent = [...byId.values()]
    .sort((a, b) => (a.issue.severity === b.issue.severity ? b.slots.size - a.slots.size : a.issue.severity === 'error' ? -1 : 1))
    .map(({ issue: i, slots }) => {
      const fix = i.fix ? `<br><span style="color:${COLORS.muted};font-size:12px">Correctif : ${esc(i.fix)}</span>` : '';
      return `<li style="margin:6px 0"><strong style="color:${COLORS[i.severity]}">${esc(SEVERITY_LABELS[i.severity])}</strong> ${esc(i.title)}
        <span style="color:${COLORS.muted};font-size:12px">- ${esc([...slots].join(', '))}</span>${fix}</li>`;
    });
  parts.push(section('Erreurs et avertissements en cours', ul(persistent) || '<p>Aucun.</p>'));

  parts.push(
    `<p style="margin:28px 0 0;color:${COLORS.muted};font-size:12px">${detailLinks(report, options)}
     Rapport genere le ${esc(report.generatedAt)} en ${(report.elapsedMs / 1000).toFixed(0)} s.</p>`,
  );

  return `<!doctype html><html><body style="margin:0;padding:0;background:#f4f4f4">
  <div style="max-width:760px;margin:0 auto;padding:24px;background:#ffffff;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.45;color:#222">
  ${parts.join('\n')}
  </div></body></html>`;
}

/** Tous les constats, une ligne par constat. Separateur ; et BOM pour Excel en francais. */
function buildCsv(report) {
  const cell = (v) => `"${String(v ?? '').replace(/"/g, '""').replace(/\r?\n/g, ' ')}"`;
  const header = ['page', 'url', 'gravite', 'id', 'categorie', 'titre', 'chemin', 'valeur', 'correctif', 'documentation'];
  const lines = [header.join(';')];
  const rows = [
    ...report.site.issues.map((i) => ['site', report.config.sitemap, i]),
    ...report.pages.flatMap((p) => p.issues.map((i) => [p.slot, p.url, i])),
  ];
  for (const [slot, url, i] of rows) {
    lines.push([slot, url, i.severity, i.id, i.category, i.title, i.path, i.value, i.fix, i.docs].map(cell).join(';'));
  }
  return `﻿${lines.join('\r\n')}\r\n`;
}

function subjectOf(report) {
  const d = report.diff ? report.diff.scoreAfter - report.diff.scoreBefore : null;
  const trend = d == null ? '' : ` (${d > 0 ? '+' : ''}${d})`;
  const alerts = report.alerts.length ? `ALERTE (${report.alerts.length}) - ` : '';
  return `${alerts}Audit SEO kaufmanbroad.fr ${report.date} - ${report.score}/100${trend}`;
}

function recipients(config) {
  if (process.env.REPORT_TO) return process.env.REPORT_TO.split(',').map((e) => e.trim()).filter(Boolean);
  return config.email.to.map((t) => t.email);
}

async function readOptional(path) {
  try {
    return await readFile(path, 'utf8');
  } catch {
    return null;
  }
}

/** L'indentation est inutile aux clients mail : un HTML compact est plus simple a transmettre. */
const compact = (html) => html.replace(/\n\s*/g, '\n');

async function main() {
  const config = JSON.parse(await readFile(resolve(ROOT, arg('config', 'audit-config.json')), 'utf8'));
  const date = arg('date', todayInParis());
  const failure = arg('failure', null);
  await mkdir(REPORTS_DIR, { recursive: true });

  let subject;
  let html;
  if (failure) {
    subject = `ECHEC - Audit SEO kaufmanbroad.fr ${date}`;
    html = `<div style="font-family:Arial,sans-serif;font-size:14px">
      <h2 style="color:${COLORS.error}">L'audit du ${esc(date)} n'a pas pu aboutir</h2>
      <pre style="white-space:pre-wrap;background:#f5f5f5;padding:12px">${esc(failure)}</pre>
      <p>Aucun rapport n'a ete produit : l'absence de mail de synthese n'est pas un signe que tout va bien.</p></div>`;
  } else {
    const report = JSON.parse(await readFile(join(REPORTS_DIR, `${date}.json`), 'utf8'));
    const synthese = await readOptional(join(REPORTS_DIR, `${date}.synthese.md`));
    subject = subjectOf(report);
    html = buildHtml(report, synthese, { reportsUrl: config.reportsUrl });
    await writeFile(join(REPORTS_DIR, `${date}.csv`), buildCsv(report));
  }

  html = compact(html);
  const htmlFile = `reports/${date}.email.html`;
  await writeFile(join(ROOT, htmlFile), html);
  const message = { to: recipients(config), subject, htmlFile };
  await writeFile(join(REPORTS_DIR, `${date}.email.json`), `${JSON.stringify(message, null, 2)}\n`);
  console.log(`Destinataires : ${message.to.join(', ')}\nSujet : ${subject}\nCorps HTML : ${htmlFile} (${Buffer.byteLength(html)} octets)`);
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
