/**
 * Interface de la boite a outils SEO.
 * Consomme /api/analyze et rend le rapport : score, eligibilite Google,
 * un onglet par outil, plus le JSON-LD brut et le detail du head.
 */

const $ = (sel) => document.querySelector(sel);

const form = $('#analyze-form');
const input = $('#url-input');
const button = $('#analyze-btn');
const recentList = $('#recent-urls');

const sections = {
  placeholder: $('#placeholder'),
  loading: $('#loading'),
  error: $('#error'),
  report: $('#report'),
};

const SEVERITY_LABEL = { error: 'Erreur', warning: 'Avertissement', info: 'Info' };
const RECENTS_KEY = 'kb-seo-recents';

let currentReport = null;

// ------------------------------------------------------------------ helpers

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value == null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2).toLowerCase(), value);
    else node.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of children.flat()) {
    if (child == null || child === false) continue;
    node.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

function show(name) {
  for (const [key, node] of Object.entries(sections)) node.hidden = key !== name;
}

function scoreColor(score) {
  if (score >= 85) return 'var(--ok)';
  if (score >= 60) return 'var(--warning)';
  return 'var(--error)';
}

// ------------------------------------------------------------------ recents

function loadRecents() {
  try {
    return JSON.parse(localStorage.getItem(RECENTS_KEY) ?? '[]');
  } catch {
    return [];
  }
}

function rememberUrl(url) {
  const recents = [url, ...loadRecents().filter((u) => u !== url)].slice(0, 12);
  try {
    localStorage.setItem(RECENTS_KEY, JSON.stringify(recents));
  } catch {
    /* mode prive : on se passe de l'historique */
  }
  renderRecents(recents);
}

function renderRecents(recents = loadRecents()) {
  recentList.replaceChildren(...recents.map((url) => el('option', { value: url })));
}

// ------------------------------------------------------------------- rendu

function renderScore(score) {
  const circumference = 2 * Math.PI * 52;
  const ring = $('#ring-value');
  ring.style.strokeDasharray = String(circumference);
  ring.style.strokeDashoffset = String(circumference * (1 - score / 100));
  ring.style.stroke = scoreColor(score);
  $('#score-number').textContent = String(score);
}

function renderBadges(report) {
  const template = report.tools.find((t) => t.key === 'structured-data')?.extras?.template;
  const blocks = report.blocks.length;
  const badges = [
    template ? el('span', { class: 'badge badge-strong', text: template.label }) : null,
    template?.mainType ? el('span', { class: 'badge', text: `Entité : ${template.mainType}` }) : null,
    el('span', { class: 'badge', text: `HTTP ${report.fetch.status}` }),
    report.fetch.redirected ? el('span', { class: 'badge', text: 'Redirigée' }) : null,
    el('span', { class: 'badge', text: `${blocks} bloc${blocks > 1 ? 's' : ''} JSON-LD` }),
    el('span', { class: 'badge', text: `${Math.round(report.fetch.bytes / 1024)} Ko en ${report.fetch.elapsedMs} ms` }),
  ];
  $('#report-badges').replaceChildren(...badges.filter(Boolean));

  $('#report-counts').replaceChildren(
    ...['error', 'warning', 'info'].map((sev) =>
      el(
        'span',
        {},
        el('span', { class: `dot dot-${sev}` }),
        el('b', { text: String(report.counts[sev]) }),
        ` ${SEVERITY_LABEL[sev].toLowerCase()}${report.counts[sev] > 1 ? 's' : ''}`,
      ),
    ),
  );

  const link = $('#report-url');
  link.href = report.url;
  link.textContent = report.url;
}

function renderFeatures(report) {
  const features = report.tools.find((t) => t.key === 'structured-data')?.extras?.features ?? [];
  $('#features').replaceChildren(
    ...features.map((feature) => {
      const state =
        feature.eligible === null ? 'neutral' : feature.eligible ? 'eligible' : feature.detected ? 'detected' : 'absent';
      const label = {
        eligible: 'Éligible',
        detected: 'Incomplet',
        absent: 'Absent',
        neutral: 'Hors galerie',
      }[state];
      return el(
        'article',
        { class: `feature ${state}` },
        el(
          'div',
          { class: 'feature-head' },
          el('span', { class: 'feature-name', text: feature.label }),
          el('span', { class: `feature-state ${state}`, text: label }),
        ),
        el('p', { class: 'feature-note', text: feature.note }),
      );
    }),
  );
}

function renderIssue(item) {
  return el(
    'article',
    { class: `issue ${item.severity}` },
    el(
      'div',
      { class: 'issue-head' },
      el('span', { class: `sev ${item.severity}`, text: SEVERITY_LABEL[item.severity] }),
      el('span', { class: 'issue-title', text: item.title }),
      item.path ? el('span', { class: 'issue-path', text: item.path }) : null,
    ),
    item.detail ? el('p', { class: 'issue-detail', text: item.detail }) : null,
    item.value ? el('code', { class: 'issue-value', text: item.value }) : null,
    item.fix ? el('p', { class: 'issue-fix' }, el('strong', { text: 'Correction : ' }), item.fix) : null,
    item.docs ? el('a', { class: 'issue-docs', href: item.docs, target: '_blank', rel: 'noreferrer' }, 'Documentation ↗') : null,
  );
}

function renderToolPanel(tool) {
  const panel = el('div', { class: 'panel', id: `panel-${tool.key}`, role: 'tabpanel', hidden: true });
  panel.append(el('p', { class: 'panel-intro', text: tool.description }));

  if (tool.issues.length === 0) {
    panel.append(el('div', { class: 'empty', text: 'Aucun constat : tout est conforme sur ce périmètre.' }));
    return panel;
  }

  const listHost = el('div');
  const active = new Set(['error', 'warning', 'info']);

  const draw = () => {
    const visible = tool.issues.filter((i) => active.has(i.severity));
    if (visible.length === 0) {
      listHost.replaceChildren(el('div', { class: 'empty', text: 'Aucun constat pour ce filtre.' }));
      return;
    }
    const groups = new Map();
    for (const item of visible) {
      if (!groups.has(item.category)) groups.set(item.category, []);
      groups.get(item.category).push(item);
    }
    listHost.replaceChildren(
      ...[...groups.entries()].map(([category, items]) =>
        el(
          'section',
          { class: 'category' },
          el('h3', { class: 'category-title', text: `${category} — ${items.length}` }),
          ...items.map(renderIssue),
        ),
      ),
    );
  };

  const filters = el(
    'div',
    { class: 'filters' },
    ...['error', 'warning', 'info'].map((sev) => {
      const count = tool.counts[sev];
      const btn = el('button', {
        type: 'button',
        class: 'chip filter',
        'aria-pressed': 'true',
        text: `${SEVERITY_LABEL[sev]}s (${count})`,
      });
      btn.addEventListener('click', () => {
        const pressed = btn.getAttribute('aria-pressed') === 'true';
        btn.setAttribute('aria-pressed', String(!pressed));
        if (pressed) active.delete(sev);
        else active.add(sev);
        draw();
      });
      return btn;
    }),
  );

  panel.append(filters, listHost);
  draw();
  return panel;
}

function renderJsonPanel(report) {
  const panel = el('div', { class: 'panel', id: 'panel-jsonld', role: 'tabpanel', hidden: true });
  panel.append(
    el('p', {
      class: 'panel-intro',
      text: 'Blocs application/ld+json tels que servis par la page, reformatés pour la lecture.',
    }),
  );
  if (report.blocks.length === 0) {
    panel.append(el('div', { class: 'empty', text: 'Aucun bloc JSON-LD sur cette page.' }));
    return panel;
  }
  for (const block of report.blocks) {
    panel.append(
      el(
        'div',
        { class: 'block' },
        el(
          'div',
          { class: 'block-head' },
          el('span', { class: 'block-title', text: `${block.label} — ligne ${block.line}` }),
          ...(block.types.length ? block.types.map((t) => el('span', { class: 'badge', text: t })) : []),
          block.parseError ? el('span', { class: 'sev error', text: 'JSON invalide' }) : null,
        ),
        el('pre', { class: 'json' }, block.pretty),
      ),
    );
  }
  return panel;
}

function renderHeadPanel(report) {
  const panel = el('div', { class: 'panel', id: 'panel-head', role: 'tabpanel', hidden: true });
  panel.append(el('p', { class: 'panel-intro', text: 'Valeurs lues dans le document servi.' }));

  const { head } = report;
  const rows = [
    ['title', head.title],
    ['meta description', head.description],
    ['robots', head.robots],
    ['lang', head.lang],
    ['canonical', head.canonical],
    ['viewport', head.viewport],
    ['og:type', head.og.type],
    ['og:title', head.og.title],
    ['og:description', head.og.description],
    ['og:url', head.og.url],
    ['og:site_name', head.og.siteName],
    ['og:locale', head.og.locale],
    ['og:image', head.og.images.join('\n')],
    ['og:image (taille)', head.og.imageWidth && head.og.imageHeight ? `${head.og.imageWidth} × ${head.og.imageHeight}` : null],
    ['twitter:card', head.twitter.card],
    ['twitter:image', head.twitter.image],
    ['hreflang', head.alternates.map((a) => `${a.hreflang} → ${a.href}`).join('\n')],
  ];

  panel.append(
    el(
      'table',
      { class: 'head-table' },
      el(
        'tbody',
        {},
        ...rows.map(([label, value]) =>
          el(
            'tr',
            {},
            el('th', { text: label }),
            value
              ? el('td', { text: value })
              : el('td', { class: 'absent', text: 'absent' }),
          ),
        ),
      ),
    ),
  );

  const headings = report.headings;
  if (headings.length) {
    panel.append(
      el('h3', { class: 'category-title', text: `Hiérarchie de titres — ${headings.length}` }),
      el(
        'pre',
        { class: 'json' },
        headings.map((h) => `${'  '.repeat(h.level - 1)}H${h.level}  ${h.text}`).join('\n'),
      ),
    );
  }
  return panel;
}

function renderTabs(report) {
  const tabsHost = $('#tabs');
  const panelsHost = $('#panels');

  const entries = [
    ...report.tools.map((tool) => ({
      key: tool.key,
      label: tool.label,
      score: tool.score,
      panel: renderToolPanel(tool),
    })),
    { key: 'jsonld', label: 'JSON-LD brut', score: null, panel: renderJsonPanel(report) },
    { key: 'head', label: 'Head lu', score: null, panel: renderHeadPanel(report) },
  ];

  const tabs = entries.map((entry, i) => {
    const tab = el(
      'button',
      {
        type: 'button',
        class: 'tab',
        role: 'tab',
        id: `tab-${entry.key}`,
        'aria-controls': `panel-${entry.key}`,
        'aria-selected': String(i === 0),
      },
      entry.label,
      entry.score === null
        ? null
        : el('span', { class: 'tab-score', text: `${entry.score}`, style: `color:${scoreColor(entry.score)}` }),
    );
    tab.addEventListener('click', () => {
      for (const [j, other] of entries.entries()) {
        tabs[j].setAttribute('aria-selected', String(j === i));
        other.panel.hidden = j !== i;
      }
    });
    return tab;
  });

  entries[0].panel.hidden = false;
  tabsHost.replaceChildren(...tabs);
  panelsHost.replaceChildren(...entries.map((e) => e.panel));
}

function renderReport(report) {
  currentReport = report;
  renderScore(report.score);
  renderBadges(report);
  renderFeatures(report);
  renderTabs(report);
  show('report');
}

// ------------------------------------------------------------------ actions

async function analyze(url) {
  show('loading');
  button.disabled = true;
  $('#loading-text').textContent = `Téléchargement et analyse de ${url}…`;
  try {
    const res = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url }),
    });
    const payload = await res.json();
    if (!res.ok) throw new Error(payload.error ?? `Erreur ${res.status}`);
    rememberUrl(url);
    renderReport(payload);
  } catch (err) {
    $('#error-text').textContent = err.message;
    show('error');
  } finally {
    button.disabled = false;
  }
}

function summaryText(report) {
  const lines = [
    `Audit SEO — ${report.url}`,
    `Score global : ${report.score}/100 (${report.counts.error} erreurs, ${report.counts.warning} avertissements, ${report.counts.info} infos)`,
    '',
  ];
  for (const tool of report.tools) {
    lines.push(`## ${tool.label} — ${tool.score}/100`);
    for (const item of tool.issues) {
      lines.push(`- [${SEVERITY_LABEL[item.severity]}] ${item.title}${item.path ? ` (${item.path})` : ''}`);
      if (item.fix) lines.push(`    → ${item.fix}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

function download(filename, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = el('a', { href: url, download: filename });
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  const url = input.value.trim();
  if (url) analyze(url);
});

for (const preset of document.querySelectorAll('.chip-preset')) {
  preset.addEventListener('click', () => {
    input.value = preset.dataset.url;
    analyze(preset.dataset.url);
  });
}

$('#export-json').addEventListener('click', () => {
  if (!currentReport) return;
  const slug = new URL(currentReport.url).pathname.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '');
  download(`audit-seo-${slug || 'page'}.json`, JSON.stringify(currentReport, null, 2), 'application/json');
});

$('#copy-summary').addEventListener('click', async (event) => {
  if (!currentReport) return;
  const button = event.currentTarget;
  const original = button.textContent;
  try {
    await navigator.clipboard.writeText(summaryText(currentReport));
    button.textContent = 'Synthèse copiée';
  } catch {
    button.textContent = 'Copie refusée par le navigateur';
  }
  setTimeout(() => {
    button.textContent = original;
  }, 2000);
});

renderRecents();

// Permet de partager un lien pre-rempli : /?url=…
const initial = new URLSearchParams(location.search).get('url');
if (initial) {
  input.value = initial;
  analyze(initial);
}
