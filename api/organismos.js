// api/organismos.js — Persistencia de organismos ligada a la cuenta (Corte 0.5)
// ---------------------------------------------------------------------------------------------
// QUE HACE
//   GET  → lista los organismos del usuario en sesion (activos y archivados).
//   POST → guarda uno (crea si es nuevo, actualiza si ya existe) usando cliente_id para
//          reconocerlo sin duplicar. Si alguien mas ya guardo una version mas nueva,
//          NO la pisa: devuelve conflicto:true con la version real del servidor.
//
// POR QUE cliente_id
//   Es el id que el organismo ya tiene hoy en localStorage (ag_core_organismos). Usarlo tal
//   cual, en vez de inventar uno nuevo, es lo que permite migrar sin duplicar: guardar el
//   mismo organismo dos veces (por red, por reintento) actualiza la misma fila en vez de
//   crear una nueva -- lo garantiza el indice unico (perfil, cliente_id) de la tabla.
//
// POR QUE jsonb Y NO COLUMNAS PARA CADA CAMPO DE LA FICHA
//   La forma del organismo (ficha, principios, borrador, historial) sigue evolucionando del
//   lado del cliente. Traducir cada campo a una columna obligaria a migrar el esquema cada
//   vez que cambie esa forma. `datos` guarda el objeto tal cual el cliente lo entiende hoy;
//   el servidor no necesita saber que hay adentro para guardarlo, listarlo o devolverlo.
//   Mismo patron que ya usa pagos.bruto.
//
// FALLA CERRADO
//   Igual que api/anthropic.js: si Supabase no responde, se devuelve 503, no se inventa una
//   respuesta de exito. El cliente decide como avisar y reintentar.
//
// VARIABLES DE ENTORNO
//   SUPABASE_URL / SUPABASE_SECRET_KEY   (ya cargadas, las usan los demas api/*.js)

const registrar = (o) => console.log(JSON.stringify({ evento: 'organismos', ...o }));

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
    headers: {
      apikey: secreta,
      Authorization: 'Bearer ' + secreta,
      'content-type': 'application/json',
    },
    body: JSON.stringify(cuerpo),
  });
  if (!r.ok) {
    const detalle = await r.text().catch(() => '');
    throw new Error('rpc ' + nombre + ' devolvio ' + r.status + ' ' + detalle.slice(0, 200));
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

  // --- Sesion ---
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

  // --- GET: listar ---
  if (req.method === 'GET') {
    try {
      const ruta = '/rest/v1/organismos?perfil=eq.' + perfil +
        '&select=id,cliente_id,nombre,estado,datos,version,creado,actualizado&order=actualizado.desc';
      const r = await fetch(SB_URL + ruta, {
        headers: { apikey: SERVICE_KEY, Authorization: 'Bearer ' + SERVICE_KEY },
      });
      if (!r.ok) throw new Error('listar devolvio ' + r.status);
      const lista = await r.json();
      return res.status(200).json({ organismos: lista });
    } catch (e) {
      registrar({ error: 'fallo_listar', perfil: perfil.slice(0, 8), detalle: String((e && e.message) || e) });
      return res.status(503).json({ error: { message: 'No se pudieron traer los organismos. Volve a intentar.', codigo: 'servicio_no_disponible' } });
    }
  }

  // --- POST: guardar (crea o actualiza) ---
  let cuerpo = req.body;
  if (typeof cuerpo === 'string') { try { cuerpo = JSON.parse(cuerpo); } catch (e) { cuerpo = null; } }
  const clienteId = cuerpo && String(cuerpo.cliente_id || '').trim();
  const datos = cuerpo && cuerpo.datos;
  if (!clienteId || !datos || typeof datos !== 'object') {
    return res.status(400).json({ error: { message: 'Falta cliente_id o datos.' } });
  }
  const nombre = (cuerpo.nombre != null) ? String(cuerpo.nombre) : null;
  const estado = (cuerpo.estado === 'archivado') ? 'archivado' : 'activo';
  const versionConocida = Number.isInteger(cuerpo.version_conocida) ? cuerpo.version_conocida : null;

  try {
    const r = await rpc('guardar_organismo', {
      p_perfil: perfil,
      p_cliente_id: clienteId,
      p_nombre: nombre,
      p_estado: estado,
      p_datos: datos,
      p_version_conocida: versionConocida,
    }, SB_URL, SERVICE_KEY);

    if (r && r.conflicto) {
      // Alguien (otra pestaña, otro dispositivo) ya guardo una version mas nueva.
      // No se pisa: el cliente decide como conservar ambas o fusionar.
      registrar({ accion: 'conflicto', perfil: perfil.slice(0, 8), cliente_id: clienteId, version_servidor: r.version });
      return res.status(409).json({
        error: { message: 'Hay una version mas nueva guardada. No se sobrescribio.', codigo: 'conflicto_version' },
        version: r.version,
        datos: r.datos,
      });
    }

    registrar({ accion: 'guardado', perfil: perfil.slice(0, 8), cliente_id: clienteId, version: r ? r.version : null });
    return res.status(200).json({ ok: true, id: r.id, version: r.version });

  } catch (e) {
    registrar({ error: 'fallo_guardar', perfil: perfil.slice(0, 8), cliente_id: clienteId, detalle: String((e && e.message) || e) });
    return res.status(503).json({ error: { message: 'No se pudo guardar. Volve a intentar.', codigo: 'servicio_no_disponible' } });
  }
}
