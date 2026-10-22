/**
 * Envoi du mail de synthese prepare par build-email.mjs, via l'API transactionnelle Brevo.
 *
 * Usage :
 *   npm run send                                 mail du jour (reports/AAAA-MM-JJ.email.json)
 *   npm run send -- --date 2026-10-01            mail d'une date donnee
 *   npm run send -- --text "version texte"       version texte facultative (sinon HTML seul)
 *
 * Entrees : reports/AAAA-MM-JJ.email.json ({ to, subject, htmlFile }) et le HTML qu'il designe.
 * Expediteur : email.from de audit-config.json ; l'adresse doit etre un expediteur valide dans Brevo.
 * Reponses : email.replyTo de audit-config.json (facultatif).
 *
 * Variable d'environnement obligatoire : BREVO_API_KEY (jamais dans le depot ni dans les journaux).
 */
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BREVO_URL = 'https://api.brevo.com/v3/smtp/email';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : fallback;
}

function todayInParis() {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Paris' }).format(new Date());
}

async function post(apiKey, payload) {
  const res = await fetch(BREVO_URL, {
    method: 'POST',
    headers: { 'api-key': apiKey, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = await res.text();
  return { ok: res.ok, status: res.status, body };
}

async function main() {
  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) throw new Error('BREVO_API_KEY absente : la declarer dans les variables de l\'environnement cloud.');

  const config = JSON.parse(await readFile(resolve(ROOT, arg('config', 'audit-config.json')), 'utf8'));
  const from = config.email?.from;
  if (!from?.email) throw new Error('email.from absent de audit-config.json (expediteur valide dans Brevo).');

  const date = arg('date', todayInParis());
  const message = JSON.parse(await readFile(join(ROOT, 'reports', `${date}.email.json`), 'utf8'));
  const html = await readFile(join(ROOT, message.htmlFile), 'utf8');
  const text = arg('text', null);

  const payload = {
    sender: { email: from.email, ...(from.name ? { name: from.name } : {}) },
    ...(config.email.replyTo?.email ? { replyTo: config.email.replyTo } : {}),
    to: message.to.map((email) => ({ email })),
    subject: message.subject,
    htmlContent: html,
    ...(text ? { textContent: text } : {}),
  };

  // Un seul nouvel essai, et seulement sur erreur reseau ou 5xx : un 4xx (cle, expediteur) ne se corrige pas seul.
  let result;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      result = await post(apiKey, payload);
    } catch (err) {
      result = { ok: false, status: null, body: err.cause?.code ?? err.message };
    }
    if (result.ok || (result.status && result.status < 500)) break;
  }

  if (!result.ok) throw new Error(`Envoi Brevo refuse (${result.status ?? 'reseau'}) : ${result.body}`);
  const { messageId } = JSON.parse(result.body || '{}');
  console.log(`Mail envoye via Brevo a ${message.to.join(', ')}\nSujet : ${message.subject}\nmessageId : ${messageId ?? '?'}`);
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
