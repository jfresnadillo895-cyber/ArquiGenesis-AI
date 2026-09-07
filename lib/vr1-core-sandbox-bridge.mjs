import {
  SANDBOX_ENGINE_VERSION, emptyStore, validateStore, appendResult, resolveReview,
  organismView, exportPortable, inspectPortable, clone, fingerprint
} from './vr1-core-sandbox-engine.mjs';

const contract = window.__VR1_CORE_SANDBOX_CONTRACT__;
const STORE_KEY = 'ag_vr1_core_sandbox_ledger_v1';
const FLAG_KEY = 'ag_vr1_core_sandbox_enabled_v1';
let volatileStore = emptyStore();
let storageStatus = 'localStorage';

// --- Mensajes de estado del ensayo (122.30) ---
// Constantes compartidas para que el mensaje mostrado al encender/apagar el
// ensayo (setEnabled) y el mensaje mostrado al recargar la página con el flag
// ya activo desde una sesión previa (más abajo, al final del módulo) sean
// siempre el mismo texto -- ver corrección 1 de VR1SBCORR02.
const MESSAGE_ENABLED = 'Ensayo habilitado. Sólo se escribirá el sidecar sandbox.';
const MESSAGE_DISABLED_ON_TOGGLE = 'Ensayo apagado. No se preparan nuevas escrituras.';
let lastMessage = 'Ensayo apagado. El Core funciona sin depender de VR-1.';

// --- Barrera de flag real (122.29 · corrección Claude/staging) ---
// Con el flag apagado: no se monta botón ni panel, no se registran listeners,
// no se lee ni escribe el ledger, y toda operación pública devuelve
// { ok:false, error:'FEATURE_DISABLED' } sin ningún otro efecto secundario.
function disabledResult() { return { ok: false, error: 'FEATURE_DISABLED' }; }

// --- Diccionario de presentación (122.30 · corrección 2 de VR1SBCORR02) ---
// SOLO decide qué texto legible se pinta en el panel para un valor canónico
// conocido. Nunca se usa para leer, comparar, guardar o validar nada: el
// ledger, el store, los fixtures y el motor (vr1-core-sandbox-engine.mjs)
// siguen viendo y persistiendo exactamente los mismos valores internos de
// siempre (result.status, review.state, unresolved[].type) sin pasar por
// este diccionario en ningún momento -- ver render(), único lugar donde se
// usa presentationLabel().
const PRESENTATION_LABELS = {
  status: {
    preliminary_conditional_compatibility: 'Compatibilidad condicional preliminar'
  },
  reviewState: {
    pending_human_review: 'Revisión humana pendiente',
    accepted_as_reference: 'Aceptada como referencia',
    corrected_as_reference: 'Corregida como referencia',
    rejected: 'Rechazada'
  },
  unresolvedType: {
    official_parcel_location: 'Ubicación catastral oficial',
    exhaustive_normative_validity: 'Vigencia normativa exhaustiva',
    official_operational_formulas: 'Fórmulas operativas oficiales',
    complete_use_and_building_requirements: 'Requisitos completos de uso y edificación',
    professional_review: 'Revisión profesional',
    authority_validation: 'Validación de autoridad competente',
    annex_ii_original: 'Anexo II original'
  }
};

// Fallback seguro: un identificador canónico que todavía no está en el
// diccionario (por ejemplo, un fixture nuevo con un `status` distinto) nunca
// rompe el render ni muestra "undefined" -- se muestra una versión legible
// del propio identificador (guiones bajos por espacios, primera letra en
// mayúscula) en vez de ocultarlo o inventar un texto.
function presentationLabel(dictionaryKey, rawValue) {
  if (!rawValue) return rawValue;
  const known = PRESENTATION_LABELS[dictionaryKey]?.[rawValue];
  if (known) return known;
  const text = String(rawValue).replace(/_/g, ' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function readLocal(key) {
  try { return window.localStorage.getItem(key); }
  catch (_) { storageStatus = 'volatile_memory'; return null; }
}

function writeLocal(key, value) {
  try { window.localStorage.setItem(key, value); return true; }
  catch (_) { storageStatus = 'volatile_memory'; return false; }
}

function enabled() { return readLocal(FLAG_KEY) === 'true'; }

function isEnabled() {
  return enabled() || window.__VR1_SANDBOX_VOLATILE_ENABLED__ === true;
}

function loadStore() {
  const raw = readLocal(STORE_KEY);
  if (!raw) return clone(volatileStore);
  try {
    const parsed = JSON.parse(raw);
    const checked = validateStore(parsed);
    if (!checked.ok) throw new Error(checked.errors.join(','));
    return parsed;
  } catch (error) {
    storageStatus = 'invalid_local_store';
    lastMessage = `Sidecar local inválido: ${error.message}`;
    return clone(volatileStore);
  }
}

function saveStore(store) {
  volatileStore = clone(store);
  if (!writeLocal(STORE_KEY, JSON.stringify(store))) storageStatus = 'volatile_memory';
}

function activeOrganism() {
  return contract?.getActiveOrganism?.() || null;
}

function eventFromMemory(organism) {
  const memory = Array.isArray(organism?.recuerdos) ? organism.recuerdos.at(-1) : null;
  if (!memory?.id) throw new Error('El organismo activo no tiene un Recuerdo estable para enlazar.');
  return { type: 'memory', id: memory.id, organism_id: organism.id };
}

function attach(result, eventRef, idempotencyKey = null) {
  if (!isEnabled()) return disabledResult();
  const organism = activeOrganism();
  if (!organism) throw new Error('Abrí primero el organismo piloto desde Tu espacio.');
  const store = loadStore();
  const key = idempotencyKey || `sandbox:${organism.id}:${eventRef.type}:${eventRef.id}:${result?.provenance?.input_sha256 || fingerprint(result)}`;
  const outcome = appendResult(store, {
    enabled: isEnabled(), organismId: organism.id, eventRef, result,
    idempotencyKey: key, expectedLedgerVersion: store.ledger_version,
    occurredAt: new Date().toISOString()
  });
  saveStore(outcome.store);
  lastMessage = outcome.response.duplicate ? 'Reintento reconocido: no se duplicaron registros.' : `${outcome.response.appended} registros adjuntados al sidecar.`;
  render();
  return outcome;
}

function attachPilotBase() {
  if (!isEnabled()) return disabledResult();
  const organism = activeOrganism();
  if (!organism || organism.id !== window.VR1_PILOT_ORGANISM?.id) throw new Error('Importá y abrí el organismo sintético antes de adjuntar el caso.');
  return attach(window.VR1_PILOT_RESULT, eventFromMemory(organism));
}

function attachPilotContradiction() {
  if (!isEnabled()) return disabledResult();
  const organism = activeOrganism();
  if (!organism || organism.id !== window.VR1_PILOT_ORGANISM?.id) throw new Error('Abrí el organismo sintético.');
  return attach(window.VR1_PILOT_CONTRADICTION, { type: 'specialty_return', id: 'ret_sandbox_norma_posterior_001', organism_id: organism.id });
}

function resolve(reviewId, action) {
  if (!isEnabled()) return disabledResult();
  const actorId = window.prompt('Identificador del actor humano para este ensayo:');
  if (!actorId?.trim()) throw new Error('La revisión no se resolvió: falta actor humano.');
  const next = resolveReview(loadStore(), reviewId, action, { actorId: actorId.trim(), resolvedAt: new Date().toISOString() });
  saveStore(next);
  lastMessage = 'Revisión resuelta como referencia. La ficha y los recuerdos no fueron modificados.';
  render();
  return next;
}

function importPilotOrganism() {
  // Punto corregido 122.29: sin flag habilitado, esta función jamás llega a
  // llamar al importador real del Core (contract.importCoreBackup). Antes del
  // corte 122.29 esta guarda no existía.
  if (!isEnabled()) return disabledResult();
  if (!contract?.importCoreBackup || !window.VR1_PILOT_ORGANISM) throw new Error('Contrato Core o fixture no disponible.');
  contract.importCoreBackup({ producto: 'Comprender AI', version: 'corte-b', exportado: new Date().toISOString(), organismos: [clone(window.VR1_PILOT_ORGANISM)], sesiones: [] });
  const opened = contract.openOrganismById?.(window.VR1_PILOT_ORGANISM.id) === true;
  lastMessage = opened ? 'Organismo piloto importado y abierto mediante funciones reales del Core.' : 'Organismo piloto importado. Abrilo desde Tu espacio.';
  render();
  return { ok: true };
}

function exportBackup() {
  if (!isEnabled()) return disabledResult();
  if (!contract?.buildCoreBackup) throw new Error('Exportador Core no disponible.');
  return exportPortable(contract.buildCoreBackup(), loadStore());
}

function importBackup(payload) {
  if (!isEnabled()) return disabledResult();
  const inspection = inspectPortable(payload);
  if (!inspection.ok) throw new Error(inspection.errors.join(','));
  contract.importCoreBackup(payload);
  saveStore(inspection.store);
  lastMessage = inspection.legacy ? 'Respaldo anterior importado: no contenía sidecar.' : 'Respaldo Core + sidecar importado y verificado.';
  render();
  return inspection;
}

function downloadJson(value, name) {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = name; document.body.appendChild(anchor); anchor.click(); anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 500);
}

function el(tag, text = null) {
  const node = document.createElement(tag);
  if (text !== null) node.textContent = text;
  return node;
}

// --- Montaje/desmontaje de UI: sólo ocurre mientras el flag está encendido ---
let style = null, launch = null, panel = null;

function mountUI() {
  if (panel) return; // ya montado
  style = el('style');
  style.textContent = `
#vr1sb-launch{position:fixed;left:14px;bottom:14px;z-index:100001;border:1px solid #77e0b5;background:#0d1714;color:#dff9ee;border-radius:999px;padding:9px 13px;font:700 11px system-ui;letter-spacing:.06em}
#vr1sb-panel{position:fixed;inset:12px;z-index:100002;display:none;overflow:auto;background:#09100ef5;color:#eef7f3;border:1px solid #2a3b35;border-radius:16px;padding:20px;font:14px/1.45 system-ui;box-shadow:0 20px 80px #000b}
#vr1sb-panel.open{display:block}#vr1sb-panel h2{margin:0 0 4px;font-size:24px}#vr1sb-panel h3{font-size:11px;text-transform:uppercase;letter-spacing:.1em;color:#9bb0a8;margin:0 0 8px}
.vr1sb-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin:14px 0}.vr1sb-card,.vr1sb-block{background:#111b18;border:1px solid #2a3b35;border-radius:12px;padding:13px}.vr1sb-card strong{color:#77e0b5}.vr1sb-actions{display:flex;flex-wrap:wrap;gap:8px;margin:10px 0}.vr1sb-actions button{border:1px solid #3a5048;background:#17231f;color:#eef7f3;border-radius:8px;padding:8px 10px}.vr1sb-actions button.primary{border-color:#77e0b5}.vr1sb-actions button.warn{border-color:#f4c76b}.vr1sb-muted{color:#9bb0a8}.vr1sb-notice{border:1px solid #f4c76b;background:#2a2314;padding:10px;border-radius:9px}.vr1sb-review{border-top:1px solid #2a3b35;padding-top:10px;margin-top:10px}#vr1sb-io{width:100%;min-height:120px;background:#070c0b;color:#eef7f3;border:1px solid #2a3b35;border-radius:8px;padding:9px;font:11px ui-monospace,monospace}@media(max-width:760px){.vr1sb-grid{grid-template-columns:1fr 1fr}}@media(max-width:440px){.vr1sb-grid{grid-template-columns:1fr}}
`;
  document.head.appendChild(style);
  launch = el('button', 'VR-1 · sandbox'); launch.id = 'vr1sb-launch'; document.body.appendChild(launch);
  panel = el('section'); panel.id = 'vr1sb-panel'; document.body.appendChild(panel);
  launch.addEventListener('click', () => { panel.classList.add('open'); render(); });
}

function unmountUI() {
  if (launch) { launch.remove(); launch = null; }
  if (panel) { panel.remove(); panel = null; }
  if (style) { style.remove(); style = null; }
}

function setEnabled(value) {
  const next = Boolean(value);
  window.__VR1_SANDBOX_VOLATILE_ENABLED__ = next;
  writeLocal(FLAG_KEY, next ? 'true' : 'false');
  lastMessage = next ? MESSAGE_ENABLED : MESSAGE_DISABLED_ON_TOGGLE;
  if (next) { mountUI(); render(); }
  else { unmountUI(); }
  return next;
}

function button(label, fn, className = '') {
  const node = el('button', label); node.className = className;
  node.addEventListener('click', () => { try { fn(); } catch (error) { lastMessage = error.message; render(); } });
  return node;
}

function card(title, main, detail) {
  const node = el('article'); node.className = 'vr1sb-card'; node.append(el('h3', title), el('strong', main), el('p', detail)); return node;
}

function render() {
  if (!isEnabled()) return disabledResult();
  if (!panel) return disabledResult(); // defensivo: sin UI montada no hay nada que pintar
  const organism = activeOrganism();
  const view = organism ? organismView(loadStore(), organism.id) : null;
  const result = view?.result;
  panel.replaceChildren();
  const close = button('Cerrar', () => panel.classList.remove('open'));
  close.style.float = 'right'; panel.appendChild(close);
  panel.append(el('div', '122.28 · ENSAYO DESCARTABLE'), el('h2', 'VR-1 dentro del Core sandbox'));
  const meta = el('p', `Motor ${SANDBOX_ENGINE_VERSION} · ${isEnabled() ? 'habilitado' : 'apagado'} · almacenamiento ${storageStatus} · organismo ${organism?.id || 'ninguno abierto'}`); meta.className = 'vr1sb-muted'; panel.appendChild(meta);
  const notice = el('div', lastMessage); notice.className = 'vr1sb-notice'; panel.appendChild(notice);
  const actions = el('div'); actions.className = 'vr1sb-actions';
  actions.append(
    button(isEnabled() ? 'Apagar ensayo' : 'Habilitar ensayo', () => setEnabled(!isEnabled()), 'primary'),
    button('Importar organismo piloto', importPilotOrganism),
    button('Adjuntar caso base', attachPilotBase),
    button('Simular norma posterior', attachPilotContradiction, 'warn')
  );
  panel.appendChild(actions);
  const grid = el('div'); grid.className = 'vr1sb-grid';
  grid.append(
    card('Resultado', result ? presentationLabel('status', result.status) : 'Sin registro', result ? `${result.verification_level} · estado trazable` : 'El Core continúa sin depender del sidecar.'),
    card('Evidencia', String(result?.evidence_links || 0), 'Vínculos conservados en registros, no en Memoria.'),
    card('Pendientes', String(result?.unresolved?.length || 0), result?.unresolved?.slice(0, 3).map(type => presentationLabel('unresolvedType', type)).join(' · ') || 'Sin evaluación adjunta.'),
    card('Alcance', 'Preliminar', 'No constituye revisión profesional ni aprobación municipal.')
  );
  panel.appendChild(grid);
  const reviewBlock = el('div'); reviewBlock.className = 'vr1sb-block'; reviewBlock.appendChild(el('h3', 'Revisiones humanas'));
  const reviews = view?.reviews || [];
  if (!reviews.length) reviewBlock.appendChild(el('p', 'No hay revisiones epistemológicas para este organismo.'));
  for (const review of reviews) {
    const row = el('div'); row.className = 'vr1sb-review';
    row.append(el('strong', `${review.review_id} · ${presentationLabel('reviewState', review.state)}`), el('p', `Cambios: ${review.changed_claims.join(', ')} · Afectadas: ${review.affected_claims.map(x => x.claim_id).join(', ') || 'ninguna'}`));
    if (review.state === 'pending_human_review') {
      const controls = el('div'); controls.className = 'vr1sb-actions';
      controls.append(button('Aceptar como referencia', () => resolve(review.review_id, 'accept_as_reference')), button('Rechazar', () => resolve(review.review_id, 'reject'))); row.appendChild(controls);
    }
    reviewBlock.appendChild(row);
  }
  panel.appendChild(reviewBlock);
  const io = el('div'); io.className = 'vr1sb-block'; io.appendChild(el('h3', 'Respaldo portable'));
  const textarea = el('textarea'); textarea.id = 'vr1sb-io'; textarea.placeholder = 'Exportá o pegá aquí un respaldo Core + sidecar'; io.appendChild(textarea);
  const ioActions = el('div'); ioActions.className = 'vr1sb-actions';
  ioActions.append(
    button('Preparar respaldo', () => { textarea.value = JSON.stringify(exportBackup(), null, 2); }),
    button('Descargar respaldo', () => downloadJson(exportBackup(), `comprender_vr1_sandbox_${new Date().toISOString().slice(0, 10)}.json`)),
    button('Importar texto', () => { if (!textarea.value.trim()) throw new Error('Pegá un respaldo primero.'); importBackup(JSON.parse(textarea.value)); })
  );
  io.appendChild(ioActions); panel.appendChild(io);
  return { ok: true };
}

function getStore() {
  if (!isEnabled()) return disabledResult();
  return clone(loadStore());
}

function getActiveView() {
  if (!isEnabled()) return disabledResult();
  const org = activeOrganism();
  return org ? organismView(loadStore(), org.id) : null;
}

window.VR1Sandbox = Object.freeze({
  version: SANDBOX_ENGINE_VERSION,
  setEnabled, isEnabled, getStore, getActiveView,
  attach, attachPilotBase, attachPilotContradiction, importPilotOrganism, resolveReview: resolve,
  exportBackup, importBackup, render
});

// Con el flag ya encendido de una sesión previa (localStorage), se remonta la UI.
// Con el flag apagado (el caso por defecto), este módulo no monta nada, no agrega
// listeners y no toca el ledger: sólo deja expuesto window.VR1Sandbox para que
// setEnabled(true) pueda activarlo explícitamente.
//
// Corrección 1 de VR1SBCORR02: antes, en este caso (flag ya activo al recargar),
// lastMessage se quedaba con el texto por defecto de "apagado" (línea de arriba)
// porque nada lo actualizaba hasta el próximo setEnabled(). El primer render()
// de la sesión mostraba entonces un mensaje que contradecía el estado real. Se
// sincroniza acá, antes del primer render(), con el mismo texto que usa
// setEnabled(true).
if (isEnabled()) {
  lastMessage = MESSAGE_ENABLED;
  mountUI();
}
if (panel) render();
