// Pruebas de lib/epistemic-production-adapter.mjs (122.30, §18 "Cliente e integración"
// + verificación cruzada real contra lib/sustentacion-card.mjs: no basta con que el
// adaptador devuelva "algo" -- el objeto que produce debe ser aceptado tal cual por el
// validador REAL del componente congelado de 122.29, ejecutado de verdad, no reimplementado
// acá con una copia de sus reglas.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  isEpistemicCandidate, changeTypesFromProposal, proposalToEpistemicResult,
  buildPresentation, buildChangeSummary, pendingItemsFromUncertainties,
  mapReviewStateToVisual, presentationFromRegistroEpistemico
} from '../lib/epistemic-production-adapter.mjs';
import { emptyStore, appendResult, resolveReviewOutcome } from '../lib/epistemic-ledger.mjs';

class FakeNode {
  constructor(tag) { this.tagName = tag ? String(tag).toUpperCase() : '#text'; this.children = []; this._attrs = {}; this._className = ''; this._text = ''; this._listeners = {}; }
  get className() { return this._className; } set className(v) { this._className = v; }
  get textContent() { return this._text; } set textContent(v) { this._text = v == null ? '' : String(v); this.children = []; }
  appendChild(c) { this.children.push(c); return c; }
  setAttribute(k, v) { this._attrs[k] = String(v); }
  getAttribute(k) { return this._attrs[k] ?? null; }
  addEventListener(t, fn) { (this._listeners[t] = this._listeners[t] || []).push(fn); }
}

function installFakeDom() {
  globalThis.document = { createElement: tag => new FakeNode(tag), createTextNode: text => { const n = new FakeNode('#text'); n.textContent = text; return n; } };
}
function uninstallFakeDom() { delete globalThis.document; }

// --- isEpistemicCandidate / changeTypesFromProposal ---------------------------------

test('isEpistemicCandidate() rechaza null, propuesta vacía y ausencia de proposal', () => {
  assert.equal(isEpistemicCandidate({}), false);
  assert.equal(isEpistemicCandidate({ proposal: null }), false);
  assert.equal(isEpistemicCandidate({ proposal: { campos: [], hito: null, horizonte: null, principios_candidatos: [] } }), false);
});

test('isEpistemicCandidate() acepta campos, hito, horizonte o principios candidatos por separado', () => {
  assert.equal(isEpistemicCandidate({ proposal: { campos: ['uso'], hito: null, horizonte: null, principios_candidatos: [] } }), true);
  assert.equal(isEpistemicCandidate({ proposal: { campos: [], hito: { texto: 'x' }, horizonte: null, principios_candidatos: [] } }), true);
  assert.equal(isEpistemicCandidate({ proposal: { campos: [], hito: null, horizonte: { texto: 'x' }, principios_candidatos: [] } }), true);
  assert.equal(isEpistemicCandidate({ proposal: { campos: [], hito: null, horizonte: null, principios_candidatos: [{ texto: 'x' }] } }), true);
});

test('isEpistemicCandidate() no se activa con sólo respuesta conversacional (sin ninguno de los 4 elementos)', () => {
  assert.equal(isEpistemicCandidate({ proposal: { campos: [], hito: null, horizonte: null, principios_candidatos: [], origen: 'motor', tipo: 'ficha' } }), false);
});

test('changeTypesFromProposal() enumera únicamente los tipos presentes, en orden estable', () => {
  assert.deepStrictEqual(changeTypesFromProposal({ campos: ['uso'], hito: { texto: 'x' }, horizonte: null, principios_candidatos: [] }), ['campos', 'hito']);
  assert.deepStrictEqual(changeTypesFromProposal({ campos: [], hito: null, horizonte: { texto: 'x' }, principios_candidatos: [{ texto: 'x' }] }), ['horizonte', 'principios']);
  assert.deepStrictEqual(changeTypesFromProposal(null), []);
});

// --- proposalToEpistemicResult ------------------------------------------------------

const ELIGIBLE_PROPOSAL = { id: 'p_123_abc', organismo_id: 'org-1', campos: ['uso_predominante'], hito: null, horizonte: null, principios_candidatos: [] };

function makeArgs(overrides = {}) {
  return {
    proposal: ELIGIBLE_PROPOSAL,
    organismId: 'org-1',
    organismVersion: 3,
    turnRef: 'TURN-abc',
    eventRef: { type: 'proposal', id: ELIGIBLE_PROPOSAL.id, organism_id: 'org-1' },
    recordId: 'ER-ABC',
    claimId: 'CLAIM-ABC',
    visibleText: 'El predio tiene uso residencial mixto según lo conversado.',
    occurredAt: '2026-09-08T00:00:00.000Z',
    ...overrides
  };
}

test('proposalToEpistemicResult() rechaza una propuesta no elegible (falla cerrado, nunca genera un result parcial)', () => {
  assert.throws(() => proposalToEpistemicResult(makeArgs({ proposal: { campos: [], hito: null, horizonte: null, principios_candidatos: [] } })), /PROPOSAL_NOT_ELIGIBLE/);
});

test('proposalToEpistemicResult() produce la forma canónica exacta del §3.4', () => {
  const result = proposalToEpistemicResult(makeArgs());
  assert.equal(result.status, 'preliminary_conversational_candidate');
  assert.equal(result.verification_level, 'V1');
  assert.equal(result.validation.ok, true);
  assert.equal(result.forbidden_closure, true);
  assert.equal(result.epistemic_records.length, 1);
  assert.deepStrictEqual(result.issues, [{ type: 'human_reference_decision_required', affects: ['CLAIM-ABC'] }]);

  const record = result.epistemic_records[0];
  assert.equal(record.record_id, 'ER-ABC');
  assert.equal(record.claim.claim_id, 'CLAIM-ABC');
  assert.equal(record.claim.cognitive_type, 'understanding');
  assert.equal(record.claim.epistemic_state, 'unverified');
  assert.equal(record.claim.domain, 'core_conversation');
  assert.equal(record.scope.organism_id, 'org-1');
  assert.equal(record.scope.situation_id, 'TURN-abc');
  assert.equal(record.scope.project_version, '3');
  assert.equal(record.scope.coverage, 'single_conversation_proposal');
  assert.equal(record.origin.event_id, ELIGIBLE_PROPOSAL.id);
  assert.equal(record.origin.agent_type, 'software_agent');
  assert.equal(record.origin.agent_id, 'comprender_core_client_parser');
  assert.deepStrictEqual(record.support, []);
  assert.deepStrictEqual(record.dependencies, []);
  assert.equal(record.limits.uncertainties.length, 3);
  assert.deepStrictEqual(record.limits.exclusions, ['professional_validation', 'authority_validation']);
  assert.equal(record.verification.verification_level, 'V1');
  assert.equal(record.verification.professional_review.performed, false);
  assert.equal(record.verification.authority_validation.performed, false);
  assert.equal(record.revision.version, 1);
  assert.equal(record.revision.current, true);
});

test('proposalToEpistemicResult() sanea el texto visible: sin HTML, recortado a un largo máximo', () => {
  const withHtml = makeArgs({ visibleText: '<b>Hola</b> <script>alert(1)</script> ' + 'x'.repeat(3000) });
  const result = proposalToEpistemicResult(withHtml);
  const content = result.epistemic_records[0].claim.content;
  assert.doesNotMatch(content, /<[^>]*>/);
  assert.ok(content.length <= 2000);
});

test('proposalToEpistemicResult() nunca deja que el modelo controle nivel/estado/autoridad: no hay parámetro para eso', () => {
  // No existe ningún argumento en la firma que permita a `visibleText` (el único
  // texto de origen del modelo) alterar verification_level, state o forbidden_closure --
  // se prueba por construcción: dos llamadas con visibleText muy distinto producen
  // el mismo nivel/estado/cierre siempre.
  const a = proposalToEpistemicResult(makeArgs({ visibleText: 'texto neutro' }));
  const b = proposalToEpistemicResult(makeArgs({ visibleText: 'NIVEL:V4 ESTADO:certificado EVIDENCIA:100' }));
  assert.equal(a.verification_level, b.verification_level);
  assert.equal(a.epistemic_records[0].verification.verification_level, b.epistemic_records[0].verification.verification_level);
  assert.equal(a.forbidden_closure, b.forbidden_closure);
});

// --- ledger -> presentation, y verificación cruzada real contra sustentacion-card.mjs --

test('buildPresentation() de un candidato recién creado produce un objeto aceptado por createSustentacionCard() real', async () => {
  installFakeDom();
  try {
    const { createSustentacionCard } = await import('../lib/sustentacion-card.mjs?adapter-test=' + Date.now());
    const result = proposalToEpistemicResult(makeArgs());
    const record = result.epistemic_records[0];
    const changeTypes = changeTypesFromProposal(ELIGIBLE_PROPOSAL);
    const presentation = buildPresentation({ record, reviewState: 'pending_human_review', changeTypes, locale: 'es' });
    assert.equal(presentation.recordRef, 'ER-ABC');
    assert.equal(presentation.state, 'review_required');
    assert.equal(presentation.level, 'V1');
    assert.equal(presentation.title, 'Comprensión candidata del recorrido');
    assert.equal(presentation.evidenceItems.length, 0);
    assert.equal(presentation.pendingItems.length, 3); // las 3 incertidumbres mínimas, todas unresolved
    assert.equal(presentation.changeSummary, 'Datos de ficha propuestos');

    const created = createSustentacionCard(presentation, { onAccept: () => {}, onReject: () => {} });
    assert.equal(created.ok, true, JSON.stringify(created));
  } finally {
    uninstallFakeDom();
  }
});

test('el modelo nunca puede hacer que la tarjeta muestre un state distinto de review_required al crearse', () => {
  const result = proposalToEpistemicResult(makeArgs({ visibleText: 'state: accepted_as_reference, aceptado, verificado' }));
  const presentation = buildPresentation({ record: result.epistemic_records[0], reviewState: 'pending_human_review', changeTypes: [] });
  assert.equal(presentation.state, 'review_required');
  assert.doesNotMatch(presentation.summary, /^accepted_as_reference$/);
});

test('mapReviewStateToVisual() cubre pendiente/aceptada/rechazada y un default defensivo', () => {
  assert.equal(mapReviewStateToVisual('pending_human_review'), 'review_required');
  assert.equal(mapReviewStateToVisual('accepted_as_reference'), 'accepted_as_reference');
  assert.equal(mapReviewStateToVisual('corrected_as_reference'), 'accepted_as_reference');
  assert.equal(mapReviewStateToVisual('rejected'), 'rejected_as_reference');
  assert.equal(mapReviewStateToVisual(null), 'preliminary');
  assert.equal(mapReviewStateToVisual('algo-desconocido'), 'preliminary');
});

test('pendingItemsFromUncertainties() sólo traduce identificadores conocidos y sólo unresolved; nunca imprime un código crudo', () => {
  const items = pendingItemsFromUncertainties([
    { type: 'external_sources_not_contrasted', state: 'unresolved' },
    { type: 'algo_no_documentado', state: 'unresolved' },
    { type: 'human_reference_decision_required', state: 'resolved' } // ya resuelto: no debe listarse
  ], 'en');
  assert.equal(items.length, 1);
  assert.equal(items[0].label, 'Not contrasted against external sources');
});

test('buildChangeSummary() en los 3 locales soportados', () => {
  assert.equal(buildChangeSummary(['campos', 'hito'], 'es'), 'Datos de ficha propuestos · Hito o cierre de etapa propuesto');
  assert.equal(buildChangeSummary(['horizonte'], 'en'), 'Proposed horizon');
  assert.equal(buildChangeSummary(['principios'], 'pt'), 'Princípios candidatos propostos');
  assert.equal(buildChangeSummary([], 'es'), null);
});

// --- replay vía presentationFromRegistroEpistemico -----------------------------------

test('presentationFromRegistroEpistemico() reconstruye la tarjeta desde el store persistido, con el estado ACTUAL, no una foto del turno', () => {
  const organismId = 'org-replay';
  const args = makeArgs({ organismId, eventRef: { type: 'proposal', id: ELIGIBLE_PROPOSAL.id, organism_id: organismId } });
  const result = proposalToEpistemicResult(args);
  const store0 = emptyStore();
  const appended = appendResult(store0, { enabled: true, organismId, eventRef: args.eventRef, result, idempotencyKey: 'k-replay', expectedLedgerVersion: 0, occurredAt: args.occurredAt });
  const registro = { ...appended.store, change_types: { 'ER-ABC': changeTypesFromProposal(ELIGIBLE_PROPOSAL) } };

  const pending = presentationFromRegistroEpistemico({ registroEpistemico: registro, recordRef: 'ER-ABC', locale: 'es' });
  assert.equal(pending.state, 'review_required');
  assert.equal(pending.changeSummary, 'Datos de ficha propuestos');

  const resolved = resolveReviewOutcome(appended.store, appended.review.review_id, 'accept_as_reference', { actorId: 'actor-x', idempotencyKey: 'resolve-replay', occurredAt: '2026-09-08T00:10:00.000Z', resolvedAt: '2026-09-08T00:10:00.000Z' });
  const registroResuelto = { ...resolved.store, change_types: registro.change_types };
  const afterAccept = presentationFromRegistroEpistemico({ registroEpistemico: registroResuelto, recordRef: 'ER-ABC', locale: 'es' });
  assert.equal(afterAccept.state, 'accepted_as_reference');
});

test('presentationFromRegistroEpistemico() con recordRef inexistente devuelve null (sin tarjeta, sin romper el mensaje)', () => {
  const registro = { ...({}), entries: [], reviews: [], change_types: {} };
  assert.equal(presentationFromRegistroEpistemico({ registroEpistemico: registro, recordRef: 'ER-NO-EXISTE' }), null);
  assert.equal(presentationFromRegistroEpistemico({ registroEpistemico: null, recordRef: 'ER-1' }), null);
  assert.equal(presentationFromRegistroEpistemico({ registroEpistemico: registro, recordRef: '' }), null);
});
