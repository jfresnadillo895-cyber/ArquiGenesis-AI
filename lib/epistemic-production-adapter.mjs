// lib/epistemic-production-adapter.mjs
//
// Adaptador productivo (122.30, §10). Puro, sin I/O: no persiste, no lee el DOM,
// no importa vr1-dev-suite/ ni el bridge de laboratorio, no interpreta texto libre
// del modelo para asignar estado. Se ejecuta indistintamente en el servidor
// (api/organismos.js, Node) y en el cliente (index.html, navegador) -- por eso no
// depende de `window`, `document` ni `ComprenderI18n`: su propia i18n es un conjunto
// cerrado de tablas ES/EN/PT, autosuficiente.
//
// Responsabilidades exclusivas (§10):
//   - isEpistemicCandidate(): política determinista de elegibilidad (§3.1);
//   - proposalToEpistemicResult(): traducción cerrada propuesta -> result (§3.4);
//   - ledger -> presentation: mapear una revisión pendiente/aceptada/rechazada a
//     los cuatro estados visuales y devolver el objeto exacto validado por
//     lib/sustentacion-card.mjs.
//
// No puede: persistir; leer el DOM; interpretar el texto visible para asignar
// estado; inventar evidencia desde un conteo; exponer IDs internos; importar
// vr1-dev-suite/ ni el bridge de sandbox.

export const LOCALES = Object.freeze(['es', 'en', 'pt']);
const DEFAULT_LOCALE = 'es';

function normalizeLocale(locale) {
  return LOCALES.includes(locale) ? locale : DEFAULT_LOCALE;
}

function isPlainObject(v) {
  return v != null && typeof v === 'object' && !Array.isArray(v);
}

function isNonEmptyString(v) {
  return typeof v === 'string' && v.trim().length > 0;
}

function isNonEmptyArray(v) {
  return Array.isArray(v) && v.length > 0;
}

/* -----------------------------------------------------------------------
 * §3.1 · Política determinista de elegibilidad
 * ---------------------------------------------------------------------- */

// isEpistemicCandidate({ proposal }) -> boolean
//
// Sólo devuelve true cuando `proposal` (la propuesta normalizada ya construida
// por el camino real de proponerFicha() en index.html) trae al menos uno de:
// campos candidatos, hito/cierre, horizonte, o principios candidatos. Una
// respuesta conversacional simple, o DIAG/TENSION/FUNCION por sí solos, nunca
// activan la tarjeta -- esta función no mira nada de eso, sólo la propuesta.
export function isEpistemicCandidate({ proposal } = {}) {
  if (!isPlainObject(proposal)) return false;
  const tieneCampos = isNonEmptyArray(proposal.campos);
  const tieneHito = proposal.hito != null && proposal.hito !== false;
  const tieneHorizonte = proposal.horizonte != null && proposal.horizonte !== false;
  const tienePrincipios = isNonEmptyArray(proposal.principios_candidatos);
  return tieneCampos || tieneHito || tieneHorizonte || tienePrincipios;
}

// changeTypesFromProposal(proposal) -> string[]
//
// Vocabulario cerrado de códigos de tipo de cambio, derivado de forma puramente
// estructural de la propuesta real (nunca del texto libre del modelo). Se
// persiste junto al registro (ver registerEpistemicRecord en api/organismos.js)
// para que el changeSummary pueda reconstruirse correctamente en el replay, sin
// tener que volver a leer la propuesta original (que sólo vive en el cliente,
// en ag_core_propuestas -- almacenamiento exclusivamente local).
export function changeTypesFromProposal(proposal) {
  if (!isPlainObject(proposal)) return [];
  const types = [];
  if (isNonEmptyArray(proposal.campos)) types.push('campos');
  if (proposal.hito != null && proposal.hito !== false) types.push('hito');
  if (proposal.horizonte != null && proposal.horizonte !== false) types.push('horizonte');
  if (isNonEmptyArray(proposal.principios_candidatos)) types.push('principios');
  return types;
}

/* -----------------------------------------------------------------------
 * Saneamiento de texto visible (§3.3, §3.4)
 * ---------------------------------------------------------------------- */

const MAX_CLAIM_CONTENT_LEN = 2000;
const MAX_SUMMARY_DISPLAY_LEN = 600; // debe caber dentro de MAX_SUMMARY_LEN de sustentacion-card.mjs

// Extrae un extracto textual sanitizado: sin etiquetas HTML, colapsa espacios,
// recorta a un largo máximo. No interpreta el contenido -- sólo lo acota.
function sanitizeExcerpt(text, maxLen) {
  const raw = typeof text === 'string' ? text : '';
  const withoutTags = raw.replace(/<[^>]*>/g, ' ');
  const collapsed = withoutTags.replace(/\s+/g, ' ').trim();
  if (collapsed.length <= maxLen) return collapsed;
  return collapsed.slice(0, maxLen - 1).trimEnd() + '…';
}

/* -----------------------------------------------------------------------
 * §3.4 · Traducción obligatoria proposal -> result
 * ---------------------------------------------------------------------- */

// Forma cerrada exacta especificada en el contrato 122.30 §3.4. El servidor es
// quien invoca esta función (dentro de create_epistemic_candidate, api/organismos.js)
// con recordId/claimId/occurredAt ya generados por él mismo -- nunca por el cliente.
export function proposalToEpistemicResult({
  proposal, organismId, organismVersion, turnRef, eventRef,
  recordId, claimId, visibleText, occurredAt
} = {}) {
  if (!isEpistemicCandidate({ proposal })) {
    throw new Error('PROPOSAL_NOT_ELIGIBLE');
  }
  if (!isNonEmptyString(organismId)) throw new Error('ORGANISM_ID_REQUIRED');
  if (!isNonEmptyString(turnRef)) throw new Error('TURN_REF_REQUIRED');
  if (!isPlainObject(eventRef) || !isNonEmptyString(eventRef.id)) throw new Error('EVENT_REF_REQUIRED');
  if (!isNonEmptyString(recordId)) throw new Error('RECORD_ID_REQUIRED');
  if (!isNonEmptyString(claimId)) throw new Error('CLAIM_ID_REQUIRED');
  if (!isNonEmptyString(occurredAt)) throw new Error('OCCURRED_AT_REQUIRED');

  const content = sanitizeExcerpt(visibleText, MAX_CLAIM_CONTENT_LEN);

  const record = {
    schema_version: '1.0',
    record_id: recordId,
    claim: {
      claim_id: claimId,
      content,
      cognitive_type: 'understanding',
      epistemic_state: 'unverified',
      domain: 'core_conversation',
      conditions: [],
      operation: null
    },
    scope: {
      organism_id: organismId,
      situation_id: turnRef,
      module: 'core',
      jurisdiction: { status: 'not_established' },
      spatial_scope: { status: 'not_established' },
      temporal_scope: { generated_at: occurredAt },
      project_version: String(organismVersion),
      coverage: 'single_conversation_proposal'
    },
    origin: {
      event_id: eventRef.id,
      agent_type: 'software_agent',
      agent_id: 'comprender_core_client_parser',
      specialty: 'core',
      method: 'authenticated_client_submission_of_parsed_proposal',
      generated_at: occurredAt
    },
    support: [],
    dependencies: [],
    limits: {
      uncertainties: [
        { type: 'external_sources_not_contrasted', state: 'unresolved' },
        { type: 'human_reference_decision_required', state: 'unresolved' },
        { type: 'model_origin_not_server_attested', state: 'unresolved' }
      ],
      contradictions: [],
      exclusions: ['professional_validation', 'authority_validation']
    },
    verification: {
      verification_level: 'V1',
      reasoning_level: 'R1',
      traceability_level: 'T1',
      maximum_authorized_conclusion: { label: 'preliminary_conversational_candidate' },
      professional_review: { performed: false, actor_id: null, artifact_ref: null },
      authority_validation: { performed: false, actor_id: null, act_ref: null }
    },
    revision: {
      version: 1,
      revision_of: null,
      supersedes: null,
      current: true,
      change_reason: 'initial_conversational_candidate'
    }
  };

  return {
    status: 'preliminary_conversational_candidate',
    verification_level: 'V1',
    validation: { ok: true }, // sólo validación estructural/de política -- nunca verdad del contenido
    forbidden_closure: true,
    epistemic_records: [record],
    issues: [{ type: 'human_reference_decision_required', affects: [claimId] }]
  };
}

/* -----------------------------------------------------------------------
 * §3.3 / §10 · Tablas cerradas ES/EN/PT y ledger -> presentation
 * ---------------------------------------------------------------------- */

const TITLE_TABLE = {
  es: 'Comprensión candidata del recorrido',
  en: 'Candidate understanding from the journey',
  pt: 'Compreensão candidata do percurso'
};

const SCOPE_TABLE = {
  es: 'Candidato conversacional preliminar del Core. No constituye revisión profesional ni validación de autoridad.',
  en: 'Preliminary conversational candidate from the Core. Does not constitute professional review or authority validation.',
  pt: 'Candidato conversacional preliminar do Core. Não constitui revisão profissional nem validação de autoridade.'
};

const CHANGE_TYPE_TABLE = {
  campos: { es: 'Datos de ficha propuestos', en: 'Proposed profile fields', pt: 'Dados de ficha propostos' },
  hito: { es: 'Hito o cierre de etapa propuesto', en: 'Proposed milestone or stage close', pt: 'Marco ou fechamento de etapa proposto' },
  horizonte: { es: 'Horizonte propuesto', en: 'Proposed horizon', pt: 'Horizonte proposto' },
  principios: { es: 'Principios candidatos propuestos', en: 'Candidate principles proposed', pt: 'Princípios candidatos propostos' }
};

const UNCERTAINTY_TABLE = {
  external_sources_not_contrasted: { es: 'Sin contraste con fuentes externas', en: 'Not contrasted against external sources', pt: 'Sem contraste com fontes externas' },
  human_reference_decision_required: { es: 'Requiere decisión humana de incorporación', en: 'Requires human reference decision', pt: 'Requer decisão humana de incorporação' },
  model_origin_not_server_attested: { es: 'Origen del modelo no atestiguado por el servidor', en: 'Model origin not server-attested', pt: 'Origem do modelo não atestada pelo servidor' }
};

function tableText(table, key, locale) {
  const entry = table[key];
  if (!entry) return null;
  return entry[locale] || entry[DEFAULT_LOCALE];
}

// buildChangeSummary(changeTypes, locale) -> string|null
export function buildChangeSummary(changeTypes, locale) {
  const loc = normalizeLocale(locale);
  const list = Array.isArray(changeTypes) ? changeTypes : [];
  const labels = list.map(code => tableText(CHANGE_TYPE_TABLE, code, loc)).filter(Boolean);
  return labels.length ? labels.join(' · ') : null;
}

// pendingItemsFromUncertainties(uncertainties, locale) -> [{label,url}]
//
// Sólo traduce identificadores ya presentes en el registro (tabla cerrada); un
// tipo no reconocido no se imprime crudo -- se descarta en vez de inventarse una
// etiqueta. Sólo las incertidumbres todavía "unresolved" se muestran como
// pendientes.
export function pendingItemsFromUncertainties(uncertainties, locale) {
  const loc = normalizeLocale(locale);
  const list = Array.isArray(uncertainties) ? uncertainties : [];
  return list
    .filter(u => u && u.state === 'unresolved')
    .map(u => tableText(UNCERTAINTY_TABLE, u.type, loc))
    .filter(Boolean)
    .map(label => ({ label, url: null }));
}

// evidenceItemsFromSupport(support) -> [{label,url}]
//
// El adaptador nunca infiere evidencia desde un conteo: sólo la recupera si el
// registro trae un arreglo estructurado real en `support[]`. En 122.30, todo
// registro nuevo nace con support: [] (§3.4) -- este mapeo existe para no
// perder evidencia real si una revisión futura del esquema la agrega.
export function evidenceItemsFromSupport(support) {
  const list = Array.isArray(support) ? support : [];
  return list
    .map(item => {
      if (isNonEmptyString(item?.label)) {
        const url = isNonEmptyString(item.url) ? item.url : null;
        return { label: item.label, url: url && /^https:\/\//.test(url) ? url : null };
      }
      return null;
    })
    .filter(Boolean);
}

// mapReviewStateToVisual(reviewState) -> uno de los 4 estados visuales de
// lib/sustentacion-card.mjs. Nunca deriva el estado del texto visible -- sólo
// del `state` canónico ya persistido en el ledger.
export function mapReviewStateToVisual(reviewState) {
  switch (reviewState) {
    case 'pending_human_review': return 'review_required';
    case 'accepted_as_reference': return 'accepted_as_reference';
    case 'corrected_as_reference': return 'accepted_as_reference';
    case 'rejected': return 'rejected_as_reference';
    default: return 'preliminary'; // sin revisión asociada -- estado defensivo, no usado por 122.30
  }
}

// buildPresentation({ record, reviewState, changeTypes, locale }) -> objeto
// EXACTO que valida lib/sustentacion-card.mjs (recordRef, state, level, title,
// summary, evidenceItems, pendingItems, scope, changeSummary). No incluye
// `actions` -- eso lo arma el llamador (index.html), que es quien conoce los
// callbacks de red hacia create_epistemic_candidate/resolve_epistemic_review.
export function buildPresentation({ record, reviewState = null, changeTypes = [], locale = DEFAULT_LOCALE } = {}) {
  if (!isPlainObject(record) || !isNonEmptyString(record.record_id)) return null;
  const loc = normalizeLocale(locale);
  const state = mapReviewStateToVisual(reviewState);
  return {
    recordRef: record.record_id,
    state,
    level: record?.verification?.verification_level || null,
    title: TITLE_TABLE[loc],
    summary: isNonEmptyString(record?.claim?.content) ? sanitizeExcerpt(record.claim.content, MAX_SUMMARY_DISPLAY_LEN) : SCOPE_TABLE[loc],
    evidenceItems: evidenceItemsFromSupport(record?.support),
    pendingItems: pendingItemsFromUncertainties(record?.limits?.uncertainties, loc),
    scope: SCOPE_TABLE[loc],
    changeSummary: buildChangeSummary(changeTypes, loc),
    humanReview: null
  };
}

// presentationFromRegistroEpistemico({ registroEpistemico, recordRef, locale })
//
// Camino de replay/reconstrucción (§9.2) y de respuesta del servidor (§7.3 paso
// 10): a partir del subárbol persistido `registro_epistemico` (la forma del
// store de lib/epistemic-ledger.mjs, con el agregado de `change_types` -- ver
// nota de diseño más abajo) y un `recordRef`, reconstruye la presentación
// vigente. Devuelve null si el recordRef no existe o el subárbol es inválido:
// el llamador no debe mostrar tarjeta ni romper el mensaje.
//
// Nota de diseño (documentada también en el informe de cierre): el esquema
// cerrado del `record` epistémico (§3.4) no tiene lugar para retener qué tipos
// de contenido (campos/hito/horizonte/principios) traía la propuesta original
// -- sólo un resumen textual agregado. Para que el replay pueda reconstruir
// `changeSummary` sin volver a leer la propuesta original (que además sólo
// vive en almacenamiento local del cliente), `registro_epistemico` guarda,
// junto al store del ledger, un mapa adicional `change_types: { [record_id]:
// string[] }`, calculado siempre por el servidor de forma puramente
// estructural a partir de la propuesta real (nunca por el modelo, nunca por
// el cliente). Esto no modifica ni contamina el esquema cerrado de `record`
// en sí -- es un campo hermano, fuera de `entries[]`.
export function presentationFromRegistroEpistemico({ registroEpistemico, recordRef, locale = DEFAULT_LOCALE } = {}) {
  if (!isPlainObject(registroEpistemico) || !isNonEmptyString(recordRef)) return null;
  const entries = Array.isArray(registroEpistemico.entries) ? registroEpistemico.entries : [];
  const matching = entries.filter(e => e?.record?.record_id === recordRef);
  if (!matching.length) return null;
  const latestEntry = matching.reduce((best, e) => (!best || e.record.revision.version > best.record.revision.version) ? e : best, null);
  const record = latestEntry.record;
  const claimId = record?.claim?.claim_id;
  const reviews = Array.isArray(registroEpistemico.reviews) ? registroEpistemico.reviews : [];
  const relatedReviews = reviews.filter(r => Array.isArray(r.changed_claims) && claimId && r.changed_claims.includes(claimId));
  const latestReview = relatedReviews.length ? relatedReviews[relatedReviews.length - 1] : null;
  const changeTypesMap = isPlainObject(registroEpistemico.change_types) ? registroEpistemico.change_types : {};
  const changeTypes = Array.isArray(changeTypesMap[recordRef]) ? changeTypesMap[recordRef] : [];
  return buildPresentation({ record, reviewState: latestReview ? latestReview.state : null, changeTypes, locale });
}

/* Auto-registro en window -- único punto de contacto con index.html, mismo patrón que usa
   lib/sustentacion-card.mjs para window.__sustentacionCard (122.29). En Node (pruebas y
   api/organismos.js) `window` no existe y este bloque no hace nada; el servidor sigue
   importando las funciones nombradas directamente. index.html sólo necesita este adaptador
   para: (a) evaluar isEpistemicCandidate() antes de pedir la creación del candidato, y
   (b) reconstruir la presentación en replay vía presentationFromRegistroEpistemico(). No
   necesita nunca cargar lib/epistemic-ledger.mjs del lado del cliente -- ese módulo es
   exclusivamente servidor (api/organismos.js) y laboratorio (lib/vr1-core-sandbox-bridge.mjs). */
if (typeof window !== 'undefined') {
  window.__epistemicAdapter = {
    isEpistemicCandidate, changeTypesFromProposal, presentationFromRegistroEpistemico, buildPresentation,
  };
}
