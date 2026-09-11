// Corte 122.30 · §9.2 -- replay real de restaurarBorrador()/restaurarCheckpoint(). No repite lo
// que ya cubre enviar-epistemico.test.mjs (la creación en vivo) ni epistemic-production-adapter
// .test.mjs (presentationFromRegistroEpistemico() en sí, ya probado ahí) -- esto verifica
// exclusivamente el CABLEADO de reconstrucción: que un mensaje con recordRef reconstruye la
// tarjeta a partir del estado ACTUAL de o.registro_epistemico (no de una foto vieja), que uno sin
// recordRef sigue el camino histórico exacto, que un recordRef inexistente no rompe el mensaje, y
// que todo esto respeta el mismo flag de activación (§15) que enviar() -- con el flag apagado, el
// replay es indistinguible del baseline 122.29 aunque el dato exista en el organismo. El replay
// nunca despacha ningún request: no hay fetch de por medio en ninguno de estos casos.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as adapter from '../lib/epistemic-production-adapter.mjs';

class FakeClassList {
  constructor() { this.s = new Set(); }
  add(...xs) { xs.forEach(x => this.s.add(x)); }
  remove(...xs) { xs.forEach(x => this.s.delete(x)); }
  contains(x) { return this.s.has(x); }
  toggle(x, force) { if (force === undefined) force = !this.s.has(x); force ? this.s.add(x) : this.s.delete(x); return force; }
}
// Registro compartido id -> elemento, activo mientras se arma cada contexto (ver buildContext).
// Necesario porque addPensando()/rmPensando() crean el nodo con document.createElement() y le
// asignan `.id = 'pensando'` DESPUÉS (no via document.getElementById) -- en un navegador real,
// document.getElementById sigue encontrándolo igual; este shim necesita este enganche explícito
// para no crear un segundo elemento fantasma, desconectado del árbol real, con el mismo id.
let _registroIdsActivo = null;
class FakeElement {
  constructor(tag = 'div') {
    this.tagName = String(tag).toUpperCase(); this.style = {}; this.classList = new FakeClassList();
    this.children = []; this.dataset = {}; this.attributes = {}; this.value = ''; this.checked = false;
    this.textContent = ''; this.innerHTML = ''; this._id = ''; this.disabled = false;
  }
  get id() { return this._id; }
  set id(v) {
    if (this._id && _registroIdsActivo && _registroIdsActivo.get(this._id) === this) _registroIdsActivo.delete(this._id);
    this._id = v;
    if (v && _registroIdsActivo) _registroIdsActivo.set(v, this);
  }
  appendChild(x) { this.children.push(x); x.parentNode = this; return x; }
  insertBefore(x) { return this.appendChild(x); }
  remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(c => c !== this); }
  querySelector(sel) {
    if (sel === '.lectura') return this.children.find(c => c.className && String(c.className).includes('lectura')) || null;
    // addUserMsg() arma la burbuja vía innerHTML ('<div class="bubble"></div>') en vez de
    // createElement+className -- este shim no parsea HTML real, así que reconoce ese único patrón
    // acá: si no hay un hijo real todavía pero el innerHTML declara la clase pedida, se crea y
    // cachea perezosamente para que .textContent = ... funcione igual que en el navegador real.
    const claseBuscada = sel && sel[0] === '.' ? sel.slice(1) : null;
    if (claseBuscada) {
      const existente = this.children.find(c => c.className && String(c.className).includes(claseBuscada));
      if (existente) return existente;
      if (typeof this.innerHTML === 'string' && this.innerHTML.indexOf('class="' + claseBuscada + '"') > -1) {
        const sintetico = new FakeElement('div');
        sintetico.className = claseBuscada;
        this.appendChild(sintetico);
        return sintetico;
      }
    }
    return this.children.find(c => true) || null;
  }
  querySelectorAll() { return []; }
  addEventListener() {}
  setAttribute(k, v) { this.attributes[k] = String(v); }
  getAttribute(k) { return this.attributes[k] ?? null; }
  closest() { return null; }
  focus() {} select() {} setSelectionRange() {} click() {} scrollIntoView() {}
}

function buildContext(fetchImpl, hostname) {
  const elements = new Map();
  _registroIdsActivo = elements;
  const document = {
    readyState: 'complete', documentElement: new FakeElement('html'), body: new FakeElement('body'),
    getElementById(id) { if (!elements.has(id)) { const e = new FakeElement(); e.id = id; elements.set(id, e); } return elements.get(id); },
    createElement(tag) { return new FakeElement(tag); },
    createTextNode(text) { const e = new FakeElement('#text'); e.textContent = String(text); return e; },
    querySelector() { return new FakeElement(); }, querySelectorAll() { return []; }, addEventListener() {}
  };
  const store = new Map();
  const localStorage = { getItem: k => store.has(k) ? store.get(k) : null, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k), clear: () => store.clear() };
  const location = { href: 'https://' + hostname + '/', origin: 'https://' + hostname, hostname, pathname: '/', hash: '', search: '' };
  const navigator = { language: 'es-AR', clipboard: { writeText: async () => {} } };
  const context = {
    console: { log() {}, warn() {}, error() {} }, document, localStorage, location, navigator,
    fetch: fetchImpl,
    setTimeout, clearTimeout, setInterval, clearInterval, URL, URLSearchParams, Blob, Map, Set,
    Date, Math, JSON, Object, Array, String, Number, Boolean, RegExp, Error, Promise,
    crypto: globalThis.crypto, performance: globalThis.performance,
    addEventListener() {}, removeEventListener() {}, open() { return null; }, confirm() { return false; }, prompt() { return null; },
    BroadcastChannel: undefined
  };
  context.ComprenderI18n = { localeTag() { return 'es-AR'; }, getLocale() { return 'es'; }, t(x) { return x; }, onChange() { return () => {}; }, formatNumber(n) { return String(n); } };
  context.window = context; context.globalThis = context; context.global = context;
  context.window.__epistemicAdapter = {
    isEpistemicCandidate: adapter.isEpistemicCandidate,
    changeTypesFromProposal: adapter.changeTypesFromProposal,
    presentationFromRegistroEpistemico: adapter.presentationFromRegistroEpistemico,
    buildPresentation: adapter.buildPresentation,
  };
  let fakeCard = { ok: true, node: null };
  context.window.__sustentacionCard = { create() { return fakeCard; } };
  // tokenVigente() vive en el PRIMER <script> inline (candado de acceso v6), que este arnés no
  // carga (mismo patrón que addmotormsg-hook.test.mjs / sincronizacion-cola.test.mjs -- sólo se
  // extrae y ejecuta el segundo). En un navegador real ambos scripts corren en orden dentro de la
  // misma página bien antes de que el usuario dispare enviar(), así que window.tokenVigente ya
  // existe para cuando integracionEpistemicaHabilitada() lo llama; acá se provee un stub
  // equivalente ("hay sesión válida") para poder ejercitar el segundo script de forma aislada.
  context.tokenVigente = async () => 'tok-test';
  vm.createContext(context);
  return { context, document, localStorage, setFakeCard(c) { fakeCard = c; } };
}

function loadCoreScript(context) {
  const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map(m => m[1]);
  vm.runInContext(scripts[1], context, { filename: 'index-core.js', timeout: 30000 });
}

function sembrarSesionYCreditos(localStorage) {
  localStorage.setItem('comprender_sesion', JSON.stringify({ token: 'tok-test', vence: Date.now() + 3600000 }));
  localStorage.setItem('ag_core_saldo', JSON.stringify({ saldo: 1000, momento: Date.now() }));
}

// El replay nunca hace POST -- sólo el GET del barrido de arranque (una vez, al cargar el
// script). Un fetch que ve cualquier otra llamada revienta la prueba: probaría que el replay
// disparó un request real, que es exactamente lo que §9.2 prohíbe ("el replay nunca ejecuta
// acciones por sí solo ni crea nuevos registros").
function fetchSoloArranque() {
  return async (recurso, opciones) => {
    if (!opciones || !opciones.body) return { ok: true, status: 200, json: async () => ({ organismos: [] }) };
    throw new Error('el replay no debería disparar ningún request: ' + String(opciones.body).slice(0, 200));
  };
}

// Construye un registro_epistemico REAL (mismo store del ledger, misma traducción del adaptador
// que usa el servidor) con una única entrada aceptada como referencia -- no se hand-rolea el
// shape del store a mano para no divergir silenciosamente de lib/epistemic-ledger.mjs.
async function construirRegistroEpistemicoFixture(recordRef) {
  const ledger = await import('../lib/epistemic-ledger.mjs');
  const adapterMod = await import('../lib/epistemic-production-adapter.mjs');
  const proposal = { id: 'p_fixture_1', organismo_id: 'org-replay-1', campos: ['funcion'], candidato: { funcion: 'orientar' }, anterior: {} };
  const eventRef = { type: 'proposal', id: proposal.id, organism_id: 'org-replay-1' };
  const occurredAt = '2026-01-01T00:00:00.000Z';
  const result = adapterMod.proposalToEpistemicResult({
    proposal, organismId: 'org-replay-1', organismVersion: 1, turnRef: 'TURN-fixture-000000',
    eventRef, recordId: recordRef, claimId: 'CLAIM-FIXTURE-1', visibleText: 'Texto visible del turno.', occurredAt,
  });
  let store = ledger.normalizeStore(ledger.emptyStore());
  const outcome = ledger.appendResult(store, {
    enabled: true, organismId: 'org-replay-1', eventRef, result,
    idempotencyKey: 'fixture-key-1', expectedLedgerVersion: store.ledger_version, occurredAt,
  });
  return { ...outcome.store, turn_index: { 'TURN-fixture-000000': recordRef }, change_types: { [recordRef]: ['campos'] } };
}

test('restaurarBorrador() con flag completo y recordRef válido: reconstruye la tarjeta desde el estado ACTUAL de registro_epistemico', async () => {
  const registroEpistemico = await construirRegistroEpistemicoFixture('ER-REPLAY-0001');
  const { context, localStorage } = buildContext(fetchSoloArranque(), 'staging.comprenderai.com');
  loadCoreScript(context);
  sembrarSesionYCreditos(localStorage);
  localStorage.setItem('ag_core_pref_integracion_epistemica_staging', '1');

  let capturedPresentation = null;
  context.window.__sustentacionCard.create = function (presentation) { capturedPresentation = presentation; return { ok: true, node: new FakeElement('div') }; };

  const o = {
    id: 'org-replay-1', nombre: 'Test', ficha: {}, principios: [], registro_epistemico: registroEpistemico,
    borrador: { history: [
      { role: 'user', content: 'hola' },
      { role: 'assistant', content: 'Encontramos algo importante.', turnRef: 'TURN-fixture-000000', recordRef: 'ER-REPLAY-0001' },
    ], modo: null },
  };
  context.o = o;
  const ok = vm.runInContext('restaurarBorrador(o)', context);
  assert.equal(ok, true);
  assert.ok(capturedPresentation, 'debe reconstruir y montar la tarjeta a partir de o.registro_epistemico');
  assert.equal(capturedPresentation.recordRef, 'ER-REPLAY-0001');
});

test('restaurarBorrador() con flag apagado (host de producción): NO reconstruye tarjeta aunque el recordRef exista -- indistinguible del baseline', async () => {
  const registroEpistemico = await construirRegistroEpistemicoFixture('ER-REPLAY-0002');
  const { context, localStorage } = buildContext(fetchSoloArranque(), 'app.comprenderai.com');
  loadCoreScript(context);
  sembrarSesionYCreditos(localStorage);
  localStorage.setItem('ag_core_pref_integracion_epistemica_staging', '1'); // encendida igual -- el host manda

  let tarjetaMontada = false;
  context.window.__sustentacionCard.create = function () { tarjetaMontada = true; return { ok: true, node: new FakeElement('div') }; };

  const o = {
    id: 'org-replay-1', nombre: 'Test', ficha: {}, principios: [], registro_epistemico: registroEpistemico,
    borrador: { history: [
      { role: 'assistant', content: 'Encontramos algo importante.', turnRef: 'TURN-fixture-000000', recordRef: 'ER-REPLAY-0002' },
    ], modo: null },
  };
  context.o = o;
  vm.runInContext('restaurarBorrador(o)', context);
  assert.equal(tarjetaMontada, false, 'fuera de staging, el replay nunca reconstruye una tarjeta, aunque el dato exista');
});

test('restaurarBorrador() con entrada sin recordRef (historia vieja/no elegible): camino histórico exacto, sin tarjeta', async () => {
  const { context, localStorage } = buildContext(fetchSoloArranque(), 'staging.comprenderai.com');
  loadCoreScript(context);
  sembrarSesionYCreditos(localStorage);
  localStorage.setItem('ag_core_pref_integracion_epistemica_staging', '1');

  let tarjetaMontada = false;
  context.window.__sustentacionCard.create = function () { tarjetaMontada = true; return { ok: true, node: new FakeElement('div') }; };

  const o = {
    id: 'org-replay-1', nombre: 'Test', ficha: {}, principios: [],
    borrador: { history: [ { role: 'assistant', content: 'Una respuesta vieja, sin turnRef ni recordRef.' } ], modo: null },
  };
  context.o = o;
  const ok = vm.runInContext('restaurarBorrador(o)', context);
  assert.equal(ok, true);
  assert.equal(tarjetaMontada, false);
});

test('restaurarBorrador() con recordRef que ya no existe en registro_epistemico: no muestra tarjeta y no rompe el mensaje', async () => {
  const registroEpistemico = await construirRegistroEpistemicoFixture('ER-REPLAY-0003');
  const { context, localStorage } = buildContext(fetchSoloArranque(), 'staging.comprenderai.com');
  loadCoreScript(context);
  sembrarSesionYCreditos(localStorage);
  localStorage.setItem('ag_core_pref_integracion_epistemica_staging', '1');

  let tarjetaMontada = false;
  context.window.__sustentacionCard.create = function () { tarjetaMontada = true; return { ok: true, node: new FakeElement('div') }; };

  const o = {
    id: 'org-replay-1', nombre: 'Test', ficha: {}, principios: [], registro_epistemico: registroEpistemico,
    borrador: { history: [
      { role: 'assistant', content: 'Este recordRef no está en el registro.', turnRef: 'TURN-fixture-999999', recordRef: 'ER-NO-EXISTE' },
    ], modo: null },
  };
  context.o = o;
  assert.doesNotThrow(() => { vm.runInContext('restaurarBorrador(o)', context); });
  const ok = vm.runInContext('restaurarBorrador(o)', context);
  assert.equal(ok, true, 'el mensaje se reproduce igual, sin romperse');
  assert.equal(tarjetaMontada, false);
});

test('restaurarCheckpoint() con flag completo y recordRef válido: también reconstruye la tarjeta (mismo camino que restaurarBorrador())', async () => {
  const registroEpistemico = await construirRegistroEpistemicoFixture('ER-REPLAY-0004');
  const { context, localStorage } = buildContext(fetchSoloArranque(), 'staging.comprenderai.com');
  loadCoreScript(context);
  sembrarSesionYCreditos(localStorage);
  localStorage.setItem('ag_core_pref_integracion_epistemica_staging', '1');

  let capturedPresentation = null;
  context.window.__sustentacionCard.create = function (presentation) { capturedPresentation = presentation; return { ok: true, node: new FakeElement('div') }; };

  const o = {
    id: 'org-replay-1', nombre: 'Test', ficha: {}, principios: [], registro_epistemico: registroEpistemico,
    checkpoints: { core: [ {
      fecha: '2026-01-01T00:00:00.000Z', modulo: 'core', organismo_id: 'org-replay-1',
      history: [ { role: 'assistant', content: 'Encontramos algo importante.', turnRef: 'TURN-fixture-000000', recordRef: 'ER-REPLAY-0004' } ],
      panel: null, principios: [],
    } ] },
  };
  context.o = o;
  const ok = vm.runInContext('restaurarCheckpoint(o, "core", 0)', context);
  assert.equal(ok, true);
  assert.ok(capturedPresentation, 'restaurarCheckpoint() debe reconstruir la tarjeta igual que restaurarBorrador()');
  assert.equal(capturedPresentation.recordRef, 'ER-REPLAY-0004');
});
