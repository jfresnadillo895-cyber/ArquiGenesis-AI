// api/comm-events.js — Corte A del Sistema de Acontecimientos, Comunicaciones y Notificaciones
// ---------------------------------------------------------------------------------------------
// QUE HACE
//   POST → ingresa un acontecimiento (comm_ingresar_evento): valida forma, deduplica por
//          event_id, detecta colision (mismo event_id, payload distinto) y cuarentena lo
//          invalido o sin finalidad vigente.
//   GET  → consulta un acontecimiento propio (?event_id=...), acotado a la cuenta en sesion.
//
// AISLAMIENTO
//   organization_id NUNCA lo manda el cliente: lo resuelve el servidor a partir de la sesion
//   (mismo patron que api/organismos.js). Este sistema no tiene organizaciones multi-tenant
//   reales todavia -- ver DIAGNOSTICO_SISTEMA_COMUNICACIONAL.md, seccion 6 -- asi que
//   organization_id = perfil de la cuenta logueada.
//
// FALLA CERRADO
//   Igual que el resto de api/*.js: si Supabase no responde, 503, no se inventa exito.
//
// VARIABLES DE ENTORNO
//   SUPABASE_URL / SUPABASE_SECRET_KEY   (ya cargadas, las usan los demas api/*.js)
//
// SIN PROVEEDORES NI DESTINATARIOS EXTERNOS EN ESTE CORTE
//   Este endpoint no envia nada a nadie. Solo registra la intencion.

const registrar = (o) => console.log(JSON.stringify({ evento: 'comm_events', ...o }));

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
  if (!token) {
    return res.status(401).json({ error: { message: 'Inicia sesion para continuar.', codigo: 'sin_sesion' } });
  }

  let perfil;
  try {
    perfil = await identificar(token, SB_URL, SERVICE_KEY);
  } catch (e) {
    registrar({ error: 'base_inalcanzable', detalle: String((e && e.message) || e) });
    return res.status(503).json({ error: { message: 'El servicio no esta disponible. Volve a intentar.', codigo: 'servicio_no_disponible' } });
  }
  if (!perfil) {
    return res.status(401).json({ error: { message: 'Sesion vencida. Volve a iniciar sesion.', codigo: 'sesion_invalida' } });
  }

  // --- GET: consultar un evento propio ---
  if (req.method === 'GET') {
    const eventId = String(req.query.event_id || '').trim();
    if (!eventId) {
      return res.status(400).json({ error: { message: 'Falta event_id.' } });
    }
    try {
      const ruta = '/rest/v1/comm_events?event_id=eq.' + encodeURIComponent(eventId) +
        '&organization_id=eq.' + encodeURIComponent(perfil) +
        '&select=event_id,version,type,producer,purpose_id,occurred_at,payload,received_at';
      const r = await fetch(SB_URL + ruta, {
        headers: { apikey: SERVICE_KEY, Authorization: 'Bearer ' + SERVICE_KEY },
      });
      if (!r.ok) throw new Error('consulta devolvio ' + r.status);
      const lista = await r.json();
      if (!lista.length) {
        return res.status(404).json({ error: { message: 'No encontrado.', codigo: 'no_encontrado' } });
      }
      return res.status(200).json({ evento: lista[0] });
    } catch (e) {
      registrar({ error: 'fallo_consultar', perfil: perfil.slice(0, 8), detalle: String((e && e.message) || e) });
      return res.status(503).json({ error: { message: 'No se pudo consultar. Volve a intentar.', codigo: 'servicio_no_disponible' } });
    }
  }

  // --- POST: ingresar ---
  let cuerpo = req.body;
  if (typeof cuerpo === 'string') { try { cuerpo = JSON.parse(cuerpo); } catch (e) { cuerpo = null; } }
  if (!cuerpo || typeof cuerpo !== 'object') {
    return res.status(400).json({ error: { message: 'Cuerpo invalido.' } });
  }

  const eventId = cuerpo.event_id;
  const version = Number.isInteger(cuerpo.version) ? cuerpo.version : null;
  const type = cuerpo.type ? String(cuerpo.type) : null;
  const producer = cuerpo.producer ? String(cuerpo.producer) : null;
  const purposeId = cuerpo.purpose_id ? String(cuerpo.purpose_id) : null;
  const occurredAt = cuerpo.occurred_at || null;
  const payload = (cuerpo.payload && typeof cuerpo.payload === 'object') ? cuerpo.payload : {};

  if (!eventId) {
    return res.status(400).json({ error: { message: 'Falta event_id.' } });
  }

  try {
    const r = await rpc('comm_ingresar_evento', {
      p_event_id: eventId,
      p_version: version,
      p_type: type,
      p_producer: producer,
      p_organization_id: perfil,
      p_purpose_id: purposeId,
      p_occurred_at: occurredAt,
      p_payload: payload,
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
