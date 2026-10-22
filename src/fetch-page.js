/**
 * Recuperation du HTML brut d'une page (HTML servi, pas de rendu JS).
 */

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const TIMEOUT_MS = 20000;
const MAX_REDIRECTS = 10;

/** Erreur imputable a la saisie de l'utilisateur, pas au site distant. */
function invalidUrl(message) {
  const err = new Error(message);
  err.code = 'INVALID_URL';
  return err;
}

/**
 * En-tete secret qui exempte l'audit de la regle anti-robots du WAF Azure Front Door
 * (regle personnalisee AllowSeoAudit). La valeur vient de la variable d'environnement
 * AUDIT_TOKEN et n'est envoyee qu'au site audite : l'UI peut analyser n'importe quelle URL,
 * et le jeton ne doit pas fuiter vers un site tiers (ni via une redirection vers un autre domaine).
 */
const TOKEN_HOST = /(^|\.)kaufmanbroad\.fr$/i;

function auditHeaders(hostname) {
  const token = process.env.AUDIT_TOKEN?.trim();
  return token && TOKEN_HOST.test(hostname) ? { 'x-audit-token': token } : {};
}

export async function fetchPage(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw invalidUrl(`URL invalide : ${url}. Attendu une adresse complete commencant par https://`);
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw invalidUrl(`Protocole non supporte : ${parsed.protocol}. Seuls http et https sont acceptes.`);
  }

  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    // Redirections suivies a la main : fetch renverrait l'en-tete secret au domaine cible.
    let current = parsed;
    let res;
    for (let hop = 0; ; hop += 1) {
      res = await fetch(current.href, {
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          'user-agent': USER_AGENT,
          accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'accept-language': 'fr-FR,fr;q=0.9,en;q=0.8',
          ...auditHeaders(current.hostname),
        },
      });
      const location = res.headers.get('location');
      if (res.status < 300 || res.status >= 400 || !location) break;
      if (hop >= MAX_REDIRECTS) throw new Error(`plus de ${MAX_REDIRECTS} redirections`);
      await res.body?.cancel();
      current = new URL(location, current);
    }
    const html = await res.text();
    return {
      requestedUrl: parsed.href,
      finalUrl: current.href,
      status: res.status,
      redirected: current.href !== parsed.href,
      contentType: res.headers.get('content-type'),
      xRobotsTag: res.headers.get('x-robots-tag'),
      elapsedMs: Date.now() - started,
      bytes: Buffer.byteLength(html, 'utf8'),
      html,
    };
  } catch (err) {
    if (err.name === 'AbortError') throw new Error(`Delai depasse (${TIMEOUT_MS / 1000}s) sur ${parsed.href}`);
    throw new Error(`Echec du telechargement de ${parsed.href} : ${err.message}`);
  } finally {
    clearTimeout(timer);
  }
}
