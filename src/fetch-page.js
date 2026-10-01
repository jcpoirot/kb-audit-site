/**
 * Recuperation du HTML brut d'une page (HTML servi, pas de rendu JS).
 */

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const TIMEOUT_MS = 20000;

/** Erreur imputable a la saisie de l'utilisateur, pas au site distant. */
function invalidUrl(message) {
  const err = new Error(message);
  err.code = 'INVALID_URL';
  return err;
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
    const res = await fetch(parsed.href, {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'user-agent': USER_AGENT,
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'accept-language': 'fr-FR,fr;q=0.9,en;q=0.8',
      },
    });
    const html = await res.text();
    return {
      requestedUrl: parsed.href,
      finalUrl: res.url || parsed.href,
      status: res.status,
      redirected: res.redirected,
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
