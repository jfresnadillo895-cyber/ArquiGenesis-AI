// lib/i18n-server.js — idioma de interacción para APIs/serverless de Comprender AI
// El locale pertenece al usuario/interacción; no toca organismo, ontología, contratos ni DB.

export const LOCALES = ['es', 'en', 'pt'];

export function normalizarLocale(valor) {
  const v = String(valor || '').trim().toLowerCase();
  if (v === 'en' || v.startsWith('en-')) return 'en';
  /* PTBR-01 · acepta 'pt', 'pt-br', 'pt-pt', etc. -- siempre normaliza a 'pt' (pt-BR es la
     unica variante que la app realmente ofrece; no se distingue pt-PT como locale separado). */
  if (v === 'pt' || v.startsWith('pt-')) return 'pt';
  return 'es';
}

export function localeDe(req) {
  if (!req) return 'es';
  // Prioridad: header explícito del runtime I18N → query → body (formularios externos) → ES.
  const h = req.headers && (req.headers['x-comprender-locale'] || req.headers['X-Comprender-Locale']);
  if (h) return normalizarLocale(h);
  const q = req.query && (req.query.lang || req.query.locale);
  if (q) return normalizarLocale(q);
  let b = req.body;
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch (e) { b = null; } }
  if (b && (b.locale || b.lang)) return normalizarLocale(b.locale || b.lang);
  return 'es';
}

export function biLocale(locale, es, en, pt) {
  const l = normalizarLocale(locale);
  if (l === 'pt') return pt !== undefined ? pt : en;
  return l === 'en' ? en : es;
}

export function bi(req, es, en, pt) {
  return biLocale(localeDe(req), es, en, pt);
}

export function localeTag(locale) {
  const l = normalizarLocale(locale);
  if (l === 'en') return 'en-US';
  if (l === 'pt') return 'pt-BR';
  return 'es-AR';
}

export function fechaLocal(fecha, locale, opciones) {
  const d = fecha instanceof Date ? fecha : new Date(fecha);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(localeTag(locale), opciones || { day:'numeric', month:'long', year:'numeric' });
}

export function htmlFirma(locale) {
  const l = normalizarLocale(locale);
  if (l === 'en') return '<p style="color:#888;font-size:12px">Comprender AI<br>A product of ARQUIGÉNESIS</p>';
  if (l === 'pt') return '<p style="color:#888;font-size:12px">Comprender AI<br>Um produto de ARQUIGÉNESIS</p>';
  return '<p style="color:#888;font-size:12px">Comprender AI<br>Producto de ARQUIGÉNESIS</p>';
}
