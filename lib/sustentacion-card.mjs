/* 122.29 · lib/sustentacion-card.mjs
 * Componente visual PURO para el resultado de sustentación epistémica.
 *
 * No conoce marcadores [[SUSTENTACION:...]] (no existen en producción).
 * No llama a registrarMomento(), guardarOrganismo() ni localStorage.
 * No importa nada de vr1-dev-suite/ ni del bridge de laboratorio.
 * No maneja identidad de usuario -- onAccept/onReject reciben sólo recordRef.
 *
 * API pública:
 *   createSustentacionCard(presentation, { onAccept, onReject } = {})
 *     -> { ok: true,  node: HTMLElement }
 *     -> { ok: false, reason: 'INVALID_PRESENTATION_STATE' | 'INVALID_PRESENTATION_OBJECT' }
 *
 * `presentation` es el único objeto validado. `actions` nunca se copia al DOM
 * ni forma parte del objeto validado -- llega separado, tal como lo definió
 * la enmienda final del contrato 122.29 (v3 + adenda).
 */

export const INVALID_PRESENTATION_STATE = 'INVALID_PRESENTATION_STATE';
export const INVALID_PRESENTATION_OBJECT = 'INVALID_PRESENTATION_OBJECT';

const VALID_STATES = [
  'preliminary',
  'review_required',
  'accepted_as_reference',
  'rejected_as_reference'
];

// Encabezado humano por estado (fuente ES -- pasa siempre por t()).
const STATE_HEADING = {
  preliminary: 'COMPRENSIÓN PRELIMINAR',
  review_required: 'ESTA COMPRENSIÓN NECESITA REVISIÓN',
  accepted_as_reference: 'COMPRENSIÓN ACEPTADA COMO REFERENCIA',
  rejected_as_reference: 'COMPRENSIÓN NO INCORPORADA'
};

// Clase presentacional por estado -- NUNCA es el valor interno de `state`,
// sólo un gancho de estilo (no es un identificador técnico ni se prueba como tal).
const STATE_VISUAL_CLASS = {
  preliminary: 'is-preliminary',
  review_required: 'is-review',
  accepted_as_reference: 'is-accepted',
  rejected_as_reference: 'is-rejected'
};

// Traducción controlada de `level`. Un nivel no listado nunca se imprime
// (crudo ni de ninguna otra forma) -- fallo cerrado, igual que con `state`.
const LEVEL_LABELS = {
  V1: 'Nivel de sustentación: preliminar'
};

const MAX_TITLE_LEN = 160;
const MAX_SUMMARY_LEN = 600;
const MAX_SCOPE_LEN = 600;
const MAX_VISIBLE_ITEMS = 5;

function isNonEmptyString(v) {
  return typeof v === 'string' && v.length > 0;
}

function isPlainObject(v) {
  return v != null && typeof v === 'object' && !Array.isArray(v);
}

/* ---------------------------------------------------------------------
 * i18n -- un único punto de acceso a ComprenderI18n, inyectable en pruebas.
 * ------------------------------------------------------------------- */

let injectedI18n = null;

/** Sólo para pruebas: inyecta un ComprenderI18n de reemplazo. No se usa en producción. */
export function __setI18nForTests(i18n) {
  injectedI18n = i18n;
}

function getI18n() {
  if (injectedI18n) return injectedI18n;
  if (typeof globalThis !== 'undefined' && globalThis.ComprenderI18n) {
    return globalThis.ComprenderI18n;
  }
  return null;
}

function t(es) {
  const i18n = getI18n();
  if (!i18n || typeof i18n.t !== 'function') return es;
  try {
    const out = i18n.t(es);
    return typeof out === 'string' ? out : es;
  } catch (e) {
    return es;
  }
}

function formatNumberSafe(n) {
  const i18n = getI18n();
  if (i18n && typeof i18n.formatNumber === 'function') {
    try {
      return i18n.formatNumber(n);
    } catch (e) {
      /* cae al fallback */
    }
  }
  return String(n);
}

/* ---------------------------------------------------------------------
 * Listener global único de idioma (una sola suscripción para todo el
 * módulo, nunca una por tarjeta). Las tarjetas ya no conectadas al DOM
 * se descartan del registro automáticamente al disparar un cambio.
 * ------------------------------------------------------------------- */

const connectedCards = new Set();
let globalListenerRegistered = false;

function isNodeConnected(node) {
  if (!node) return false;
  if (typeof node.isConnected === 'boolean') return node.isConnected;
  // Fallback para entornos sin la propiedad nativa: recorre parentNode.
  let cur = node;
  while (cur) {
    if (cur.__isDocumentRoot) return true;
    cur = cur.parentNode || null;
  }
  return false;
}

function ensureGlobalI18nListener() {
  if (globalListenerRegistered) return;
  const i18n = getI18n();
  if (!i18n || typeof i18n.onChange !== 'function') return;
  i18n.onChange(function onLocaleChange() {
    for (const card of Array.from(connectedCards)) {
      if (!isNodeConnected(card.node)) {
        connectedCards.delete(card);
        continue;
      }
      card.refreshTexts();
    }
  });
  globalListenerRegistered = true;
}

/* ---------------------------------------------------------------------
 * Validación del objeto de presentación (§3/§8 del contrato v3).
 * Sólo se valida `presentation` -- `actions` nunca entra acá.
 * ------------------------------------------------------------------- */

function validateEvidenceItem(item) {
  if (typeof item === 'string') return { label: item, url: null };
  if (isPlainObject(item) && isNonEmptyString(item.label)) {
    let url = null;
    if (isNonEmptyString(item.url)) {
      try {
        const parsed = new URL(item.url);
        if (parsed.protocol === 'https:') url = item.url;
      } catch (e) {
        url = null;
      }
    }
    return { label: item.label, url };
  }
  return null;
}

/**
 * Devuelve { presentation: <objeto normalizado> } si es válido,
 * o { reason: INVALID_PRESENTATION_STATE | INVALID_PRESENTATION_OBJECT } si no.
 */
function validatePresentation(presentation) {
  if (!isPlainObject(presentation)) {
    return { reason: INVALID_PRESENTATION_OBJECT };
  }
  const { recordRef, state, level, title, summary } = presentation;

  if (!isNonEmptyString(recordRef)) {
    return { reason: INVALID_PRESENTATION_OBJECT };
  }
  if (typeof state !== 'string' || !VALID_STATES.includes(state)) {
    return { reason: INVALID_PRESENTATION_STATE };
  }
  if (!isNonEmptyString(title) || title.length > MAX_TITLE_LEN) {
    return { reason: INVALID_PRESENTATION_OBJECT };
  }
  if (!isNonEmptyString(summary) || summary.length > MAX_SUMMARY_LEN) {
    return { reason: INVALID_PRESENTATION_OBJECT };
  }

  const rawEvidence = Array.isArray(presentation.evidenceItems) ? presentation.evidenceItems : [];
  const rawPending = Array.isArray(presentation.pendingItems) ? presentation.pendingItems : [];
  const evidenceItems = rawEvidence.map(validateEvidenceItem).filter(Boolean);
  const pendingItems = rawPending.map(validateEvidenceItem).filter(Boolean);

  let scope = null;
  if (isNonEmptyString(presentation.scope)) {
    scope = presentation.scope.length > MAX_SCOPE_LEN
      ? presentation.scope.slice(0, MAX_SCOPE_LEN) + '…'
      : presentation.scope;
  } else if (Array.isArray(presentation.scope)) {
    scope = presentation.scope.filter(x => typeof x === 'string');
  }

  let changeSummary = null;
  if (isNonEmptyString(presentation.changeSummary)) {
    changeSummary = presentation.changeSummary.length > MAX_SCOPE_LEN
      ? presentation.changeSummary.slice(0, MAX_SCOPE_LEN) + '…'
      : presentation.changeSummary;
  }

  const humanReview = isPlainObject(presentation.humanReview) ? presentation.humanReview : null;
  const normalizedLevel = isNonEmptyString(level) ? level : null;

  return {
    presentation: {
      recordRef, state, level: normalizedLevel, title, summary,
      evidenceItems, pendingItems, scope, changeSummary, humanReview
    }
  };
}

/* ---------------------------------------------------------------------
 * Construcción del DOM.
 * ------------------------------------------------------------------- */

function buildCountList(container, items, emptyTextEs) {
  container.textContent = '';
  if (items.length === 0) {
    const p = document.createElement('p');
    p.className = 'sustentacion-card__empty';
    p.textContent = t(emptyTextEs);
    container.appendChild(p);
    return;
  }
  const ul = document.createElement('ul');
  ul.className = 'sustentacion-card__list';
  const visible = items.slice(0, MAX_VISIBLE_ITEMS);
  visible.forEach(function (item) {
    const li = document.createElement('li');
    if (item.url) {
      const a = document.createElement('a');
      a.setAttribute('href', item.url);
      a.setAttribute('target', '_blank');
      a.setAttribute('rel', 'noopener noreferrer');
      a.textContent = item.label;
      li.appendChild(a);
    } else {
      li.textContent = item.label;
    }
    ul.appendChild(li);
  });
  const remaining = items.length - visible.length;
  if (remaining > 0) {
    const li = document.createElement('li');
    li.className = 'sustentacion-card__more';
    li.textContent = '+' + formatNumberSafe(remaining) + ' ' + t('más');
    ul.appendChild(li);
  }
  container.appendChild(ul);
}

function countLabel(count, singularEs, pluralEs) {
  return formatNumberSafe(count) + ' ' + t(count === 1 ? singularEs : pluralEs);
}

/**
 * createSustentacionCard(presentation, actions) -> { ok, node|reason }
 */
export function createSustentacionCard(presentation, actions) {
  const safeActions = isPlainObject(actions) ? actions : {};
  const validated = validatePresentation(presentation);
  if (validated.reason) {
    return { ok: false, reason: validated.reason };
  }
  const p = validated.presentation;

  ensureGlobalI18nListener();

  // -- estado mutable de esta instancia (nunca en el DOM como identificador) --
  let currentState = p.state;
  let busy = false;

  const root = document.createElement('div');
  root.className = 'sustentacion-card';

  const badge = document.createElement('div');
  badge.className = 'sustentacion-card__badge';

  const summaryText = document.createElement('p');
  summaryText.className = 'sustentacion-card__summary';
  summaryText.textContent = p.summary;

  const evidenceDetails = document.createElement('details');
  evidenceDetails.className = 'sustentacion-card__details';
  const evidenceSummary = document.createElement('summary');
  evidenceDetails.appendChild(evidenceSummary);
  const evidenceBody = document.createElement('div');
  evidenceDetails.appendChild(evidenceBody);

  const pendingDetails = document.createElement('details');
  pendingDetails.className = 'sustentacion-card__details';
  const pendingSummary = document.createElement('summary');
  pendingDetails.appendChild(pendingSummary);
  const pendingBody = document.createElement('div');
  pendingDetails.appendChild(pendingBody);

  const scopeDetails = document.createElement('details');
  scopeDetails.className = 'sustentacion-card__details';
  const scopeSummary = document.createElement('summary');
  scopeDetails.appendChild(scopeSummary);
  const scopeBody = document.createElement('div');
  scopeDetails.appendChild(scopeBody);

  const actionsRow = document.createElement('div');
  actionsRow.className = 'sustentacion-card__actions';

  const statusRegion = document.createElement('div');
  statusRegion.className = 'sustentacion-card__status';
  statusRegion.setAttribute('role', 'status');
  statusRegion.setAttribute('aria-live', 'polite');

  root.appendChild(badge);
  root.appendChild(summaryText);
  root.appendChild(evidenceDetails);
  root.appendChild(pendingDetails);
  root.appendChild(scopeDetails);
  root.appendChild(actionsRow);
  root.appendChild(statusRegion);

  function renderScopeBody() {
    scopeBody.textContent = '';
    const isReview = currentState === 'review_required';
    const text = isReview ? p.changeSummary : (typeof p.scope === 'string' ? p.scope : null);
    const scopeArray = !isReview && Array.isArray(p.scope) ? p.scope : null;

    if (text) {
      const para = document.createElement('p');
      para.textContent = text;
      scopeBody.appendChild(para);
    } else if (scopeArray && scopeArray.length) {
      const ul = document.createElement('ul');
      scopeArray.slice(0, MAX_VISIBLE_ITEMS).forEach(function (line) {
        const li = document.createElement('li');
        li.textContent = line;
        ul.appendChild(li);
      });
      scopeBody.appendChild(ul);
    } else {
      const para = document.createElement('p');
      para.className = 'sustentacion-card__empty';
      para.textContent = t('Sin información adicional.');
      scopeBody.appendChild(para);
    }

    const levelLabel = p.level ? LEVEL_LABELS[p.level] : null;
    if (levelLabel) {
      const levelPara = document.createElement('p');
      levelPara.className = 'sustentacion-card__level';
      levelPara.textContent = t(levelLabel);
      scopeBody.appendChild(levelPara);
    }
  }

  function refreshTexts() {
    badge.textContent = t(STATE_HEADING[currentState] || '');
    evidenceSummary.textContent = t('Evidencia') + ' · ' + countLabel(p.evidenceItems.length, 'evidencia', 'evidencias');
    pendingSummary.textContent = t('Pendientes') + ' · ' + countLabel(p.pendingItems.length, 'pendiente', 'pendientes');
    scopeSummary.textContent = currentState === 'review_required' ? t('Ver cambios') : t('Ver alcance');
    buildCountList(evidenceBody, p.evidenceItems, 'Sin evidencia registrada.');
    buildCountList(pendingBody, p.pendingItems, 'Sin pendientes registrados.');
    renderScopeBody();
    renderActions();

    root.className = 'sustentacion-card ' + (STATE_VISUAL_CLASS[currentState] || '');
  }

  function setStatusMessage(msg) {
    statusRegion.textContent = msg ? t(msg) : '';
  }

  function handleDecision(kind) {
    if (busy) return;
    const cb = kind === 'accept' ? safeActions.onAccept : safeActions.onReject;
    if (typeof cb !== 'function') return; // fallo seguro: no debería poder llegar acá (botón no se renderiza)
    busy = true;
    setActionsDisabled(true);
    setStatusMessage(null);

    let result;
    try {
      result = cb(p.recordRef);
    } catch (e) {
      result = Promise.reject(e);
    }
    Promise.resolve(result).then(
      function onSuccess() {
        busy = false;
        currentState = kind === 'accept' ? 'accepted_as_reference' : 'rejected_as_reference';
        refreshTexts();
        setStatusMessage(
          kind === 'accept'
            ? 'La aceptación incorpora este resultado como referencia del organismo. No constituye validación profesional, decisión final ni aprobación oficial.'
            : 'Este resultado no se incorpora como referencia del organismo. La acción no modifica la ficha ni los recuerdos.'
        );
      },
      function onError() {
        busy = false;
        setActionsDisabled(false);
        setStatusMessage('No se pudo registrar la decisión. Podés intentar de nuevo.');
      }
    );
  }

  let acceptBtn = null;
  let rejectBtn = null;

  function setActionsDisabled(disabled) {
    if (acceptBtn) acceptBtn.disabled = disabled;
    if (rejectBtn) rejectBtn.disabled = disabled;
  }

  function renderActions() {
    actionsRow.textContent = '';
    acceptBtn = null;
    rejectBtn = null;
    if (currentState !== 'review_required') return;

    if (typeof safeActions.onAccept === 'function') {
      acceptBtn = document.createElement('button');
      acceptBtn.type = 'button';
      acceptBtn.className = 'btn primary sustentacion-card__accept';
      acceptBtn.textContent = t('Aceptar como referencia');
      acceptBtn.addEventListener('click', function () { handleDecision('accept'); });
      actionsRow.appendChild(acceptBtn);
    }
    if (typeof safeActions.onReject === 'function') {
      rejectBtn = document.createElement('button');
      rejectBtn.type = 'button';
      rejectBtn.className = 'btn secundario sustentacion-card__reject';
      rejectBtn.textContent = t('No incorporar');
      rejectBtn.addEventListener('click', function () { handleDecision('reject'); });
      actionsRow.appendChild(rejectBtn);
    }
  }

  refreshTexts();

  connectedCards.add({ node: root, refreshTexts: refreshTexts });

  return { ok: true, node: root };
}

/* Auto-registro en window -- único punto de contacto con index.html (el hook opcional de
   addMotorMsg() llama a window.__sustentacionCard.create(...)). No es persistencia ni estado
   compartido: sólo expone esta misma función pura bajo un nombre estable, una vez, al cargar
   el módulo -- exactamente lo que permite que index.html no tenga que hacer import() dinámico
   en cada mensaje (ver contrato 122.29, corrección 7). En Node (pruebas) `window` no existe y
   este bloque no hace nada. */
if (typeof window !== 'undefined') {
  window.__sustentacionCard = { create: createSustentacionCard };
}
