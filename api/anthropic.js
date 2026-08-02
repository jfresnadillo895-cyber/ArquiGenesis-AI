// api/anthropic.js — Proxy de produccion de la suite Comprender (Vercel Serverless Function)
// ---------------------------------------------------------------------------------------------
// v4 · RESERVA ATOMICA DE CREDITOS (01/08)
//
// QUE CAMBIO RESPECTO DE v3
//   ✔ puede() -> reservar(): ya no solo verifica saldo, lo APARTA en el mismo paso, con un
//     UPDATE atomico (`saldo >= estimado`). Antes, entre verificar y cobrar (que pasaba
//     recien despues de la respuesta de Anthropic) habia una ventana: dos pedidos
//     simultaneos de la misma cuenta podian pasar los dos el mismo chequeo de saldo,
//     ejecutar los dos contra Anthropic (costo real dos veces) y recien ahi competir por
//     cobrar. Con reservar(), el segundo pedido que ya no alcanza no reserva nada.
//   ✔ Todo camino de salida despues de reservar libera o liquida la reserva: si Anthropic
//     responde bien, se cobra el costo real (consumir); si falla la red, si Anthropic
//     responde mal, o si no hay `usage` utilizable, se devuelve integra (liberar_reserva).
//     Antes, un fallo de red a Anthropic dejaba el saldo intacto porque nunca se habia
//     tocado -- ahora que se reserva antes de llamar, ese camino tiene que liberar tambien.
//
// ORDEN DE LA LLAMADA
//   1. Validar el token contra Supabase  →  obtener el id del usuario.
//   2. reservar(id, modulo)              →  plan, saldo (ya con el estimado descontado),
//                                            factor, estimado, permitido.
//   3. Recien entonces llamar a Anthropic.
//   4a. Si hay resultado utilizable: consumir(id, modulo, tokens, estimado) ajusta lo
//       reservado contra el costo real -- se devuelve el estimado, se cobra lo real.
//   4b. Si no (fallo de red, respuesta no-ok, sin `usage`): liberar_reserva(id, estimado)
//       devuelve integro lo apartado. Una operacion fallida no consume creditos, ahora
//       tambien en la practica y no solo en la intencion.
//
// VARIABLES DE ENTORNO EN VERCEL
//   ANTHROPIC_API_KEY    sk-ant-...
//   SUPABASE_URL         https://spavobqrigvbjabwyvbl.supabase.co     (sin barra final)
//   SUPABASE_SECRET_KEY  sb_secret_...   ← va de Supabase a Vercel, nunca por chat
//
// FALLA CERRADO
//   Si Supabase no responde, nadie entra. Se devuelve 503 —no 401— para que el
//   cliente diga "el servicio esta con problemas, reintenta" y no "tu acceso fue
//   revocado". Un cliente que paga no tiene que creer que lo echaste.
//   Causa mas probable de caida, con el volumen actual: el plan gratuito de
//   Supabase pausa los proyectos con poca actividad en una ventana de 7 dias.
//   Un proyecto pausado responde 540 a todo. Se evita con api/latido.js (cron diario).

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';

const MODELOS_PERMITIDOS = null;   // null = sin restriccion. Ej.: ['claude-sonnet-4-6']
const MAX_TOKENS_TOPE = 4000;      // tope duro aunque el cliente pida mas

const TIEMPO_LIMITE_MS = 6000;     // por intento contra Supabase
const REINTENTOS = 2;              // la mayoria de los tropiezos duran segundos
const ESPERA_MS = 400;

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

// --- Llamada a Supabase con reintentos y tiempo limite -------------------------
// Devuelve { ok, estado, datos }  o  lanza si se agotaron los reintentos.
async function pedirASupabase(ruta, opciones) {
  const base = String(process.env.SUPABASE_URL || '').replace(/\/+$/, '');
  let ultimoError = null;

  for (let intento = 0; intento <= REINTENTOS; intento++) {
    const aborto = new AbortController();
    const reloj = setTimeout(() => aborto.abort(), TIEMPO_LIMITE_MS);
    try {
      const r = await fetch(base + ruta, { ...opciones, signal: aborto.signal });
      clearTimeout(reloj);

      // 540 = proyecto pausado por inactividad. 5xx = tropiezo. Ambos se reintentan.
      if (r.status >= 500) {
        ultimoError = new Error('supabase respondio ' + r.status);
        if (intento < REINTENTOS) { await dormir(ESPERA_MS * (intento + 1)); continue; }
        throw ultimoError;
      }
      let datos = null;
      try { datos = await r.json(); } catch (e) { datos = null; }
      return { ok: r.ok, estado: r.status, datos };
    } catch (e) {
      clearTimeout(reloj);
      ultimoError = e;
      if (intento < REINTENTOS) { await dormir(ESPERA_MS * (intento + 1)); continue; }
      throw ultimoError;
    }
  }
  throw ultimoError || new Error('supabase inalcanzable');
}

// --- 1 · Quien es -------------------------------------------------------------
// Se valida contra Supabase en vez de verificar la firma localmente. Cuesta un
// salto de red mas, pero respeta la revocacion: si cerraste la sesion de alguien,
// deja de entrar en el acto. Verificar la firma sola no se entera.
async function identificar(token, secreta) {
  const r = await pedirASupabase('/auth/v1/user', {
    method: 'GET',
    headers: { apikey: secreta, Authorization: 'Bearer ' + token },
  });
  if (!r.ok || !r.datos || !r.datos.id) return null;
  return r.datos.id;
}

// --- Llamada a una funcion de la base ----------------------------------------
async function rpc(nombre, cuerpo, secreta) {
  const r = await pedirASupabase('/rest/v1/rpc/' + nombre, {
    method: 'POST',
    headers: {
      apikey: secreta,
      Authorization: 'Bearer ' + secreta,
      'content-type': 'application/json',
    },
    body: JSON.stringify(cuerpo),
  });
  if (!r.ok) throw new Error('rpc ' + nombre + ' devolvio ' + r.estado);
  return Array.isArray(r.datos) ? r.datos[0] : r.datos;
}

// --- Liberar la reserva, con log si ni siquiera eso se pudo -------------------
// Se usa en todos los caminos de fallo despues de reservar. Best-effort: si esto
// tambien falla, ya no hay mas red de seguridad que gritar en los logs -- pero no
// se le devuelve un error distinto al usuario por eso, ya tiene bastante con que
// la operacion no le salio.
async function liberarSeguro(usuario, modulo, estimado, secreta, res) {
  try {
    const lib = await rpc('liberar_reserva', { p_perfil: usuario, p_estimado: estimado || 0 }, secreta);
    if (lib && typeof lib.saldo === 'number') {
      res.setHeader('x-comprender-saldo', String(lib.saldo));
    }
  } catch (e) {
    console.error(JSON.stringify({
      evento: 'RESERVA_NO_LIBERADA',
      usuario: String(usuario).slice(0, 8),
      modulo, estimado,
      detalle: String((e && e.message) || e),
    }));
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: { message: 'Metodo no permitido. Usa POST.' } });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  const secreta = process.env.SUPABASE_SECRET_KEY;
  const urlBase = process.env.SUPABASE_URL;

  if (!apiKey)  return res.status(500).json({ error: { message: 'Falta ANTHROPIC_API_KEY en el servidor.' } });
  if (!secreta || !urlBase) {
    return res.status(500).json({ error: { message: 'Falta SUPABASE_URL o SUPABASE_SECRET_KEY. El proxy no atiende sin base.' } });
  }

  // --- Token ---
  const cabecera = String(req.headers['authorization'] || '');
  const token = cabecera.toLowerCase().startsWith('bearer ') ? cabecera.slice(7).trim() : '';
  if (!token) {
    return res.status(401).json({ error: { message: 'Falta la sesion. Inicia sesion para continuar.', codigo: 'sin_sesion' } });
  }

  const modulo = String(req.headers['x-comprender-modulo'] || 'core').trim().toLowerCase() || 'core';

  // --- 1 y 2 · Identidad y reserva ---
  let usuario, permiso;
  try {
    usuario = await identificar(token, secreta);
    if (!usuario) {
      return res.status(401).json({ error: { message: 'Sesion vencida o invalida. Volve a iniciar sesion.', codigo: 'sesion_invalida' } });
    }
    permiso = await rpc('reservar', { p_perfil: usuario, p_modulo: modulo }, secreta);
  } catch (e) {
    // FALLA CERRADO. 503, no 401: el problema es el servicio, no el usuario.
    console.error(JSON.stringify({ evento: 'base_inalcanzable', detalle: String((e && e.message) || e) }));
    return res.status(503).json({
      error: {
        message: 'El servicio no esta disponible en este momento. Volve a intentar en unos minutos.',
        codigo: 'servicio_no_disponible',
      },
    });
  }

  if (!permiso || !permiso.permitido) {
    const motivo = (permiso && permiso.motivo) || 'no_autorizado';
    const mapa = {
      sin_saldo:          [402, 'Te quedaste sin creditos.'],
      requiere_plan:      [403, 'Tu plan no incluye este modulo.'],
      modulo_inactivo:    [403, 'Este modulo no esta disponible.'],
      perfil_inexistente: [401, 'No encontramos tu cuenta. Volve a iniciar sesion.'],
      cuenta_pausada:     [403, 'Tu cuenta esta pausada. Escribinos si crees que es un error.'],
    };
    const [codigo, mensaje] = mapa[motivo] || [403, 'No autorizado.'];
    return res.status(codigo).json({
      error: {
        message: mensaje,
        codigo: motivo,
        modulo,
        plan_actual: permiso ? permiso.plan : null,
        saldo: permiso ? permiso.saldo : null,
      },
    });
  }

  // Ya se reservo: este saldo viene con el estimado descontado.
  const estimado = permiso.estimado || 0;

  // El cliente aprende su estado del servidor, no de su propio navegador.
  res.setHeader('x-comprender-plan', String(permiso.plan));
  res.setHeader('x-comprender-saldo', String(permiso.saldo));
  res.setHeader('x-comprender-factor', String(permiso.factor));
  res.setHeader('x-comprender-estimado', String(estimado));
  res.setHeader('Access-Control-Expose-Headers',
    'x-comprender-plan, x-comprender-saldo, x-comprender-factor, x-comprender-estimado');

  // --- Cuerpo ---
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = null; } }
  if (!body || !Array.isArray(body.messages)) {
    await liberarSeguro(usuario, modulo, estimado, secreta, res);
    return res.status(400).json({ error: { message: 'Cuerpo invalido: se esperaba { model, max_tokens, messages }.' } });
  }
  if (MODELOS_PERMITIDOS && MODELOS_PERMITIDOS.indexOf(body.model) === -1) {
    await liberarSeguro(usuario, modulo, estimado, secreta, res);
    return res.status(400).json({ error: { message: 'Modelo no permitido.' } });
  }
  if (typeof body.max_tokens === 'number' && body.max_tokens > MAX_TOKENS_TOPE) {
    body.max_tokens = MAX_TOKENS_TOPE;
  }

  // --- 3 · Anthropic ---
  let r, data;
  try {
    r = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
      },
      body: JSON.stringify(body),
    });
    data = await r.json();
  } catch (e) {
    // No se pudo ni contactar a Anthropic: la reserva se libera entera, no se
    // intento nada que haya costado algo.
    await liberarSeguro(usuario, modulo, estimado, secreta, res);
    return res.status(502).json({
      error: { message: 'No se pudo contactar al proveedor de IA.', detalle: String((e && e.message) || e) },
    });
  }

  // --- 4 · Liquidar la reserva: cobrar lo real, o devolver todo si no hay resultado ---
  if (r.ok && data && data.usage) {
    const u = data.usage;
    try {
      const cobro = await rpc('consumir', {
        p_perfil:          usuario,
        p_modulo:          modulo,
        p_entrada:         u.input_tokens || 0,
        p_salida:          u.output_tokens || 0,
        p_cache_lectura:   u.cache_read_input_tokens || 0,
        p_cache_escritura: u.cache_creation_input_tokens || 0,
        p_estimado:        estimado,
      }, secreta);

      if (cobro) {
        res.setHeader('x-comprender-saldo', String(cobro.saldo));
        res.setHeader('x-comprender-cobrado', String(cobro.creditos));
        res.setHeader('Access-Control-Expose-Headers',
          'x-comprender-plan, x-comprender-saldo, x-comprender-factor, x-comprender-estimado, x-comprender-cobrado');
      }
    } catch (e) {
      // La respuesta ya existe y el usuario la merece: no se le niega por un
      // fallo de contabilidad. La reserva ya estaba tomada -- mejor liberarla
      // entera (best-effort) a dejar el credito retenido sin motivo.
      console.error(JSON.stringify({
        evento: 'COBRO_PERDIDO',
        usuario: String(usuario).slice(0, 8),
        modulo,
        entrada: u.input_tokens || 0,
        salida: u.output_tokens || 0,
        detalle: String((e && e.message) || e),
      }));
      await liberarSeguro(usuario, modulo, estimado, secreta, res);
    }
  } else {
    // Sin resultado utilizable (fallo del modelo, respuesta sin usage, etc.):
    // se devuelve integra la reserva. Una operacion fallida no consume creditos.
    await liberarSeguro(usuario, modulo, estimado, secreta, res);
  }

  return res.status(r.status).json(data);
}
