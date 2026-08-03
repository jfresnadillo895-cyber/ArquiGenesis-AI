// api/comm-jobs-resume.js — Corte A del Sistema de Acontecimientos, Comunicaciones y Notificaciones
// ---------------------------------------------------------------------------------------------
// QUE HACE
//   POST { job_id, reason?, version_conocida? } → transiciona el trabajo de HELD a READY via
//   comm_transicionar_job(), si las restricciones lo permiten. No reanuda trabajos CANCELLED
//   ni EXPIRED -- comm_transicion_valida() no tiene ninguna salida desde esos dos estados
//   (pide el documento maestro: "cancelado y vencido no pueden volver a listo").
//
// VARIABLES DE ENTORNO
//   SUPABASE_URL / SUPABASE_SECRET_KEY   (ya cargadas)

const registrar = (o) => console.log(JSON.stringify({ evento: 'comm_jobs_resume', ...o }));

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
  const jobId = cuerpo && cuerpo.job_id;
  if (!jobId) {
    return res.status(400).json({ error: { message: 'Falta job_id.' } });
  }
  const reason = (cuerpo.reason != null) ? String(cuerpo.reason) : 'reanudado_por_usuario';
  const versionConocida = Number.isInteger(cuerpo.version_conocida) ? cuerpo.version_conocida : null;

  try {
    const r = await rpc('comm_transicionar_job', {
      p_job_id: jobId,
      p_organization_id: perfil,
      p_hacia: 'READY',
      p_reason: reason,
      p_actor: 'user:' + perfil,
      p_version_conocida: versionConocida,
    }, SB_URL, SERVICE_KEY);

    registrar({ accion: r && r.ok ? 'reanudado' : 'rechazado', perfil: perfil.slice(0, 8), job_id: jobId, motivo: r ? r.motivo : null });

    if (!r || !r.ok) {
      const codigo = (r && r.motivo) || 'no_autorizado';
      const status = codigo === 'no_encontrado_o_no_autorizado' ? 403 : 409;
      return res.status(status).json({ ok: false, codigo, estado: r ? r.estado : null });
    }

    return res.status(200).json({ ok: true, estado: r.estado, version: r.version });

  } catch (e) {
    registrar({ error: 'fallo_reanudar', perfil: perfil.slice(0, 8), job_id: jobId, detalle: String((e && e.message) || e) });
    return res.status(503).json({ error: { message: 'No se pudo reanudar. Volve a intentar.', codigo: 'servicio_no_disponible' } });
  }
}
