// api/comm.js — Sistema de Acontecimientos, Comunicaciones y Notificaciones (Cortes A y B)
// ---------------------------------------------------------------------------------------------
// QUE ES ESTE ARCHIVO
//   Un unico endpoint que reemplaza a los nueve que se habian creado por separado
//   (comm-events.js, comm-decisions-reevaluate.js, comm-jobs.js, comm-jobs-cancel.js,
//   comm-jobs-hold.js, comm-jobs-resume.js, comm-inbox.js, comm-inbox-read.js,
//   comm-inbox-archive.js). Se consolido el 03/08 porque Vercel Hobby permite un maximo
//   de 12 funciones serverless por deployment y este proyecto ya estaba en 17 -- en vez
//   de pedirle a Javier que pase a un plan pago, se junta todo en un solo archivo con
//   ruteo interno por "recurso" + "accion". Ningun contrato, ninguna RPC, ninguna regla
//   de negocio cambio -- es el mismo codigo de los nueve archivos, reorganizado.
//
// COMO SE USA
//   GET  /api/comm?recurso=events&event_id=...              -> consultar un acontecimiento
//   GET  /api/comm?recurso=jobs&job_id=...                   -> estado + evidencia de un trabajo
//   GET  /api/comm?recurso=inbox                             -> listar bandeja (+ contador)
//   GET  /api/comm?recurso=inbox&incluir_archivadas=1        -> listar bandeja, con archivadas
//   GET  /api/comm?recurso=inbox&entry_id=...                -> detalle de una entrada
//
//   POST /api/comm   body siempre con { recurso, accion, ...datos }:
//     { recurso:'events', accion:'ingresar',  event_id, version, type, producer,
//                                              purpose_id, occurred_at, payload }
//     { recurso:'events', accion:'reevaluar', event_id }
//     { recurso:'jobs',   accion:'cancelar'|'retener'|'reanudar',
//                                              job_id, reason?, version_conocida? }
//     { recurso:'inbox',  accion:'leer'|'archivar', entry_id }
//
// AISLAMIENTO
//   organization_id nunca lo manda el cliente: se resuelve de la sesion (mismo patron que
//   el resto de api/*.js). Cada RPC ya valida pertenencia antes de tocar nada.
//
// VARIABLES DE ENTORNO
//   SUPABASE_URL / SUPABASE_SECRET_KEY   (ya cargadas)

const registrar = (o) => console.log(JSON.stringify({ evento: 'comm', ...o }));

async function identificar(token, url, secreta) {
  const r = await fetch(url + '/auth/v1/user', {
    headers: { apikey: secreta, Authorization: 'Bearer ' + token },
  });
  if (!r.ok) return null;
  const d = await r.json().catch(() => null);
  return d && d.id ? d.id : null;
}

async function rpc(nombre, cuerpo, url, secreta) {
  const r = await fetch(url + '/rest/v1/rpc/' + nombre, {
    method: 'POST',
    headers: { apikey: secreta, Authorization: 'Bearer ' + secreta, 'content-type': 'application/json' },
    body: JSON.stringify(cuerpo),
  });
  if (!r.ok) {
    const detalle = await r.text().catch(() => '');
    throw new Error('rpc ' + nombre + ' devolvio ' + r.status + ' ' + detalle.slice(0, 300));
  }
  const d = await r.json();
  return Array.isArray(d) ? d[0] : d;
}

async function restGet(ruta, url, secreta) {
  const r = await fetch(url + ruta, { headers: { apikey: secreta, Authorization: 'Bearer ' + secreta } });
  if (!r.ok) throw new Error('consulta devolvio ' + r.status);
  return r.json();
}

// ---------- events ----------

async function eventsGet(req, res, perfil, SB_URL, SERVICE_KEY) {
  const eventId = String(req.query.event_id || '').trim();
  if (!eventId) return res.status(400).json({ error: { message: 'Falta event_id.' } });
  try {
    const ruta = '/rest/v1/comm_events?event_id=eq.' + encodeURIComponent(eventId) +
      '&organization_id=eq.' + encodeURIComponent(perfil) +
      '&select=event_id,version,type,producer,purpose_id,occurred_at,payload,received_at';
    const lista = await restGet(ruta, SB_URL, SERVICE_KEY);
    if (!lista.length) return res.status(404).json({ error: { message: 'No encontrado.', codigo: 'no_encontrado' } });
    return res.status(200).json({ evento: lista[0] });
  } catch (e) {
    registrar({ error: 'fallo_consultar_evento', perfil: perfil.slice(0, 8), detalle: String((e && e.message) || e) });
    return res.status(503).json({ error: { message: 'No se pudo consultar. Volve a intentar.', codigo: 'servicio_no_disponible' } });
  }
}

async function eventsIngresar(cuerpo, res, perfil, SB_URL, SERVICE_KEY) {
  const eventId = cuerpo.event_id;
  if (!eventId) return res.status(400).json({ error: { message: 'Falta event_id.' } });

  const version = Number.isInteger(cuerpo.version) ? cuerpo.version : null;
  const type = cuerpo.type ? String(cuerpo.type) : null;
  const producer = cuerpo.producer ? String(cuerpo.producer) : null;
  const purposeId = cuerpo.purpose_id ? String(cuerpo.purpose_id) : null;
  const occurredAt = cuerpo.occurred_at || null;
  const payload = (cuerpo.payload && typeof cuerpo.payload === 'object') ? cuerpo.payload : {};

  try {
    const r = await rpc('comm_ingresar_evento', {
      p_event_id: eventId, p_version: version, p_type: type, p_producer: producer,
      p_organization_id: perfil, p_purpose_id: purposeId, p_occurred_at: occurredAt, p_payload: payload,
    }, SB_URL, SERVICE_KEY);

    registrar({ accion: r ? r.estado : 'sin_respuesta', perfil: perfil.slice(0, 8), event_id: eventId, motivo: r ? r.motivo : null });

    if (r && r.estado === 'cuarentena') {
      return res.status(422).json({ ok: false, estado: 'cuarentena', motivo: r.motivo, event_id: eventId });
    }
    return res.status(200).json({ ok: true, estado: r ? r.estado : null, event_id: eventId });
  } catch (e) {
    registrar({ error: 'fallo_ingresar', perfil: perfil.slice(0, 8), event_id: eventId, detalle: String((e && e.message) || e) });
    return res.status(503).json({ error: { message: 'No se pudo ingresar el evento. Volve a intentar.', codigo: 'servicio_no_disponible' } });
  }
}

async function eventsReevaluar(cuerpo, res, perfil, SB_URL, SERVICE_KEY) {
  const eventId = cuerpo && cuerpo.event_id;
  if (!eventId) return res.status(400).json({ error: { message: 'Falta event_id.' } });

  try {
    const ruta = '/rest/v1/comm_events?event_id=eq.' + encodeURIComponent(eventId) + '&select=organization_id';
    const filas = await restGet(ruta, SB_URL, SERVICE_KEY);
    if (!filas.length) return res.status(404).json({ error: { message: 'Evento no encontrado.', codigo: 'no_encontrado' } });
    if (filas[0].organization_id !== perfil) {
      registrar({ aviso: 'acceso_denegado_otra_cuenta', perfil: perfil.slice(0, 8), event_id: eventId });
      return res.status(403).json({ error: { message: 'No autorizado.', codigo: 'no_autorizado' } });
    }

    const r = await rpc('comm_evaluar_decision', { p_event_id: eventId }, SB_URL, SERVICE_KEY);
    registrar({ accion: 'reevaluado', perfil: perfil.slice(0, 8), event_id: eventId, resultado: r ? r.resultado : null, job_id: r ? r.job_id : null });

    return res.status(200).json({
      ok: true,
      decision_id: r ? r.decision_id : null,
      resultado: r ? r.resultado : null,
      job_id: r ? r.job_id : null,
    });
  } catch (e) {
    registrar({ error: 'fallo_reevaluar', perfil: perfil.slice(0, 8), event_id: eventId, detalle: String((e && e.message) || e) });
    return res.status(503).json({ error: { message: 'No se pudo reevaluar. Volve a intentar.', codigo: 'servicio_no_disponible' } });
  }
}

// ---------- jobs ----------

async function jobsGet(req, res, perfil, SB_URL, SERVICE_KEY) {
  const jobId = String(req.query.job_id || '').trim();
  if (!jobId) return res.status(400).json({ error: { message: 'Falta job_id.' } });
  try {
    const rutaJob = '/rest/v1/comm_jobs?id=eq.' + encodeURIComponent(jobId) +
      '&organization_id=eq.' + encodeURIComponent(perfil) +
      '&select=id,decision_id,event_id,state,not_before,expires_at,version,creado,actualizado';
    const jobs = await restGet(rutaJob, SB_URL, SERVICE_KEY);
    if (!jobs.length) return res.status(404).json({ error: { message: 'No encontrado.', codigo: 'no_encontrado' } });

    const rutaTrans = '/rest/v1/comm_job_transitions?job_id=eq.' + encodeURIComponent(jobId) +
      '&select=from_state,to_state,accepted,reason,actor,creado&order=creado.asc';
    let transiciones = [];
    try { transiciones = await restGet(rutaTrans, SB_URL, SERVICE_KEY); } catch (e) { transiciones = []; }

    return res.status(200).json({ trabajo: jobs[0], transiciones });
  } catch (e) {
    registrar({ error: 'fallo_consultar_job', perfil: perfil.slice(0, 8), job_id: jobId, detalle: String((e && e.message) || e) });
    return res.status(503).json({ error: { message: 'No se pudo consultar. Volve a intentar.', codigo: 'servicio_no_disponible' } });
  }
}

const ACCION_A_ESTADO = { cancelar: 'CANCELLED', retener: 'HELD', reanudar: 'READY' };
const MOTIVO_POR_DEFECTO = { cancelar: 'cancelado_por_usuario', retener: 'retenido_por_usuario', reanudar: 'reanudado_por_usuario' };

async function jobsTransicionar(accion, cuerpo, res, perfil, SB_URL, SERVICE_KEY) {
  const hacia = ACCION_A_ESTADO[accion];
  if (!hacia) return res.status(400).json({ error: { message: 'Accion invalida para jobs.' } });

  const jobId = cuerpo && cuerpo.job_id;
  if (!jobId) return res.status(400).json({ error: { message: 'Falta job_id.' } });
  const reason = (cuerpo.reason != null) ? String(cuerpo.reason) : MOTIVO_POR_DEFECTO[accion];
  const versionConocida = Number.isInteger(cuerpo.version_conocida) ? cuerpo.version_conocida : null;

  try {
    const r = await rpc('comm_transicionar_job', {
      p_job_id: jobId, p_organization_id: perfil, p_hacia: hacia,
      p_reason: reason, p_actor: 'user:' + perfil, p_version_conocida: versionConocida,
    }, SB_URL, SERVICE_KEY);

    registrar({ accion: r && r.ok ? accion : 'rechazado', perfil: perfil.slice(0, 8), job_id: jobId, motivo: r ? r.motivo : null });

    if (!r || !r.ok) {
      const codigo = (r && r.motivo) || 'no_autorizado';
      const status = codigo === 'no_encontrado_o_no_autorizado' ? 403 : 409;
      return res.status(status).json({ ok: false, codigo, estado: r ? r.estado : null });
    }
    return res.status(200).json({ ok: true, estado: r.estado, version: r.version });
  } catch (e) {
    registrar({ error: 'fallo_transicionar', perfil: perfil.slice(0, 8), job_id: jobId, accion, detalle: String((e && e.message) || e) });
    return res.status(503).json({ error: { message: 'No se pudo completar la accion. Volve a intentar.', codigo: 'servicio_no_disponible' } });
  }
}

// ---------- inbox ----------

async function inboxGet(req, res, perfil, SB_URL, SERVICE_KEY) {
  const entryId = String(req.query.entry_id || '').trim();

  if (entryId) {
    try {
      const r = await rpc('comm_leer_entrada_bandeja', { p_entry_id: entryId, p_organization_id: perfil }, SB_URL, SERVICE_KEY);
      if (!r || !r.encontrada) return res.status(404).json({ error: { message: 'No encontrada.', codigo: 'no_encontrado' } });
      return res.status(200).json({
        id: entryId, vencida: r.vencida, titulo: r.titulo, resumen: r.resumen,
        accion_requerida: r.accion_requerida, leida_en: r.leida_en, archivada_en: r.archivada_en, creado: r.creado,
      });
    } catch (e) {
      registrar({ error: 'fallo_leer_entrada', perfil: perfil.slice(0, 8), entry_id: entryId, detalle: String((e && e.message) || e) });
      return res.status(503).json({ error: { message: 'No se pudo consultar. Volve a intentar.', codigo: 'servicio_no_disponible' } });
    }
  }

  const incluirArchivadas = String(req.query.incluir_archivadas || '') === '1';
  try {
    let ruta = '/rest/v1/comm_inbox_entries?organization_id=eq.' + encodeURIComponent(perfil) +
      '&select=id,titulo,resumen,accion_requerida,leida_en,archivada_en,vence_en,creado&order=creado.desc';
    if (!incluirArchivadas) ruta += '&archivada_en=is.null';

    const lista = await restGet(ruta, SB_URL, SERVICE_KEY);
    const ahora = Date.now();
    const entradas = lista.map((e) => {
      const vencida = e.vence_en ? new Date(e.vence_en).getTime() < ahora : false;
      return {
        id: e.id, titulo: vencida ? null : e.titulo, resumen: vencida ? null : e.resumen, vencida,
        accion_requerida: e.accion_requerida, leida_en: e.leida_en, archivada_en: e.archivada_en, creado: e.creado,
      };
    });
    const noLeidas = entradas.filter((e) => !e.leida_en && !e.archivada_en).length;
    return res.status(200).json({ entradas, no_leidas: noLeidas });
  } catch (e) {
    registrar({ error: 'fallo_listar_inbox', perfil: perfil.slice(0, 8), detalle: String((e && e.message) || e) });
    return res.status(503).json({ error: { message: 'No se pudo listar. Volve a intentar.', codigo: 'servicio_no_disponible' } });
  }
}

async function inboxAccion(accion, cuerpo, res, perfil, SB_URL, SERVICE_KEY) {
  const entryId = cuerpo && cuerpo.entry_id;
  if (!entryId) return res.status(400).json({ error: { message: 'Falta entry_id.' } });

  const nombreRpc = accion === 'leer' ? 'comm_marcar_leida' : accion === 'archivar' ? 'comm_archivar_entrada' : null;
  if (!nombreRpc) return res.status(400).json({ error: { message: 'Accion invalida para inbox.' } });

  try {
    const r = await rpc(nombreRpc, { p_entry_id: entryId, p_organization_id: perfil }, SB_URL, SERVICE_KEY);
    registrar({ accion: r && r.ok ? accion : 'rechazado', perfil: perfil.slice(0, 8), entry_id: entryId });

    if (!r || !r.ok) return res.status(404).json({ ok: false, codigo: 'no_encontrado' });

    if (accion === 'leer') return res.status(200).json({ ok: true, ya_estaba_leida: r.ya_estaba_leida, leida_en: r.leida_en });
    return res.status(200).json({ ok: true, ya_estaba_archivada: r.ya_estaba_archivada, archivada_en: r.archivada_en });
  } catch (e) {
    registrar({ error: 'fallo_inbox_accion', perfil: perfil.slice(0, 8), entry_id: entryId, accion, detalle: String((e && e.message) || e) });
    return res.status(503).json({ error: { message: 'No se pudo completar la accion. Volve a intentar.', codigo: 'servicio_no_disponible' } });
  }
}

// ---------- preferences ----------

async function preferencesGet(req, res, perfil, SB_URL, SERVICE_KEY) {
  const purposeId = String(req.query.purpose_id || '').trim();
  const canal = String(req.query.canal || '').trim();
  if (!purposeId || !canal) return res.status(400).json({ error: { message: 'Faltan purpose_id o canal.' } });

  try {
    const r = await rpc('comm_obtener_preferencia', { p_organization_id: perfil, p_purpose_id: purposeId, p_canal: canal }, SB_URL, SERVICE_KEY);
    return res.status(200).json({
      existe: r ? r.existe : false,
      suscrito: r ? r.suscrito : true,
      frecuencia_maxima_dia: r ? r.frecuencia_maxima_dia : null,
      horario_silencio_desde: r ? r.horario_silencio_desde : null,
      horario_silencio_hasta: r ? r.horario_silencio_hasta : null,
      zona_horaria: r ? r.zona_horaria : null,
    });
  } catch (e) {
    registrar({ error: 'fallo_obtener_preferencia', perfil: perfil.slice(0, 8), detalle: String((e && e.message) || e) });
    return res.status(503).json({ error: { message: 'No se pudo consultar. Volve a intentar.', codigo: 'servicio_no_disponible' } });
  }
}

async function preferencesFijar(cuerpo, res, perfil, SB_URL, SERVICE_KEY) {
  const purposeId = cuerpo.purpose_id ? String(cuerpo.purpose_id) : null;
  const canal = cuerpo.canal ? String(cuerpo.canal) : null;
  if (!purposeId || !canal) return res.status(400).json({ error: { message: 'Faltan purpose_id o canal.' } });
  const suscrito = cuerpo.suscrito !== false;
  const frecuencia = Number.isInteger(cuerpo.frecuencia_maxima_dia) ? cuerpo.frecuencia_maxima_dia : null;
  const horarioDesde = cuerpo.horario_silencio_desde || null;
  const horarioHasta = cuerpo.horario_silencio_hasta || null;
  const zonaHoraria = cuerpo.zona_horaria ? String(cuerpo.zona_horaria) : 'America/Argentina/Buenos_Aires';

  try {
    const r = await rpc('comm_fijar_preferencia', {
      p_organization_id: perfil, p_purpose_id: purposeId, p_canal: canal, p_suscrito: suscrito,
      p_frecuencia_maxima_dia: frecuencia, p_horario_silencio_desde: horarioDesde,
      p_horario_silencio_hasta: horarioHasta, p_zona_horaria: zonaHoraria,
    }, SB_URL, SERVICE_KEY);
    registrar({ accion: 'preferencia_fijada', perfil: perfil.slice(0, 8), purpose_id: purposeId, canal });
    return res.status(200).json({ ok: true, id: r ? r.id : null, actualizado_en: r ? r.actualizado_en : null });
  } catch (e) {
    registrar({ error: 'fallo_fijar_preferencia', perfil: perfil.slice(0, 8), detalle: String((e && e.message) || e) });
    return res.status(503).json({ error: { message: 'No se pudo guardar. Volve a intentar.', codigo: 'servicio_no_disponible' } });
  }
}

// ---------- consent ----------

async function consentGet(req, res, perfil, SB_URL, SERVICE_KEY) {
  const purposeId = String(req.query.purpose_id || '').trim();
  const canal = String(req.query.canal || '').trim();
  if (!purposeId || !canal) return res.status(400).json({ error: { message: 'Faltan purpose_id o canal.' } });
  try {
    const vigente = await rpc('comm_consentimiento_vigente', { p_organization_id: perfil, p_purpose_id: purposeId, p_canal: canal }, SB_URL, SERVICE_KEY);
    return res.status(200).json({ vigente: !!vigente });
  } catch (e) {
    registrar({ error: 'fallo_consultar_consentimiento', perfil: perfil.slice(0, 8), detalle: String((e && e.message) || e) });
    return res.status(503).json({ error: { message: 'No se pudo consultar. Volve a intentar.', codigo: 'servicio_no_disponible' } });
  }
}

async function consentAccion(accion, cuerpo, res, perfil, SB_URL, SERVICE_KEY) {
  const purposeId = cuerpo.purpose_id ? String(cuerpo.purpose_id) : null;
  const canal = cuerpo.canal ? String(cuerpo.canal) : null;
  if (!purposeId || !canal) return res.status(400).json({ error: { message: 'Faltan purpose_id o canal.' } });

  const nombreRpc = accion === 'otorgar' ? 'comm_otorgar_consentimiento' : accion === 'revocar' ? 'comm_revocar_consentimiento' : null;
  if (!nombreRpc) return res.status(400).json({ error: { message: 'Accion invalida para consent.' } });

  try {
    const r = await rpc(nombreRpc, { p_organization_id: perfil, p_purpose_id: purposeId, p_canal: canal, p_actor: 'user:' + perfil }, SB_URL, SERVICE_KEY);
    registrar({ accion: 'consentimiento_' + accion, perfil: perfil.slice(0, 8), purpose_id: purposeId, canal });
    return res.status(200).json({ ok: true, otorgado_en: r ? r.otorgado_en : undefined, revocado_en: r ? r.revocado_en : undefined });
  } catch (e) {
    registrar({ error: 'fallo_consent_accion', perfil: perfil.slice(0, 8), accion, detalle: String((e && e.message) || e) });
    return res.status(503).json({ error: { message: 'No se pudo completar la accion. Volve a intentar.', codigo: 'servicio_no_disponible' } });
  }
}

// ---------- handler ----------

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: { message: 'Metodo no permitido.' } });
  }

  const SB_URL = process.env.SUPABASE_URL;
  const SERVICE_KEY = process.env.SUPABASE_SECRET_KEY;
  if (!SB_URL || !SERVICE_KEY) {
    return res.status(500).json({ error: { message: 'Falta SUPABASE_URL o SUPABASE_SECRET_KEY.' } });
  }

  const cabecera = String(req.headers['authorization'] || '');
  const token = cabecera.toLowerCase().startsWith('bearer ') ? cabecera.slice(7).trim() : '';
  if (!token) return res.status(401).json({ error: { message: 'Inicia sesion para continuar.', codigo: 'sin_sesion' } });

  let perfil;
  try {
    perfil = await identificar(token, SB_URL, SERVICE_KEY);
  } catch (e) {
    registrar({ error: 'base_inalcanzable', detalle: String((e && e.message) || e) });
    return res.status(503).json({ error: { message: 'El servicio no esta disponible. Volve a intentar.', codigo: 'servicio_no_disponible' } });
  }
  if (!perfil) return res.status(401).json({ error: { message: 'Sesion vencida. Volve a iniciar sesion.', codigo: 'sesion_invalida' } });

  if (req.method === 'GET') {
    const recurso = String(req.query.recurso || '');
    if (recurso === 'events') return eventsGet(req, res, perfil, SB_URL, SERVICE_KEY);
    if (recurso === 'jobs') return jobsGet(req, res, perfil, SB_URL, SERVICE_KEY);
    if (recurso === 'inbox') return inboxGet(req, res, perfil, SB_URL, SERVICE_KEY);
    if (recurso === 'preferences') return preferencesGet(req, res, perfil, SB_URL, SERVICE_KEY);
    if (recurso === 'consent') return consentGet(req, res, perfil, SB_URL, SERVICE_KEY);
    return res.status(400).json({ error: { message: 'Falta o es invalido el parametro recurso (events|jobs|inbox|preferences|consent).' } });
  }

  // POST
  let cuerpo = req.body;
  if (typeof cuerpo === 'string') { try { cuerpo = JSON.parse(cuerpo); } catch (e) { cuerpo = null; } }
  if (!cuerpo || typeof cuerpo !== 'object') return res.status(400).json({ error: { message: 'Cuerpo invalido.' } });

  const recurso = String(cuerpo.recurso || '');
  const accion = String(cuerpo.accion || '');

  if (recurso === 'events' && accion === 'ingresar') return eventsIngresar(cuerpo, res, perfil, SB_URL, SERVICE_KEY);
  if (recurso === 'events' && accion === 'reevaluar') return eventsReevaluar(cuerpo, res, perfil, SB_URL, SERVICE_KEY);
  if (recurso === 'jobs' && ['cancelar', 'retener', 'reanudar'].indexOf(accion) > -1) return jobsTransicionar(accion, cuerpo, res, perfil, SB_URL, SERVICE_KEY);
  if (recurso === 'inbox' && ['leer', 'archivar'].indexOf(accion) > -1) return inboxAccion(accion, cuerpo, res, perfil, SB_URL, SERVICE_KEY);
  if (recurso === 'preferences' && accion === 'fijar') return preferencesFijar(cuerpo, res, perfil, SB_URL, SERVICE_KEY);
  if (recurso === 'consent' && ['otorgar', 'revocar'].indexOf(accion) > -1) return consentAccion(accion, cuerpo, res, perfil, SB_URL, SERVICE_KEY);

  return res.status(400).json({ error: { message: 'Combinacion de recurso/accion invalida.' } });
}
