// api/anthropic.js — Proxy de producción de la suite Comprender (Vercel Serverless Function)
// ---------------------------------------------------------------------------------------------
// El cliente (Comprender AI, Urbanismo, Contextos) pega a  /api/anthropic  y esta función agrega
// la clave del lado del SERVIDOR y reenvía a Anthropic. La clave NUNCA viaja al navegador.
//
// v2 · CLAVES INDIVIDUALES POR CLIENTE  (Camino A)
// ---------------------------------------------------------------------------------------------
// Antes había UNA clave compartida: no se sabía quién consumía, no se podía revocar a uno solo,
// y el plan vivía en el navegador del usuario (cualquiera se ponía Estudio desde la consola).
// Ahora cada cliente tiene su propia clave y su plan vive en el SERVIDOR.
//
// PUESTA EN MARCHA
//   En Vercel → Settings → Environment Variables:
//
//     ANTHROPIC_API_KEY = sk-ant-...
//
//     CLAVES_ACCESO = juana-mx:estudio,carlos-co:profesional,udelar-uy:estudio,demo:gratis
//
//   Formato: pares  clave:plan  separados por coma. Planes válidos: gratis, profesional, estudio.
//   Si se omite el plan, se asume 'profesional'.  Ej.:  "unaclave,otra:estudio"
//
//   COMPATIBILIDAD: si CLAVES_ACCESO no está definida pero sí CLAVE_ACCESO (la vieja, singular),
//   se sigue aceptando esa única clave con plan 'estudio'. Así el despliegue no se corta al
//   actualizar. Cuando cargues CLAVES_ACCESO, borrá la vieja.
//
// QUÉ RESUELVE Y QUÉ NO
//   ✔ Vender y revocar de a uno, sin tocar el código.
//   ✔ El plan deja de ser honor system: lo decide el servidor y lo informa al cliente.
//   ✔ Se sabe qué cliente hizo cada llamada (queda en los logs de Vercel).
//   ✘ NO cuenta créditos: una función serverless no guarda estado entre llamadas.
//     El tope real de consumo necesita base de datos. Esto controla QUIÉN entra y CON QUÉ PLAN,
//     no CUÁNTO consume.
//
// TODO backend: reemplazar por sesión real + saldo en base de datos.

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';

// --- Guardas (reducen abuso y protegen el costo) ---
const MODELOS_PERMITIDOS = null;          // null = sin restricción. Ej.: ['claude-sonnet-4-6']
const MAX_TOKENS_TOPE = 4000;             // tope duro aunque el cliente pida más

// Qué plan mínimo exige cada módulo especializado. Espejo de ACCESO_MODULOS en los HTML.
const PLAN_MINIMO_MODULO = {
  urbanismo: 'estudio',
  contextos: 'estudio',
  tecnologias: 'estudio',
  sustentabilidad: 'estudio',
  negocios: 'estudio',
  capacidades: 'estudio',
  trayectoria: 'estudio',
};
const ORDEN_PLANES = ['gratis', 'profesional', 'estudio'];

// Comparación en tiempo constante (evita filtrar la clave por diferencias de tiempo).
function comparaSegura(a, b) {
  const x = String(a == null ? '' : a);
  const y = String(b == null ? '' : b);
  if (x.length !== y.length) return false;
  let dif = 0;
  for (let i = 0; i < x.length; i++) dif |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return dif === 0;
}

// Lee la tabla de claves de las variables de entorno. Devuelve [] si no hay nada configurado.
function leerClaves() {
  const crudo = process.env.CLAVES_ACCESO;
  if (crudo && String(crudo).trim()) {
    return String(crudo)
      .split(',')
      .map((par) => {
        const t = par.trim();
        if (!t) return null;
        const i = t.indexOf(':');
        const clave = (i === -1 ? t : t.slice(0, i)).trim();
        let plan = (i === -1 ? 'profesional' : t.slice(i + 1)).trim().toLowerCase();
        if (ORDEN_PLANES.indexOf(plan) === -1) plan = 'profesional';
        return clave ? { clave, plan } : null;
      })
      .filter(Boolean);
  }
  // Compatibilidad con la clave única anterior.
  const vieja = process.env.CLAVE_ACCESO;
  if (vieja && String(vieja).trim()) return [{ clave: String(vieja).trim(), plan: 'estudio' }];
  return [];
}

// Busca la clave recorriendo SIEMPRE la lista completa: el tiempo de respuesta no revela
// en qué posición estaba ni cuántas claves hay.
function buscarCliente(recibida, claves) {
  let hallado = null;
  for (let i = 0; i < claves.length; i++) {
    if (comparaSegura(recibida, claves[i].clave) && !hallado) hallado = claves[i];
  }
  return hallado;
}

function planAlcanza(planCliente, planMinimo) {
  return ORDEN_PLANES.indexOf(planCliente) >= ORDEN_PLANES.indexOf(planMinimo);
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

  // --- Candado: falla cerrado ---
  const claves = leerClaves();
  if (!claves.length) {
    return res.status(500).json({
      error: { message: 'Falta configurar CLAVES_ACCESO en el servidor. El proxy no atiende sin candado.' },
    });
  }

  const cliente = buscarCliente(req.headers['x-comprender-acceso'], claves);
  if (!cliente) {
    return res.status(401).json({ error: { message: 'Clave de acceso incorrecta o ausente.' } });
  }

  // --- Control de acceso por plan ---
  // El cliente declara desde qué módulo llama. Es informativo: un usuario decidido podría
  // falsear el header. Sirve para que el plan tenga efecto real sin base de datos, no como
  // barrera criptográfica.
  const modulo = String(req.headers['x-comprender-modulo'] || '').trim().toLowerCase();
  if (modulo && PLAN_MINIMO_MODULO[modulo]) {
    if (!planAlcanza(cliente.plan, PLAN_MINIMO_MODULO[modulo])) {
      return res.status(403).json({
        error: {
          message: 'Tu plan no incluye este módulo.',
          modulo,
          plan_actual: cliente.plan,
          plan_requerido: PLAN_MINIMO_MODULO[modulo],
        },
      });
    }
  }

  // El cliente aprende su plan desde el servidor, no desde su propio navegador.
  res.setHeader('x-comprender-plan', cliente.plan);
  res.setHeader('Access-Control-Expose-Headers', 'x-comprender-plan');

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) { body = null; }
  }
  if (!body || !Array.isArray(body.messages)) {
    return res.status(400).json({ error: { message: 'Cuerpo inválido: se esperaba { model, max_tokens, messages }.' } });
  }

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

    // Queda en los logs de Vercel quién consumió y cuánto. Nunca se registra la clave.
    try {
      const u = (data && data.usage) || {};
      console.log(JSON.stringify({
        evento: 'consumo',
        cliente: cliente.clave.slice(0, 3) + '***',
        plan: cliente.plan,
        modulo: modulo || 'core',
        entrada: u.input_tokens || 0,
        salida: u.output_tokens || 0,
        estado: r.status,
      }));
    } catch (e) { /* el registro nunca debe romper la respuesta */ }

    return res.status(r.status).json(data);
  } catch (e) {
    return res.status(502).json({
      error: { message: 'No se pudo contactar al proveedor de IA.', detalle: String((e && e.message) || e) },
    });
  }
}
