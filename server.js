/**
 * Serveur local de la boite a outils SEO.
 * Sert l'interface (public/) et expose l'API d'analyse.
 *
 *   npm start            -> http://localhost:4173
 *   PORT=5000 npm start
 *
 * API :
 *   GET  /api/tools               liste des outils disponibles
 *   GET  /api/analyze?url=...     analyse une URL (pratique en ligne de commande)
 *   POST /api/analyze  {url}      idem
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

import { analyzeUrl, TOOLS } from './src/analyze.js';

const ROOT = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(ROOT, 'public');
const PORT = Number(process.env.PORT ?? 4173);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  });
  res.end(body);
}

async function serveStatic(res, pathname) {
  const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  // normalize + prefixe : empeche toute remontee hors de public/
  const target = join(PUBLIC_DIR, normalize(relative));
  if (!target.startsWith(PUBLIC_DIR)) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  try {
    const content = await readFile(target);
    res.writeHead(200, {
      'content-type': MIME[extname(target).toLowerCase()] ?? 'application/octet-stream',
      'cache-control': 'no-store',
    });
    res.end(content);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('Not found');
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > 1_000_000) {
        reject(new Error('Corps de requete trop volumineux'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (url.pathname === '/api/tools') {
    sendJson(res, 200, {
      tools: TOOLS.map(({ key, label, description, weight }) => ({ key, label, description, weight })),
    });
    return;
  }

  if (url.pathname === '/api/analyze') {
    let target = url.searchParams.get('url');
    if (req.method === 'POST') {
      try {
        target = JSON.parse(await readBody(req)).url;
      } catch (err) {
        sendJson(res, 400, { error: `Requete illisible : ${err.message}` });
        return;
      }
    }
    if (!target) {
      sendJson(res, 400, { error: 'Parametre "url" manquant.' });
      return;
    }
    try {
      const report = await analyzeUrl(target);
      sendJson(res, 200, report);
    } catch (err) {
      sendJson(res, err.code === 'INVALID_URL' ? 400 : 502, { error: err.message });
    }
    return;
  }

  if (url.pathname.startsWith('/api/')) {
    sendJson(res, 404, { error: 'Endpoint inconnu.' });
    return;
  }

  await serveStatic(res, url.pathname);
});

server.listen(PORT, () => {
  process.stdout.write(`Boite a outils SEO : http://localhost:${PORT}\n`);
});
