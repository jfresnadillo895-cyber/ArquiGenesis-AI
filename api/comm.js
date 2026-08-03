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
//     { recurso:'jobs',   accion:'despachar',  job_id, template_id?, template_version?,
//                                              variables?, asunto?, contenido_html? }
//     { recurso:'inbox',  accion:'leer'|'archivar', entry_id }
//
// CORTE D — despachar (correo externo controlado)
//   Envia de verdad, via Brevo, y SOLO a las direcciones de comm_closed_recipients
//   (entorno de prueba, destinatarios cerrados -- ver CORTE_D_MIGRACION.sql). El contenido
//   se arma con comm_componer_plantilla (si se manda template_id/template_version) o con
//   asunto/contenido_html sueltos para pruebas manuales. Un timeout o error de Brevo NO
//   reintenta solo: el trabajo queda en FAILED_RETRYABLE y hace falta un despachar()
//   posterior (persona o cron) para volver a intentar -- ver CORTE_D_SISTEMA_COMUNICACIONAL.md.
//
// AISLAMIENTO
//   organization_id nunca lo manda el cliente: se resuelve de la sesion (mismo patron que
//   el resto de api/*.js). Cada RPC ya valida pertenencia antes de tocar nada.
//
// VARIABLES DE ENTORNO
//   SUPABASE_URL / SUPABASE_SECRET_KEY   (ya cargadas)
//   BREVO_API_KEY                        clave de API de Brevo (Corte D)
//   BREVO_SENDER_EMAIL                   remitente verificado (default: contacto@comprenderai.com)
//   BREVO_SENDER_NAME                    nombre del remitente (default: "Comprender AI")

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

// ---------- jobs: despachar (Corte D) ----------

async function jobsDespachar(cuerpo, res, perfil, SB_URL, SERVICE_KEY) {
  const jobId = cuerpo && cuerpo.job_id;
  if (!jobId) return res.status(400).json({ error: { message: 'Falta job_id.' } });

  const canal = 'email'; // unico canal de este corte
  const templateId = cuerpo.template_id ? String(cuerpo.template_id) : null;
  const templateVersion = Number.isInteger(cuerpo.template_version) ? cuerpo.template_version : null;
  const variables = (cuerpo.variables && typeof cuerpo.variables === 'object') ? cuerpo.variables : {};
  let asunto = cuerpo.asunto ? String(cuerpo.asunto) : null;
  let contenido = cuerpo.contenido_html ? String(cuerpo.contenido_html) : null;

  const BREVO_API_KEY = process.env.BREVO_API_KEY;
  const SENDER_EMAIL = process.env.BREVO_SENDER_EMAIL || 'contacto@comprenderai.com';
  const SENDER_NAME = process.env.BREVO_SENDER_NAME || 'Comprender AI';

  try {
    // 1. si el trabajo esta recien creado, se le aplica el portero del Corte C ahora
    const prep = await rpc('comm_preparar_entrega', { p_job_id: jobId, p_organization_id: perfil, p_canal: canal }, SB_URL, SERVICE_KEY);
    if (prep && prep.estado === 'no_encontrado') return res.status(404).json({ ok: false, codigo: 'no_encontrado' });
    if (prep && prep.estado === 'retenido') {
      registrar({ accion: 'retenido_antes_de_despachar', perfil: perfil.slice(0, 8), job_id: jobId, motivo: prep.motivo });
      return res.status(200).json({ ok: true, estado: 'retenido', motivo: prep.motivo });
    }

    // 2. destinatario cerrado configurado para este canal (entorno de prueba: TODO envio
    // de este corte va a esta direccion fija, no a datos reales de ninguna cuenta)
    const ruta = '/rest/v1/comm_closed_recipients?canal=eq.' + encodeURIComponent(canal) +
      '&activo=eq.true&select=email&order=id.asc&limit=1';
    const destinatarios = await restGet(ruta, SB_URL, SERVICE_KEY);
    if (!destinatarios.length) return res.status(409).json({ ok: false, codigo: 'sin_destinatario_cerrado_configurado' });
    const destinatario = destinatarios[0].email;

    // 3. iniciar el intento -- mueve el trabajo a PROCESSING, valida destinatario cerrado
    // y circuit breaker ANTES de gastar un llamado a Brevo
    const inicio = await rpc('comm_iniciar_intento_entrega',
      { p_job_id: jobId, p_organization_id: perfil, p_canal: canal, p_destinatario: destinatario }, SB_URL, SERVICE_KEY);
    if (!inicio || !inicio.ok) {
      const codigo = (inicio && inicio.motivo) || 'no_se_pudo_iniciar';
      registrar({ accion: 'rechazado_antes_de_enviar', perfil: perfil.slice(0, 8), job_id: jobId, motivo: codigo });
      return res.status(409).json({ ok: false, codigo });
    }
    const deliveryAttemptId = inicio.delivery_attempt_id;

    // 4. componer el contenido -- deterministico (misma plantilla + mismas variables
    // siempre da el mismo resultado, ya probado en el Corte C)
    if (templateId && templateVersion) {
      const compuesta = await rpc('comm_componer_plantilla',
        { p_template_id: templateId, p_version: templateVersion, p_variables: variables }, SB_URL, SERVICE_KEY);
      if (!compuesta || !compuesta.ok) {
        const motivo = 'plantilla_invalida: ' + (compuesta ? compuesta.motivo : 'sin_respuesta');
        await rpc('comm_registrar_envio_fallido', { p_delivery_attempt_id: deliveryAttemptId, p_motivo: motivo }, SB_URL, SERVICE_KEY);
        return res.status(422).json({ ok: false, codigo: 'plantilla_invalida', motivo: compuesta ? compuesta.motivo : null });
      }
      contenido = compuesta.contenido;
    }
    if (!contenido) {
      await rpc('comm_registrar_envio_fallido', { p_delivery_attempt_id: deliveryAttemptId, p_motivo: 'sin_contenido' }, SB_URL, SERVICE_KEY);
      return res.status(400).json({ ok: false, codigo: 'sin_contenido' });
    }
    if (!asunto) asunto = 'Comprender AI';

    if (!BREVO_API_KEY) {
      await rpc('comm_registrar_envio_fallido', { p_delivery_attempt_id: deliveryAttemptId, p_motivo: 'falta_BREVO_API_KEY' }, SB_URL, SERVICE_KEY);
      return res.status(500).json({ ok: false, codigo: 'falta_BREVO_API_KEY' });
    }

    // 5. llamar a Brevo con timeout. Un timeout no dispara un reintento ciego: se
    // registra como intento fallido y el trabajo queda en FAILED_RETRYABLE -- un
    // despachar() posterior, explicito, es el unico que vuelve a intentar.
    const controlador = new AbortController();
    const corte = setTimeout(() => controlador.abort(), 10000);
    let respuestaBrevo;
    try {
      respuestaBrevo = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: { 'api-key': BREVO_API_KEY, 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({
          sender: { name: SENDER_NAME, email: SENDER_EMAIL },
          to: [{ email: destinatario }],
          subject: asunto,
          htmlContent: contenido,
          tags: [deliveryAttemptId],
        }),
        signal: controlador.signal,
      });
    } catch (e) {
      clearTimeout(corte);
      const motivo = (e && e.name === 'AbortError') ? 'timeout_brevo' : ('red: ' + String((e && e.message) || e));
      const r = await rpc('comm_registrar_envio_fallido', { p_delivery_attempt_id: deliveryAttemptId, p_motivo: motivo }, SB_URL, SERVICE_KEY);
      registrar({ error: 'fallo_llamar_brevo', perfil: perfil.slice(0, 8), job_id: jobId, motivo });
      return res.status(502).json({ ok: false, codigo: 'fallo_envio', motivo, estado_job: r ? r.nuevo_estado_job : null });
    }
    clearTimeout(corte);

    if (!respuestaBrevo.ok) {
      const detalle = await respuestaBrevo.text().catch(() => '');
      const motivo = 'brevo_' + respuestaBrevo.status + ': ' + detalle.slice(0, 200);
      const r = await rpc('comm_registrar_envio_fallido', { p_delivery_attempt_id: deliveryAttemptId, p_motivo: motivo }, SB_URL, SERVICE_KEY);
      registrar({ error: 'brevo_rechazo', perfil: perfil.slice(0, 8), job_id: jobId, estado: respuestaBrevo.status });
      return res.status(502).json({ ok: false, codigo: 'fallo_envio', motivo, estado_job: r ? r.nuevo_estado_job : null });
    }

    const cuerpoBrevo = await respuestaBrevo.json().catch(() => ({}));
    await rpc('comm_registrar_envio_realizado',
      { p_delivery_attempt_id: deliveryAttemptId, p_proveedor_message_id: cuerpoBrevo.messageId || null }, SB_URL, SERVICE_KEY);

    registrar({ accion: 'enviado', perfil: perfil.slice(0, 8), job_id: jobId, delivery_attempt_id: deliveryAttemptId, message_id: cuerpoBrevo.messageId });
    return res.status(200).json({
      ok: true, estado: 'enviado', delivery_attempt_id: deliveryAttemptId, proveedor_message_id: cuerpoBrevo.messageId || null,
    });
  } catch (e) {
    registrar({ error: 'fallo_despachar', perfil: perfil.slice(0, 8), job_id: jobId, detalle: String((e && e.message) || e) });
    return res.status(503).json({ error: { message: 'No se pudo despachar. Volve a intentar.', codigo: 'servicio_no_disponible' } });
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
  if (recurso === 'jobs' && accion === 'despachar') return jobsDespachar(cuerpo, res, perfil, SB_URL, SERVICE_KEY);
  if (recurso === 'inbox' && ['leer', 'archivar'].indexOf(accion) > -1) return inboxAccion(accion, cuerpo, res, perfil, SB_URL, SERVICE_KEY);
  if (recurso === 'preferences' && accion === 'fijar') return preferencesFijar(cuerpo, res, perfil, SB_URL, SERVICE_KEY);
  if (recurso === 'consent' && ['otorgar', 'revocar'].indexOf(accion) > -1) return consentAccion(accion, cuerpo, res, perfil, SB_URL, SERVICE_KEY);

  return res.status(400).json({ error: { message: 'Combinacion de recurso/accion invalida.' } });
}
