// api/comm-brevo-webhook.js — Recibe los webhooks de Brevo (Corte D)
// ---------------------------------------------------------------------------------------------
// POR QUE ES UN ARCHIVO APARTE (y no una accion mas de api/comm.js)
//   api/comm.js identifica a quien llama por sesion de usuario (Bearer token de Supabase Auth,
//   ver identificar() en ese archivo). Un webhook de Brevo no tiene sesion de ningun usuario --
//   necesita un mecanismo de autenticacion completamente distinto. Mezclar los dos modelos en
//   el mismo handler es la fuente tipica de bugs de seguridad ("por que este endpoint publico
//   comparte codigo con uno que espera Bearer de usuario"), asi que se separa, igual que
//   pago.js y lemonsqueezy.js ya estan separados del resto de api/*.js por la misma razon.
//
// BREVO NO FIRMA SUS WEBHOOKS (a diferencia de Mercado Pago y Lemon Squeezy, que si firman)
//   No hay un header tipo x-signature que verificar con HMAC. La proteccion aca es un secreto
//   compartido en la URL misma del webhook: se configura la URL en el panel de Brevo
//   (Transactional > Settings > Webhooks) como
//     https://<tu-dominio>/api/comm-brevo-webhook?token=<BREVO_WEBHOOK_SECRET>
//   y este archivo rechaza (401) cualquier pedido cuyo ?token= no coincida exactamente.
//   Sin BREVO_WEBHOOK_SECRET configurada, el endpoint queda abierto -- se loguea un aviso
//   fuerte en cada pedido para que no pase desapercibido en produccion.
//
// SIEMPRE RESPONDE 200 (salvo token invalido) -- mismo motivo que pago.js/lemonsqueezy.js:
// devolver error hace que el proveedor reintente en bucle algo que no se va a arreglar solo.
//
// IDEMPOTENCIA (webhooks repetidos no duplican efectos)
//   Brevo puede reentregar el mismo evento (reintento de red de su lado). comm_procesar_recibo_
//   proveedor() en SQL tiene un unique(proveedor, proveedor_evento_id) -- la segunda entrega
//   del mismo evento cae en "duplicado" y no vuelve a tocar nada. proveedor_evento_id sale del
//   campo "id" que manda Brevo por webhook; si alguna vez faltara, se arma un hash estable del
//   cuerpo completo como respaldo (nunca null, nunca repetido para payloads distintos).
//
// CORRELACION CON EL INTENTO DE ENTREGA
//   Al enviar (api/comm.js, jobsDespachar) se manda tags:[delivery_attempt_id]. Brevo devuelve
//   esas mismas tags en el webhook -- se usan para saber a que fila de comm_delivery_attempts
//   corresponde el evento, sin depender solo del message-id.
//
// VARIABLES DE ENTORNO
//   SUPABASE_URL / SUPABASE_SECRET_KEY   (ya cargadas)
//   BREVO_WEBHOOK_SECRET                 el valor que va en ?token= de la URL configurada en Brevo
//
// CORTE G — RESPUESTAS ENTRANTES (misma URL, mismo token, payload distinto)
//   El webhook de eventos transaccionales (arriba) manda un objeto plano con "event".
//   El webhook de "inbound parsing" de Brevo (respuestas por correo) manda, en cambio,
//   un objeto con un array "items" -- cada item es un correo entrante completo (From, To,
//   Subject, RawTextBody, RawHtmlBody, InReplyTo, MessageId, etc). Se distinguen por eso,
//   sin necesitar dos URLs ni un archivo aparte: si no hay "event", se busca "items".
//   Documentacion real usada para los nombres de campo: developers.brevo.com/docs/
//   inbound-parse-webhooks. Requiere un subdominio con MX propios apuntando a Brevo --
//   ver CORTE_G_SISTEMA_COMUNICACIONAL.md para los pasos exactos; sin esa configuracion
//   de DNS, Brevo nunca llega a mandar este tipo de payload.

import crypto from 'crypto';

const registrar = (o) => console.log(JSON.stringify({ evento: 'comm_brevo_webhook', ...o }));

async function rpc(nombre, cuerpo, url, secreta) {
  const r = await fetch(url + '/rest/v1/rpc/' + nombre, {
    method: 'POST',
    headers: { apikey: secreta, Authorization: 'Bearer ' + secreta, 'content-type': 'application/json' },
    body: JSON.stringify(cuerpo),
  });
  if (!r.ok) throw new Error('rpc ' + nombre + ' devolvio ' + r.status + ' ' + (await r.text()).slice(0, 300));
  const d = await r.json();
  return Array.isArray(d) ? d[0] : d;
}

// Corte G: procesa cada correo entrante del array "items" que manda el webhook de
// inbound parsing. Un solo POST de Brevo puede traer mas de uno -- se procesan todos
// antes de responder, y un fallo en uno no corta a los demas (mismo espiritu de
// "siempre responde 200" del resto de este archivo: no es culpa de Brevo).
async function procesarRespuestasEntrantes(items, SB_URL, SERVICE_KEY, res) {
  let procesados = 0;
  let fallidos = 0;

  for (const item of items) {
    try {
      // "From"/"To"/"Cc"/"ReplyTo" son objetos {Name, Address} segun la documentacion de
      // Brevo (developers.brevo.com/docs/inbound-parse-webhooks) -- no un string plano.
      const remitenteEmail = item.From && item.From.Address ? String(item.From.Address).toLowerCase() : null;
      const asunto = item.Subject != null ? String(item.Subject) : null;
      const textoPlano = item.RawTextBody != null ? String(item.RawTextBody) : (item.ExtractedMarkdownMessage != null ? String(item.ExtractedMarkdownMessage) : null);
      const html = item.RawHtmlBody != null ? String(item.RawHtmlBody) : null;
      const inReplyTo = item.InReplyTo != null ? String(item.InReplyTo) : null;

      let mensajeId = item.MessageId != null ? String(item.MessageId) : '';
      if (!mensajeId) {
        // mismo respaldo que ya existe para los webhooks de eventos: hash estable del
        // item completo, nunca null, nunca colisiona entre payloads distintos.
        mensajeId = 'hash_' + crypto.createHash('sha256').update(JSON.stringify(item)).digest('hex');
      }

      registrar({ accion: 'respuesta_recibida', remitente: remitenteEmail, in_reply_to: inReplyTo, message_id: mensajeId });

      const r = await rpc('comm_registrar_respuesta_entrante', {
        p_proveedor: 'brevo',
        p_proveedor_message_id: mensajeId,
        p_in_reply_to: inReplyTo,
        p_remitente_email: remitenteEmail,
        p_asunto: asunto,
        p_cuerpo_texto: textoPlano,
        p_cuerpo_html: html,
        p_payload: item,
      }, SB_URL, SERVICE_KEY);

      registrar({
        accion: 'respuesta_procesada', duplicado: r ? r.duplicado : null,
        thread_id: r ? r.thread_id : null, remitente_desconocido: r ? r.remitente_desconocido : null,
      });
      procesados++;
    } catch (e) {
      fallidos++;
      registrar({ error: 'FALLO PROCESANDO RESPUESTA ENTRANTE', detalle: String((e && e.message) || e) });
    }
  }

  return res.status(200).json({ ok: true, procesados, fallidos }); // 200 igual, misma razon de siempre
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: { message: 'Metodo no permitido.' } });
  }

  const secreto = process.env.BREVO_WEBHOOK_SECRET;
  const tokenRecibido = String(req.query.token || '');
  if (secreto) {
    if (tokenRecibido !== secreto) {
      registrar({ error: 'TOKEN INVALIDO', ip: req.headers['x-forwarded-for'] || '' });
      return res.status(401).json({ error: { message: 'Token invalido.' } });
    }
  } else {
    registrar({ aviso: 'SIN BREVO_WEBHOOK_SECRET CONFIGURADA -- webhook sin verificar' });
  }

  const SB_URL = process.env.SUPABASE_URL;
  const SERVICE_KEY = process.env.SUPABASE_SECRET_KEY;
  if (!SB_URL || !SERVICE_KEY) {
    registrar({ error: 'falta SUPABASE_URL o SUPABASE_SECRET_KEY' });
    return res.status(200).json({ ok: false }); // 200 igual: no es culpa de Brevo, no debe reintentar en bucle
  }

  let cuerpo = req.body;
  if (typeof cuerpo === 'string') { try { cuerpo = JSON.parse(cuerpo); } catch (e) { cuerpo = null; } }
  if (!cuerpo || typeof cuerpo !== 'object') {
    registrar({ error: 'cuerpo no es JSON valido' });
    return res.status(200).json({ ok: true });
  }

  const evento = String(cuerpo.event || '');
  if (!evento) {
    // Corte G: sin "event", puede ser un webhook de respuestas entrantes (inbound
    // parsing) en vez de uno de eventos de entrega -- se distingue por "items".
    if (Array.isArray(cuerpo.items)) {
      return procesarRespuestasEntrantes(cuerpo.items, SB_URL, SERVICE_KEY, res);
    }
    registrar({ aviso: 'sin event ni items -- payload desconocido' });
    return res.status(200).json({ ok: true });
  }

  const proveedorMessageId = cuerpo['message-id'] ? String(cuerpo['message-id']) : null;
  let eventoId = cuerpo.id != null ? String(cuerpo.id) : '';
  if (!eventoId) {
    // respaldo: hash estable del cuerpo completo -- nunca null, nunca colisiona entre
    // payloads distintos, pero SI colisiona (a proposito) si Brevo reentrega bytes identicos.
    eventoId = 'hash_' + crypto.createHash('sha256').update(JSON.stringify(cuerpo)).digest('hex');
  }
  // Brevo reusa el MISMO "id" para todos los eventos de un mismo envio (confirmado en la
  // prueba real, 03/08: "unique_opened" y "delivered" del mismo mensaje llegaron con
  // identico cuerpo.id). Sin esto, la clave de idempotencia (proveedor+evento_id) trataba
  // al segundo evento como si fuera un reintento del primero y lo descartaba sin
  // procesarlo -- por eso "delivered" nunca actualizaba el trabajo. Se agrega el tipo de
  // evento a la clave para distinguir avisos distintos del mismo envio.
  eventoId = evento + ':' + eventoId;

  const tags = Array.isArray(cuerpo.tags) ? cuerpo.tags : (cuerpo.tag ? [cuerpo.tag] : []);
  const deliveryAttemptIdSugerido = tags.length ? String(tags[0]) : null;

  // Brevo manda "ts_event" (y "ts"/"ts_epoch") como timestamp Unix en SEGUNDOS -- un numero
  // entero, no un texto de fecha. Pasarselo tal cual a una columna timestamptz de Postgres
  // rompe con "date/time field value out of range" (encontrado en la primera prueba real,
  // 03/08): Postgres intenta interpretar "1785801974" como una fecha literal, no como epoch.
  // "date" si es un texto de fecha ya formateado por Brevo -- ese se puede pasar directo.
  let tsEvent = null;
  if (cuerpo.ts_event != null) {
    const n = Number(cuerpo.ts_event);
    tsEvent = Number.isFinite(n) ? new Date(n * 1000).toISOString() : null;
  } else if (cuerpo.date) {
    tsEvent = String(cuerpo.date);
  }

  registrar({
    accion: 'recibido', evento, message_id: proveedorMessageId,
    delivery_attempt_id_sugerido: deliveryAttemptIdSugerido, evento_id: eventoId,
  });

  try {
    const r = await rpc('comm_procesar_recibo_proveedor', {
      p_proveedor: 'brevo',
      p_proveedor_evento_id: eventoId,
      p_evento: evento,
      p_proveedor_message_id: proveedorMessageId,
      p_ts_event: tsEvent,
      p_delivery_attempt_id_sugerido: deliveryAttemptIdSugerido,
      p_payload: cuerpo,
    }, SB_URL, SERVICE_KEY);

    registrar({
      accion: 'procesado', evento, duplicado: r ? r.duplicado : null,
      delivery_attempt_id: r ? r.delivery_attempt_id : null,
      nuevo_estado_attempt: r ? r.nuevo_estado_attempt : null,
      nuevo_estado_job: r ? r.nuevo_estado_job : null,
    });
    return res.status(200).json({ ok: true });
  } catch (e) {
    registrar({ error: 'FALLO PROCESANDO', evento, detalle: String((e && e.message) || e) });
    return res.status(200).json({ ok: false }); // 200 igual, por la misma razon de siempre
  }
}
