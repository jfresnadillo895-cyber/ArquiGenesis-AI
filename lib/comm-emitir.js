// lib/comm-emitir.js — Puente entre productores reales y el sistema de comunicaciones (Corte F)
// ---------------------------------------------------------------------------------------------
// QUE ES
//   La UNICA funcion que un modulo productor real (pago.js, lemonsqueezy.js, organismos.js)
//   llama para convertir "algo paso de verdad" en un acontecimiento del sistema
//   comunicacional. Documento maestro, 5.3: "los modulos productores solo declaran
//   acontecimientos mediante contratos comunes. No conocen proveedores, credenciales,
//   plantillas concretas ni estados externos" -- ningun productor sabe que existe Brevo,
//   Corte D, webhooks, ni siquiera que la entrega es via bandeja. Solo declara QUE paso.
//
// POR QUE VIVE FUERA DE api/ (en /lib, no en /api)
//   Vercel Hobby cuenta como "funcion serverless" cada archivo que hay directamente dentro
//   de api/ -- lo confirma catalogo.js, que no exporta ningun handler y sin embargo contaba
//   para el limite de 12 (fue una de las razones por las que Corte D tuvo que consolidar
//   nueve archivos en uno). Este archivo NO es un endpoint -- es una libreria que importan
//   otros archivos de api/. Si viviera dentro de api/, gastaria un cupo de funcion sin
//   necesidad.
//
// AISLAMIENTO (documento maestro, banco de aceptacion del Corte F)
//   emitirYNotificar() NUNCA lanza una excepcion hacia quien la llama. Un fallo del sistema
//   comunicacional (Supabase caido, RPC con error, lo que sea) no puede tirar abajo un pago
//   real ni el guardado de un organismo real -- eso seria peor que no tener el aviso. Todo
//   el cuerpo esta en un try/catch que solo registra en los logs.
//
// COMO USARLO (desde un api/*.js que ya tiene SB_URL y SERVICE_KEY)
//   import { emitirYNotificar } from '../lib/comm-emitir.js';
//   await emitirYNotificar({
//     SB_URL, SERVICE_KEY,
//     organizationId: perfil, purposeId: 'plan_activado', type: 'plan.activado',
//     producer: 'pago_mercadopago', payload: { plan, dias: 30 },
//     titulo: 'Tu plan quedo activo', resumen: `Tu plan ${plan} esta activo.`,
//   });
//
// QUE HACE ADENTRO (los mismos pasos que ya usa api/comm.js, en el mismo orden)
//   1. comm_ingresar_evento   -- si es "cuarentena" o "repetido", no hay nada mas que hacer.
//   2. comm_evaluar_decision  -- si no es AUTHORIZED (DENIED/HELD/DISCARDED), correcto no
//      seguir: es exactamente el caso de aceptacion "no envio".
//   3. comm_preparar_entrega  -- aplica preferencias/consentimiento/suspensiones/notBefore/
//      dependencia/presion (Cortes C, D, E). Si queda "retenido", tampoco se sigue --
//      vuelve a intentarse solo con el barrido diario (Corte E) cuando corresponda.
//   4. comm_entregar_bandeja  -- solo si "listo": crea la entrada visible y cierra el trabajo.
//
// DESACTIVACION INDEPENDIENTE
//   No hace falta tocar este archivo ni ningun api/*.js para apagar un modulo: alcanza con
//   `update comm_purposes set vigente=false where id='plan_activado'` (o el que sea) en
//   Supabase -- comm_evaluar_decision ya lo respeta desde el Corte A.

async function rpc(nombre, cuerpo, SB_URL, SERVICE_KEY) {
  const r = await fetch(SB_URL + '/rest/v1/rpc/' + nombre, {
    method: 'POST',
    headers: { apikey: SERVICE_KEY, Authorization: 'Bearer ' + SERVICE_KEY, 'content-type': 'application/json' },
    body: JSON.stringify(cuerpo),
  });
  if (!r.ok) throw new Error('rpc ' + nombre + ' devolvio ' + r.status + ' ' + (await r.text()).slice(0, 300));
  const d = await r.json();
  return Array.isArray(d) ? d[0] : d;
}

const registrar = (o) => console.log(JSON.stringify({ evento: 'comm_emitir', ...o }));

export async function emitirYNotificar({
  SB_URL, SERVICE_KEY, organizationId, purposeId, type, producer, payload,
  titulo, resumen, accionRequerida, venceEn, canal, eventId, occurredAt,
}) {
  try {
    if (!SB_URL || !SERVICE_KEY || !organizationId || !purposeId) {
      registrar({ error: 'faltan_datos_obligatorios', purposeId });
      return { emitido: false, motivo: 'faltan_datos_obligatorios' };
    }

    const evId = eventId || (globalThis.crypto && globalThis.crypto.randomUUID
      ? globalThis.crypto.randomUUID()
      : 'evt-' + Date.now() + '-' + Math.random().toString(36).slice(2));

    const ing = await rpc('comm_ingresar_evento', {
      p_event_id: evId, p_version: 1, p_type: type || purposeId, p_producer: producer || 'desconocido',
      p_organization_id: organizationId, p_purpose_id: purposeId,
      p_occurred_at: occurredAt || new Date().toISOString(), p_payload: payload || {},
    }, SB_URL, SERVICE_KEY);

    if (!ing || ing.estado !== 'registrado') {
      registrar({ accion: ing ? ing.estado : 'sin_respuesta', purposeId, organization: String(organizationId).slice(0, 8) });
      return { emitido: false, motivo: ing ? ing.estado : 'sin_respuesta' };
    }

    const dec = await rpc('comm_evaluar_decision', { p_event_id: evId }, SB_URL, SERVICE_KEY);
    if (!dec || dec.resultado !== 'AUTHORIZED') {
      // caso de aceptacion "no envio": una finalidad denegada/descartada/retenida no
      // sigue de largo -- es lo correcto, no un error.
      registrar({ accion: 'no_autorizado', resultado: dec ? dec.resultado : null, purposeId, organization: String(organizationId).slice(0, 8) });
      return { emitido: false, motivo: dec ? dec.resultado : 'sin_decision' };
    }

    const prep = await rpc('comm_preparar_entrega', {
      p_job_id: dec.job_id, p_organization_id: organizationId, p_canal: canal || 'inapp',
    }, SB_URL, SERVICE_KEY);
    if (!prep || prep.estado !== 'listo') {
      registrar({ accion: 'retenido', motivo: prep ? prep.motivo : null, job_id: dec.job_id, purposeId, organization: String(organizationId).slice(0, 8) });
      return { emitido: false, motivo: prep ? prep.motivo : 'sin_preparar', job_id: dec.job_id };
    }

    const entrega = await rpc('comm_entregar_bandeja', {
      p_job_id: dec.job_id, p_organization_id: organizationId,
      p_titulo: titulo || purposeId, p_resumen: resumen || null,
      p_accion_requerida: !!accionRequerida, p_vence_en: venceEn || null,
    }, SB_URL, SERVICE_KEY);

    registrar({
      accion: entrega && entrega.ok ? 'entregado' : 'fallo_entrega', motivo: entrega ? entrega.motivo : null,
      job_id: dec.job_id, entry_id: entrega ? entrega.entry_id : null, purposeId, organization: String(organizationId).slice(0, 8),
    });
    return { emitido: !!(entrega && entrega.ok), job_id: dec.job_id, entry_id: entrega ? entrega.entry_id : null };

  } catch (e) {
    // aislamiento: se registra, nunca se propaga. Un fallo aca no puede tirar abajo
    // al productor real que llamo (un pago, un guardado de organismo, etc.).
    registrar({ error: 'fallo_aislado', purposeId, detalle: String((e && e.message) || e) });
    return { emitido: false, motivo: 'error_aislado' };
  }
}

// ============================================================
// emitirYEnviarCorreo — Corte I: gemela de emitirYNotificar(), pero para correo real.
// ---------------------------------------------------------------------------------------------
// POR QUE UNA FUNCION APARTE (y no una opcion "canal" adentro de emitirYNotificar)
//   emitirYNotificar() SIEMPRE termina en comm_entregar_bandeja (Corte F): ese "trabajador"
//   crea la entrada visible y cierra el trabajo, sin importar que canal se le haya pasado --
//   confirmado leyendo CORTE_F_MIGRACION.sql. Para un aviso que tiene que salir POR CORREO
//   de verdad (no bandeja), hace falta el otro camino que ya existia para pruebas manuales
//   (Corte D, jobsDespachar en api/comm.js): iniciar intento, componer, llamar a Brevo,
//   registrar exito o fallo. Esta funcion es ese mismo recorrido, pero reutilizable desde
//   cualquier productor (hoy: el cron de organismos pendientes; mañana, cualquier otro).
//
// SEGURIDAD HEREDADA, NO REESCRITA
//   comm_iniciar_intento_entrega ya exige que el destinatario este en comm_closed_recipients
//   (Corte D) -- esta funcion NO se saltea esa verificacion. Mientras un email real no este
//   en esa lista, el intento se rechaza solo (motivo 'destinatario_no_permitido') y no se
//   llama a Brevo. Abrir el envio a usuarios reales es una decision de datos en Supabase
//   (poblar comm_closed_recipients, o el criterio que Javier decida), no un cambio de codigo.
//
// COMO USARLO (desde un api/*.js o api/comm-cron.js que ya tiene SB_URL y SERVICE_KEY)
//   import { emitirYEnviarCorreo } from '../lib/comm-emitir.js';
//   await emitirYEnviarCorreo({
//     SB_URL, SERVICE_KEY, organizationId: perfil, purposeId: 'organismo_pendiente',
//     type: 'organismo.pendiente', producer: 'organismos_pendientes',
//     payload: { organismo_id, proximos }, destinatario: email,
//     asunto: '...', contenidoHtml: '<p>...</p>',
//   });
// ============================================================

export async function emitirYEnviarCorreo({
  SB_URL, SERVICE_KEY, organizationId, purposeId, type, producer, payload,
  destinatario, asunto, contenidoHtml, eventId, occurredAt,
}) {
  try {
    if (!SB_URL || !SERVICE_KEY || !organizationId || !purposeId || !destinatario) {
      registrar({ error: 'faltan_datos_obligatorios', purposeId });
      return { enviado: false, motivo: 'faltan_datos_obligatorios' };
    }

    const evId = eventId || (globalThis.crypto && globalThis.crypto.randomUUID
      ? globalThis.crypto.randomUUID()
      : 'evt-' + Date.now() + '-' + Math.random().toString(36).slice(2));

    const ing = await rpc('comm_ingresar_evento', {
      p_event_id: evId, p_version: 1, p_type: type || purposeId, p_producer: producer || 'desconocido',
      p_organization_id: organizationId, p_purpose_id: purposeId,
      p_occurred_at: occurredAt || new Date().toISOString(), p_payload: payload || {},
    }, SB_URL, SERVICE_KEY);

    if (!ing || ing.estado !== 'registrado') {
      registrar({ accion: ing ? ing.estado : 'sin_respuesta', purposeId, organization: String(organizationId).slice(0, 8) });
      return { enviado: false, motivo: ing ? ing.estado : 'sin_respuesta' };
    }

    const dec = await rpc('comm_evaluar_decision', { p_event_id: evId }, SB_URL, SERVICE_KEY);
    if (!dec || dec.resultado !== 'AUTHORIZED') {
      registrar({ accion: 'no_autorizado', resultado: dec ? dec.resultado : null, purposeId, organization: String(organizationId).slice(0, 8) });
      return { enviado: false, motivo: dec ? dec.resultado : 'sin_decision' };
    }

    const prep = await rpc('comm_preparar_entrega', { p_job_id: dec.job_id, p_organization_id: organizationId, p_canal: 'email' }, SB_URL, SERVICE_KEY);
    if (!prep || prep.estado !== 'listo') {
      registrar({ accion: 'retenido', motivo: prep ? prep.motivo : null, job_id: dec.job_id, purposeId, organization: String(organizationId).slice(0, 8) });
      return { enviado: false, motivo: prep ? prep.motivo : 'sin_preparar', job_id: dec.job_id };
    }

    const inicio = await rpc('comm_iniciar_intento_entrega',
      { p_job_id: dec.job_id, p_organization_id: organizationId, p_canal: 'email', p_destinatario: destinatario }, SB_URL, SERVICE_KEY);
    if (!inicio || !inicio.ok) {
      const codigo = (inicio && inicio.motivo) || 'no_se_pudo_iniciar';
      registrar({ accion: 'rechazado_antes_de_enviar', motivo: codigo, job_id: dec.job_id, purposeId, organization: String(organizationId).slice(0, 8) });
      return { enviado: false, motivo: codigo, job_id: dec.job_id };
    }
    const deliveryAttemptId = inicio.delivery_attempt_id;

    const BREVO_API_KEY = process.env.BREVO_API_KEY;
    const SENDER_EMAIL = process.env.BREVO_SENDER_EMAIL || 'contacto@comprenderai.com';
    const SENDER_NAME = process.env.BREVO_SENDER_NAME || 'Comprender AI';
    const REPLY_TO_EMAIL = process.env.BREVO_REPLYTO_EMAIL || null;

    if (!BREVO_API_KEY) {
      await rpc('comm_registrar_envio_fallido', { p_delivery_attempt_id: deliveryAttemptId, p_motivo: 'falta_BREVO_API_KEY' }, SB_URL, SERVICE_KEY);
      return { enviado: false, motivo: 'falta_BREVO_API_KEY', job_id: dec.job_id };
    }
    if (!contenidoHtml) {
      await rpc('comm_registrar_envio_fallido', { p_delivery_attempt_id: deliveryAttemptId, p_motivo: 'sin_contenido' }, SB_URL, SERVICE_KEY);
      return { enviado: false, motivo: 'sin_contenido', job_id: dec.job_id };
    }

    // mismo timeout y mismo criterio que jobsDespachar (Corte D): un timeout no
    // reintenta solo, queda FAILED_RETRYABLE para el proximo despachar()/barrido.
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
          subject: asunto || 'Comprender AI',
          htmlContent: contenidoHtml,
          tags: [deliveryAttemptId],
          ...(REPLY_TO_EMAIL ? { replyTo: { email: REPLY_TO_EMAIL } } : {}),
        }),
        signal: controlador.signal,
      });
    } catch (e) {
      clearTimeout(corte);
      const motivo = (e && e.name === 'AbortError') ? 'timeout_brevo' : ('red: ' + String((e && e.message) || e));
      await rpc('comm_registrar_envio_fallido', { p_delivery_attempt_id: deliveryAttemptId, p_motivo: motivo }, SB_URL, SERVICE_KEY);
      registrar({ error: 'fallo_llamar_brevo', purposeId, job_id: dec.job_id, motivo });
      return { enviado: false, motivo, job_id: dec.job_id };
    }
    clearTimeout(corte);

    if (!respuestaBrevo.ok) {
      const detalle = await respuestaBrevo.text().catch(() => '');
      const motivo = 'brevo_' + respuestaBrevo.status + ': ' + detalle.slice(0, 200);
      await rpc('comm_registrar_envio_fallido', { p_delivery_attempt_id: deliveryAttemptId, p_motivo: motivo }, SB_URL, SERVICE_KEY);
      registrar({ error: 'brevo_rechazo', purposeId, job_id: dec.job_id, estado: respuestaBrevo.status });
      return { enviado: false, motivo, job_id: dec.job_id };
    }

    const cuerpoBrevo = await respuestaBrevo.json().catch(() => ({}));
    await rpc('comm_registrar_envio_realizado',
      { p_delivery_attempt_id: deliveryAttemptId, p_proveedor_message_id: cuerpoBrevo.messageId || null }, SB_URL, SERVICE_KEY);

    registrar({
      accion: 'enviado', purposeId, job_id: dec.job_id, delivery_attempt_id: deliveryAttemptId,
      message_id: cuerpoBrevo.messageId, organization: String(organizationId).slice(0, 8),
    });
    return { enviado: true, job_id: dec.job_id, delivery_attempt_id: deliveryAttemptId, proveedor_message_id: cuerpoBrevo.messageId || null };

  } catch (e) {
    // mismo aislamiento que emitirYNotificar: un fallo aca nunca se propaga al llamador.
    registrar({ error: 'fallo_aislado', purposeId, detalle: String((e && e.message) || e) });
    return { enviado: false, motivo: 'error_aislado' };
  }
}

// obtenerEmailUsuario — resuelve el email real de una cuenta a partir de su perfil (uuid),
// via la Admin API de Supabase (misma familia de llamada que ya usa api/eliminar-cuenta.js).
// Necesario porque comm_events/organismos guardan perfil (uuid), no el email de la persona.
export async function obtenerEmailUsuario(perfil, SB_URL, SERVICE_KEY) {
  try {
    const r = await fetch(SB_URL + '/auth/v1/admin/users/' + perfil, {
      headers: { apikey: SERVICE_KEY, Authorization: 'Bearer ' + SERVICE_KEY },
    });
    if (!r.ok) return null;
    const d = await r.json().catch(() => null);
    const email = d && (d.email || (d.user && d.user.email));
    return email || null;
  } catch (e) {
    return null;
  }
}
