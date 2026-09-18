import { bi } from '../lib/i18n-server.js';

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
//
// 124-BLOQ-URB-ABORT-02 (18/09) -- RECLAMO ATOMICO DE OPERACION, antes de reservar/llamar a la IA
//
// QUE PROBLEMA CIERRA (confirmado con trafico real en 124-BLOQ-URB-ABORT-01_INFORME.md, 15/09):
//   URB-ROBUST 03/124-BLOQ-URB-ABORT-02 (client-side, 26/08 y 15/09) ya le ensenaron al cliente a
//   preguntarle al servidor antes de reintentar una fase larga de Urbanismo (items/nucleo/
//   receptivos_espiral) -- pero el servidor nunca tuvo de donde sacar una respuesta "todavia se
//   esta procesando": `urb_resultados_pendientes` solo se escribia DESPUES de que Anthropic ya
//   habia respondido bien, asi que una consulta hecha mientras la llamada seguia en curso (el caso
//   normal: Anthropic real tarda 15+ segundos, ver el log citado mas abajo en consumir()) siempre
//   daba 404 -- "no hay nada" -- y el cliente terminaba dsiparando un segundo POST real, pago,
//   para la misma unidad de trabajo. `consumir()` tampoco tenia ninguna nocion de "ya cobre por
//   esto": dos POST para la misma firma/fase se cobraban dos veces, de forma independiente.
//
// QUE CAMBIA: antes de reservar credito o llamar a Anthropic, un POST de una fase larga de
//   Urbanismo (mismas 3: items/nucleo/receptivos_espiral, mismos headers opcionales
//   x-comprender-urb-firma/x-comprender-urb-fase que ya existian) intenta reclamar, de forma
//   atomica en la base (RPC `urb_reclamar_operacion`, ver la migracion adjunta a este corte), la
//   fila (perfil, firma, fase) en `urb_resultados_pendientes`. Dos resultados posibles:
//     - GANA el reclamo (fila nueva, o una vencida/fallida que se reabre): sigue exactamente el
//       mismo camino de siempre (reservar -> Anthropic -> consumir/liberar), y al final dejä la
//       fila en 'completed' o 'failed_terminal' (finalizarOperacionUrbanismo(), mas abajo).
//     - PIERDE el reclamo (otra ejecucion ya tiene esta clave, vigente o completada): responde de
//       inmediato, SIN tocar creditos ni llamar a Anthropic -- 202 si la otra sigue procesando
//       (el cliente ya sabe esperar y volver a consultar, ver consultarRecuperacionConEspera() en
//       urbanismo.html), 200 con el mismo resultado si ya esta 'completed' (transparente para el
//       cliente: llega con la misma forma {content,usage} que una respuesta fresca), 409 si el
//       payload que manda este POST no coincide con el de la clave ya reclamada (nunca se ejecuta
//       silenciosamente algo distinto bajo la misma clave).
//   Esto es lo que hace que la idempotencia deje de depender del cliente: aunque el navegador
//   dispare 2, 3 o mas POST fisicos para la misma unidad (reintento silencioso de Chromium, doble
//   click, "Retomar analisis", o el propio reintento automatico), como maximo UNO va a ganar el
//   reclamo y llegar a llamar a Anthropic/cobrar -- los demas se resuelven leyendo el estado ya
//   reclamado, gratis.
//   Ningun otro modulo (Core/Negocios/Contextos) ni las llamadas standalone de Urbanismo (detalle/
//   inercia/haiku/recomendacion_urgente) pasan estos headers -- para todos esos, cero llamadas
//   nuevas a Supabase, cero cambio de comportamiento respecto de antes de este corte.

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';

const MODELOS_PERMITIDOS = null;   // null = sin restriccion. Ej.: ['claude-sonnet-4-6']
const MAX_TOKENS_TOPE = 4000;      // tope duro aunque el cliente pida mas

const TIEMPO_LIMITE_MS = 6000;     // por intento contra Supabase
const REINTENTOS = 2;              // la mayoria de los tropiezos duran segundos
const ESPERA_MS = 400;

// 124-BLOQ-URB-ABORT-02 (18/09): unica lista de fases largas de Urbanismo, compartida entre el
// reclamo (POST), la finalizacion y la recuperacion (GET) -- antes habia dos copias del mismo
// array (FASES_VALIDAS en manejarRecuperacionUrbanismo, FASES_LARGAS_URB inline en el handler de
// POST) que podian divergir con el tiempo. Nombres reales, tal como los manda urbanismo.html
// (ver llamarFaseConRecuperacion()/regenerarProyectivo() ahi).
const FASES_LARGAS_URB = ['items', 'nucleo', 'receptivos_espiral'];
// TTL de un reclamo 'processing': generoso frente al maxDuration real de esta funcion (60s,
// vercel.json) -- si una ejecucion ganadora se cae sin llegar a finalizar (crash, funcion matada),
// el reclamo queda huerfano como maximo este tiempo antes de que un reclamo nuevo pueda reabrirlo.
const CLAIM_TTL_PROCESANDO_SEG = 120;
// TTL de un reclamo ya 'completed': mucho mas largo -- un resultado completado es válido y
// reutilizable indefinidamente en la práctica (brief, punto 5: "duplicado despues de completar:
// devuelve el mismo resultado"); este TTL no es una fecha de caducidad del resultado en sí, es
// sólo la ventana despues de la cual, en el caso extremo de que el propio cliente nunca haya
// podido aceptar un resultado igual utilizable (ver informe, límite documentado sobre parseo),
// un reclamo puede reabrirse en vez de quedar bloqueado para siempre.
const CLAIM_TTL_COMPLETADO_SEG = 24 * 60 * 60;

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

// --- URB-ROBUST 03 (26/08), reescrito por 124-BLOQ-URB-ABORT-02 (18/09): GET = consultar el
// estado de una fase larga de Urbanismo en el servidor -- Vive en ESTE mismo archivo (una rama por
// método, dentro del mismo handler) y no en un archivo aparte a propósito: Vercel Hobby tiene un
// límite duro de 12 Serverless Functions por deployment, y api/ ya tenía exactamente 12 archivos
// antes de URB-ROBUST 03 -- un archivo nuevo rompía el deploy con el error de límite de Vercel.
// Comparte identificar() con el resto de este archivo, no se duplica esa lógica en un segundo
// lugar.
//
// QUE HACE: GET ?firma=<firma>&fase=<items|nucleo|receptivos_espiral>. Lee (nunca reclama ni
// muta -- eso ahora es responsabilidad exclusiva de reclamarOperacionUrbanismo(), del lado POST)
// la fila de (usuario de la sesión, firma, fase) en `urb_resultados_pendientes` y responde según
// su 'estado':
//   - sin fila, o 'failed_terminal', o 'processing' ya vencido (huérfano): 404 -- "no hay nada
//     que recuperar todavía"; el cliente cae al mismo camino de siempre (puede terminar en un
//     POST nuevo, que si corresponde va a poder reclamar de verdad vía la RPC).
//   - 'processing' vigente: 202 -- la operación original sigue en curso en el servidor, vale la
//     pena esperar (ver consultarRecuperacionConEspera() en urbanismo.html).
//   - 'completed': 200 con { content, usage } -- el mismo shape que ya consumen
//     parsearJSONIA()/registrarUso() del lado cliente. A diferencia de antes de este corte, esto
//     ya NO es de un solo uso (antes un PATCH con `entregado=eq.false` en el WHERE hacía que sólo
//     el primer GET tuviera éxito y cualquier GET posterior para la misma clave, aunque el
//     resultado siguiera vigente, diera 404) -- el brief pide explícitamente que "un duplicado
//     después de completar devuelva el mismo resultado persistido", así que ahora es una simple
//     lectura, repetible tantas veces como haga falta mientras la fila no venza (ver
//     CLAIM_TTL_COMPLETADO_SEG).
//
// AISLAMIENTO: el WHERE siempre incluye perfil=<usuario de ESTA sesión, vía identificar(token)>
// -- nunca se puede reclamar la fila de otro usuario. La firma ya trae adentro el
// organismo/ciudad/insumos (ver firmaCheckpointUrbanismo() en urbanismo.html).
function filtroPgExacto(valor) {
  // PostgREST interpreta una coma o un paréntesis sin escapar dentro del VALOR de un filtro como
  // sintaxis propia -- 'firma' se arma en el cliente con texto libre del usuario (ciudad, pasivo,
  // info local), así que puede legítimamente contener cualquiera de esos caracteres. Encerrarlo
  // entre comillas dobles (con las internas escapadas) le dice a PostgREST "tratalo como
  // literal", evitando falsos negativos o errores 400 con una firma en los hechos correcta.
  return 'eq."' + String(valor).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
}
async function manejarRecuperacionUrbanismo(req, res, token, urlBase, secreta) {
  let perfil;
  try {
    perfil = await identificar(token, secreta);
  } catch (e) {
    console.error(JSON.stringify({ evento: 'base_inalcanzable', detalle: String((e && e.message) || e) }));
    return res.status(503).json({
      error: { message: bi(req, 'El servicio no esta disponible en este momento. Volve a intentar en unos minutos.', 'The service is unavailable right now. Try again in a few minutes.'), codigo: 'servicio_no_disponible' },
    });
  }
  if (!perfil) {
    return res.status(401).json({ error: { message: bi(req, 'Sesion vencida o invalida. Volve a iniciar sesion.', 'Your session has expired or is invalid. Sign in again.'), codigo: 'sesion_invalida' } });
  }

  const firma = String((req.query && req.query.firma) || '').trim();
  const fase = String((req.query && req.query.fase) || '').trim();
  if (!firma || FASES_LARGAS_URB.indexOf(fase) === -1) {
    return res.status(400).json({ error: { message: bi(req, 'Falta firma o fase invalida.', 'Missing signature or invalid phase.') } });
  }

  try {
    const ruta = '/rest/v1/urb_resultados_pendientes' +
      '?perfil=eq.' + encodeURIComponent(perfil) +
      '&firma=' + encodeURIComponent(filtroPgExacto(firma)) +
      '&fase=eq.' + encodeURIComponent(fase) +
      '&select=estado,resultado,usage,expira';
    const r = await fetch(urlBase + ruta, {
      method: 'GET',
      headers: { apikey: secreta, Authorization: 'Bearer ' + secreta },
    });
    if (!r.ok) throw new Error('consulta devolvio ' + r.status);
    const filas = await r.json();
    const fila = Array.isArray(filas) ? filas[0] : null;
    const sinNada = () => res.status(404).json({ error: { message: bi(req, 'No hay nada para recuperar.', 'There is nothing to recover.'), codigo: 'no_encontrado' } });

    if (!fila) return sinNada();
    if (fila.estado === 'completed') {
      return res.status(200).json({
        content: (fila.resultado && fila.resultado.content) || [],
        usage: fila.usage || null,
      });
    }
    if (fila.estado === 'processing') {
      // Vencido y huérfano (la ejecución que lo reclamó nunca llegó a finalizarlo, p.ej. la
      // función serverless murió a mitad de camino): tratarlo igual que "no hay nada" -- un POST
      // nuevo va a poder reclamarlo de verdad vía la RPC (ver CLAIM_TTL_PROCESANDO_SEG).
      if (fila.expira && new Date(fila.expira) < new Date()) return sinNada();
      return res.status(202).json({ estado: 'processing' });
    }
    // 'failed_terminal' u otro valor inesperado: nada recuperable -- un POST nuevo puede reclamar
    // de verdad (ver la condición de reapertura en la RPC urb_reclamar_operacion).
    return sinNada();
  } catch (e) {
    console.error(JSON.stringify({
      evento: 'URB_RESULTADO_FALLO_RECLAMO',
      perfil: String(perfil).slice(0, 8),
      fase,
      detalle: String((e && e.message) || e),
    }));
    return res.status(503).json({ error: { message: bi(req, 'No se pudo recuperar. Volve a intentar.', 'Could not recover the result. Try again.'), codigo: 'servicio_no_disponible' } });
  }
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
// --- 124-BLOQ-URB-ABORT-02 (18/09): reclamo atómico, ANTES de reservar/llamar a Anthropic -------
// Sólo hace algo cuando el cliente manda los headers opcionales x-comprender-urb-firma /
// x-comprender-urb-fase (sólo los mandan las tres fases largas de Urbanismo -- ver
// FASES_LARGAS_URB arriba). Para Core, Negocios, Contextos, y para las llamadas standalone de
// Urbanismo, esta función nunca se llama -- cero llamadas nuevas a Supabase, cero cambio de
// comportamiento respecto de antes de este corte.
//
// A diferencia de reservar()/consumir()/liberar_reserva() (que NO se tocan: siguen siendo las
// mismas funciones de siempre, con la misma firma, invocadas exactamente igual una vez que se
// gana el reclamo), esto es una función NUEVA (urb_reclamar_operacion, ver la migración SQL
// adjunta a este corte) -- hace un INSERT ... ON CONFLICT (perfil,firma,fase) DO UPDATE ... WHERE
// <reclamable> RETURNING * de un solo statement, atómico por fila vía el índice único existente:
// si dos POST llegan a la vez para la misma clave, Postgres serializa el acceso a esa fila -- sólo
// uno puede ganar el INSERT/UPDATE, el otro simplemente no encuentra nada que actualizar y lee el
// estado que el ganador dejó. 'reclamable' es: la fila no existe todavía, o existe pero está
// 'failed_terminal' (falla comprobada: se permite reabrir), o está vencida (processing huérfano
// por CLAIM_TTL_PROCESANDO_SEG, o completed vencido por CLAIM_TTL_COMPLETADO_SEG -- ver el
// comentario junto a esa constante). No hay reintentos de red acá (tiempoLimiteMs/reintentos
// acotados, 4000/0) -- el mismo criterio de presupuesto de tiempo que ya usan liberarSeguro()/
// consumir(): si Supabase no responde rápido, mejor fallar rápido (ver el catch en el handler
// principal, que trata esto igual que cualquier otra falla de identidad/reserva) que jugarse el
// resto del maxDuration de 60s reintentando.
async function reclamarOperacionUrbanismo(usuario, firma, fase, payloadHash, secreta) {
  return rpc('urb_reclamar_operacion', {
    p_perfil: usuario,
    p_firma: firma,
    p_fase: fase,
    p_payload_hash: payloadHash || null,
    p_ttl_seg: CLAIM_TTL_PROCESANDO_SEG,
  }, secreta, 4000, 0);
  // -> { ganado, estado, resultado, usage, conflicto }
}

// --- 124-BLOQ-URB-ABORT-02 (18/09): cerrar el reclamo ganado -- 'completed' o 'failed_terminal' -
// Reemplaza a guardarResultadoPendienteUrbanismo() (URB-ROBUST 03, 26/08): antes esa función hacía
// un upsert DESPUÉS de que Anthropic ya había respondido bien -- la fila no existía mientras la
// llamada estaba en curso, que es exactamente el hueco que este corte cierra (ver el comentario
// grande al principio del archivo). Ahora la fila YA EXISTE desde reclamarOperacionUrbanismo()
// (creada en 'processing' antes de llamar a Anthropic), así que esto es un UPDATE condicionado
// (`estado=eq.processing` en el WHERE) -- mismo patrón PATCH-con-condición-en-el-WHERE que ya usa
// el resto de este archivo (ver reservar()/liberar_reserva() del lado RPC, y el GET de más arriba
// del lado REST). Best-effort y no bloqueante para el usuario, igual que antes: si esto falla
// (Supabase lento/caído), NO se le niega la respuesta al usuario -- en el peor caso se pierde la
// chance futura de recuperar/deduplicar ESTA fila puntual (el reclamo queda 'processing' hasta que
// venza por TTL), que es el mismo riesgo residual que ya existía en URB-ROBUST 03, no uno nuevo.
async function finalizarOperacionUrbanismo(usuario, firma, fase, estado, data, secreta) {
  try {
    const cuerpo = { estado: estado };
    if (estado === 'completed') {
      cuerpo.resultado = data;
      cuerpo.usage = (data && data.usage) || null;
      cuerpo.expira = new Date(Date.now() + CLAIM_TTL_COMPLETADO_SEG * 1000).toISOString();
    }
    const ruta = '/rest/v1/urb_resultados_pendientes' +
      '?perfil=eq.' + encodeURIComponent(usuario) +
      '&firma=' + encodeURIComponent(filtroPgExacto(firma)) +
      '&fase=eq.' + encodeURIComponent(fase) +
      '&estado=eq.processing';
    const r = await pedirASupabase(ruta, {
      method: 'PATCH',
      headers: {
        apikey: secreta,
        Authorization: 'Bearer ' + secreta,
        'content-type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify(cuerpo),
    }, 3000, 0);
    if (!r.ok) {
      console.error(JSON.stringify({ evento: 'URB_OPERACION_NO_FINALIZADA', usuario: String(usuario).slice(0, 8), fase, estado, http: r.estado }));
    }
  } catch (e) {
    console.error(JSON.stringify({
      evento: 'URB_OPERACION_NO_FINALIZADA',
      usuario: String(usuario).slice(0, 8),
      fase, estado,
      detalle: String((e && e.message) || e),
    }));
  }
}

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
  if (req.method !== 'POST' && req.method !== 'GET') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: { message: bi(req, 'Metodo no permitido. Usa POST o GET.', 'Method not allowed. Use POST or GET.') } });
  }

  const secreta = process.env.SUPABASE_SECRET_KEY;
  const urlBase = process.env.SUPABASE_URL;
  if (!secreta || !urlBase) {
    return res.status(500).json({ error: { message: bi(req, 'Falta SUPABASE_URL o SUPABASE_SECRET_KEY. El proxy no atiende sin base.', 'Server configuration is incomplete.') } });
  }

  // --- Token (comun a GET y POST) ---
  const cabecera = String(req.headers['authorization'] || '');
  const token = cabecera.toLowerCase().startsWith('bearer ') ? cabecera.slice(7).trim() : '';
  if (!token) {
    return res.status(401).json({ error: { message: bi(req, 'Falta la sesion. Inicia sesion para continuar.', 'Missing session. Sign in to continue.'), codigo: 'sin_sesion' } });
  }

  // URB-ROBUST 03 (26/08): GET recupera una fase larga de Urbanismo -- ver
  // manejarRecuperacionUrbanismo() mas arriba para el detalle completo y por que vive en esta
  // misma funcion en vez de un archivo aparte.
  if (req.method === 'GET') {
    return manejarRecuperacionUrbanismo(req, res, token, urlBase, secreta);
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: { message: bi(req, 'Falta ANTHROPIC_API_KEY en el servidor.', 'Server configuration is incomplete.') } });

  const modulo = String(req.headers['x-comprender-modulo'] || 'core').trim().toLowerCase() || 'core';

  // 124-BLOQ-URB-ABORT-02 (18/09): mismos headers opcionales que URB-ROBUST 03 -- sólo los mandan
  // las tres fases largas de Urbanismo (ver llamarAnthropicUrbanismo() en urbanismo.html).
  // payloadHashUrb es nuevo: un hash corto, no criptográfico, del prompt real que arma el cliente
  // (urbHashPayload() ahí mismo) -- se usa EXCLUSIVAMENTE para detectar, de forma defensiva, que
  // la misma clave (perfil,firma,fase) nunca ejecute en silencio un contenido distinto del que
  // reclamó primero (brief, punto 4: "la misma clave con un payload diferente debe rechazarse").
  const firmaUrb = String(req.headers['x-comprender-urb-firma'] || '').trim();
  const faseUrb = String(req.headers['x-comprender-urb-fase'] || '').trim();
  const payloadHashUrb = String(req.headers['x-comprender-urb-payload-hash'] || '').trim();
  const esFaseLargaUrb = modulo === 'urbanismo' && !!firmaUrb && FASES_LARGAS_URB.indexOf(faseUrb) > -1;

  /* Instrumentacion de tiempos (12/08): Javier reporto timeouts de 60s en Vercel Hobby que
     persistian incluso reduciendo mucho el tamano del pedido a la IA (de una llamada gigante a
     tres chicas), y ademas sin patron claro de que el cuello de botella fuera el volumen de
     tokens de salida. Sin ver DONDE se va el tiempo dentro de los 60s, seguir adivinando que
     recortar no tiene sentido. Estos console.log quedan aunque la funcion termine matada por
     timeout -- Vercel captura la salida a medida que se genera, no solo al final -- asi que el
     ultimo log visto antes de un timeout dice hasta donde llego. */
  const _t0 = Date.now();
  const _tlog = (fase) => { try { console.log(JSON.stringify({ evento: 'tiempo', fase, modulo, ms: Date.now() - _t0 })); } catch (e) {} };

  // --- 1 · Identidad ---
  let usuario;
  try {
    usuario = await identificar(token, secreta);
    _tlog('identificar_listo');
    if (!usuario) {
      return res.status(401).json({ error: { message: bi(req, 'Sesion vencida o invalida. Volve a iniciar sesion.', 'Your session has expired or is invalid. Sign in again.'), codigo: 'sesion_invalida' } });
    }
  } catch (e) {
    _tlog('identidad_fallo');
    // FALLA CERRADO. 503, no 401: el problema es el servicio, no el usuario.
    console.error(JSON.stringify({ evento: 'base_inalcanzable', detalle: String((e && e.message) || e) }));
    return res.status(503).json({
      error: {
        message: bi(req, 'El servicio no esta disponible en este momento. Volve a intentar en unos minutos.', 'The service is unavailable right now. Try again in a few minutes.'),
        codigo: 'servicio_no_disponible',
      },
    });
  }

  // Cierra el reclamo como fallido en cualquier salida posterior que decida NO seguir hasta
  // Anthropic (reserva denegada, cuerpo inválido, modelo no permitido) -- sin esto, esas salidas
  // dejarían la fila en 'processing' hasta que venza sola por CLAIM_TTL_PROCESANDO_SEG (120s), en
  // vez de quedar reabrible de inmediato para un reintento legítimo (p.ej. después de comprar más
  // créditos). No-op cuando esta llamada no es una fase larga de Urbanismo.
  const finalizarFalloUrb = async () => {
    if (esFaseLargaUrb) await finalizarOperacionUrbanismo(usuario, firmaUrb, faseUrb, 'failed_terminal', null, secreta);
  };

  // --- 124-BLOQ-URB-ABORT-02 (18/09): reclamo atómico, ANTES de reservar crédito ---
  // Ver el comentario grande junto a reclamarOperacionUrbanismo() más arriba para el detalle
  // completo. En una llamada que NO es una fase larga de Urbanismo (esFaseLargaUrb === false)
  // este bloque entero es un no-op -- cero llamadas nuevas a Supabase, sigue exactamente igual
  // que antes de este corte.
  if (esFaseLargaUrb) {
    let reclamo;
    try {
      reclamo = await reclamarOperacionUrbanismo(usuario, firmaUrb, faseUrb, payloadHashUrb, secreta);
      _tlog('reclamo_listo');
    } catch (e) {
      _tlog('reclamo_fallo');
      console.error(JSON.stringify({ evento: 'URB_RECLAMO_FALLO', usuario: String(usuario).slice(0, 8), fase: faseUrb, detalle: String((e && e.message) || e) }));
      return res.status(503).json({
        error: {
          message: bi(req, 'El servicio no esta disponible en este momento. Volve a intentar en unos minutos.', 'The service is unavailable right now. Try again in a few minutes.'),
          codigo: 'servicio_no_disponible',
        },
      });
    }

    if (!reclamo || !reclamo.ganado) {
      // No se ganó el reclamo: otra ejecución (u otra ya completada) tiene esta misma clave. Se
      // responde de inmediato, SIN reservar crédito ni llamar a Anthropic -- este es el punto
      // exacto que evita la segunda llamada paga que confirmó 124-BLOQ-URB-ABORT-01_INFORME.md.
      if (reclamo && reclamo.conflicto) {
        return res.status(409).json({
          error: {
            message: bi(req, 'Esta operacion ya se esta ejecutando con datos distintos. Volve a intentar en unos minutos.', 'This operation is already running with different data. Try again in a few minutes.'),
            codigo: 'operacion_en_conflicto',
          },
        });
      }
      if (reclamo && reclamo.estado === 'completed') {
        // Transparente para el cliente: misma forma {content,usage} que una respuesta fresca de
        // Anthropic -- llamarAnthropicUrbanismo() en urbanismo.html no necesita saber que esto
        // vino de una clave ya resuelta en vez de una llamada nueva.
        return res.status(200).json({
          content: (reclamo.resultado && reclamo.resultado.content) || [],
          usage: reclamo.usage || null,
        });
      }
      // 'processing' (o cualquier otro estado no ganado sin conflicto): la operación original
      // sigue en curso en el servidor. 202, nunca se llama dos veces a Anthropic para esta clave.
      return res.status(202).json({ estado: 'processing' });
    }
    _tlog('reclamo_ganado');
    // ganado === true: sigue exactamente el mismo camino de siempre, desde reservar() para abajo.
  }

  // --- 2 · Reserva ---
  let permiso;
  try {
    permiso = await rpc('reservar', { p_perfil: usuario, p_modulo: modulo }, secreta);
    _tlog('reservar_listo');
  } catch (e) {
    _tlog('reserva_fallo');
    console.error(JSON.stringify({ evento: 'base_inalcanzable', detalle: String((e && e.message) || e) }));
    await finalizarFalloUrb();
    return res.status(503).json({
      error: {
        message: bi(req, 'El servicio no esta disponible en este momento. Volve a intentar en unos minutos.', 'The service is unavailable right now. Try again in a few minutes.'),
        codigo: 'servicio_no_disponible',
      },
    });
  }

  if (!permiso || !permiso.permitido) {
    const motivo = (permiso && permiso.motivo) || 'no_autorizado';
    const mapa = {
      sin_saldo:          [402, bi(req, 'Te quedaste sin creditos.', 'You have run out of credits.')],
      requiere_plan:      [403, bi(req, 'Tu plan no incluye este modulo.', 'Your plan does not include this module.')],
      modulo_inactivo:    [403, bi(req, 'Este modulo no esta disponible.', 'This module is not available.')],
      perfil_inexistente: [401, bi(req, 'No encontramos tu cuenta. Volve a iniciar sesion.', 'We could not find your account. Sign in again.')],
      cuenta_pausada:     [403, bi(req, 'Tu cuenta esta pausada. Escribinos si crees que es un error.', 'Your account is paused. Contact us if you think this is a mistake.')],
      cuenta_cancelada:   [403, bi(req, 'Tu cuenta esta cancelada y no tiene un plan activo. Suscribite de nuevo para seguir generando.', 'Your account is canceled and has no active plan. Subscribe again to continue generating.')],
    };
    const [codigo, mensaje] = mapa[motivo] || [403, bi(req, 'No autorizado.', 'Unauthorized.')];
    await finalizarFalloUrb();
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
    await finalizarFalloUrb();
    return res.status(400).json({ error: { message: bi(req, 'Cuerpo invalido: se esperaba { model, max_tokens, messages }.', 'Invalid request body: expected { model, max_tokens, messages }.') } });
  }
  if (MODELOS_PERMITIDOS && MODELOS_PERMITIDOS.indexOf(body.model) === -1) {
    await liberarSeguro(usuario, modulo, estimado, secreta, res, _tlog);
    await finalizarFalloUrb();
    return res.status(400).json({ error: { message: bi(req, 'Modelo no permitido.', 'Model not allowed.') } });
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
    // intento nada que haya costado algo. Idem el reclamo, si lo había -- queda 'failed_terminal',
    // reabrible de inmediato por un reintento real (nunca se llegó a gastar nada en éste).
    await liberarSeguro(usuario, modulo, estimado, secreta, res, _tlog);
    await finalizarFalloUrb();
    return res.status(502).json({
      error: { message: bi(req, 'No se pudo contactar al proveedor de IA.', 'Could not contact the AI provider.'), detalle: String((e && e.message) || e) },
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

    // 124-BLOQ-URB-ABORT-02 (18/09): reemplaza a guardarResultadoPendienteUrbanismo() (URB-ROBUST
    // 03, 26/08) -- si esta es una fase larga de Urbanismo, la fila YA existe en 'processing'
    // (se creó al ganar el reclamo, más arriba) -- esto la cierra como 'completed'. Se hace ANTES
    // del intento de cobro y a propósito no depende de si consumir() sale bien: el resultado de
    // Anthropic ya es válido y utilizable en este punto -- si el cobro real falla más abajo (catch
    // de consumir()), el usuario igual recibe este mismo resultado (ver el comentario de ese catch,
    // sin cambios de este corte) y una recuperación posterior debe poder servir ese mismo contenido
    // sin volver a golpear a Anthropic, no descartarlo como si nada se hubiera generado.
    if (esFaseLargaUrb) {
      await finalizarOperacionUrbanismo(usuario, firmaUrb, faseUrb, 'completed', data, secreta);
      _tlog('urb_operacion_completada');
    }

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
      // entera (best-effort) a dejar el credito retenido sin motivo. El reclamo (si lo había) ya
      // quedó 'completed' arriba, a propósito -- un fallo de COBRO no es un fallo de GENERACIÓN,
      // así que no corresponde finalizarFalloUrb() acá (eso descartaría un resultado bueno).
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
    // se devuelve integra la reserva. Una operacion fallida no consume creditos. Si había un
    // reclamo, se cierra como 'failed_terminal' -- reabrible de inmediato por un reintento real
    // (ver la condición de reapertura en la RPC urb_reclamar_operacion).
    await liberarSeguro(usuario, modulo, estimado, secreta, res, _tlog);
    await finalizarFalloUrb();
  }

  _tlog('respondiendo_al_cliente');
  return res.status(r.status).json(data);
}
