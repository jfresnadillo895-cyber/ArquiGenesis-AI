// api/comm-inbox-read.js — Corte B del Sistema de Acontecimientos, Comunicaciones y Notificaciones
// ---------------------------------------------------------------------------------------------
// QUE HACE
//   POST { entry_id } → marca la entrada como leida (comm_marcar_leida). Idempotente: si ya
//   estaba leida, devuelve el momento original, no lo pisa.
//
// LEER NO EQUIVALE A RESOLVER
//   Esto no toca el job ni su estado -- son conceptos distintos a proposito (documento
//   maestro, principios no negociables). "Resolver" (si algun dia existe una accion asi)
//   seria otra cosa, sobre el job, no sobre la entrada de bandeja.
//
// VARIABLES DE ENTORNO
//   SUPABASE_URL / SUPABASE_SECRET_KEY   (ya cargadas)

const registrar = (o) => console.log(JSON.stringify({ evento: 'comm_inbox_read', ...o }));

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
  const entryId = cuerpo && cuerpo.entry_id;
  if (!entryId) {
    return res.status(400).json({ error: { message: 'Falta entry_id.' } });
  }

  try {
    const r = await rpc('comm_marcar_leida', { p_entry_id: entryId, p_organization_id: perfil }, SB_URL, SERVICE_KEY);
    registrar({ accion: r && r.ok ? 'leida' : 'rechazado', perfil: perfil.slice(0, 8), entry_id: entryId });

    if (!r || !r.ok) {
      return res.status(404).json({ ok: false, codigo: 'no_encontrado' });
    }
    return res.status(200).json({ ok: true, ya_estaba_leida: r.ya_estaba_leida, leida_en: r.leida_en });

  } catch (e) {
    registrar({ error: 'fallo_marcar_leida', perfil: perfil.slice(0, 8), entry_id: entryId, detalle: String((e && e.message) || e) });
    return res.status(503).json({ error: { message: 'No se pudo marcar como leida. Volve a intentar.', codigo: 'servicio_no_disponible' } });
  }
}
