// api/solicitudes.js — Contrato para solicitudes desde la web + atención al usuario interna
// ---------------------------------------------------------------------------------------------
// QUE HACE
//   Punto de entrada para las categorías que el encargo 115 AG pide trazar (bloques 4.3 y 4.6):
//     'arrepentimiento'   — solicitud comercial vinculada a una contratación.
//     'baja_servicio'     — cancelación de renovación/terminación, sin implicar supresión.
//     'supresion_datos'   — derecho de supresión (Ley 25.326 art. 16), con revisión de
//                            excepciones -- nunca se ejecuta sola (Corte O).
//     'consulta'          — soporte comercial general.
//     'reclamo'           — soporte comercial general.
//   'area' se deriva SOLA de 'tipo' (columna generada en la base, Corte Q): arrepentimiento/
//   baja_servicio/supresion_datos → 'privacidad'; consulta/reclamo → 'soporte'. Es la
//   separación LÓGICA que pide el bloque 4.6, sin separar la infraestructura.
//   NO crea, modifica ni sirve el formulario visual -- eso lo construye Javier aparte.
//
// LO QUE ESTE CORTE NO HACE TODAVIA (a propósito, ver CORTE_N_SISTEMA_COMUNICACIONAL.md)
//   No ejecuta ninguna acción de forma automática (cancelar en la pasarela, borrar datos,
//   resolver un reclamo). Cada solicitud queda 'recibido' hasta que una persona la revise.
//
// LIMITE DE FUNCIONES DE VERCEL (Hobby)
//   Función #12 de 12 -- no queda ningún lugar libre (decisión de Javier, 05/08, de seguir
//   consolidando en vez de pasar a Pro). Todo lo nuevo entra ACÁ.
//
// CONTRATO
//   POST /api/solicitudes   (público -- sesión opcional, ver "IDENTIDAD" abajo)
//     body: { tipo, correo, nombre?, proveedor_pago?, identificador_operacion?, pais?,
//             consentimiento?, observaciones?, idempotencia_key? }
//     Todos los campos de texto tienen un largo máximo (LARGO_MAXIMO) y se sanean antes de
//     guardarse (limpiarTexto) -- ver "PROTECCIÓN" abajo.
//     200 → { ok:true, id, estado, ya_existia }   -- y dispara el acuse automático por correo
//                                                     (best-effort, ver "ACUSE Y CONSTANCIA")
//     400 → { error:{ message, codigo:'tipo_invalido'|'correo_requerido' } }
//     429 → { error:{ message, codigo:'limite_excedido' } }   -- ver "PROTECCIÓN"
//
// PROTECCIÓN (Cierre técnico legal, Corte W, bloque 3)
//   - Límite por IP: LIMITE_IP_POR_HORA intentos (cualquier resultado) por hora.
//   - Límite por correo: LIMITE_CORREO_POR_DIA solicitudes NUEVAS aceptadas por día -- evita que
//     alguien mande acuses repetidos al correo de un tercero declarándolo como propio.
//   - CORS explícito: solo responde con Access-Control-Allow-Origin a ORIGENES_PERMITIDOS;
//     maneja el preflight OPTIONS (antes no existía, un formulario en otro dominio no hubiera
//     podido ni completar el preflight).
//   - Cada intento (aceptado, rechazado, bloqueado por límite) queda en
//     solicitudes_legales_intentos -- evidencia de abuso consultable, no solo un log de Vercel.
//   - La respuesta NUNCA distingue si el correo declarado pertenece a una cuenta existente --
//     mismo comportamiento desde el Corte N, confirmado, no es nuevo de este Corte.
//   - Inyección SQL: no es una superficie real acá -- todo pasa por RPC parametrizado
//     (registrar_solicitud_legal), nunca por concatenación de texto en una consulta.
//
//   GET /api/solicitudes?estado=&tipo=&area=&limite=       (interno, X-Staff-Key)
//     200 → { ok:true, solicitudes:[...] }
//   GET /api/solicitudes?vista=metricas&dias_vencimiento=5  (interno, X-Staff-Key)
//     200 → { ok:true, metricas:{ total_recibidas, en_curso, vencidas, resueltas,
//                                  requieren_intervencion, por_area, por_tipo } }
//
//   PATCH /api/solicitudes   { id, estado_nuevo, detalle?, motivo_rechazo?, responsable? }
//     (interno, X-Staff-Key)
//     200 → { ok:true, estado, responsable }   -- dispara constancia final o escalamiento
//                                                  interno según el estado, ver abajo
//     404 → { error:{ message:'Solicitud no encontrada.' } }
//
// IDENTIDAD Y PERTENENCIA (sin exigir cuenta activa) -- sin cambios desde el Corte N: sesión
// si vino, si no, match best-effort por identificador_operacion contra `pagos`. Nunca se
// rechaza el acuse de recepción por esto.
//
// IDEMPOTENCIA -- sin cambios desde el Corte N: idempotencia_key del cliente, o derivada de
// tipo+correo+identificador_operacion+día si no la manda.
//
// ACUSE Y CONSTANCIA (Corte Q, bloque 4.6)
//   Acuse automático: al registrar la solicitud (POST), se manda un correo de acuse al
//   `correo` declarado, con el id de la solicitud -- best-effort, nunca bloquea la respuesta.
//   Constancia final: al pasar a 'ejecutado' o 'rechazado' (PATCH), se manda un correo final
//   al solicitante. Escalamiento: al pasar a 'requiere_intervencion', se manda un aviso
//   INTERNO (no al solicitante) a STAFF_ALERT_EMAIL -- ver la nota de esa variable abajo.
//
// NO SE ALMACENAN DATOS DE TARJETA.
//
// VARIABLES DE ENTORNO
//   SUPABASE_URL · SUPABASE_SECRET_KEY   (ya cargadas)
//   STAFF_API_KEY       (Corte N -- protege GET/PATCH)
//   STAFF_ALERT_EMAIL   (Corte Q, NUEVA -- destino del correo de escalamiento interno; si no
//                         está cargada, se usa contacto@comprenderai.com. En cualquier caso,
//                         ESE correo tiene que estar en comm_closed_recipients para que el
//                         envío no se rechace solo -- mismo mecanismo de consentimiento que
//                         ya protege cualquier otro correo real del sistema, ver lib/comm-emitir.js)

import { emitirYEnviarCorreo } from '../lib/comm-emitir.js';
import { localeDe, biLocale, htmlFirma } from '../lib/i18n-server.js';

const TIPOS = ['arrepentimiento', 'baja_servicio', 'supresion_datos', 'consulta', 'reclamo'];
const ESTADOS = ['recibido', 'en_validacion', 'ejecutado', 'rechazado', 'requiere_intervencion'];
const ESTADOS_TERMINALES = ['ejecutado', 'rechazado'];

// Cierre tecnico legal, Corte W (bloque 3) -- proteccion del endpoint publico.
const ORIGENES_PERMITIDOS = ['https://www.comprenderai.com', 'https://comprenderai.com', 'https://app.comprenderai.com'];
const LIMITE_IP_POR_HORA = 20;      // cualquier intento (valido o no) desde la misma IP
const LIMITE_CORREO_POR_DIA = 5;    // solicitudes NUEVAS aceptadas para el mismo correo -- evita
                                     // que alguien spamee de correos de acuse a un tercero declarando
                                     // repetidamente el correo de otra persona
const LARGO_MAXIMO = {
  correo: 254, nombre: 200, proveedor_pago: 50, identificador_operacion: 200,
  pais: 100, observaciones: 2000, idempotencia_key: 300,
};
const REGEX_CORREO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const registrar = (o) => console.log(JSON.stringify({ evento: 'solicitudes_legales', ...o }));

function obtenerIp(req) {
  const cabecera = String(req.headers['x-forwarded-for'] || '');
  return cabecera.split(',')[0].trim() || 'desconocida';
}

// Saneamiento: saca caracteres de control peligrosos (conserva salto de linea y tab en
// observaciones), recorta espacios, y aplica un largo maximo -- ningun campo tenia limite
// antes de este Corte (hallazgo real: se podia mandar una `observaciones` de tamaño arbitrario).
function limpiarTexto(valor, largoMaximo) {
  if (valor == null) return null;
  const texto = String(valor).replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '').trim();
  return texto ? texto.slice(0, largoMaximo) : null;
}

function aplicarCors(req, res) {
  const origen = String(req.headers['origin'] || '');
  if (ORIGENES_PERMITIDOS.includes(origen)) {
    res.setHeader('Access-Control-Allow-Origin', origen);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'content-type, x-staff-key, authorization, x-comprender-locale');
}

// Best-effort, aislado -- nunca bloquea la respuesta al que hizo el pedido. Es evidencia de
// abuso, no algo que tenga que ser perfecto.
async function registrarIntento(ip, correo, tipo, resultado, SB_URL, SERVICE_KEY) {
  try {
    await fetch(SB_URL + '/rest/v1/solicitudes_legales_intentos', {
      method: 'POST',
      headers: {
        apikey: SERVICE_KEY, Authorization: 'Bearer ' + SERVICE_KEY,
        'content-type': 'application/json', Prefer: 'return=minimal',
      },
      body: JSON.stringify({ ip, correo: correo || null, tipo: tipo || null, resultado }),
    });
  } catch (e) {
    registrar({ aviso: 'fallo registrando intento (no bloquea al usuario)', detalle: String((e && e.message) || e) });
  }
}

async function contarDesde(SB_URL, SERVICE_KEY, filtro) {
  const r = await fetch(SB_URL + '/rest/v1/solicitudes_legales_intentos?' + filtro + '&select=id&limit=1', {
    headers: { apikey: SERVICE_KEY, Authorization: 'Bearer ' + SERVICE_KEY, Prefer: 'count=exact' },
  });
  const rango = r.headers.get('content-range') || '';   // formato "0-0/123"
  const total = Number(rango.split('/')[1]);
  return Number.isFinite(total) ? total : 0;
}

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

const NOMBRES_TIPO = {
  arrepentimiento: { es:'arrepentimiento', en:'withdrawal request' },
  baja_servicio: { es:'baja de servicio', en:'service cancellation' },
  supresion_datos: { es:'supresión de datos', en:'data deletion' },
  consulta: { es:'consulta', en:'inquiry' },
  reclamo: { es:'reclamo', en:'claim' },
};
function nombreTipo(tipo, locale) {
  const n = NOMBRES_TIPO[tipo];
  return n ? (locale === 'en' ? n.en : n.es) : tipo;
}

async function manejarPost(req, res, SB_URL, SERVICE_KEY) {
  const locale = localeDe(req);
  const ip = obtenerIp(req);
  let cuerpo = req.body;
  if (typeof cuerpo === 'string') { try { cuerpo = JSON.parse(cuerpo); } catch (e) { cuerpo = {}; } }
  cuerpo = cuerpo || {};

  const tipo = String(cuerpo.tipo || '').slice(0, 50);
  const correo = limpiarTexto(cuerpo.correo, LARGO_MAXIMO.correo);

  // Limite por IP primero -- corta cualquier flood sin importar que mande el cuerpo, y sin
  // necesidad de haber validado nada mas todavia.
  let intentosIp;
  try {
    intentosIp = await contarDesde(SB_URL, SERVICE_KEY,
      'ip=eq.' + encodeURIComponent(ip) + '&creado=gte.' + encodeURIComponent(new Date(Date.now() - 3600000).toISOString()));
  } catch (e) {
    intentosIp = 0;   // si falla la consulta de limite, no se bloquea al usuario por eso -- ver nota de aislamiento
  }
  if (intentosIp >= LIMITE_IP_POR_HORA) {
    await registrarIntento(ip, correo, tipo, 'rechazada_limite_ip', SB_URL, SERVICE_KEY);
    return res.status(429).json({ error: { message: biLocale(locale, 'Demasiadas solicitudes. Probá de nuevo más tarde.', 'Too many requests. Try again later.'), codigo: 'limite_excedido' } });
  }

  if (!TIPOS.includes(tipo)) {
    await registrarIntento(ip, correo, tipo, 'rechazada_tipo_invalido', SB_URL, SERVICE_KEY);
    return res.status(400).json({ error: { message: biLocale(locale, 'Tipo inválido.', 'Invalid request type.'), codigo: 'tipo_invalido' } });
  }
  if (!correo || !REGEX_CORREO.test(correo)) {
    await registrarIntento(ip, correo, tipo, 'rechazada_correo_invalido', SB_URL, SERVICE_KEY);
    return res.status(400).json({ error: { message: biLocale(locale, 'El correo es obligatorio.', 'Email is required.'), codigo: 'correo_requerido' } });
  }

  // Limite por correo -- solo cuenta solicitudes NUEVAS aceptadas (no reintentos idempotentes
  // repetidos, no las rechazadas), asi un reintento legitimo del mismo usuario no lo penaliza.
  let intentosCorreo;
  try {
    intentosCorreo = await contarDesde(SB_URL, SERVICE_KEY,
      'correo=eq.' + encodeURIComponent(correo) + '&resultado=eq.aceptada_nueva&creado=gte.' + encodeURIComponent(new Date(Date.now() - 86400000).toISOString()));
  } catch (e) {
    intentosCorreo = 0;
  }
  if (intentosCorreo >= LIMITE_CORREO_POR_DIA) {
    await registrarIntento(ip, correo, tipo, 'rechazada_limite_correo', SB_URL, SERVICE_KEY);
    return res.status(429).json({ error: { message: biLocale(locale, 'Demasiadas solicitudes. Probá de nuevo más tarde.', 'Too many requests. Try again later.'), codigo: 'limite_excedido' } });
  }

  const nombre = limpiarTexto(cuerpo.nombre, LARGO_MAXIMO.nombre);
  const proveedorPago = limpiarTexto(cuerpo.proveedor_pago, LARGO_MAXIMO.proveedor_pago);
  const identificadorOperacion = limpiarTexto(cuerpo.identificador_operacion, LARGO_MAXIMO.identificador_operacion);
  const pais = limpiarTexto(cuerpo.pais, LARGO_MAXIMO.pais);
  const observaciones = limpiarTexto(cuerpo.observaciones, LARGO_MAXIMO.observaciones);
  const idempotenciaKeyCliente = limpiarTexto(cuerpo.idempotencia_key, LARGO_MAXIMO.idempotencia_key);
  // consentimiento: objeto JSON libre -- se acepta solo si es realmente un objeto (no array, no
  // string suelto) para no pasarle un tipo inesperado a la columna jsonb.
  const consentimiento = (cuerpo.consentimiento && typeof cuerpo.consentimiento === 'object' && !Array.isArray(cuerpo.consentimiento))
    ? cuerpo.consentimiento : null;

  let perfil = null;
  const cabeceraAuth = String(req.headers['authorization'] || '');
  const token = cabeceraAuth.toLowerCase().startsWith('bearer ') ? cabeceraAuth.slice(7).trim() : '';
  try {
    if (token) {
      const u = await resolverPerfilPorSesion(SB_URL, SERVICE_KEY, token);
      if (u) perfil = u.id;
    }
    if (!perfil && identificadorOperacion) {
      perfil = await resolverPerfilPorOperacion(SB_URL, SERVICE_KEY, identificadorOperacion, correo);
    }
  } catch (e) {
    registrar({ aviso: 'no se pudo resolver perfil, se acepta igual sin asociar', detalle: String((e && e.message) || e) });
  }

  const idempotenciaKey = idempotenciaKeyCliente || idempotenciaPorDefecto(tipo, correo, identificadorOperacion);

  let resultado;
  try {
    resultado = await rpc('registrar_solicitud_legal', {
      p_tipo: tipo, p_idempotencia_key: idempotenciaKey, p_correo: correo,
      p_nombre: nombre, p_proveedor_pago: proveedorPago,
      p_identificador_operacion: identificadorOperacion, p_pais: pais,
      p_consentimiento: consentimiento, p_observaciones: observaciones,
      p_perfil: perfil,
    }, SB_URL, SERVICE_KEY);
  } catch (e) {
    await registrarIntento(ip, correo, tipo, 'rechazada_error_interno', SB_URL, SERVICE_KEY);
    registrar({ error: 'FALLO REGISTRANDO SOLICITUD', detalle: String((e && e.message) || e) });
    return res.status(502).json({ error: { message: biLocale(locale, 'No se pudo registrar la solicitud. Volvé a intentar.', 'The request could not be registered. Try again.') } });
  }

  await registrarIntento(ip, correo, tipo, resultado && resultado.ya_existia ? 'aceptada_repetida' : 'aceptada_nueva', SB_URL, SERVICE_KEY);

  registrar({ accion: resultado && resultado.ya_existia ? 'repetida' : 'recibida', tipo, id: resultado && resultado.id, perfil_asociado: !!perfil });

  // Acuse automático -- best-effort, aislado (emitirYEnviarCorreo nunca lanza). No repetir el
  // acuse en un reintento idempotente (ya_existia=true): ya se mandó la primera vez.
  if (resultado && resultado.id && !resultado.ya_existia) {
    try {
      await emitirYEnviarCorreo({
        SB_URL, SERVICE_KEY, organizationId: perfil || resultado.id, purposeId: 'solicitud_acuse_recepcion',
        type: 'solicitud.acuse', producer: 'solicitudes_legales',
        payload: { tipo, solicitud_id: resultado.id, locale },
        destinatario: correo,
        asunto: biLocale(locale, 'Recibimos tu solicitud de ' + nombreTipo(tipo, locale), 'We received your ' + nombreTipo(tipo, locale)),
        contenidoHtml: biLocale(locale,
          '<p>Hola,</p><p>Recibimos tu solicitud de <strong>' + nombreTipo(tipo, locale) + '</strong>. Tu número de referencia es <strong>' + resultado.id + '</strong>.</p><p>La vamos a revisar y te vamos a confirmar el resultado por este mismo medio.</p>',
          '<p>Hello,</p><p>We received your <strong>' + nombreTipo(tipo, locale) + '</strong>. Your reference number is <strong>' + resultado.id + '</strong>.</p><p>We will review it and confirm the outcome through this same channel.</p>'
        ) + htmlFirma(locale),
      });
    } catch (e) {
      registrar({ aviso: 'fallo enviando acuse automatico', id: resultado.id, detalle: String((e && e.message) || e) });
    }
  }

  return res.status(200).json({ ok: true, id: resultado && resultado.id, estado: resultado && resultado.estado, ya_existia: !!(resultado && resultado.ya_existia) });
}

async function manejarGet(req, res, SB_URL, SERVICE_KEY) {
  const { estado, tipo, area, limite, vista, dias_vencimiento } = req.query || {};

  if (String(vista || '') === 'metricas') {
    try {
      const dias = Math.max(1, Number(dias_vencimiento) || 5);
      const m = await rpc('solicitudes_metricas', { p_dias_vencimiento: dias }, SB_URL, SERVICE_KEY);
      return res.status(200).json({ ok: true, metricas: m });
    } catch (e) {
      registrar({ error: 'FALLO METRICAS', detalle: String((e && e.message) || e) });
      return res.status(502).json({ error: { message: 'No se pudieron calcular las métricas.' } });
    }
  }

  let filtro = '?order=creado.desc&limit=' + (Math.min(Number(limite) || 50, 200));
  if (estado && ESTADOS.includes(String(estado))) filtro += '&estado=eq.' + encodeURIComponent(String(estado));
  if (tipo && TIPOS.includes(String(tipo))) filtro += '&tipo=eq.' + encodeURIComponent(String(tipo));
  if (area && ['privacidad', 'soporte'].includes(String(area))) filtro += '&area=eq.' + encodeURIComponent(String(area));

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

  let r;
  try {
    r = await rpc('actualizar_estado_solicitud', {
      p_id: id, p_estado_nuevo: estadoNuevo,
      p_detalle: cuerpo.detalle || null, p_motivo_rechazo: cuerpo.motivo_rechazo || null,
      p_responsable: cuerpo.responsable || null,
    }, SB_URL, SERVICE_KEY);
  } catch (e) {
    registrar({ error: 'FALLO ACTUALIZANDO ESTADO', detalle: String((e && e.message) || e) });
    return res.status(502).json({ error: { message: 'No se pudo actualizar la solicitud.' } });
  }
  if (!r || !r.ok) {
    return res.status(404).json({ error: { message: 'Solicitud no encontrada.' } });
  }
  registrar({ accion: 'estado_actualizado', id, estado: estadoNuevo, responsable: r.responsable });

  // Constancia final al solicitante (best-effort) -- solo en estados terminales.
  if (ESTADOS_TERMINALES.includes(estadoNuevo) && r.correo) {
    try {
      const esEjecutado = estadoNuevo === 'ejecutado';
      await emitirYEnviarCorreo({
        SB_URL, SERVICE_KEY, organizationId: id, purposeId: 'solicitud_constancia_final',
        type: 'solicitud.constancia', producer: 'solicitudes_legales',
        payload: { solicitud_id: id, estado: estadoNuevo },
        destinatario: r.correo,
        asunto: esEjecutado ? 'Tu solicitud fue resuelta' : 'Novedades sobre tu solicitud',
        contenidoHtml:
          '<p>Hola,</p>' +
          '<p>Tu solicitud <strong>' + id + '</strong> (' + (NOMBRES_TIPO[r.tipo] || r.tipo) + ') ' +
          (esEjecutado ? 'fue procesada.' : 'no pudo procesarse tal como se pidió.') + '</p>' +
          '<p style="color:#888;font-size:12px">Comprender AI<br>Producto de ARQUIGÉNESIS</p>',
      });
    } catch (e) {
      registrar({ aviso: 'fallo enviando constancia final', id, detalle: String((e && e.message) || e) });
    }
  }

  // Escalamiento interno (best-effort) -- correo a STAFF, no al solicitante.
  if (estadoNuevo === 'requiere_intervencion') {
    try {
      const destinoStaff = process.env.STAFF_ALERT_EMAIL || 'contacto@comprenderai.com';
      await emitirYEnviarCorreo({
        SB_URL, SERVICE_KEY, organizationId: id, purposeId: 'solicitud_escalamiento_interno',
        type: 'solicitud.escalamiento', producer: 'solicitudes_legales',
        payload: { solicitud_id: id, tipo: r.tipo },
        destinatario: destinoStaff, asunto: 'Solicitud requiere intervención: ' + id,
        contenidoHtml:
          '<p>La solicitud <strong>' + id + '</strong> (' + (NOMBRES_TIPO[r.tipo] || r.tipo) + ') quedó marcada como que requiere intervención manual.</p>' +
          '<p>Consultá <code>GET /api/solicitudes?estado=requiere_intervencion</code> para verla completa.</p>',
      });
    } catch (e) {
      registrar({ aviso: 'fallo enviando escalamiento interno', id, detalle: String((e && e.message) || e) });
    }
  }

  return res.status(200).json({ ok: true, estado: r.estado, responsable: r.responsable });
}

export default async function handler(req, res) {
  const locale = localeDe(req);
  // Cierre tecnico legal, Corte W (bloque 3): CORS explicito + preflight. Antes no habia nada
  // -- un formulario publico en un dominio distinto (por ejemplo, la web de Framer) ni siquiera
  // hubiera podido completar el preflight OPTIONS que manda el navegador antes de un POST con
  // JSON. Solo se refleja el origen si esta en la lista permitida -- ver ORIGENES_PERMITIDOS.
  aplicarCors(req, res);
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  const SB_URL = String(process.env.SUPABASE_URL || '').replace(/\/+$/, '');
  const SERVICE_KEY = process.env.SUPABASE_SECRET_KEY;
  if (!SB_URL || !SERVICE_KEY) {
    return res.status(500).json({ error: { message: biLocale(locale, 'Falta configuracion en el servidor.', 'Server configuration is incomplete.') } });
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
      return res.status(401).json({ error: { message: biLocale(locale, 'No autorizado.', 'Unauthorized.') } });
    }
    if (req.method === 'GET') return manejarGet(req, res, SB_URL, SERVICE_KEY);
    return manejarPatch(req, res, SB_URL, SERVICE_KEY);
  }

  res.setHeader('Allow', 'POST, GET, PATCH, OPTIONS');
  return res.status(405).json({ error: { message: biLocale(locale, 'Metodo no permitido.', 'Method not allowed.') } });
}
