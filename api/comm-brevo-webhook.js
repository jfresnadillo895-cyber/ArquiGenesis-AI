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
    registrar({ aviso: 'sin event' });
    return res.status(200).json({ ok: true });
  }

  const proveedorMessageId = cuerpo['message-id'] ? String(cuerpo['message-id']) : null;
  let eventoId = cuerpo.id != null ? String(cuerpo.id) : '';
  if (!eventoId) {
    // respaldo: hash estable del cuerpo completo -- nunca null, nunca colisiona entre
    // payloads distintos, pero SI colisiona (a proposito) si Brevo reentrega bytes identicos.
    eventoId = 'hash_' + crypto.createHash('sha256').update(JSON.stringify(cuerpo)).digest('hex');
  }

  const tags = Array.isArray(cuerpo.tags) ? cuerpo.tags : (cuerpo.tag ? [cuerpo.tag] : []);
  const deliveryAttemptIdSugerido = tags.length ? String(tags[0]) : null;

  const tsEvent = cuerpo.ts_event || cuerpo.date || null;

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
