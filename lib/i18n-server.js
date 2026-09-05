// lib/i18n-server.js — idioma de interacción para APIs/serverless de Comprender AI
// El locale pertenece al usuario/interacción; no toca organismo, ontología, contratos ni DB.

export const LOCALES = ['es', 'en'];

export function normalizarLocale(valor) {
  const v = String(valor || '').trim().toLowerCase();
  if (v === 'en' || v.startsWith('en-')) return 'en';
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

export function biLocale(locale, es, en) {
  return normalizarLocale(locale) === 'en' ? en : es;
}

export function bi(req, es, en) {
  return biLocale(localeDe(req), es, en);
}

export function localeTag(locale) {
  return normalizarLocale(locale) === 'en' ? 'en-US' : 'es-AR';
}

export function fechaLocal(fecha, locale, opciones) {
  const d = fecha instanceof Date ? fecha : new Date(fecha);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(localeTag(locale), opciones || { day:'numeric', month:'long', year:'numeric' });
}

export function htmlFirma(locale) {
  return normalizarLocale(locale) === 'en'
    ? '<p style="color:#888;font-size:12px">Comprender AI<br>A product of ARQUIGÉNESIS</p>'
    : '<p style="color:#888;font-size:12px">Comprender AI<br>Producto de ARQUIGÉNESIS</p>';
}
