// api/comm-decisions-reevaluate.js — Corte A del Sistema de Acontecimientos, Comunicaciones y Notificaciones
// ---------------------------------------------------------------------------------------------
// QUE HACE
//   POST { event_id } → reevalua un evento ya ingresado (comm_evaluar_decision): aplica la
//   politica minima del Corte A (suspension global -> HELD; vencido -> DISCARDED; finalidad
//   no vigente -> DENIED; si no, AUTHORIZED) y, si autoriza, crea a lo sumo un trabajo
//   (comm_jobs.decision_id es UNIQUE -- no puede haber dos trabajos por la misma decision).
//
// POR QUE ES UN PASO APARTE DEL INGRESO
//   El documento maestro separa "acontecimiento" de "decision" a proposito: un mismo evento
//   podria reevaluarse mas de una vez (nueva version de politica, cambio de suspensiones) sin
//   reingresar el evento. Cada reevaluacion crea un nuevo registro en comm_decisions, nunca
//   reescribe el anterior.
//
// AISLAMIENTO
//   Se verifica que el evento pertenezca a la cuenta en sesion antes de reevaluar -- no hay
//   RLS activo (se usa la service key), asi que el chequeo de organization_id se hace a mano
//   en este archivo, no en la base.
//
// VARIABLES DE ENTORNO
//   SUPABASE_URL / SUPABASE_SECRET_KEY   (ya cargadas)

const registrar = (o) => console.log(JSON.stringify({ evento: 'comm_decisions_reevaluate', ...o }));

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
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
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

  let cuerpo = req.body;
  if (typeof cuerpo === 'string') { try { cuerpo = JSON.parse(cuerpo); } catch (e) { cuerpo = null; } }
  const eventId = cuerpo && cuerpo.event_id;
  if (!eventId) {
    return res.status(400).json({ error: { message: 'Falta event_id.' } });
  }

  try {
    // Aislamiento: confirmar que el evento es de esta cuenta antes de reevaluar.
    const ruta = '/rest/v1/comm_events?event_id=eq.' + encodeURIComponent(eventId) + '&select=organization_id';
    const rDueno = await fetch(SB_URL + ruta, {
      headers: { apikey: SERVICE_KEY, Authorization: 'Bearer ' + SERVICE_KEY },
    });
    if (!rDueno.ok) throw new Error('verificacion de dueno devolvio ' + rDueno.status);
    const filas = await rDueno.json();
    if (!filas.length) {
      return res.status(404).json({ error: { message: 'Evento no encontrado.', codigo: 'no_encontrado' } });
    }
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
