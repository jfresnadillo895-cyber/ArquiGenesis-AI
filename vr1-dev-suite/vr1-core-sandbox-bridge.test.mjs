// Prueba de barrera de flag real para lib/vr1-core-sandbox-bridge.mjs (122.29).
// No depende de Playwright ni de un navegador: arma un DOM/localStorage mínimos
// en Node (mismo patrón que sandbox/tests/run-core-bank.mjs) e importa el
// bridge como módulo ES real, para ejercer exactamente el código que corre en
// el navegador.
//
// Objetivo: demostrar, con aserciones, que con el flag apagado:
//   - no se monta botón ni panel;
//   - no se importa el organismo piloto (no se llama al importador real del Core);
//   - no se crea ni modifica el ledger (localStorage del sidecar nunca se escribe);
//   - no se registran listeners (no hay elementos a los que atarlos);
//   - toda operación pública devuelve { ok:false, error:'FEATURE_DISABLED' }.
// Y que, con el flag encendido, el comportamiento original se preserva.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
// Fixture real del caso base VR-1 (mismo contenido que vr1/EVR-TL-001.result.json /
// results/EVR-TL-001.result.json en el paquete), no un objeto inventado a mano.
const REAL_BASE_RESULT = JSON.parse(fs.readFileSync(path.join(HERE, '..', 'vr1', 'EVR-TL-001.result.json'), 'utf8'));

class FakeClassList {
  constructor() { this.s = new Set(); }
  add(...xs) { xs.forEach(x => this.s.add(x)); }
  remove(...xs) { xs.forEach(x => this.s.delete(x)); }
  contains(x) { return this.s.has(x); }
}
class FakeElement {
  constructor(tag = 'div') {
    this.tagName = String(tag).toUpperCase();
    this.style = {};
    this.classList = new FakeClassList();
    this.children = [];
    this.parentNode = null;
    this.id = '';
    this.textContent = '';
    this._listeners = {};
  }
  appendChild(x) { this.children.push(x); x.parentNode = this; return x; }
  append(...xs) { xs.forEach(x => this.appendChild(x)); }
  remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(c => c !== this); this.parentNode = null; }
  replaceChildren() { this.children = []; }
  addEventListener(type, fn) { (this._listeners[type] ||= []).push(fn); }
  click() { (this._listeners.click || []).forEach(fn => fn()); }
}

const store = new Map();
const localStorage = {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: k => store.delete(k),
  clear: () => store.clear()
};

const document = {
  head: new FakeElement('head'),
  body: new FakeElement('body'),
  createElement(tag) { return new FakeElement(tag); }
};

let importCoreBackupCalls = 0;
const pilotOrganism = { id: 'ORG-SYNTHETIC-001', recuerdos: [{ id: 'rec_fixture_001' }] };
let activeOrganism = null;

const contract = Object.freeze({
  getActiveOrganism: () => (activeOrganism ? JSON.parse(JSON.stringify(activeOrganism)) : null),
  listOrganisms: () => [],
  openOrganismById: (id) => { if (id === pilotOrganism.id) { activeOrganism = pilotOrganism; return true; } return false; },
  buildCoreBackup: () => ({ producto: 'Comprender AI', organismos: activeOrganism ? [activeOrganism] : [] }),
  importCoreBackup: () => { importCoreBackupCalls += 1; return { ok: true }; },
  getCoreVersion: () => null,
  authorityBoundary: Object.freeze({ directFichaWrite: false, directRecuerdoWrite: false, humanReviewRequired: true })
});

globalThis.window = {
  localStorage,
  __VR1_CORE_SANDBOX_CONTRACT__: contract,
  VR1_PILOT_ORGANISM: pilotOrganism,
  VR1_PILOT_RESULT: null,
  VR1_PILOT_CONTRADICTION: null,
  prompt: () => 'tester-qa',
  __VR1_SANDBOX_VOLATILE_ENABLED__: undefined
};
globalThis.document = document;
globalThis.localStorage = localStorage;
globalThis.Blob = class { constructor() {} };
globalThis.URL = { createObjectURL: () => 'blob:fake', revokeObjectURL: () => {} };

const STORE_KEY = 'ag_vr1_core_sandbox_ledger_v1';
const FLAG_KEY = 'ag_vr1_core_sandbox_enabled_v1';

const mod = await import('./vr1-core-sandbox-bridge.mjs');
const Sandbox = window.VR1Sandbox;

test('flag apagado (estado por defecto) · window.VR1Sandbox existe pero no monta nada', () => {
  assert.equal(typeof Sandbox, 'object');
  assert.equal(document.body.children.length, 0, 'no debe haber elementos montados en body');
  assert.equal(document.head.children.length, 0, 'no debe haber <style> inyectado en head');
});

test('flag apagado · isEnabled() es false por defecto', () => {
  assert.equal(Sandbox.isEnabled(), false);
});

test('flag apagado · importPilotOrganism() rechaza y NO llama al importador real del Core', () => {
  const before = importCoreBackupCalls;
  const result = Sandbox.importPilotOrganism();
  assert.deepEqual(result, { ok: false, error: 'FEATURE_DISABLED' });
  assert.equal(importCoreBackupCalls, before, 'el importador real del Core no debe haberse invocado');
});

test('flag apagado · toda operación pública devuelve FEATURE_DISABLED sin tocar el ledger', () => {
  const ops = ['attachPilotBase', 'attachPilotContradiction', 'exportBackup', 'getStore', 'getActiveView', 'render'];
  for (const op of ops) {
    const result = Sandbox[op]();
    assert.deepEqual(result, { ok: false, error: 'FEATURE_DISABLED' }, `${op}() debe rechazar mientras el flag está apagado`);
  }
  assert.equal(localStorage.getItem(STORE_KEY), null, 'el ledger sandbox nunca debe escribirse mientras el flag está apagado');
  const reviewResult = Sandbox.resolveReview('cualquiera', 'accept_as_reference');
  assert.deepEqual(reviewResult, { ok: false, error: 'FEATURE_DISABLED' });
  const importResult = Sandbox.importBackup({});
  assert.deepEqual(importResult, { ok: false, error: 'FEATURE_DISABLED' });
});

test('flag apagado · attach() de bajo nivel también rechaza sin crear entradas', () => {
  const result = Sandbox.attach({}, { type: 'memory', id: 'x', organism_id: 'y' });
  assert.deepEqual(result, { ok: false, error: 'FEATURE_DISABLED' });
});

test('setEnabled(true) · monta botón y panel, y habilita las operaciones', () => {
  const changed = Sandbox.setEnabled(true);
  assert.equal(changed, true);
  assert.equal(Sandbox.isEnabled(), true);
  assert.equal(document.body.children.some(c => c.id === 'vr1sb-launch'), true, 'debe montar el botón de lanzamiento');
  assert.equal(document.body.children.some(c => c.id === 'vr1sb-panel'), true, 'debe montar el panel');
  assert.equal(document.head.children.length, 1, 'debe inyectar el <style> del panel');
});

test('flag encendido · importPilotOrganism() ahora sí llama al importador real y abre el organismo', () => {
  const before = importCoreBackupCalls;
  const result = Sandbox.importPilotOrganism();
  assert.equal(result.ok, true);
  assert.equal(importCoreBackupCalls, before + 1);
  assert.equal(Sandbox.getActiveView()?.organism_id, pilotOrganism.id);
});

test('flag encendido · attachPilotBase() escribe el ledger sandbox (sidecar), no la ficha ni los recuerdos', () => {
  window.VR1_PILOT_RESULT = REAL_BASE_RESULT;
  const outcome = Sandbox.attachPilotBase();
  assert.equal(outcome.response.status, 'appended');
  assert.equal(localStorage.getItem(STORE_KEY) !== null, true, 'el sidecar sí debe escribirse con el flag encendido');
  assert.equal(pilotOrganism.ficha, undefined, 'la ficha del organismo no fue tocada');
  assert.equal(pilotOrganism.recuerdos.length, 1, 'los recuerdos del organismo no fueron tocados');
});

// --- VR1SBCORR02 (122.30) · corrección 2: diccionario de presentación ---
test('presentación · Resultado y Pendientes muestran texto legible, no los identificadores técnicos crudos', () => {
  Sandbox.render();
  const activePanel = document.body.children.find(c => c.id === 'vr1sb-panel');
  assert.ok(activePanel, 'el panel debe estar montado con el flag encendido');
  const grid = activePanel.children.find(c => c.className === 'vr1sb-grid');
  assert.ok(grid, 'el panel debe tener la grilla de tarjetas');
  const [resultCard, , pendientesCard] = grid.children;
  const resultMain = resultCard.children.find(c => c.tagName === 'STRONG');
  assert.equal(resultMain.textContent, 'Compatibilidad condicional preliminar');
  assert.notEqual(resultMain.textContent, 'preliminary_conditional_compatibility', 'no debe mostrarse el identificador técnico crudo');
  const pendientesDetail = pendientesCard.children.find(c => c.tagName === 'P');
  assert.match(pendientesDetail.textContent, /Ubicación catastral oficial/);
  assert.match(pendientesDetail.textContent, /Vigencia normativa exhaustiva/);
  assert.match(pendientesDetail.textContent, /Fórmulas operativas oficiales/);
  assert.doesNotMatch(pendientesDetail.textContent, /official_parcel_location/);
  assert.doesNotMatch(pendientesDetail.textContent, /exhaustive_normative_validity/);
  assert.doesNotMatch(pendientesDetail.textContent, /official_operational_formulas/);
});

test('conservación exacta de los valores internos · el store guardado sigue con los identificadores canónicos, sin traducir', () => {
  const store = Sandbox.getStore();
  assert.equal(store.entries[0].result_status, 'preliminary_conditional_compatibility', 'el valor guardado en el ledger debe seguir siendo el identificador canónico, no la etiqueta traducida');
  const view = Sandbox.getActiveView();
  assert.equal(view.result.status, 'preliminary_conditional_compatibility');
  assert.ok(view.result.unresolved.includes('official_parcel_location'), 'los tipos de pendientes en el valor interno deben seguir siendo los identificadores canónicos');
  assert.ok(view.result.unresolved.includes('exhaustive_normative_validity'));
  assert.equal(view.result.unresolved.some(x => x.includes('Ubicación') || x.includes('Vigencia')), false, 'el valor interno nunca debe contener las etiquetas traducidas de presentación');
});

test('setEnabled(false) · desmonta botón y panel, y vuelve a rechazar operaciones', () => {
  Sandbox.setEnabled(false);
  assert.equal(Sandbox.isEnabled(), false);
  assert.equal(document.body.children.some(c => c.id === 'vr1sb-launch'), false, 'el botón debe desmontarse al apagar');
  assert.equal(document.body.children.some(c => c.id === 'vr1sb-panel'), false, 'el panel debe desmontarse al apagar');
  assert.equal(document.head.children.length, 0, 'el <style> debe removerse al apagar');
  const result = Sandbox.importPilotOrganism();
  assert.deepEqual(result, { ok: false, error: 'FEATURE_DISABLED' });
});

test('apagar el flag no altera la ficha ni los recuerdos ya existentes (invariante heredado del protocolo QA)', () => {
  assert.equal(pilotOrganism.ficha, undefined);
  assert.equal(pilotOrganism.recuerdos.length, 1);
});

// --- VR1SBCORR02 (122.30) · corrección 1: mensaje sincronizado tras recarga ---
// Última prueba del archivo, a propósito: simula una carga de página COMPLETAMENTE
// nueva (DOM y localStorage propios, aislados de todo lo que dejaron las pruebas
// anteriores) con el flag ya activo desde una sesión previa -- exactamente el
// escenario que Javier reportó: recargar con el ensayo ya habilitado. Reimporta
// el módulo con un query de invalidación de caché (Node trata cada URL de módulo
// distinta como una instancia nueva, con su propio bloque de inicialización de
// nivel superior), así se ejercita el mismo camino que corre un navegador real al
// cargar index.html con 'ag_vr1_core_sandbox_enabled_v1' ya en 'true'.
test('recarga con flag ya activo (simulada) · el mensaje inicial coincide con el estado real, no con el texto de "apagado"', async () => {
  const freshBackingStore = new Map();
  const freshLocalStorage = {
    getItem: k => (freshBackingStore.has(k) ? freshBackingStore.get(k) : null),
    setItem: (k, v) => freshBackingStore.set(k, String(v)),
    removeItem: k => freshBackingStore.delete(k),
    clear: () => freshBackingStore.clear()
  };
  const freshDocument = {
    head: new FakeElement('head'),
    body: new FakeElement('body'),
    createElement(tag) { return new FakeElement(tag); }
  };
  freshLocalStorage.setItem(FLAG_KEY, 'true'); // el flag ya estaba activo ANTES de "recargar"

  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  const previousLocalStorage = globalThis.localStorage;
  globalThis.window = {
    localStorage: freshLocalStorage,
    __VR1_CORE_SANDBOX_CONTRACT__: contract,
    VR1_PILOT_ORGANISM: pilotOrganism,
    VR1_PILOT_RESULT: null,
    VR1_PILOT_CONTRADICTION: null,
    prompt: () => 'tester-qa',
    __VR1_SANDBOX_VOLATILE_ENABLED__: undefined
  };
  globalThis.document = freshDocument;
  globalThis.localStorage = freshLocalStorage;

  try {
    await import(`./vr1-core-sandbox-bridge.mjs?reload-test=${Date.now()}`);

    const reloadedPanel = freshDocument.body.children.find(c => c.id === 'vr1sb-panel');
    assert.ok(reloadedPanel, 'con el flag ya activo, el panel debe montarse también al "recargar"');
    const notice = reloadedPanel.children.find(c => c.className === 'vr1sb-notice');
    assert.ok(notice, 'el panel recargado debe tener el aviso de estado');
    assert.equal(notice.textContent, 'Ensayo habilitado. Sólo se escribirá el sidecar sandbox.', 'el mensaje inicial debe reflejar que el ensayo YA está habilitado');
    assert.notEqual(notice.textContent, 'Ensayo apagado. El Core funciona sin depender de VR-1.', 'no debe quedar el mensaje de apagado heredado cuando el flag ya estaba activo antes de recargar');
  } finally {
    globalThis.window = previousWindow;
    globalThis.document = previousDocument;
    globalThis.localStorage = previousLocalStorage;
  }
});
