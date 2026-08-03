// api/comm-jobs.js — Corte A del Sistema de Acontecimientos, Comunicaciones y Notificaciones
// ---------------------------------------------------------------------------------------------
// QUE HACE
//   GET ?job_id=... → estado actual del trabajo + evidencia minima (sus transiciones), acotado
//   a la cuenta en sesion. Es la unica lectura -- cancelar/retener/reanudar viven en sus propios
//   archivos (comm-jobs-cancel.js, comm-jobs-hold.js, comm-jobs-resume.js) para que cada uno
//   tenga un solo verbo y sea mas facil de auditar.
//
// AISLAMIENTO
//   El filtro `organization_id=eq.<perfil>` va en la propia consulta REST -- un trabajo de
//   otra cuenta no aparece ni con el id exacto (prueba A11 del banco de aceptacion).
//
// VARIABLES DE ENTORNO
//   SUPABASE_URL / SUPABASE_SECRET_KEY   (ya cargadas)

const registrar = (o) => console.log(JSON.stringify({ evento: 'comm_jobs', ...o }));

async function identificar(token, url, secreta) {
  const r = await fetch(url + '/auth/v1/user', {
    headers: { apikey: secreta, Authorization: 'Bearer ' + token },
  });
  if (!r.ok) return null;
  const d = await r.json().catch(() => null);
  return d && d.id ? d.id : null;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
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

  const jobId = String(req.query.job_id || '').trim();
  if (!jobId) {
    return res.status(400).json({ error: { message: 'Falta job_id.' } });
  }

  try {
    const rutaJob = '/rest/v1/comm_jobs?id=eq.' + encodeURIComponent(jobId) +
      '&organization_id=eq.' + encodeURIComponent(perfil) +
      '&select=id,decision_id,event_id,state,not_before,expires_at,version,creado,actualizado';
    const rJob = await fetch(SB_URL + rutaJob, {
      headers: { apikey: SERVICE_KEY, Authorization: 'Bearer ' + SERVICE_KEY },
    });
    if (!rJob.ok) throw new Error('consulta de job devolvio ' + rJob.status);
    const jobs = await rJob.json();
    if (!jobs.length) {
      return res.status(404).json({ error: { message: 'No encontrado.', codigo: 'no_encontrado' } });
    }

    const rutaTrans = '/rest/v1/comm_job_transitions?job_id=eq.' + encodeURIComponent(jobId) +
      '&select=from_state,to_state,accepted,reason,actor,creado&order=creado.asc';
    const rTrans = await fetch(SB_URL + rutaTrans, {
      headers: { apikey: SERVICE_KEY, Authorization: 'Bearer ' + SERVICE_KEY },
    });
    const transiciones = rTrans.ok ? await rTrans.json() : [];

    return res.status(200).json({ trabajo: jobs[0], transiciones });

  } catch (e) {
    registrar({ error: 'fallo_consultar', perfil: perfil.slice(0, 8), job_id: jobId, detalle: String((e && e.message) || e) });
    return res.status(503).json({ error: { message: 'No se pudo consultar. Volve a intentar.', codigo: 'servicio_no_disponible' } });
  }
}
