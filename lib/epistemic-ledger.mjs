// lib/epistemic-ledger.mjs
//
// Módulo canónico de producción del ledger epistemológico (122.30).
//
// Este módulo reemplaza a lib/vr1-core-sandbox-engine.mjs como fuente de verdad del
// motor de ledger. El archivo histórico se convierte en un re-export compatible
// (`export * from './epistemic-ledger.mjs';`) para no romper a sus importadores
// actuales (lib/vr1-core-sandbox-bridge.mjs y el banco de pruebas de laboratorio).
//
// Todas las funciones heredadas del motor 1.0 (clone, stableStringify, fingerprint,
// validateResultForOrganism, validateEventRef, traceImpact, organismView,
// exportPortable, inspectPortable) se conservan byte-equivalentes en comportamiento.
// appendResult() y resolveReview() conservan sus firmas públicas exactas para el
// bridge de laboratorio. Las capacidades nuevas requeridas por producción
// (normalización 1.0 → 1.1, historia inmutable de revisiones, resolución idempotente
// sin fechas de fixture) se agregan mediante funciones nuevas: normalizeStore() y
// resolveReviewOutcome().
//
// El código productivo (index.html, api/organismos.js) importa este módulo
// directamente. No importa nunca un archivo llamado "vr1-core-sandbox-*".

export const SANDBOX_ENGINE_VERSION = '1.0.0';

// --- Esquemas de store: histórico (1.0) y canónico (1.1) ---
// LEDGER_SCHEMA_1_0 es el valor que normalizeStore() reconoce como store histórico
// (mismo string que STORE_SCHEMA tenía en el motor 1.0 original). LEDGER_SCHEMA_1_1
// es el esquema canónico de este módulo: agrega review_events[] como historia
// inmutable de aperturas y resoluciones humanas, separada de reviews[] (que sigue
// siendo una proyección mutable, no una fuente de auditoría).
export const LEDGER_SCHEMA_1_0 = 'vr1-core-sandbox-ledger/1.0';
export const LEDGER_SCHEMA_1_1 = 'vr1-core-ledger/1.1';
// STORE_SCHEMA es el esquema vigente/actual (1.1). Ningún importador de este módulo
// depende de su valor exacto hoy (verificado contra bridge y banco de pruebas), por
// lo que su promoción de 1.0 a 1.1 no altera comportamiento observable existente.
export const STORE_SCHEMA = LEDGER_SCHEMA_1_1;

export const PORTABLE_SCHEMA = 'comprender-backup-with-epistemic-sidecar/1.0';
export const EVENT_TYPES = Object.freeze(['proposal', 'memory', 'specialty_return', 'contextual_genealogy', 'hito']);

export function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

export function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

// Fingerprint local para detectar corrupción accidental y deduplicar por idempotencia.
// No es firma ni prueba criptográfica de autenticidad -- documentado también en 122.30
// (record.origin no depende de este fingerprint para ninguna afirmación de procedencia).
export function fingerprint(value) {
  const encoded = typeof value === 'string' ? value : stableStringify(value);
  const text = encoded === undefined ? 'undefined' : String(encoded);
  let hash = 0xcbf29ce484222325n;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= BigInt(text.charCodeAt(i));
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, '0');
}

export function emptyStore() {
  return { schema_version: STORE_SCHEMA, ledger_version: 0, entries: [], operations: [], reviews: [], review_events: [] };
}

// --- Normalización retrocompatible (§5.1) ---
//
// Orden obligatorio en todo camino productivo (appendResult, resolveReviewOutcome,
// importación portable y el bridge de laboratorio): normalizeStore() SIEMPRE se
// ejecuta antes de validateStore(). Un store 1.0 nunca se compara directamente
// contra el esquema 1.1.
//
// normalizeStore(input):
//   1. acepta tanto LEDGER_SCHEMA_1_0 como LEDGER_SCHEMA_1_1;
//   2. clona el input y agrega review_events: [] si falta;
//   3. convierte únicamente la cabecera de esquema -- nunca altera entries,
//      operations ni reviews;
//   4. deja intacto cualquier schema_version no reconocido: validateStore() lo
//      rechazará explícitamente como STORE_SCHEMA_INVALID (falla cerrado, nunca
//      se inventa una migración de un esquema desconocido).
//
// Para stores 1.0 preexistentes, review_events: [] significa "sin historia de
// eventos disponible antes de la migración" -- no se fabrican retrospectivamente
// actores, fechas ni decisiones. Desde la primera operación 1.1, todo evento nuevo
// es obligatorio e inmutable.
export function normalizeStore(input) {
  const source = input || emptyStore();
  const next = clone(source);
  if (next.schema_version === LEDGER_SCHEMA_1_0 || next.schema_version === LEDGER_SCHEMA_1_1) {
    next.schema_version = LEDGER_SCHEMA_1_1;
  }
  if (!Array.isArray(next.review_events)) next.review_events = [];
  return next;
}

// validateStore() valida SIEMPRE contra el esquema ya normalizado (1.1). Todo
// llamador productivo debe pasar por normalizeStore() antes de invocar esta función.
export function validateStore(store) {
  const errors = [];
  if (store?.schema_version !== STORE_SCHEMA) errors.push('STORE_SCHEMA_INVALID');
  if (!Number.isInteger(store?.ledger_version) || store.ledger_version < 0) errors.push('LEDGER_VERSION_INVALID');
  for (const key of ['entries', 'operations', 'reviews', 'review_events']) {
    if (!Array.isArray(store?.[key])) errors.push(`${key.toUpperCase()}_INVALID`);
  }
  if (Array.isArray(store?.entries) && store.entries.length !== store.ledger_version) errors.push('LEDGER_LENGTH_MISMATCH');
  return { ok: errors.length === 0, errors };
}

export function validateResultForOrganism(result, organismId) {
  const errors = [];
  if (!organismId) errors.push('ORGANISM_ID_REQUIRED');
  if (!result || result.verification_level !== 'V1') errors.push('VR1_LEVEL_REQUIRED');
  if (result?.validation?.ok !== true) errors.push('VR1_RESULT_NOT_VALIDATED');
  if (result?.forbidden_closure !== true) errors.push('FORBIDDEN_CLOSURE_GUARD_REQUIRED');
  if (!Array.isArray(result?.epistemic_records) || !result.epistemic_records.length) errors.push('EPISTEMIC_RECORDS_REQUIRED');
  for (const record of result?.epistemic_records || []) {
    if (record?.scope?.organism_id !== organismId) errors.push(`RECORD_ORGANISM_MISMATCH:${record?.record_id || 'unknown'}`);
    if (!record?.record_id || !Number.isInteger(record?.revision?.version)) errors.push('RECORD_ID_OR_REVISION_INVALID');
  }
  return { ok: errors.length === 0, errors };
}

export function validateEventRef(eventRef, organismId) {
  const errors = [];
  if (!EVENT_TYPES.includes(eventRef?.type)) errors.push('EVENT_TYPE_INVALID');
  if (!eventRef?.id || typeof eventRef.id !== 'string') errors.push('EVENT_ID_REQUIRED');
  if (eventRef?.organism_id && eventRef.organism_id !== organismId) errors.push('EVENT_ORGANISM_MISMATCH');
  return { ok: errors.length === 0, errors };
}

function reverseDependencies(records) {
  const reverse = new Map();
  for (const record of records) {
    for (const dep of record.dependencies || []) {
      const list = reverse.get(dep.claim_id) || [];
      list.push(record.claim.claim_id);
      reverse.set(dep.claim_id, list);
    }
  }
  return reverse;
}

export function traceImpact(records, changedClaimIds) {
  const reverse = reverseDependencies(records || []);
  const queue = [...new Set(changedClaimIds || [])].map(claimId => ({ claim_id: claimId, depth: 0 }));
  const affected = new Map();
  while (queue.length) {
    const current = queue.shift();
    if (current.depth >= 16) continue;
    for (const target of reverse.get(current.claim_id) || []) {
      const depth = current.depth + 1;
      if (!affected.has(target) || depth < affected.get(target)) {
        affected.set(target, depth);
        queue.push({ claim_id: target, depth });
      }
    }
  }
  return [...affected.entries()].sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0])).map(([claim_id, depth]) => ({ claim_id, depth }));
}

function latestRevision(store, recordId) {
  return store.entries.filter(entry => entry.record.record_id === recordId).reduce((max, entry) => Math.max(max, entry.record.revision.version), 0);
}

function currentRecords(store, organismId) {
  const latest = new Map();
  for (const entry of store.entries) {
    if (entry.organism_id !== organismId) continue;
    const prior = latest.get(entry.record.record_id);
    if (!prior || prior.revision.version < entry.record.revision.version) latest.set(entry.record.record_id, entry.record);
  }
  return [...latest.values()];
}

// Valida forma ISO-8601 estricta, consistente con el patrón que produce siempre
// new Date().toISOString() en el servidor. 122.30 prohíbe fechas de fixture: quien
// llame a una función que exige timestamp productivo debe proveerlo explícitamente.
function isValidIso8601(value) {
  if (typeof value !== 'string' || !value) return false;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(value)) return false;
  return !Number.isNaN(new Date(value).getTime());
}

// appendResult(store, {...}) -- firma pública idéntica a la del motor 1.0, conservada
// para lib/vr1-core-sandbox-bridge.mjs. Diferencia productiva agregada por 122.30:
// normaliza el store recibido antes de validarlo (en vez de clonarlo y validarlo
// directamente), de modo que cualquier caller -- productivo o de laboratorio --
// que todavía no haya pasado por normalizeStore() no rompe por un schema_version
// 1.0 heredado. Cuando el store recibido ya viene normalizado (como hace el bridge
// desde su loadStore() corregido), el comportamiento es exactamente el mismo que
// en el motor 1.0 original.
//
// El parámetro occurredAt sigue teniendo un default: éste NO es el default de
// fixture que 122.30 prohíbe para la ruta productiva nueva (resolveReviewOutcome);
// es el mismo default histórico del motor 1.0, conservado por compatibilidad con
// el banco de pruebas de laboratorio certificado, que invoca appendResult() sin
// pasar occurredAt en varios casos. Todo caller productivo (api/organismos.js)
// pasa siempre occurredAt = new Date().toISOString() explícitamente.
export function appendResult(store, { enabled, organismId, eventRef, result, idempotencyKey, expectedLedgerVersion, occurredAt = '2026-09-06T12:00:00.000Z' }) {
  const before = normalizeStore(store || emptyStore());
  const storeCheck = validateStore(before);
  if (!storeCheck.ok) throw new Error(storeCheck.errors.join(','));
  if (!enabled) return { store: before, response: { ok: true, status: 'disabled', duplicate: false, ledger_version: before.ledger_version }, review: null };
  const resultCheck = validateResultForOrganism(result, organismId);
  if (!resultCheck.ok) throw new Error(resultCheck.errors.join(','));
  const refCheck = validateEventRef(eventRef, organismId);
  if (!refCheck.ok) throw new Error(refCheck.errors.join(','));
  if (!idempotencyKey) throw new Error('IDEMPOTENCY_KEY_REQUIRED');
  const requestFingerprint = fingerprint({ organismId, eventRef, result });
  const prior = before.operations.find(operation => operation.idempotency_key === idempotencyKey);
  if (prior) {
    if (prior.request_fingerprint !== requestFingerprint) throw new Error('IDEMPOTENCY_KEY_REUSED');
    return { store: before, response: { ...clone(prior.response), duplicate: true }, review: null };
  }
  if (expectedLedgerVersion !== before.ledger_version) throw new Error('LEDGER_VERSION_CONFLICT');
  const keys = new Set(before.entries.map(entry => entry.revision_key));
  for (const record of result.epistemic_records) {
    const key = `${record.record_id}@${record.revision.version}`;
    if (keys.has(key)) throw new Error(`REVISION_ALREADY_EXISTS:${key}`);
    const expectedRevision = latestRevision(before, record.record_id) + 1;
    if (record.revision.version !== expectedRevision) throw new Error(`REVISION_SEQUENCE_CONFLICT:${record.record_id}`);
    keys.add(key);
  }
  const operationId = `SBOP-${fingerprint({ idempotencyKey, requestFingerprint })}`;
  for (const record of result.epistemic_records) {
    before.ledger_version += 1;
    before.entries.push({
      ledger_index: before.ledger_version,
      organism_id: organismId,
      event_ref: { type: eventRef.type, id: eventRef.id },
      revision_key: `${record.record_id}@${record.revision.version}`,
      record_fingerprint: fingerprint(record),
      result_status: result.status,
      operation_id: operationId,
      occurred_at: occurredAt,
      record: clone(record)
    });
  }
  const changedClaims = [...new Set((result.issues || []).flatMap(issue => issue.affects || []))];
  const affected = traceImpact(currentRecords(before, organismId), changedClaims);
  let review = null;
  if (changedClaims.length) {
    review = {
      review_id: `SBREV-${fingerprint({ organismId, operationId, changedClaims })}`,
      organism_id: organismId,
      state: 'pending_human_review',
      trigger_ref: { type: eventRef.type, id: eventRef.id },
      changed_claims: changedClaims,
      affected_claims: affected,
      created_at: occurredAt,
      actor_id: null,
      core_write_performed: false
    };
    before.reviews.push(review);
    // Historia inmutable de apertura (§5.1): review_events registra que esta
    // revisión se abrió, separado de reviews[] (proyección mutable que sí se
    // actualiza in-place al resolver). No participa de la respuesta pública ni
    // del objeto `review` devuelto -- ningún caller existente (bridge, banco de
    // pruebas) los inspecciona, por lo que esta adición es aditiva y no rompe
    // comportamiento certificado.
    before.review_events.push({
      review_event_id: `SBREVEV-${fingerprint({ reviewId: review.review_id, operationId, type: 'opened' })}`,
      review_id: review.review_id,
      organism_id: organismId,
      type: 'opened',
      action: null,
      actor_id: null,
      occurred_at: occurredAt
    });
  }
  const response = { ok: true, status: 'appended', duplicate: false, operation_id: operationId, appended: result.epistemic_records.length, ledger_version: before.ledger_version, review_id: review?.review_id || null };
  before.operations.push({ operation_id: operationId, idempotency_key: idempotencyKey, request_fingerprint: requestFingerprint, response: clone(response), occurred_at: occurredAt });
  return { store: before, response, review: clone(review) };
}

// resolveReview(store, reviewId, action, opts) -- conservada BYTE-IDÉNTICA al motor
// 1.0, incluidos sus defaults de fixture para resolvedAt. Se mantiene exclusivamente
// por compatibilidad con lib/vr1-core-sandbox-bridge.mjs y su banco de pruebas
// certificado, que la siguen usando tal cual. El código productivo de 122.30 NUNCA
// llama a esta función: usa resolveReviewOutcome() (abajo), que exige timestamps
// reales, es idempotente y agrega historia inmutable de eventos.
export function resolveReview(store, reviewId, action, { actorId, correction = null, resolvedAt = '2026-09-06T12:30:00.000Z' } = {}) {
  if (!actorId) throw new Error('HUMAN_ACTOR_ID_REQUIRED');
  if (!['accept_as_reference', 'correct_as_reference', 'reject'].includes(action)) throw new Error('REVIEW_ACTION_INVALID');
  const next = clone(store);
  const review = next.reviews.find(item => item.review_id === reviewId);
  if (!review) throw new Error('REVIEW_NOT_FOUND');
  if (review.state !== 'pending_human_review') throw new Error('REVIEW_ALREADY_RESOLVED');
  review.state = action === 'reject' ? 'rejected' : (action === 'correct_as_reference' ? 'corrected_as_reference' : 'accepted_as_reference');
  review.actor_id = actorId;
  review.correction = action === 'correct_as_reference' ? clone(correction || {}) : null;
  review.resolved_at = resolvedAt;
  review.core_write_performed = false;
  return next;
}

// resolveReviewOutcome(store, reviewId, action, opts) -- función NUEVA (§5.2),
// exclusiva de producción. Diferencias deliberadas frente a resolveReview():
//   - normaliza el store recibido antes de operar (normalizeStore() primero);
//   - occurredAt y resolvedAt son OBLIGATORIOS y deben ser ISO-8601 válidos; nunca
//     hay una fecha de fixture como default -- omitirlos es un error controlado;
//   - exige idempotencyKey (organismId/recordRef + actor + acción + intento,
//     construido por el llamador productivo) y es idempotente:
//       * misma clave + misma revisión + misma decisión -> devuelve el resultado ya
//         aplicado con duplicate:true, sin reescribir nada;
//       * misma clave con contenido distinto -> error controlado (IDEMPOTENCY_KEY_REUSED);
//       * decisión distinta sobre una revisión ya resuelta -> conflicto
//         (REVIEW_ALREADY_RESOLVED), sin reescritura;
//   - toda resolución exitosa agrega un review_event inmutable ANTES de actualizar
//     la proyección reviews[] (§5.1: review_events es la historia; reviews[] es la
//     proyección de lectura).
// Devuelve { store, response, review } -- misma forma general que appendResult(),
// para que los llamadores productivos puedan tratarlas de manera uniforme.
export function resolveReviewOutcome(store, reviewId, action, opts = {}) {
  const { actorId, correction = null, occurredAt, resolvedAt, idempotencyKey } = opts;
  const before = normalizeStore(store);
  const storeCheck = validateStore(before);
  if (!storeCheck.ok) throw new Error(storeCheck.errors.join(','));
  if (!actorId) throw new Error('HUMAN_ACTOR_ID_REQUIRED');
  if (!['accept_as_reference', 'correct_as_reference', 'reject'].includes(action)) throw new Error('REVIEW_ACTION_INVALID');
  if (!idempotencyKey) throw new Error('IDEMPOTENCY_KEY_REQUIRED');
  if (!isValidIso8601(occurredAt)) throw new Error('OCCURRED_AT_REQUIRED_ISO8601');
  if (!isValidIso8601(resolvedAt)) throw new Error('RESOLVED_AT_REQUIRED_ISO8601');

  const requestFingerprint = fingerprint({ reviewId, action, actorId, correction });
  const prior = before.operations.find(operation => operation.idempotency_key === idempotencyKey);
  if (prior) {
    if (prior.request_fingerprint !== requestFingerprint) throw new Error('IDEMPOTENCY_KEY_REUSED');
    return { store: before, response: { ...clone(prior.response), duplicate: true }, review: clone(prior.resolved_review || null) };
  }

  const review = before.reviews.find(item => item.review_id === reviewId);
  if (!review) throw new Error('REVIEW_NOT_FOUND');
  // La comprobación de idempotencia (arriba) ocurre ANTES de este chequeo de
  // estado a propósito: un reintento legítimo con la MISMA clave sobre una
  // revisión que esa misma operación ya resolvió nunca cae acá (ya devolvió
  // duplicate:true arriba). Sólo una decisión distinta -- clave nueva -- sobre
  // una revisión ya resuelta llega a este throw, que es exactamente el
  // "conflicto, sin reescritura" que exige §5.2.
  if (review.state !== 'pending_human_review') throw new Error('REVIEW_ALREADY_RESOLVED');

  const nextState = action === 'reject' ? 'rejected' : (action === 'correct_as_reference' ? 'corrected_as_reference' : 'accepted_as_reference');
  const reviewEventId = `SBREVEV-${fingerprint({ reviewId, idempotencyKey, requestFingerprint })}`;
  before.review_events.push({
    review_event_id: reviewEventId,
    review_id: reviewId,
    organism_id: review.organism_id,
    type: 'resolved',
    action,
    actor_id: actorId,
    occurred_at: occurredAt
  });
  review.state = nextState;
  review.actor_id = actorId;
  review.correction = action === 'correct_as_reference' ? clone(correction || {}) : null;
  review.resolved_at = resolvedAt;
  review.core_write_performed = false;

  const response = { ok: true, status: 'resolved', duplicate: false, review_id: reviewId, review_event_id: reviewEventId, state: nextState };
  before.operations.push({
    operation_id: reviewEventId,
    idempotency_key: idempotencyKey,
    request_fingerprint: requestFingerprint,
    response: clone(response),
    resolved_review: clone(review),
    occurred_at: occurredAt
  });
  return { store: before, response, review: clone(review) };
}

export function organismView(store, organismId) {
  const entries = store.entries.filter(entry => entry.organism_id === organismId);
  const latest = new Map();
  for (const entry of entries) {
    const previous = latest.get(entry.record.record_id);
    if (!previous || previous.record.revision.version < entry.record.revision.version) latest.set(entry.record.record_id, entry);
  }
  return {
    organism_id: organismId,
    entries: clone(entries),
    current_records: [...latest.values()].map(entry => clone(entry.record)),
    reviews: clone(store.reviews.filter(review => review.organism_id === organismId)),
    result: entries.length ? {
      status: entries.at(-1).result_status || entries.at(-1).record.verification.maximum_authorized_conclusion.label,
      verification_level: entries.at(-1).record.verification.verification_level,
      evidence_links: [...latest.values()].reduce((sum, entry) => sum + (entry.record.support || []).length, 0),
      unresolved: [...new Set([...latest.values()].flatMap(entry => (entry.record.limits?.uncertainties || []).filter(x => x.state === 'unresolved').map(x => x.type)))]
    } : null
  };
}

export function exportPortable(coreBackup, store) {
  const body = clone(store);
  return {
    ...clone(coreBackup),
    epistemic_sidecar: {
      schema_version: PORTABLE_SCHEMA,
      body,
      integrity: { algorithm: 'FNV1A-64-CORRUPTION-CHECK-NONSECURITY', fingerprint: fingerprint(body), authenticity_proven: false }
    }
  };
}

export function inspectPortable(payload) {
  if (!payload?.epistemic_sidecar) return { ok: true, legacy: true, store: emptyStore(), errors: [] };
  const sidecar = payload.epistemic_sidecar;
  const errors = [];
  if (sidecar.schema_version !== PORTABLE_SCHEMA) errors.push('PORTABLE_SCHEMA_INVALID');
  if (sidecar.integrity?.fingerprint !== fingerprint(sidecar.body)) errors.push('SIDECAR_INTEGRITY_FAILED');
  // El body embebido en un respaldo portable puede venir en esquema 1.0 (respaldos
  // exportados antes de 122.30) o 1.1. Se normaliza antes de validar, igual que
  // cualquier otro camino productivo (§5.1, punto "importación portable").
  const normalizedBody = normalizeStore(sidecar.body);
  const storeCheck = validateStore(normalizedBody);
  errors.push(...storeCheck.errors);
  for (let index = 0; index < (sidecar.body?.entries || []).length; index += 1) {
    const entry = sidecar.body.entries[index];
    if (entry.ledger_index !== index + 1) errors.push('ENTRY_SEQUENCE_INVALID');
    if (entry.record_fingerprint !== fingerprint(entry.record)) errors.push(`ENTRY_FINGERPRINT_INVALID:${entry.revision_key}`);
  }
  return { ok: errors.length === 0, legacy: false, store: errors.length ? null : normalizedBody, errors };
}
