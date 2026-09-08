// api/organismos.js — Persistencia de organismos ligada a la cuenta (Corte 0.5)
// ---------------------------------------------------------------------------------------------
// QUE HACE
//   GET    → lista los organismos del usuario en sesion (activos y archivados).
//   POST   → guarda uno (crea si es nuevo, actualiza si ya existe) usando cliente_id para
//            reconocerlo sin duplicar. Si alguien mas ya guardo una version mas nueva,
//            NO la pisa: devuelve conflicto:true con la version real del servidor.
//            122.30: el POST tambien acepta un campo `operacion` opcional (ver mas abajo,
//            "Operaciones epistemologicas · 122.30") -- sin `operacion` o con
//            `operacion:'guardar_organismo'`, este flujo historico sigue exactamente igual.
//   DELETE → borra un organismo puntual (?cliente_id=...) de verdad, del lado del servidor.
//            Corte K (05/08): antes de esto, "eliminar organismo" en index.html solo borraba
//            de localStorage -- el organismo seguia existiendo en Supabase para siempre. Eso
//            le mentia al usuario sobre lo que acababa de pasar (ver Resolucion de Criterio
//            Legal, punto 3). Este metodo cierra ese hueco: el DELETE esta acotado al perfil
//            de la sesion (WHERE perfil=eq.<perfil> AND cliente_id=eq.<id>), nunca a un id
//            suelto -- nadie puede borrar el organismo de otra cuenta con esto.
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
//   122.30 agrega una EXCEPCION explicita, acotada y versionada a esta opacidad (§7.1 del
//   contrato 122.30): las dos operaciones epistemologicas nuevas son las UNICAS que leen,
//   modifican y reescriben -- por clonacion completa del blob, nunca merge parcial (la RPC
//   no lo ofrece) -- los subarboles conocidos `datos.registro_epistemico` y `datos.momentos`.
//   El guardado generico (`guardar_organismo` sin operacion, arriba) sigue tratando `datos`
//   como blob opaco de punta a punta, exactamente como siempre.
//
// FALLA CERRADO
//   Igual que api/anthropic.js: si Supabase no responde, se devuelve 503, no se inventa una
//   respuesta de exito. El cliente decide como avisar y reintentar.
//
// VARIABLES DE ENTORNO
//   SUPABASE_URL / SUPABASE_SECRET_KEY   (ya cargadas, las usan los demas api/*.js)
//
// ---------------------------------------------------------------------------------------------
// OPERACIONES EPISTEMOLOGICAS · 122.30 (contrato CONTRATO_122.30_INTEGRACION_EPISTEMICA_CONGELADO_v3.md)
//
//   El body del POST se sigue parseando una sola vez (como siempre). El despacho por
//   `operacion` ocurre ANTES del validador historico que exige `cliente_id`+`datos` (§7.2):
//     - `operacion` ausente o `'guardar_organismo'` → flujo historico, sin cambios.
//     - `operacion: 'create_epistemic_candidate'`   → crea un registro epistemologico V1
//       preliminar a partir de una propuesta ya elegible (§7.3).
//     - `operacion: 'resolve_epistemic_review'`     → aplica la decision humana (aceptar
//       como referencia / no incorporar) sobre un registro existente (§7.4).
//     - cualquier otro valor                        → 400 { codigo:'operacion_no_permitida' }.
//
//   Ninguna de las dos operaciones nuevas acepta `perfil` ni `actorId` desde el body: el
//   actor siempre se deriva de `identificar()` (el mismo token Bearer que ya autentica todo
//   este handler), igual que el flujo historico.
//
//   El motor real (append-only, idempotente, con historia inmutable de revisiones) vive en
//   lib/epistemic-ledger.mjs; la traduccion propuesta→resultado y resultado→presentacion vive
//   en lib/epistemic-production-adapter.mjs. Este archivo no reimplementa esa logica: la
//   importa y la ejecuta de verdad, igual que ya hace con las funciones de i18n-server.js.

import { randomUUID } from 'node:crypto';
import { emitirYNotificar } from '../lib/comm-emitir.js';
import { localeDe, biLocale } from '../lib/i18n-server.js';
import {
  emptyStore, normalizeStore, appendResult, resolveReviewOutcome, clone,
} from '../lib/epistemic-ledger.mjs';
import {
  isEpistemicCandidate, proposalToEpistemicResult, changeTypesFromProposal, buildPresentation,
} from '../lib/epistemic-production-adapter.mjs';

const registrar = (o) => console.log(JSON.stringify({ evento: 'organismos', ...o }));

// --- 122.30 · constantes compartidas de las operaciones epistemologicas ---
const OPERACIONES_PERMITIDAS = ['guardar_organismo', 'create_epistemic_candidate', 'resolve_epistemic_review'];
const ACCIONES_REVISION_PERMITIDAS = ['accept_as_reference', 'reject'];
// Mismo limite que RECORRIDO_MAX en index.html (var RECORRIDO_MAX = 400). Declarado tambien
// acá, con el mismo nombre y valor, para que una prueba de contrato (vr1-dev-suite) pueda
// detectar si alguno de los dos diverge silenciosamente en el futuro (§12 del contrato).
const RECORRIDO_MAX = 400;
// Mismo codigo que TIPO_MOMENTO.revision_epistemica en index.html -- unica fuente de verdad
// del identificador, no del texto (el texto humano se arma acá, vía biLocale()).
const TIPO_MOMENTO_REVISION_EPISTEMICA = 'revision_epistemica';

const MAX_VISIBLE_TEXT_LEN = 4000;
const MAX_PROPOSAL_JSON_LEN = 20000;
const MAX_IDEMPOTENCY_KEY_LEN = 200;
// TURN-<uuid v4 minuscula> (crypto.randomUUID()) o TURN-<fallback certificado de index.html:
// Date.now().toString(36) + '-' + Math.random().toString(36).slice(2), mismo alfabeto que
// registrarSenalVital() ya usa para su propio fallback -- no se introduce uno nuevo (§6.2)>.
const TURN_REF_RE = /^TURN-[0-9a-z-]{6,60}$/;
// ER-<uuid v4 EN MAYUSCULAS> -- formato que el propio servidor genera siempre (§6.1). Nunca
// se confia en un recordRef con otra forma: se usa sólo como criterio de forma antes de
// buscarlo de verdad dentro del ledger del organismo.
const RECORD_REF_RE = /^ER-[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/;

function isPlainObject(v) {
  return v != null && typeof v === 'object' && !Array.isArray(v);
}

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

// 122.30 · leerFila(): unica lectura puntual de una fila por (perfil, cliente_id), usada por
// las dos operaciones epistemologicas nuevas para el patron "leer fila actual → verificar
// perfil y version → clonar datos → modificar subarbol permitido → guardar blob completo"
// (§7.1). El flujo historico de guardar_organismo no la necesita: sigue confiando
// exclusivamente en el control de concurrencia optimista que ya hace la propia RPC.
async function leerFila(perfil, clienteId, SB_URL, SERVICE_KEY) {
  const ruta = '/rest/v1/organismos?perfil=eq.' + perfil + '&cliente_id=eq.' + encodeURIComponent(clienteId) +
    '&select=id,nombre,estado,datos,version&limit=1';
  const r = await fetch(SB_URL + ruta, {
    headers: { apikey: SERVICE_KEY, Authorization: 'Bearer ' + SERVICE_KEY },
  });
  if (!r.ok) throw new Error('leer_fila devolvio ' + r.status);
  const filas = await r.json();
  return Array.isArray(filas) && filas.length ? filas[0] : null;
}

function errorPayloadInvalido(locale) {
  return { error: { message: biLocale(locale, 'Solicitud inválida.', 'Invalid request.', 'Solicitação inválida.'), codigo: 'payload_invalido' } };
}
function errorConflictoVersion(locale, version) {
  return { error: { message: biLocale(locale, 'Hay una version mas nueva guardada. No se sobrescribio.', 'A newer version is already saved. It was not overwritten.', 'Já existe uma versão mais nova salva. Não foi sobrescrita.'), codigo: 'conflicto_version' }, version };
}
function errorOrganismoNoEncontrado(locale) {
  return { error: { message: biLocale(locale, 'Organismo no encontrado.', 'Organism not found.', 'Organismo não encontrado.'), codigo: 'organismo_no_encontrado' } };
}
function errorServicioNoDisponible(locale) {
  return { error: { message: biLocale(locale, 'El servicio no esta disponible. Volve a intentar.', 'The service is unavailable. Try again.', 'O serviço não está disponível. Tente novamente.'), codigo: 'servicio_no_disponible' } };
}

// --- 122.30 · create_epistemic_candidate (§7.3) ---
async function manejarCrearCandidatoEpistemico({ cuerpo, perfil, locale, SB_URL, SERVICE_KEY, res }) {
  const CLAVES_PERMITIDAS = ['operacion', 'cliente_id', 'version_conocida', 'turnRef', 'eventRef', 'idempotency_key', 'candidate'];
  const claveDesconocida = Object.keys(cuerpo || {}).some((k) => !CLAVES_PERMITIDAS.includes(k));
  if (claveDesconocida) return res.status(400).json(errorPayloadInvalido(locale));

  const clienteId = String((cuerpo && cuerpo.cliente_id) || '').trim();
  const versionConocida = Number.isInteger(cuerpo && cuerpo.version_conocida) ? cuerpo.version_conocida : null;
  const turnRef = typeof (cuerpo && cuerpo.turnRef) === 'string' ? cuerpo.turnRef : '';
  const eventRefIn = isPlainObject(cuerpo && cuerpo.eventRef) ? cuerpo.eventRef : null;
  const idempotencyKey = typeof (cuerpo && cuerpo.idempotency_key) === 'string' ? cuerpo.idempotency_key.trim() : '';
  const candidate = isPlainObject(cuerpo && cuerpo.candidate) ? cuerpo.candidate : null;
  const proposal = candidate && isPlainObject(candidate.proposal) ? candidate.proposal : null;
  const visibleText = candidate && typeof candidate.visibleText === 'string' ? candidate.visibleText : '';

  // paso 4 (parcial) · límites de tamaño, allowlist de forma (§14)
  if (!clienteId || versionConocida === null || !TURN_REF_RE.test(turnRef) || !eventRefIn ||
      !idempotencyKey || idempotencyKey.length > MAX_IDEMPOTENCY_KEY_LEN || !proposal ||
      typeof proposal.id !== 'string' || !proposal.id ||
      visibleText.length > MAX_VISIBLE_TEXT_LEN || JSON.stringify(proposal).length > MAX_PROPOSAL_JSON_LEN) {
    return res.status(400).json(errorPayloadInvalido(locale));
  }

  // paso 4 · política V1: la propuesta debe ser elegible según la misma política determinista
  // que ya evalúa el cliente antes de pedir la creación (isEpistemicCandidate es la MISMA
  // función para ambos lados -- el servidor nunca confía ciegamente en el cliente).
  if (!isEpistemicCandidate({ proposal })) {
    return res.status(400).json({ error: { message: biLocale(locale, 'La propuesta no es un candidato epistemológico elegible.', 'The proposal is not an eligible epistemic candidate.', 'A proposta não é um candidato epistêmico elegível.'), codigo: 'candidato_no_elegible' } });
  }

  // paso 5 · consistencia INTERNA del payload -- nunca contraste contra un proposal server-side
  // previo: ag_core_propuestas es exclusivamente almacenamiento local (§7.3).
  if (eventRefIn.type !== 'proposal' || eventRefIn.id !== proposal.id || proposal.organismo_id !== clienteId) {
    return res.status(400).json({ error: { message: biLocale(locale, 'Referencia de evento inconsistente.', 'Inconsistent event reference.', 'Referência de evento inconsistente.'), codigo: 'event_ref_invalido' } });
  }

  // pasos 1-3 · autenticación (ya resuelta arriba, `perfil`), organismo y versión
  let fila;
  try {
    fila = await leerFila(perfil, clienteId, SB_URL, SERVICE_KEY);
  } catch (e) {
    registrar({ error: 'fallo_leer_organismo', perfil: perfil.slice(0, 8), detalle: String((e && e.message) || e) });
    return res.status(503).json(errorServicioNoDisponible(locale));
  }
  if (!fila) return res.status(404).json(errorOrganismoNoEncontrado(locale));
  if (fila.version !== versionConocida) return res.status(409).json(errorConflictoVersion(locale, fila.version));

  const datos = fila.datos && typeof fila.datos === 'object' ? clone(fila.datos) : {};
  const registroPrevio = isPlainObject(datos.registro_epistemico) ? datos.registro_epistemico : null;
  const registro = normalizeStore(registroPrevio || emptyStore());
  const turnIndex = isPlainObject(registroPrevio && registroPrevio.turn_index) ? { ...registroPrevio.turn_index } : {};
  const changeTypesMap = isPlainObject(registroPrevio && registroPrevio.change_types) ? { ...registroPrevio.change_types } : {};

  // paso 6 · recordRef/record_id y claimId, generados por el servidor
  const recordId = 'ER-' + randomUUID().toUpperCase();
  const claimId = 'CLAIM-' + randomUUID().toUpperCase();
  const occurredAt = new Date().toISOString();
  const eventRef = { type: 'proposal', id: proposal.id, organism_id: clienteId };

  // paso 7 · traducción proposal → result (lib/epistemic-production-adapter.mjs) y validación
  let result;
  try {
    result = proposalToEpistemicResult({
      proposal, organismId: clienteId, organismVersion: fila.version, turnRef, eventRef,
      recordId, claimId, visibleText, occurredAt,
    });
  } catch (e) {
    registrar({ error: 'fallo_traducir_propuesta', perfil: perfil.slice(0, 8), detalle: String((e && e.message) || e) });
    return res.status(400).json({ error: { message: biLocale(locale, 'No se pudo construir el registro epistemológico.', 'Could not build the epistemic record.', 'Não foi possível construir o registro epistêmico.'), codigo: 'candidato_no_elegible' } });
  }

  // paso 8 · crear el registro + la revisión (lib/epistemic-ledger.mjs); issues[].affects
  // siempre no vacío por construcción (§3.4), por lo que appendResult() SIEMPRE abre revisión.
  let outcome;
  try {
    outcome = appendResult(registro, {
      enabled: true, organismId: clienteId, eventRef, result,
      idempotencyKey, expectedLedgerVersion: registro.ledger_version, occurredAt,
    });
  } catch (e) {
    registrar({ error: 'fallo_ledger_append', perfil: perfil.slice(0, 8), detalle: String((e && e.message) || e) });
    return res.status(400).json({ error: { message: biLocale(locale, 'No se pudo registrar el candidato epistemológico.', 'Could not register the epistemic candidate.', 'Não foi possível registrar o candidato epistêmico.'), codigo: 'ledger_invalido' } });
  }

  // asociación canónica turnRef → recordRef, dentro de registro_epistemico (nunca en datos.borrador)
  turnIndex[turnRef] = recordId;
  changeTypesMap[recordId] = changeTypesFromProposal(proposal);
  const registroActualizado = { ...outcome.store, turn_index: turnIndex, change_types: changeTypesMap };
  datos.registro_epistemico = registroActualizado;

  // paso 9 · guardar ese subárbol en una única actualización versionada. Se preservan nombre y
  // estado exactamente como estaban (clonados de la fila leída, nunca null) -- la RPC no ofrece
  // merge parcial (§7.1), así que cualquier valor sería la nueva verdad si se enviara distinto.
  let guardado;
  try {
    guardado = await rpc('guardar_organismo', {
      p_perfil: perfil, p_cliente_id: clienteId, p_nombre: fila.nombre, p_estado: fila.estado,
      p_datos: datos, p_version_conocida: versionConocida,
    }, SB_URL, SERVICE_KEY);
  } catch (e) {
    registrar({ error: 'fallo_guardar_epistemico', perfil: perfil.slice(0, 8), detalle: String((e && e.message) || e) });
    return res.status(503).json(errorServicioNoDisponible(locale));
  }
  if (guardado && guardado.conflicto) return res.status(409).json(errorConflictoVersion(locale, guardado.version));

  registrar({
    accion: 'candidato_epistemico_creado', perfil: perfil.slice(0, 8), cliente_id: clienteId,
    duplicate: outcome.response.duplicate,
  });

  // paso 10 · versión, recordRef, estado, registro_epistemico vigente y presentation seguro.
  // Nunca se devuelve ni reemplaza el blob completo por conveniencia.
  const presentation = buildPresentation({
    record: result.epistemic_records[0], reviewState: 'pending_human_review',
    changeTypes: changeTypesMap[recordId], locale,
  });
  return res.status(200).json({
    ok: true, version: guardado.version, recordRef: recordId, turnRef, state: 'review_required',
    registro_epistemico: registroActualizado, presentation,
  });
}

// --- 122.30 · resolve_epistemic_review (§7.4) ---
async function manejarResolverRevisionEpistemica({ cuerpo, perfil, locale, SB_URL, SERVICE_KEY, res }) {
  const CLAVES_PERMITIDAS = ['operacion', 'cliente_id', 'recordRef', 'accion', 'version_conocida', 'idempotency_key'];
  const claveDesconocida = Object.keys(cuerpo || {}).some((k) => !CLAVES_PERMITIDAS.includes(k));
  if (claveDesconocida) return res.status(400).json(errorPayloadInvalido(locale));

  const clienteId = String((cuerpo && cuerpo.cliente_id) || '').trim();
  const recordRef = typeof (cuerpo && cuerpo.recordRef) === 'string' ? cuerpo.recordRef : '';
  const accion = cuerpo && cuerpo.accion;
  const versionConocida = Number.isInteger(cuerpo && cuerpo.version_conocida) ? cuerpo.version_conocida : null;
  const idempotencyKey = typeof (cuerpo && cuerpo.idempotency_key) === 'string' ? cuerpo.idempotency_key.trim() : '';

  if (!clienteId || !RECORD_REF_RE.test(recordRef) || !ACCIONES_REVISION_PERMITIDAS.includes(accion) ||
      versionConocida === null || !idempotencyKey || idempotencyKey.length > MAX_IDEMPOTENCY_KEY_LEN) {
    return res.status(400).json(errorPayloadInvalido(locale));
  }

  // pasos 1-2 · autenticación (ya resuelta, `perfil` = actor) y organismo del actor
  let fila;
  try {
    fila = await leerFila(perfil, clienteId, SB_URL, SERVICE_KEY);
  } catch (e) {
    registrar({ error: 'fallo_leer_organismo', perfil: perfil.slice(0, 8), detalle: String((e && e.message) || e) });
    return res.status(503).json(errorServicioNoDisponible(locale));
  }
  if (!fila) return res.status(404).json(errorOrganismoNoEncontrado(locale));
  if (fila.version !== versionConocida) return res.status(409).json(errorConflictoVersion(locale, fila.version));

  const datos = fila.datos && typeof fila.datos === 'object' ? clone(fila.datos) : {};
  const registroPrevio = isPlainObject(datos.registro_epistemico) ? datos.registro_epistemico : null;
  const registro = normalizeStore(registroPrevio || emptyStore());

  // paso 3 · el recordRef pertenece a ESTE organismo
  const entryMatch = registro.entries.find((e) => e && e.record && e.record.record_id === recordRef && e.organism_id === clienteId);
  if (!entryMatch) {
    return res.status(404).json({ error: { message: biLocale(locale, 'Registro no encontrado para este organismo.', 'Record not found for this organism.', 'Registro não encontrado para este organismo.'), codigo: 'record_ref_invalido' } });
  }
  const claimId = entryMatch.record.claim.claim_id;
  const revisionPendiente = registro.reviews.find((r) => r.state === 'pending_human_review' && Array.isArray(r.changed_claims) && r.changed_claims.includes(claimId));
  // Si ya no hay una revisión pendiente para este claim, o bien ya se resolvió con esta misma
  // idempotency_key (reintento legítimo -- resolveReviewOutcome() lo trata como duplicate:true
  // más abajo si encuentra la operación previa) o bien es un conflicto real de una decisión
  // distinta sobre algo ya resuelto. En ambos casos, sin revisión pendiente visible acá no hay
  // review_id contra el cual reintentar -- se informa como ya resuelta.
  if (!revisionPendiente) {
    return res.status(409).json({ error: { message: biLocale(locale, 'Esta revisión ya fue resuelta.', 'This review has already been resolved.', 'Esta revisão já foi resolvida.'), codigo: 'revision_ya_resuelta' } });
  }

  // paso 4-5 · resolución idempotente + evento inmutable (lib/epistemic-ledger.mjs)
  const occurredAt = new Date().toISOString();
  let outcome;
  try {
    outcome = resolveReviewOutcome(registro, revisionPendiente.review_id, accion, {
      actorId: perfil, idempotencyKey, occurredAt, resolvedAt: occurredAt,
    });
  } catch (e) {
    const msg = String((e && e.message) || e);
    if (msg.indexOf('REVIEW_ALREADY_RESOLVED') !== -1 || msg.indexOf('IDEMPOTENCY_KEY_REUSED') !== -1) {
      return res.status(409).json({ error: { message: biLocale(locale, 'Esta revisión ya fue resuelta.', 'This review has already been resolved.', 'Esta revisão já foi resolvida.'), codigo: 'revision_ya_resuelta' } });
    }
    registrar({ error: 'fallo_resolver_revision', perfil: perfil.slice(0, 8), detalle: msg });
    return res.status(400).json({ error: { message: biLocale(locale, 'No se pudo resolver la revisión.', 'Could not resolve the review.', 'Não foi possível resolver a revisão.'), codigo: 'resolucion_invalida' } });
  }

  const changeTypesMap = isPlainObject(registroPrevio && registroPrevio.change_types) ? registroPrevio.change_types : {};
  const turnIndex = isPlainObject(registroPrevio && registroPrevio.turn_index) ? registroPrevio.turn_index : {};
  const registroActualizado = { ...outcome.store, turn_index: turnIndex, change_types: changeTypesMap };
  datos.registro_epistemico = registroActualizado;

  // paso 6 · momento mínimo, en la MISMA persistencia confirmada (nunca un segundo
  // guardarOrganismo, nunca fire-and-forget). Nunca llama a aplicarPropuesta(), fusionarFicha(),
  // crearRecuerdo() ni escribe ficha/principios/diagnóstico (§12).
  const textoMomento = !outcome.response.duplicate
    ? (accion === 'accept_as_reference'
      ? biLocale(locale, 'Comprensión candidata aceptada como referencia del organismo.', 'Candidate understanding accepted as the organism’s reference.', 'Compreensão candidata aceita como referência do organismo.')
      : biLocale(locale, 'Comprensión candidata no incorporada como referencia.', 'Candidate understanding not incorporated as reference.', 'Compreensão candidata não incorporada como referência.'))
    : null;
  let momentos = Array.isArray(datos.momentos) ? datos.momentos.slice() : [];
  // Un reintento idempotente (duplicate:true) no agrega un segundo momento -- "un solo momento
  // nuevo por resolución CONFIRMADA" (§18), no uno por cada request.
  if (textoMomento) {
    momentos.push({
      f: occurredAt, turno: null, tipo: TIPO_MOMENTO_REVISION_EPISTEMICA,
      texto: textoMomento, lectura: null, epistemic_record_ref: recordRef,
    });
    if (momentos.length > RECORRIDO_MAX) momentos = momentos.slice(momentos.length - RECORRIDO_MAX);
  }
  datos.momentos = momentos;

  // paso 7 · persistir todo en una única actualización versionada (mismo patrón RMW que la
  // creación; nombre/estado preservados exactamente como estaban).
  let guardado;
  try {
    guardado = await rpc('guardar_organismo', {
      p_perfil: perfil, p_cliente_id: clienteId, p_nombre: fila.nombre, p_estado: fila.estado,
      p_datos: datos, p_version_conocida: versionConocida,
    }, SB_URL, SERVICE_KEY);
  } catch (e) {
    registrar({ error: 'fallo_guardar_resolucion', perfil: perfil.slice(0, 8), detalle: String((e && e.message) || e) });
    return res.status(503).json(errorServicioNoDisponible(locale));
  }
  if (guardado && guardado.conflicto) return res.status(409).json(errorConflictoVersion(locale, guardado.version));

  registrar({
    accion: 'revision_epistemica_resuelta', perfil: perfil.slice(0, 8), cliente_id: clienteId,
    decision: accion, duplicate: outcome.response.duplicate,
  });

  // paso 8 · sólo los subárboles actualizados registro_epistemico y momentos.
  return res.status(200).json({
    ok: true, version: guardado.version, state: outcome.review.state,
    registro_epistemico: registroActualizado, momentos,
  });
}

export default async function handler(req, res) {
  const locale = localeDe(req);
  if (req.method !== 'GET' && req.method !== 'POST' && req.method !== 'DELETE') {
    res.setHeader('Allow', 'GET, POST, DELETE');
    return res.status(405).json({ error: { message: biLocale(locale, 'Metodo no permitido.', 'Method not allowed.', 'Método não permitido.') } });
  }

  const SB_URL = process.env.SUPABASE_URL;
  const SERVICE_KEY = process.env.SUPABASE_SECRET_KEY;
  if (!SB_URL || !SERVICE_KEY) {
    return res.status(500).json({ error: { message: biLocale(locale, 'Falta SUPABASE_URL o SUPABASE_SECRET_KEY.', 'Server configuration is incomplete.', 'Configuração do servidor incompleta.') } });
  }

  // --- Sesion ---
  const cabecera = String(req.headers['authorization'] || '');
  const token = cabecera.toLowerCase().startsWith('bearer ') ? cabecera.slice(7).trim() : '';
  if (!token) {
    return res.status(401).json({ error: { message: biLocale(locale, 'Inicia sesion para continuar.', 'Sign in to continue.', 'Entre para continuar.'), codigo: 'sin_sesion' } });
  }

  let perfil;
  try {
    perfil = await identificar(token, SB_URL, SERVICE_KEY);
  } catch (e) {
    registrar({ error: 'base_inalcanzable', detalle: String((e && e.message) || e) });
    return res.status(503).json({ error: { message: biLocale(locale, 'El servicio no esta disponible. Volve a intentar.', 'The service is unavailable. Try again.', 'O serviço não está disponível. Tente novamente.'), codigo: 'servicio_no_disponible' } });
  }
  if (!perfil) {
    return res.status(401).json({ error: { message: biLocale(locale, 'Sesion vencida. Volve a iniciar sesion.', 'Your session has expired. Sign in again.', 'Sua sessão expirou. Entre novamente.'), codigo: 'sesion_invalida' } });
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
      return res.status(503).json({ error: { message: biLocale(locale, 'No se pudieron traer los organismos. Volve a intentar.', 'Could not load your organisms. Try again.', 'Não foi possível carregar os organismos. Tente novamente.'), codigo: 'servicio_no_disponible' } });
    }
  }

  // --- DELETE: borrar un organismo puntual, de verdad ---
  if (req.method === 'DELETE') {
    const clienteId = String((req.query && req.query.cliente_id) || '').trim();
    if (!clienteId) {
      return res.status(400).json({ error: { message: biLocale(locale, 'Falta cliente_id.', 'Missing client_id.', 'Falta o client_id.') } });
    }
    try {
      const ruta = '/rest/v1/organismos?perfil=eq.' + perfil + '&cliente_id=eq.' + encodeURIComponent(clienteId);
      const r = await fetch(SB_URL + ruta, {
        method: 'DELETE',
        headers: { apikey: SERVICE_KEY, Authorization: 'Bearer ' + SERVICE_KEY, Prefer: 'return=representation' },
      });
      if (!r.ok) throw new Error('borrar devolvio ' + r.status);
      const borrados = await r.json().catch(() => []);
      registrar({ accion: 'borrado', perfil: perfil.slice(0, 8), cliente_id: clienteId, encontrado: Array.isArray(borrados) && borrados.length > 0 });
      return res.status(200).json({ ok: true, encontrado: Array.isArray(borrados) && borrados.length > 0 });
    } catch (e) {
      registrar({ error: 'fallo_borrar', perfil: perfil.slice(0, 8), cliente_id: clienteId, detalle: String((e && e.message) || e) });
      return res.status(503).json({ error: { message: biLocale(locale, 'No se pudo borrar. Volve a intentar.', 'Could not delete it. Try again.', 'Não foi possível excluir. Tente novamente.'), codigo: 'servicio_no_disponible' } });
    }
  }

  // --- POST ---
  let cuerpo = req.body;
  if (typeof cuerpo === 'string') { try { cuerpo = JSON.parse(cuerpo); } catch (e) { cuerpo = null; } }

  // 122.30 §7.2: el despacho por `operacion` ocurre ANTES del validador histórico que exige
  // `cliente_id`+`datos` (más abajo). El body ya se parseó una sola vez, arriba.
  const operacion = (cuerpo && typeof cuerpo.operacion === 'string') ? cuerpo.operacion : null;
  if (operacion !== null && !OPERACIONES_PERMITIDAS.includes(operacion)) {
    return res.status(400).json({ error: { message: biLocale(locale, 'Operación no permitida.', 'Operation not allowed.', 'Operação não permitida.'), codigo: 'operacion_no_permitida' } });
  }
  if (operacion === 'create_epistemic_candidate') {
    return manejarCrearCandidatoEpistemico({ cuerpo, perfil, locale, SB_URL, SERVICE_KEY, res });
  }
  if (operacion === 'resolve_epistemic_review') {
    return manejarResolverRevisionEpistemica({ cuerpo, perfil, locale, SB_URL, SERVICE_KEY, res });
  }

  // --- POST: guardar (crea o actualiza) -- flujo histórico, sin `operacion` o con
  // `operacion:'guardar_organismo'`. Byte-equivalente a antes de 122.30. ---
  const clienteId = cuerpo && String(cuerpo.cliente_id || '').trim();
  const datos = cuerpo && cuerpo.datos;
  if (!clienteId || !datos || typeof datos !== 'object') {
    return res.status(400).json({ error: { message: biLocale(locale, 'Falta cliente_id o datos.', 'Missing client_id or data.', 'Falta o client_id ou os dados.') } });
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
        error: { message: biLocale(locale, 'Hay una version mas nueva guardada. No se sobrescribio.', 'A newer version is already saved. It was not overwritten.', 'Já existe uma versão mais nova salva. Não foi sobrescrita.'), codigo: 'conflicto_version' },
        version: r.version,
        datos: r.datos,
      });
    }

    registrar({ accion: 'guardado', perfil: perfil.slice(0, 8), cliente_id: clienteId, version: r ? r.version : null });

    // Corte F: aviso real SOLO la primera vez que este organismo existe (version===1).
    // Los autoguardados posteriores (ediciones) son version>1 y no generan un aviso
    // nuevo -- decision explicita con Javier (04/08) para no llenar la bandeja de
    // ruido en cada autoguardado. Aislado y esperado (await), misma razon que en
    // api/pago.js: no dejar esto como "fire and forget".
    if (r && r.version === 1 && estado === 'activo') {
      await emitirYNotificar({
        SB_URL, SERVICE_KEY,
        organizationId: perfil, purposeId: 'organismo_disponible', type: 'organismo.disponible',
        producer: 'organismos', payload: { organismo_id: r.id, nombre: nombre || null, locale },
        titulo: biLocale(locale, 'Tu análisis está disponible', 'Your analysis is available', 'Sua análise está disponível'),
        resumen: nombre ? biLocale(locale, `"${nombre}" ya está guardado.`, `"${nombre}" is now saved.`, `"${nombre}" já foi salvo.`) : biLocale(locale, 'Tu nuevo análisis ya está guardado.', 'Your new analysis is now saved.', 'Sua nova análise já foi salva.'),
      });
    }

    return res.status(200).json({ ok: true, id: r.id, version: r.version });

  } catch (e) {
    registrar({ error: 'fallo_guardar', perfil: perfil.slice(0, 8), cliente_id: clienteId, detalle: String((e && e.message) || e) });
    return res.status(503).json({ error: { message: biLocale(locale, 'No se pudo guardar. Volve a intentar.', 'Could not save. Try again.', 'Não foi possível salvar. Tente novamente.'), codigo: 'servicio_no_disponible' } });
  }
}
