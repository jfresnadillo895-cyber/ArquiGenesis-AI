// Pruebas del módulo canónico lib/epistemic-ledger.mjs (122.30, §18 "Ledger").
// No dependen de DOM ni de localStorage: ejercitan el módulo directamente, como
// lo hará el código productivo (index.html, api/organismos.js).

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LEDGER_SCHEMA_1_0, LEDGER_SCHEMA_1_1, STORE_SCHEMA,
  emptyStore, normalizeStore, validateStore,
  appendResult, resolveReview, resolveReviewOutcome,
  organismView
} from '../lib/epistemic-ledger.mjs';

function baseRecord(recordId, claimId, organismId, version = 1) {
  return {
    schema_version: '1.0',
    record_id: recordId,
    claim: { claim_id: claimId, content: 'candidato de prueba', cognitive_type: 'understanding', epistemic_state: 'unverified', domain: 'core_conversation', conditions: [], operation: null },
    scope: { organism_id: organismId, situation_id: 'TURN-1', module: 'core', jurisdiction: { status: 'not_established' }, spatial_scope: { status: 'not_established' }, temporal_scope: { generated_at: '2026-09-08T00:00:00.000Z' }, project_version: '1', coverage: 'single_conversation_proposal' },
    origin: { event_id: 'proposal-1', agent_type: 'software_agent', agent_id: 'comprender_core_client_parser', specialty: 'core', method: 'authenticated_client_submission_of_parsed_proposal', generated_at: '2026-09-08T00:00:00.000Z' },
    support: [], dependencies: [],
    limits: { uncertainties: [{ type: 'human_reference_decision_required', state: 'unresolved' }], contradictions: [], exclusions: [] },
    verification: { verification_level: 'V1', reasoning_level: 'R1', traceability_level: 'T1', maximum_authorized_conclusion: { label: 'preliminary_conversational_candidate' }, professional_review: { performed: false, actor_id: null, artifact_ref: null }, authority_validation: { performed: false, actor_id: null, act_ref: null } },
    revision: { version, revision_of: null, supersedes: null, current: true, change_reason: 'initial_conversational_candidate' }
  };
}

function baseResult(recordId, claimId, organismId, version = 1) {
  const record = baseRecord(recordId, claimId, organismId, version);
  return { status: 'preliminary_conversational_candidate', verification_level: 'V1', validation: { ok: true }, forbidden_closure: true, epistemic_records: [record], issues: [{ type: 'human_reference_decision_required', affects: [claimId] }] };
}

test('normalizeStore() acepta 1.0 y 1.1; agrega review_events si falta; no altera entries/operations/reviews', () => {
  const legacy1_0 = { schema_version: LEDGER_SCHEMA_1_0, ledger_version: 1, entries: [{ marca: 'sin-tocar' }], operations: [{ marca: 'sin-tocar' }], reviews: [{ marca: 'sin-tocar' }] };
  const normalized = normalizeStore(legacy1_0);
  assert.equal(normalized.schema_version, LEDGER_SCHEMA_1_1);
  assert.deepStrictEqual(normalized.review_events, []);
  assert.deepStrictEqual(normalized.entries, [{ marca: 'sin-tocar' }]);
  assert.deepStrictEqual(normalized.operations, [{ marca: 'sin-tocar' }]);
  assert.deepStrictEqual(normalized.reviews, [{ marca: 'sin-tocar' }]);
  // No debe mutar el original.
  assert.equal(legacy1_0.schema_version, LEDGER_SCHEMA_1_0);
  assert.equal(legacy1_0.review_events, undefined);
});

test('normalizeStore() sobre un store 1.1 ya normalizado conserva review_events existentes', () => {
  const already1_1 = { schema_version: LEDGER_SCHEMA_1_1, ledger_version: 0, entries: [], operations: [], reviews: [], review_events: [{ marca: 'evento-previo' }] };
  const normalized = normalizeStore(already1_1);
  assert.equal(normalized.schema_version, STORE_SCHEMA);
  assert.deepStrictEqual(normalized.review_events, [{ marca: 'evento-previo' }]);
});

test('normalizeStore() no inventa un esquema válido para un schema_version desconocido: validateStore() lo rechaza', () => {
  const garbage = { schema_version: 'algo-invalido/9.9', ledger_version: 0, entries: [], operations: [], reviews: [] };
  const normalized = normalizeStore(garbage);
  assert.equal(normalized.schema_version, 'algo-invalido/9.9');
  const check = validateStore(normalized);
  assert.equal(check.ok, false);
  assert.ok(check.errors.includes('STORE_SCHEMA_INVALID'));
});

test('validateStore() exige review_events como arreglo (parte del esquema 1.1)', () => {
  const withoutEvents = { schema_version: STORE_SCHEMA, ledger_version: 0, entries: [], operations: [], reviews: [] };
  const check = validateStore(withoutEvents);
  assert.equal(check.ok, false);
  assert.ok(check.errors.includes('REVIEW_EVENTS_INVALID'));
});

test('appendResult() normaliza un store 1.0 recibido antes de operar, y abre revisión con review_event inmutable', () => {
  const legacyStore = { schema_version: LEDGER_SCHEMA_1_0, ledger_version: 0, entries: [], operations: [], reviews: [] };
  const organismId = 'org-1';
  const result = baseResult('ER-1', 'CLAIM-1', organismId);
  const outcome = appendResult(legacyStore, { enabled: true, organismId, eventRef: { type: 'proposal', id: 'proposal-1', organism_id: organismId }, result, idempotencyKey: 'key-1', expectedLedgerVersion: 0, occurredAt: '2026-09-08T00:00:00.000Z' });
  assert.equal(outcome.store.schema_version, LEDGER_SCHEMA_1_1);
  assert.equal(outcome.response.status, 'appended');
  assert.equal(outcome.review.state, 'pending_human_review');
  assert.equal(outcome.store.review_events.length, 1);
  assert.equal(outcome.store.review_events[0].type, 'opened');
  assert.equal(outcome.store.review_events[0].review_id, outcome.review.review_id);
});

test('appendResult() es idempotente: misma clave devuelve duplicate:true sin duplicar entries', () => {
  const organismId = 'org-2';
  const result = baseResult('ER-2', 'CLAIM-2', organismId);
  const store0 = emptyStore();
  const first = appendResult(store0, { enabled: true, organismId, eventRef: { type: 'proposal', id: 'proposal-2', organism_id: organismId }, result, idempotencyKey: 'dup-key', expectedLedgerVersion: 0, occurredAt: '2026-09-08T00:00:00.000Z' });
  const second = appendResult(first.store, { enabled: true, organismId, eventRef: { type: 'proposal', id: 'proposal-2', organism_id: organismId }, result, idempotencyKey: 'dup-key', expectedLedgerVersion: first.store.ledger_version, occurredAt: '2026-09-08T00:00:00.000Z' });
  assert.equal(second.response.duplicate, true);
  assert.equal(second.store.entries.length, 1);
});

test('appendResult() con misma clave y contenido distinto falla cerrado (IDEMPOTENCY_KEY_REUSED)', () => {
  const organismId = 'org-3';
  const store0 = emptyStore();
  const resultA = baseResult('ER-3', 'CLAIM-3', organismId);
  const first = appendResult(store0, { enabled: true, organismId, eventRef: { type: 'proposal', id: 'proposal-3', organism_id: organismId }, result: resultA, idempotencyKey: 'reused-key', expectedLedgerVersion: 0, occurredAt: '2026-09-08T00:00:00.000Z' });
  const resultB = baseResult('ER-4-otro', 'CLAIM-4-otro', organismId);
  assert.throws(() => appendResult(first.store, { enabled: true, organismId, eventRef: { type: 'proposal', id: 'proposal-3-otro', organism_id: organismId }, result: resultB, idempotencyKey: 'reused-key', expectedLedgerVersion: first.store.ledger_version, occurredAt: '2026-09-08T00:00:00.000Z' }), /IDEMPOTENCY_KEY_REUSED/);
});

test('entries y review_events son append-only: una segunda apertura agrega, nunca reemplaza', () => {
  const organismId = 'org-4';
  const store0 = emptyStore();
  const r1 = baseResult('ER-5', 'CLAIM-5', organismId);
  const first = appendResult(store0, { enabled: true, organismId, eventRef: { type: 'proposal', id: 'p-a', organism_id: organismId }, result: r1, idempotencyKey: 'k-a', expectedLedgerVersion: 0, occurredAt: '2026-09-08T00:00:00.000Z' });
  const r2 = baseResult('ER-6', 'CLAIM-6', organismId);
  const second = appendResult(first.store, { enabled: true, organismId, eventRef: { type: 'proposal', id: 'p-b', organism_id: organismId }, result: r2, idempotencyKey: 'k-b', expectedLedgerVersion: first.store.ledger_version, occurredAt: '2026-09-08T00:05:00.000Z' });
  assert.equal(second.store.entries.length, 2);
  assert.equal(second.store.review_events.length, 2);
  assert.equal(second.store.entries[0].record.record_id, 'ER-5');
  assert.equal(second.store.entries[1].record.record_id, 'ER-6');
});

test('resolveReview() legado sigue siendo byte-equivalente (default de fixture conservado, sólo para el banco de laboratorio)', () => {
  const organismId = 'org-legacy';
  const store0 = emptyStore();
  const result = baseResult('ER-legacy', 'CLAIM-legacy', organismId);
  const appended = appendResult(store0, { enabled: true, organismId, eventRef: { type: 'proposal', id: 'p-legacy', organism_id: organismId }, result, idempotencyKey: 'k-legacy', expectedLedgerVersion: 0 });
  const resolved = resolveReview(appended.store, appended.review.review_id, 'accept_as_reference', { actorId: 'actor-legacy' });
  const review = resolved.reviews.find(r => r.review_id === appended.review.review_id);
  assert.equal(review.state, 'accepted_as_reference');
  assert.equal(review.resolved_at, '2026-09-06T12:30:00.000Z'); // default de fixture heredado, sólo para el motor legado
});

test('resolveReviewOutcome() exige occurredAt y resolvedAt ISO-8601 explícitos; nunca usa fecha de fixture', () => {
  const organismId = 'org-5';
  const store0 = emptyStore();
  const result = baseResult('ER-7', 'CLAIM-7', organismId);
  const appended = appendResult(store0, { enabled: true, organismId, eventRef: { type: 'proposal', id: 'p-5', organism_id: organismId }, result, idempotencyKey: 'k-5', expectedLedgerVersion: 0, occurredAt: '2026-09-08T00:00:00.000Z' });
  assert.throws(() => resolveReviewOutcome(appended.store, appended.review.review_id, 'accept_as_reference', { actorId: 'actor-5', idempotencyKey: 'resolve-5', resolvedAt: '2026-09-08T00:10:00.000Z' /* falta occurredAt */ }), /OCCURRED_AT_REQUIRED_ISO8601/);
  assert.throws(() => resolveReviewOutcome(appended.store, appended.review.review_id, 'accept_as_reference', { actorId: 'actor-5', idempotencyKey: 'resolve-5', occurredAt: 'no-es-fecha' }), /OCCURRED_AT_REQUIRED_ISO8601/);
});

test('resolveReviewOutcome() agrega review_event ANTES de actualizar la proyección, y deja historia inmutable', () => {
  const organismId = 'org-6';
  const store0 = emptyStore();
  const result = baseResult('ER-8', 'CLAIM-8', organismId);
  const appended = appendResult(store0, { enabled: true, organismId, eventRef: { type: 'proposal', id: 'p-6', organism_id: organismId }, result, idempotencyKey: 'k-6', expectedLedgerVersion: 0, occurredAt: '2026-09-08T00:00:00.000Z' });
  const outcome = resolveReviewOutcome(appended.store, appended.review.review_id, 'accept_as_reference', { actorId: 'actor-6', idempotencyKey: 'resolve-6', occurredAt: '2026-09-08T00:10:00.000Z', resolvedAt: '2026-09-08T00:10:00.000Z' });
  assert.equal(outcome.response.duplicate, false);
  assert.equal(outcome.review.state, 'accepted_as_reference');
  assert.equal(outcome.store.review_events.length, 2); // apertura + resolución
  const resolvedEvent = outcome.store.review_events.find(e => e.type === 'resolved');
  assert.equal(resolvedEvent.action, 'accept_as_reference');
  assert.equal(resolvedEvent.actor_id, 'actor-6');
});

test('resolveReviewOutcome() es idempotente: misma clave + misma revisión + misma decisión -> duplicate:true, sin reescritura', () => {
  const organismId = 'org-7';
  const store0 = emptyStore();
  const result = baseResult('ER-9', 'CLAIM-9', organismId);
  const appended = appendResult(store0, { enabled: true, organismId, eventRef: { type: 'proposal', id: 'p-7', organism_id: organismId }, result, idempotencyKey: 'k-7', expectedLedgerVersion: 0, occurredAt: '2026-09-08T00:00:00.000Z' });
  const opts = { actorId: 'actor-7', idempotencyKey: 'resolve-7', occurredAt: '2026-09-08T00:10:00.000Z', resolvedAt: '2026-09-08T00:10:00.000Z' };
  const first = resolveReviewOutcome(appended.store, appended.review.review_id, 'accept_as_reference', opts);
  const second = resolveReviewOutcome(first.store, appended.review.review_id, 'accept_as_reference', opts);
  assert.equal(second.response.duplicate, true);
  assert.equal(second.store.review_events.length, 2); // no se agregó un tercer evento
});

test('resolveReviewOutcome() con misma clave y contenido distinto falla cerrado', () => {
  const organismId = 'org-8';
  const store0 = emptyStore();
  const result = baseResult('ER-10', 'CLAIM-10', organismId);
  const appended = appendResult(store0, { enabled: true, organismId, eventRef: { type: 'proposal', id: 'p-8', organism_id: organismId }, result, idempotencyKey: 'k-8', expectedLedgerVersion: 0, occurredAt: '2026-09-08T00:00:00.000Z' });
  const first = resolveReviewOutcome(appended.store, appended.review.review_id, 'accept_as_reference', { actorId: 'actor-8', idempotencyKey: 'resolve-8', occurredAt: '2026-09-08T00:10:00.000Z', resolvedAt: '2026-09-08T00:10:00.000Z' });
  assert.throws(() => resolveReviewOutcome(first.store, appended.review.review_id, 'reject', { actorId: 'actor-8-otro', idempotencyKey: 'resolve-8', occurredAt: '2026-09-08T00:11:00.000Z', resolvedAt: '2026-09-08T00:11:00.000Z' }), /IDEMPOTENCY_KEY_REUSED/);
});

test('resolveReviewOutcome() con decisión distinta y clave nueva sobre revisión ya resuelta: conflicto, sin reescritura', () => {
  const organismId = 'org-9';
  const store0 = emptyStore();
  const result = baseResult('ER-11', 'CLAIM-11', organismId);
  const appended = appendResult(store0, { enabled: true, organismId, eventRef: { type: 'proposal', id: 'p-9', organism_id: organismId }, result, idempotencyKey: 'k-9', expectedLedgerVersion: 0, occurredAt: '2026-09-08T00:00:00.000Z' });
  const first = resolveReviewOutcome(appended.store, appended.review.review_id, 'accept_as_reference', { actorId: 'actor-9', idempotencyKey: 'resolve-9-a', occurredAt: '2026-09-08T00:10:00.000Z', resolvedAt: '2026-09-08T00:10:00.000Z' });
  assert.throws(() => resolveReviewOutcome(first.store, appended.review.review_id, 'reject', { actorId: 'actor-9', idempotencyKey: 'resolve-9-b', occurredAt: '2026-09-08T00:11:00.000Z', resolvedAt: '2026-09-08T00:11:00.000Z' }), /REVIEW_ALREADY_RESOLVED/);
  const stillAccepted = first.store.reviews.find(r => r.review_id === appended.review.review_id);
  assert.equal(stillAccepted.state, 'accepted_as_reference'); // no se reescribió a 'rejected'
});

test('reapertura por nueva entrada: una segunda propuesta sobre el mismo record_id abre nueva revisión sin tocar la entrada histórica', () => {
  const organismId = 'org-10';
  const store0 = emptyStore();
  const r1 = baseResult('ER-12', 'CLAIM-12', organismId, 1);
  const first = appendResult(store0, { enabled: true, organismId, eventRef: { type: 'proposal', id: 'p-10', organism_id: organismId }, result: r1, idempotencyKey: 'k-10-a', expectedLedgerVersion: 0, occurredAt: '2026-09-08T00:00:00.000Z' });
  const r2 = baseResult('ER-12', 'CLAIM-12', organismId, 2); // misma record_id, revisión 2
  const second = appendResult(first.store, { enabled: true, organismId, eventRef: { type: 'proposal', id: 'p-10-b', organism_id: organismId }, result: r2, idempotencyKey: 'k-10-b', expectedLedgerVersion: first.store.ledger_version, occurredAt: '2026-09-08T00:05:00.000Z' });
  assert.equal(second.store.entries.length, 2);
  assert.equal(second.store.entries[0].record.revision.version, 1);
  assert.equal(second.store.entries[1].record.revision.version, 2);
  assert.equal(second.review.state, 'pending_human_review');
  const view = organismView(second.store, organismId);
  assert.equal(view.current_records.length, 1);
  assert.equal(view.current_records[0].revision.version, 2);
});
