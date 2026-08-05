// api/solicitudes.js — Contrato técnico para solicitudes originadas en la web pública (Corte N)
// ---------------------------------------------------------------------------------------------
// QUE HACE
//   Punto de entrada interno para dos tipos de solicitud independientes, definidos en el
//   bloque 4.3 del encargo 115 AG:
//     'arrepentimiento'  — solicitud comercial vinculada a una contratación.
//     'baja_servicio'    — cancelación de renovación/terminación, SIN implicar por sí misma
//                           supresión de datos personales (ver bloque 4.4 para esa distinción).
//   NO crea, modifica ni sirve el formulario visual -- eso lo construye Javier aparte, en la
//   web pública (fuera de este software, decisión suya explícita). Este archivo es el
//   contrato que ese formulario puede llamar.
//
// LO QUE ESTE CORTE NO HACE TODAVIA (a propósito, ver CORTE_N_SISTEMA_COMUNICACIONAL.md)
//   No ejecuta la cancelación en la pasarela ni dispara ninguna eliminación de datos de forma
//   automática. Cada solicitud queda 'recibido' -- con el proveedor de pago identificado si se
//   pudo, para que la ejecución real (manual por ahora) sepa a dónde ir. Automatizar la
//   ejecución es una decisión de producto aparte (¿qué pasa si se ejecuta una cancelación por
//   error, sobre una identidad mal validada?), no algo para decidir en silencio acá.
//
// LIMITE DE FUNCIONES DE VERCEL (Hobby)
//   Esta es la función #12 de 12 -- el tope del plan Hobby (decisión de Javier, 05/08, de
//   seguir consolidando en vez de pasar a Pro). No queda ningún lugar libre: todo lo que el
//   bloque 4.6 (atención al usuario) necesite tiene que entrar ACÁ, como una acción/método
//   más de este mismo archivo, no como un archivo nuevo.
//
// CONTRATO
//   POST /api/solicitudes   (público -- sesión opcional, ver "IDENTIDAD" abajo)
//     body: {
//       tipo: 'arrepentimiento' | 'baja_servicio',   // requerido
//       correo: string,                               // requerido
//       nombre?: string,
//       proveedor_pago?: 'mercadopago' | 'lemonsqueezy',
//       identificador_operacion?: string,              // orden o suscripción, si existe
//       pais?: string,
//       consentimiento?: object,                        // declaración asociada (texto aceptado, etc.)
//       observaciones?: string,
//       idempotencia_key?: string                       // opcional -- ver "IDEMPOTENCIA"
//     }
//     200 → { ok:true, id, estado, ya_existia }          // acuse de recepción
//     400 → { error:{ message, codigo:'tipo_invalido'|'correo_requerido' } }
//     500/502 → { error:{ message } }
//
//   GET /api/solicitudes?estado=recibido&tipo=arrepentimiento&limite=50
//     Header: X-Staff-Key: <STAFF_API_KEY>                // uso interno, no público
//     200 → { ok:true, solicitudes:[...] }
//     401 → { error:{ message:'No autorizado.' } }
//
//   PATCH /api/solicitudes   { id, estado_nuevo, detalle?, motivo_rechazo? }
//     Header: X-Staff-Key: <STAFF_API_KEY>                // uso interno, no público
//     200 → { ok:true, estado }
//     404 → { error:{ message:'Solicitud no encontrada.' } }
//
// IDENTIDAD Y PERTENENCIA (sin exigir cuenta activa)
//   Si llega Authorization: Bearer <token> válido, se resuelve el perfil por sesión (más
//   fuerte) y se asocia directo. Si NO llega sesión (circuito público sin login, esperado para
//   una persona que quiere darse de baja sin entrar a la cuenta), se intenta un match best-
//   effort: si vino identificador_operacion, se busca en `pagos` y se compara el correo del
//   perfil dueño de ese pago contra el correo declarado. Si no matchea o no hay
//   identificador_operacion, la solicitud igual se acepta (nunca se rechaza en el intake por
//   esto) pero queda sin `perfil` asociado -- la validación real la hace una persona, no este
//   endpoint. Esto es a propósito: negarle el acuse de recepción a alguien porque su operación
//   no matcheó automático sería peor que dejarlo para revisión manual.
//
// IDEMPOTENCIA
//   Si el cliente manda idempotencia_key, se usa tal cual (recomendado: que la web pública
//   genere un uuid propio en el momento del submit, y lo reuse si reintenta por un timeout).
//   Si no la manda, se deriva de tipo+correo+identificador_operacion+día (UTC) -- dos envíos
//   del mismo tipo, mismo correo y mismo día colapsan en la misma solicitud en vez de crear
//   duplicados por un doble click o un reintento de red.
//
// NO SE ALMACENAN DATOS DE TARJETA -- ningún campo de este contrato los admite; si llegaran
// en observaciones/consentimiento por error del formulario, quedarían igual (este endpoint no
// los busca ni los filtra) -- responsabilidad del formulario público no incluirlos, señalado
// en CORTE_N_SISTEMA_COMUNICACIONAL.md como límite conocido.
//
// VARIABLES DE ENTORNO
//   SUPABASE_URL · SUPABASE_SECRET_KEY   (ya cargadas)
//   STAFF_API_KEY                         (NUEVA -- Javier tiene que cargarla en Vercel;
//                                          sin ella, GET/PATCH devuelven 401 siempre)

// 'supresion_datos' agregado en el bloque 4.4 del encargo (Corte O, 05/08): a diferencia de
// 'eliminar cuenta' (api/cuenta.js, automatica a los 7 dias), un pedido de supresion de datos
// (Ley 25.326 art. 16) puede tener excepciones/obligaciones de conservacion que hace falta
// analizar ANTES de ejecutar nada -- por eso entra por esta cola en vez del flujo automatico.
const TIPOS = ['arrepentimiento', 'baja_servicio', 'supresion_datos'];
const ESTADOS = ['recibido', 'en_validacion', 'ejecutado', 'rechazado', 'requiere_intervencion'];

const registrar = (o) => console.log(JSON.stringify({ evento: 'solicitudes_legales', ...o }));

async function rpc(nombre, cuerpo, SB_URL, SERVICE_KEY) {
  const r = await fetch(SB_URL + '/rest/v1/rpc/' + nombre, {
    method: 'POST',
    headers: { apikey: SERVICE_KEY, Authorization: 'Bearer ' + SERVICE_KEY, 'content-type': 'application/json' },
    body: JSON.stringify(cuerpo),
  });
  if (!r.ok) throw new Error('rpc ' + nombre + ' devolvio ' + r.status + ' ' + (await r.text()).slice(0, 200));
  const d = await r.json();
  return Array.isArray(d) ? d[0] : d;
}

async function resolverPerfilPorSesion(SB_URL, SERVICE_KEY, token) {
  const r = await fetch(SB_URL + '/auth/v1/user', {
    headers: { apikey: SERVICE_KEY, Authorization: 'Bearer ' + token },
  });
  if (!r.ok) return null;
  const d = await r.json().catch(() => null);
  return d && d.id ? { id: d.id, correo: (d.email || '').toLowerCase() } : null;
}

// Best-effort: matchea identificador_operacion (suscripcion o pago_externo) contra `pagos`,
// y compara el correo del perfil dueño contra el correo declarado -- ver nota "IDENTIDAD".
async function resolverPerfilPorOperacion(SB_URL, SERVICE_KEY, identificadorOperacion, correoDeclarado) {
  if (!identificadorOperacion) return null;
  const filtro = 'or=(suscripcion.eq.' + encodeURIComponent(identificadorOperacion) +
    ',pago_externo.eq.' + encodeURIComponent(identificadorOperacion) + ')';
  const r = await fetch(SB_URL + '/rest/v1/pagos?' + filtro + '&select=perfil&order=momento.desc&limit=1', {
    headers: { apikey: SERVICE_KEY, Authorization: 'Bearer ' + SERVICE_KEY },
  });
  const filas = r.ok ? await r.json().catch(() => []) : [];
  const perfilId = filas && filas[0] && filas[0].perfil;
  if (!perfilId) return null;

  const rUsuario = await fetch(SB_URL + '/auth/v1/admin/users/' + perfilId, {
    headers: { apikey: SERVICE_KEY, Authorization: 'Bearer ' + SERVICE_KEY },
  });
  const usuario = rUsuario.ok ? await rUsuario.json().catch(() => null) : null;
  const correoReal = usuario && usuario.email ? String(usuario.email).toLowerCase() : null;
  if (!correoReal || correoReal !== String(correoDeclarado || '').toLowerCase()) return null;
  return perfilId;
}

function idempotenciaPorDefecto(tipo, correo, identificadorOperacion) {
  const dia = new Date().toISOString().slice(0, 10);
  return [tipo, String(correo || '').toLowerCase().trim(), identificadorOperacion || '', dia].join('|');
}

async function manejarPost(req, res, SB_URL, SERVICE_KEY) {
  let cuerpo = req.body;
  if (typeof cuerpo === 'string') { try { cuerpo = JSON.parse(cuerpo); } catch (e) { cuerpo = {}; } }
  cuerpo = cuerpo || {};

  const tipo = String(cuerpo.tipo || '');
  if (!TIPOS.includes(tipo)) {
    return res.status(400).json({ error: { message: 'Tipo inválido. Usá arrepentimiento o baja_servicio.', codigo: 'tipo_invalido' } });
  }
  const correo = String(cuerpo.correo || '').trim();
  if (!correo) {
    return res.status(400).json({ error: { message: 'El correo es obligatorio.', codigo: 'correo_requerido' } });
  }

  // Identidad: sesión si vino, si no, best-effort por identificador_operacion (ver cabecera).
  let perfil = null;
  const cabeceraAuth = String(req.headers['authorization'] || '');
  const token = cabeceraAuth.toLowerCase().startsWith('bearer ') ? cabeceraAuth.slice(7).trim() : '';
  try {
    if (token) {
      const u = await resolverPerfilPorSesion(SB_URL, SERVICE_KEY, token);
      if (u) perfil = u.id;
    }
    if (!perfil && cuerpo.identificador_operacion) {
      perfil = await resolverPerfilPorOperacion(SB_URL, SERVICE_KEY, String(cuerpo.identificador_operacion), correo);
    }
  } catch (e) {
    registrar({ aviso: 'no se pudo resolver perfil, se acepta igual sin asociar', detalle: String((e && e.message) || e) });
  }

  const idempotenciaKey = String(cuerpo.idempotencia_key || '').trim() ||
    idempotenciaPorDefecto(tipo, correo, cuerpo.identificador_operacion);

  try {
    const r = await rpc('registrar_solicitud_legal', {
      p_tipo: tipo, p_idempotencia_key: idempotenciaKey, p_correo: correo,
      p_nombre: cuerpo.nombre || null, p_proveedor_pago: cuerpo.proveedor_pago || null,
      p_identificador_operacion: cuerpo.identificador_operacion || null, p_pais: cuerpo.pais || null,
      p_consentimiento: cuerpo.consentimiento || null, p_observaciones: cuerpo.observaciones || null,
      p_perfil: perfil,
    }, SB_URL, SERVICE_KEY);

    registrar({ accion: r && r.ya_existia ? 'repetida' : 'recibida', tipo, id: r && r.id, perfil_asociado: !!perfil });
    return res.status(200).json({ ok: true, id: r && r.id, estado: r && r.estado, ya_existia: !!(r && r.ya_existia) });
  } catch (e) {
    registrar({ error: 'FALLO REGISTRANDO SOLICITUD', detalle: String((e && e.message) || e) });
    return res.status(502).json({ error: { message: 'No se pudo registrar la solicitud. Volvé a intentar.' } });
  }
}

async function manejarGet(req, res, SB_URL, SERVICE_KEY) {
  const { estado, tipo, limite } = req.query || {};
  let filtro = '?order=creado.desc&limit=' + (Math.min(Number(limite) || 50, 200));
  if (estado && ESTADOS.includes(String(estado))) filtro += '&estado=eq.' + encodeURIComponent(String(estado));
  if (tipo && TIPOS.includes(String(tipo))) filtro += '&tipo=eq.' + encodeURIComponent(String(tipo));

  try {
    const r = await fetch(SB_URL + '/rest/v1/solicitudes_legales' + filtro, {
      headers: { apikey: SERVICE_KEY, Authorization: 'Bearer ' + SERVICE_KEY },
    });
    if (!r.ok) throw new Error('listar solicitudes devolvio ' + r.status);
    const solicitudes = await r.json();
    return res.status(200).json({ ok: true, solicitudes });
  } catch (e) {
    registrar({ error: 'FALLO LISTANDO', detalle: String((e && e.message) || e) });
    return res.status(502).json({ error: { message: 'No se pudo listar las solicitudes.' } });
  }
}

async function manejarPatch(req, res, SB_URL, SERVICE_KEY) {
  let cuerpo = req.body;
  if (typeof cuerpo === 'string') { try { cuerpo = JSON.parse(cuerpo); } catch (e) { cuerpo = {}; } }
  cuerpo = cuerpo || {};

  const id = String(cuerpo.id || '');
  const estadoNuevo = String(cuerpo.estado_nuevo || '');
  if (!id || !ESTADOS.includes(estadoNuevo)) {
    return res.status(400).json({ error: { message: 'id y estado_nuevo válido son obligatorios.' } });
  }

  try {
    const r = await rpc('actualizar_estado_solicitud', {
      p_id: id, p_estado_nuevo: estadoNuevo,
      p_detalle: cuerpo.detalle || null, p_motivo_rechazo: cuerpo.motivo_rechazo || null,
    }, SB_URL, SERVICE_KEY);
    if (!r || !r.ok) {
      return res.status(404).json({ error: { message: 'Solicitud no encontrada.' } });
    }
    registrar({ accion: 'estado_actualizado', id, estado: estadoNuevo });
    return res.status(200).json({ ok: true, estado: r.estado });
  } catch (e) {
    registrar({ error: 'FALLO ACTUALIZANDO ESTADO', detalle: String((e && e.message) || e) });
    return res.status(502).json({ error: { message: 'No se pudo actualizar la solicitud.' } });
  }
}

export default async function handler(req, res) {
  const SB_URL = String(process.env.SUPABASE_URL || '').replace(/\/+$/, '');
  const SERVICE_KEY = process.env.SUPABASE_SECRET_KEY;
  if (!SB_URL || !SERVICE_KEY) {
    return res.status(500).json({ error: { message: 'Falta configuracion en el servidor.' } });
  }

  if (req.method === 'POST') {
    return manejarPost(req, res, SB_URL, SERVICE_KEY);
  }

  // GET y PATCH son de uso interno (staff), no del formulario público -- protegidos por una
  // clave separada, no por sesión de usuario (quien las use no necesariamente tiene cuenta).
  if (req.method === 'GET' || req.method === 'PATCH') {
    const claveStaff = process.env.STAFF_API_KEY;
    const recibida = String(req.headers['x-staff-key'] || '');
    if (!claveStaff || recibida !== claveStaff) {
      return res.status(401).json({ error: { message: 'No autorizado.' } });
    }
    if (req.method === 'GET') return manejarGet(req, res, SB_URL, SERVICE_KEY);
    return manejarPatch(req, res, SB_URL, SERVICE_KEY);
  }

  res.setHeader('Allow', 'POST, GET, PATCH');
  return res.status(405).json({ error: { message: 'Metodo no permitido.' } });
}
