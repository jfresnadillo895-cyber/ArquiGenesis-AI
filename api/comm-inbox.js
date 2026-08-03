// api/comm-inbox.js — Corte B del Sistema de Acontecimientos, Comunicaciones y Notificaciones
// ---------------------------------------------------------------------------------------------
// QUE HACE
//   GET (sin entry_id)   → lista las entradas activas (no archivadas) de la cuenta en sesion,
//                          mas el contador de no leidas. ?incluir_archivadas=1 para verlas todas
//                          (archivar no elimina evidencia -- siguen ahi, solo se ocultan de
//                          la vista activa por defecto).
//   GET ?entry_id=...    → detalle de una entrada puntual, via comm_leer_entrada_bandeja().
//                          Si la entrada vencio, el contenido (titulo/resumen) vuelve nulo --
//                          la regla de "los enlaces vencidos no abren contenido" vive en esa
//                          funcion de la base, no aca, para que no dependa de este archivo.
//
// AISLAMIENTO
//   organization_id se resuelve de la sesion (igual patron que el resto de api/comm-*.js).
//   El listado filtra por organization_id en la propia consulta; el detalle pasa por la RPC,
//   que verifica pertenencia antes de devolver nada.
//
// VARIABLES DE ENTORNO
//   SUPABASE_URL / SUPABASE_SECRET_KEY   (ya cargadas)

const registrar = (o) => console.log(JSON.stringify({ evento: 'comm_inbox', ...o }));

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

  const entryId = String(req.query.entry_id || '').trim();

  // --- Detalle de una entrada ---
  if (entryId) {
    try {
      const r = await rpc('comm_leer_entrada_bandeja', {
        p_entry_id: entryId,
        p_organization_id: perfil,
      }, SB_URL, SERVICE_KEY);

      if (!r || !r.encontrada) {
        return res.status(404).json({ error: { message: 'No encontrada.', codigo: 'no_encontrado' } });
      }
      return res.status(200).json({
        id: entryId,
        vencida: r.vencida,
        titulo: r.titulo,
        resumen: r.resumen,
        accion_requerida: r.accion_requerida,
        leida_en: r.leida_en,
        archivada_en: r.archivada_en,
        creado: r.creado,
      });
    } catch (e) {
      registrar({ error: 'fallo_leer', perfil: perfil.slice(0, 8), entry_id: entryId, detalle: String((e && e.message) || e) });
      return res.status(503).json({ error: { message: 'No se pudo consultar. Volve a intentar.', codigo: 'servicio_no_disponible' } });
    }
  }

  // --- Listado ---
  const incluirArchivadas = String(req.query.incluir_archivadas || '') === '1';
  try {
    let ruta = '/rest/v1/comm_inbox_entries?organization_id=eq.' + encodeURIComponent(perfil) +
      '&select=id,titulo,resumen,accion_requerida,leida_en,archivada_en,vence_en,creado&order=creado.desc';
    if (!incluirArchivadas) ruta += '&archivada_en=is.null';

    const r = await fetch(SB_URL + ruta, {
      headers: { apikey: SERVICE_KEY, Authorization: 'Bearer ' + SERVICE_KEY },
    });
    if (!r.ok) throw new Error('listar devolvio ' + r.status);
    const lista = await r.json();

    const ahora = Date.now();
    const entradas = lista.map((e) => {
      const vencida = e.vence_en ? new Date(e.vence_en).getTime() < ahora : false;
      return {
        id: e.id,
        titulo: vencida ? null : e.titulo,
        resumen: vencida ? null : e.resumen,
        vencida,
        accion_requerida: e.accion_requerida,
        leida_en: e.leida_en,
        archivada_en: e.archivada_en,
        creado: e.creado,
      };
    });
    const noLeidas = entradas.filter((e) => !e.leida_en && !e.archivada_en).length;

    return res.status(200).json({ entradas, no_leidas: noLeidas });
  } catch (e) {
    registrar({ error: 'fallo_listar', perfil: perfil.slice(0, 8), detalle: String((e && e.message) || e) });
    return res.status(503).json({ error: { message: 'No se pudo listar. Volve a intentar.', codigo: 'servicio_no_disponible' } });
  }
}
