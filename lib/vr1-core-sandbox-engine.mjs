export const SANDBOX_ENGINE_VERSION = '1.0.0';
export const STORE_SCHEMA = 'vr1-core-sandbox-ledger/1.0';
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

// Fingerprint local para detectar corrupción accidental en el sandbox. No es firma ni prueba de autenticidad.
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
  return { schema_version: STORE_SCHEMA, ledger_version: 0, entries: [], operations: [], reviews: [] };
}

export function validateStore(store) {
  const errors = [];
  if (store?.schema_version !== STORE_SCHEMA) errors.push('STORE_SCHEMA_INVALID');
  if (!Number.isInteger(store?.ledger_version) || store.ledger_version < 0) errors.push('LEDGER_VERSION_INVALID');
  for (const key of ['entries', 'operations', 'reviews']) if (!Array.isArray(store?.[key])) errors.push(`${key.toUpperCase()}_INVALID`);
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

export function appendResult(store, { enabled, organismId, eventRef, result, idempotencyKey, expectedLedgerVersion, occurredAt = '2026-09-06T12:00:00.000Z' }) {
  const before = clone(store || emptyStore());
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
  }
  const response = { ok: true, status: 'appended', duplicate: false, operation_id: operationId, appended: result.epistemic_records.length, ledger_version: before.ledger_version, review_id: review?.review_id || null };
  before.operations.push({ operation_id: operationId, idempotency_key: idempotencyKey, request_fingerprint: requestFingerprint, response: clone(response), occurred_at: occurredAt });
  return { store: before, response, review: clone(review) };
}

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
  const storeCheck = validateStore(sidecar.body);
  errors.push(...storeCheck.errors);
  for (let index = 0; index < (sidecar.body?.entries || []).length; index += 1) {
    const entry = sidecar.body.entries[index];
    if (entry.ledger_index !== index + 1) errors.push('ENTRY_SEQUENCE_INVALID');
    if (entry.record_fingerprint !== fingerprint(entry.record)) errors.push(`ENTRY_FINGERPRINT_INVALID:${entry.revision_key}`);
  }
  return { ok: errors.length === 0, legacy: false, store: errors.length ? null : clone(sidecar.body), errors };
}
