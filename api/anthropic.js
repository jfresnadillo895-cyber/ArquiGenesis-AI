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
// tiempoLimiteMs/reintentos son opcionales -- default = las constantes de siempre. Se usan
// acotados (ver mas abajo, hallazgo del 12/08) para consumir/liberar_reserva: esas dos corren
// DESPUES de ya tener la respuesta de la IA lista, con poco presupuesto de tiempo restante
// antes del maxDuration de Vercel -- ahi vale mas fallar rapido (y liberar/perder el credito
// vía el catch existente) que perder la respuesta entera reintentando contra una Supabase lenta.
async function pedirASupabase(ruta, opciones, tiempoLimiteMs, reintentos) {
  const limite = (typeof tiempoLimiteMs === 'number') ? tiempoLimiteMs : TIEMPO_LIMITE_MS;
  const intentosMax = (typeof reintentos === 'number') ? reintentos : REINTENTOS;
  const base = String(process.env.SUPABASE_URL || '').replace(/\/+$/, '');
  let ultimoError = null;

  for (let intento = 0; intento <= intentosMax; intento++) {
    const aborto = new AbortController();
    const reloj = setTimeout(() => aborto.abort(), limite);
    try {
      const r = await fetch(base + ruta, { ...opciones, signal: aborto.signal });
      clearTimeout(reloj);

      // 540 = proyecto pausado por inactividad. 5xx = tropiezo. Ambos se reintentan.
      if (r.status >= 500) {
        ultimoError = new Error('supabase respondio ' + r.status);
        if (intento < intentosMax) { await dormir(ESPERA_MS * (intento + 1)); continue; }
        throw ultimoError;
      }
      let datos = null;
      try { datos = await r.json(); } catch (e) { datos = null; }
      return { ok: r.ok, estado: r.status, datos };
    } catch (e) {
      clearTimeout(reloj);
      ultimoError = e;
      if (intento < intentosMax) { await dormir(ESPERA_MS * (intento + 1)); continue; }
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
async function rpc(nombre, cuerpo, secreta, tiempoLimiteMs, reintentos) {
  const r = await pedirASupabase('/rest/v1/rpc/' + nombre, {
    method: 'POST',
    headers: {
      apikey: secreta,
      Authorization: 'Bearer ' + secreta,
      'content-type': 'application/json',
    },
    body: JSON.stringify(cuerpo),
  }, tiempoLimiteMs, reintentos);
  if (!r.ok) throw new Error('rpc ' + nombre + ' devolvio ' + r.estado);
  return Array.isArray(r.datos) ? r.datos[0] : r.datos;
}

// --- Liberar la reserva, con log si ni siquiera eso se pudo -------------------
// Se usa en todos los caminos de fallo despues de reservar. Best-effort: si esto
// tambien falla, ya no hay mas red de seguridad que gritar en los logs -- pero no
// se le devuelve un error distinto al usuario por eso, ya tiene bastante con que
// la operacion no le salio.
// Presupuesto de tiempo acotado (hallazgo del 12/08, ver comentario en pedirASupabase): esto
// corre DESPUES de la respuesta de Anthropic, con poco tiempo restante antes del maxDuration.
// Un solo intento de 4s en vez del default (hasta 3 intentos de 6s = ~19s) -- si falla, ya
// quedo el RESERVA_NO_LIBERADA en los logs para revisar a mano, pero no se juega el resto del
// presupuesto de tiempo de la funcion en reintentar.
async function liberarSeguro(usuario, modulo, estimado, secreta, res, _tlog) {
  try {
    const lib = await rpc('liberar_reserva', { p_perfil: usuario, p_estimado: estimado || 0 }, secreta, 4000, 0);
    if (_tlog) _tlog('liberar_reserva_listo');
    if (lib && typeof lib.saldo === 'number') {
      res.setHeader('x-comprender-saldo', String(lib.saldo));
    }
  } catch (e) {
    if (_tlog) _tlog('liberar_reserva_fallo');
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

  /* Instrumentacion de tiempos (12/08): Javier reporto timeouts de 60s en Vercel Hobby que
     persistian incluso reduciendo mucho el tamano del pedido a la IA (de una llamada gigante a
     tres chicas), y ademas sin patron claro de que el cuello de botella fuera el volumen de
     tokens de salida. Sin ver DONDE se va el tiempo dentro de los 60s, seguir adivinando que
     recortar no tiene sentido. Estos console.log quedan aunque la funcion termine matada por
     timeout -- Vercel captura la salida a medida que se genera, no solo al final -- asi que el
     ultimo log visto antes de un timeout dice hasta donde llego. */
  const _t0 = Date.now();
  const _tlog = (fase) => { try { console.log(JSON.stringify({ evento: 'tiempo', fase, modulo, ms: Date.now() - _t0 })); } catch (e) {} };

  // --- 1 y 2 · Identidad y reserva ---
  let usuario, permiso;
  try {
    usuario = await identificar(token, secreta);
    _tlog('identificar_listo');
    if (!usuario) {
      return res.status(401).json({ error: { message: 'Sesion vencida o invalida. Volve a iniciar sesion.', codigo: 'sesion_invalida' } });
    }
    permiso = await rpc('reservar', { p_perfil: usuario, p_modulo: modulo }, secreta);
    _tlog('reservar_listo');
  } catch (e) {
    _tlog('identidad_o_reserva_fallo');
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
      cuenta_cancelada:   [403, 'Tu cuenta esta cancelada y no tiene un plan activo. Suscribite de nuevo para seguir generando.'],
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
    await liberarSeguro(usuario, modulo, estimado, secreta, res, _tlog);
    return res.status(400).json({ error: { message: 'Cuerpo invalido: se esperaba { model, max_tokens, messages }.' } });
  }
  if (MODELOS_PERMITIDOS && MODELOS_PERMITIDOS.indexOf(body.model) === -1) {
    await liberarSeguro(usuario, modulo, estimado, secreta, res, _tlog);
    return res.status(400).json({ error: { message: 'Modelo no permitido.' } });
  }
  if (typeof body.max_tokens === 'number' && body.max_tokens > MAX_TOKENS_TOPE) {
    body.max_tokens = MAX_TOKENS_TOPE;
  }

  // --- 3 · Anthropic ---
  _tlog('arrancando_llamada_anthropic');
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
    _tlog('anthropic_respondio_headers');
    data = await r.json();
    _tlog('anthropic_body_leido');
  } catch (e) {
    _tlog('anthropic_fallo');
    // No se pudo ni contactar a Anthropic: la reserva se libera entera, no se
    // intento nada que haya costado algo.
    await liberarSeguro(usuario, modulo, estimado, secreta, res, _tlog);
    return res.status(502).json({
      error: { message: 'No se pudo contactar al proveedor de IA.', detalle: String((e && e.message) || e) },
    });
  }

  // --- 4 · Liquidar la reserva: cobrar lo real, o devolver todo si no hay resultado ---
  // Presupuesto de tiempo acotado en consumir() (hallazgo del 12/08): un intento real contra
  // Vercel Hobby mostro los logs "identificar_listo" a los 496ms, "reservar_listo" a los 867ms,
  // "anthropic_body_leido" a los 15212ms -- TODO el trabajo real (auth + reserva + la llamada a
  // la IA) resuelto en 15 segundos, sobre un presupuesto de 60 -- y despues, silencio total
  // hasta que Vercel mato la funcion a los 60s. La unica llamada sin instrumentar entre
  // "anthropic_body_leido" y el final era exactamente esta: rpc('consumir', ...), con el
  // default de hasta 3 intentos de 6s (~19s) si Supabase responde lento o falla. La respuesta
  // de la IA ya estaba lista y el usuario se quedaba sin ella igual, por una llamada de
  // CONTABILIDAD que no tiene nada que ver con generarla. Un solo intento de 4s (en vez de
  // hasta 19s) para no jugarse el resto del presupuesto de la funcion en esto -- si falla,
  // el catch de abajo ya libera la reserva (tambien acotado) y el usuario igual recibe su
  // analisis completo.
  if (r.ok && data && data.usage) {
    const u = data.usage;
    try {
      _tlog('arrancando_consumir');
      const cobro = await rpc('consumir', {
        p_perfil:          usuario,
        p_modulo:          modulo,
        p_entrada:         u.input_tokens || 0,
        p_salida:          u.output_tokens || 0,
        p_cache_lectura:   u.cache_read_input_tokens || 0,
        p_cache_escritura: u.cache_creation_input_tokens || 0,
        p_estimado:        estimado,
      }, secreta, 4000, 0);
      _tlog('consumir_listo');

      if (cobro) {
        res.setHeader('x-comprender-saldo', String(cobro.saldo));
        res.setHeader('x-comprender-cobrado', String(cobro.creditos));
        res.setHeader('Access-Control-Expose-Headers',
          'x-comprender-plan, x-comprender-saldo, x-comprender-factor, x-comprender-estimado, x-comprender-cobrado');
      }
    } catch (e) {
      _tlog('consumir_fallo');
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
      await liberarSeguro(usuario, modulo, estimado, secreta, res, _tlog);
    }
  } else {
    // Sin resultado utilizable (fallo del modelo, respuesta sin usage, etc.):
    // se devuelve integra la reserva. Una operacion fallida no consume creditos.
    await liberarSeguro(usuario, modulo, estimado, secreta, res, _tlog);
  }

  _tlog('respondiendo_al_cliente');
  return res.status(r.status).json(data);
}
