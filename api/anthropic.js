// api/anthropic.js — Proxy de producción de la suite Comprender (Vercel Serverless Function)
// ---------------------------------------------------------------------------------------------
// El cliente (Comprender AI, Urbanismo, Contextos) pega a  /api/anthropic  y esta función agrega
// la clave del lado del SERVIDOR y reenvía a Anthropic. La clave NUNCA viaja al navegador.
// Cierra el residual servidor de H03 y unifica el proxy de los tres productos (Opción A).
//
// PUESTA EN MARCHA (una sola vez):
//   1. Este archivo va en la carpeta  api/  del proyecto de Vercel (ruta final: /api/anthropic).
//   2. En Vercel → Settings → Environment Variables, definí DOS variables:
//        ANTHROPIC_API_KEY = sk-ant-...      (tu clave de Anthropic)
//        CLAVE_ACCESO      = la-que-elijas   (candado provisorio de acceso, ver abajo)
//      No pongas ninguna de las dos en el código ni las subas al repositorio.
//   3. Deploy. Los tres HTML detectan solos que están en un dominio real y salen por el proxy.
//
// CANDADO PROVISORIO (CLAVE_ACCESO)
//   Mientras no exista backend con login y créditos, este endpoint es la única puerta hacia tu
//   clave de Anthropic. Sin candado, cualquiera con la URL te consume saldo. El candado es una
//   contraseña compartida: el navegador la manda en el header 'x-comprender-acceso' y acá se
//   compara. Es provisorio y deliberadamente simple — NO es un sistema de usuarios.
//   Falla cerrado a propósito: si CLAVE_ACCESO no está definida, el proxy no atiende a nadie.
//
// TODO créditos: cuando exista el backend, reemplazar el candado por verificación real de
//   sesión y créditos (leer token, consultar la base, devolver 402 si no alcanzan).

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';

// --- Guardas (reducen abuso y protegen el costo) ---
// Lista blanca de modelos. null = sin restricción. Ej.: ['claude-sonnet-4-6']
const MODELOS_PERMITIDOS = null;
// Tope duro de max_tokens (protege el costo aunque el cliente pida más).
const MAX_TOKENS_TOPE = 4000;

// Comparación de strings en tiempo constante (evita filtrar la clave por diferencias de tiempo).
function comparaSegura(a, b) {
  const x = String(a == null ? '' : a);
  const y = String(b == null ? '' : b);
  if (x.length !== y.length) return false;
  let dif = 0;
  for (let i = 0; i < x.length; i++) dif |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return dif === 0;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: { message: 'Método no permitido. Usá POST.' } });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: { message: 'Falta configurar ANTHROPIC_API_KEY en el servidor.' } });
  }

  // --- Candado provisorio: falla cerrado ---
  const claveAcceso = process.env.CLAVE_ACCESO;
  if (!claveAcceso) {
    return res.status(500).json({
      error: { message: 'Falta configurar CLAVE_ACCESO en el servidor. El proxy no atiende sin candado.' },
    });
  }
  if (!comparaSegura(req.headers['x-comprender-acceso'], claveAcceso)) {
    return res.status(401).json({ error: { message: 'Clave de acceso incorrecta o ausente.' } });
  }

  // El cuerpo que mandan los productos es { model, max_tokens, messages }.
  // Vercel parsea JSON automáticamente; por las dudas, toleramos string.
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) { body = null; }
  }
  if (!body || !Array.isArray(body.messages)) {
    return res.status(400).json({ error: { message: 'Cuerpo inválido: se esperaba { model, max_tokens, messages }.' } });
  }

  // Guardas
  if (MODELOS_PERMITIDOS && MODELOS_PERMITIDOS.indexOf(body.model) === -1) {
    return res.status(400).json({ error: { message: 'Modelo no permitido.' } });
  }
  if (typeof body.max_tokens === 'number' && body.max_tokens > MAX_TOKENS_TOPE) {
    body.max_tokens = MAX_TOKENS_TOPE;
  }

  try {
    const r = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
      },
      body: JSON.stringify(body),
    });
    const data = await r.json();
    // Reenviamos el status real de Anthropic (200, 400, 429, 529...) para que el cliente lo maneje.
    return res.status(r.status).json(data);
  } catch (e) {
    return res.status(502).json({
      error: { message: 'No se pudo contactar al proveedor de IA.', detalle: String((e && e.message) || e) },
    });
  }
}
