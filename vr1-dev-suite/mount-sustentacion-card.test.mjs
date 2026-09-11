// Corte 122.30 · §18 "Cliente e integración" -- pruebas aisladas de mountSustentacionCard()
// (index.html), la única función que decide SI se monta la tarjeta sobre el nodo ya renderizado
// por addMotorMsg(). No repite lo que ya prueba enviar-epistemico.test.mjs (el cableado completo
// de enviar() de punta a punta) ni sustentacion-card.test.mjs (el componente congelado en sí) --
// esto verifica exclusivamente las tres garantías que el propio comentario de mountSustentacionCard()
// declara en index.html:
//   1. "evita un segundo montaje en el mismo mensaje" -- dos intentos de montaje sobre el mismo
//      nodo producen una sola tarjeta (§18: "dos intentos de montaje... producen una sola tarjeta
//      y una sola pareja de acciones").
//   2. ausencia de window.__sustentacionCard.create() -- no rompe, conserva el mensaje, falla
//      cerrado (§18: "ausencia o fallo de window.__sustentacionCard.create() conserva el mensaje
//      y falla cerrado").
//   3. create() que lanza una excepción -- se atrapa, no rompe enviar(), el mensaje sigue intacto
//      (misma garantía, camino de fallo en tiempo de ejecución en vez de ausencia).
//
// Mismo shim mínimo de DOM y misma técnica de extracción del segundo <script> inline que ya usan
// core-bank-runner.mjs / addmotormsg-hook.test.mjs / sincronizacion-cola.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

class FakeClassList {
  constructor() { this.s = new Set(); }
  add(...xs) { xs.forEach(x => this.s.add(x)); }
  remove(...xs) { xs.forEach(x => this.s.delete(x)); }
  contains(x) { return this.s.has(x); }
  toggle(x, force) { if (force === undefined) force = !this.s.has(x); force ? this.s.add(x) : this.s.delete(x); return force; }
}
class FakeElement {
  constructor(tag = 'div') {
    this.tagName = String(tag).toUpperCase(); this.style = {}; this.classList = new FakeClassList();
    this.children = []; this.dataset = {}; this.attributes = {}; this.value = ''; this.checked = false;
    this.textContent = ''; this.innerHTML = ''; this.id = ''; this.disabled = false;
  }
  appendChild(x) { this.children.push(x); x.parentNode = this; return x; }
  insertBefore(x) { return this.appendChild(x); }
  remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(c => c !== this); }
  querySelector() { return this.children.find(c => true) || null; }
  querySelectorAll() { return []; }
  addEventListener() {}
  setAttribute(k, v) { this.attributes[k] = String(v); }
  getAttribute(k) { return this.attributes[k] ?? null; }
  closest() { return null; }
  focus() {} select() {} setSelectionRange() {} click() {} scrollIntoView() {}
}

function buildContext() {
  const elements = new Map();
  const document = {
    readyState: 'complete', documentElement: new FakeElement('html'), body: new FakeElement('body'),
    getElementById(id) { if (!elements.has(id)) { const e = new FakeElement(); e.id = id; elements.set(id, e); } return elements.get(id); },
    createElement(tag) { return new FakeElement(tag); },
    createTextNode(text) { const e = new FakeElement('#text'); e.textContent = String(text); return e; },
    querySelector() { return new FakeElement(); }, querySelectorAll() { return []; }, addEventListener() {}
  };
  const store = new Map();
  const localStorage = { getItem: k => store.has(k) ? store.get(k) : null, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k), clear: () => store.clear() };
  const location = { href: 'https://app.comprenderai.com/', origin: 'https://app.comprenderai.com', hostname: 'app.comprenderai.com', pathname: '/', hash: '', search: '' };
  const navigator = { language: 'es-AR', clipboard: { writeText: async () => {} } };
  // El barrido de arranque (sincronizarOrganismosConServidor()) dispara un GET apenas se carga
  // el script -- no es relevante para estas pruebas (que no tocan organismos), así que se le
  // responde de forma neutra e inmediata en cualquier llamado a fetch.
  const fetchImpl = async () => ({ ok: true, status: 200, json: async () => ({ organismos: [] }) });
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
  context.tokenVigente = async () => 'tok-test';
  vm.createContext(context);
  return { context };
}

function loadCoreScript(context) {
  const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map(m => m[1]);
  vm.runInContext(scripts[1], context, { filename: 'index-core.js', timeout: 30000 });
}

function envelope(recordRef) {
  return { presentation: { recordRef: recordRef || 'ER-MOUNT-0001', state: 'review_required', level: 'V1', title: 't', summary: 's', evidenceItems: [], pendingItems: [] }, actions: { onAccept: async () => {}, onReject: async () => {} } };
}

test('mountSustentacionCard() · monta exactamente una vez: un segundo intento sobre el mismo nodo no agrega una segunda tarjeta', () => {
  const { context } = buildContext();
  loadCoreScript(context);
  let llamadosACreate = 0;
  context.window.__sustentacionCard = { create() { llamadosACreate++; return { ok: true, node: new FakeElement('div') }; } };

  const nodo = new FakeElement('div');
  const primero = vm.runInContext('mountSustentacionCard', context)(nodo, envelope());
  const segundo = vm.runInContext('mountSustentacionCard', context)(nodo, envelope());

  assert.equal(primero, true, 'el primer montaje debe tener éxito');
  assert.equal(segundo, false, 'el segundo intento sobre el MISMO nodo no debe montar de nuevo');
  assert.equal(llamadosACreate, 1, 'window.__sustentacionCard.create() se llama una sola vez -- una sola pareja de acciones');
  assert.equal(nodo.children.length, 1, 'sólo un nodo de tarjeta queda agregado al mensaje');
});

test('mountSustentacionCard() · sin window.__sustentacionCard.create() disponible: no rompe, no monta, falla cerrado', () => {
  const { context } = buildContext();
  loadCoreScript(context);
  context.window.__sustentacionCard = undefined; // ausencia total del componente

  const nodo = new FakeElement('div');
  let resultado;
  assert.doesNotThrow(() => { resultado = vm.runInContext('mountSustentacionCard', context)(nodo, envelope()); });

  assert.equal(resultado, false);
  assert.equal(nodo.children.length, 0, 'el mensaje conversacional original queda intacto, sin tarjeta fantasma');
});

test('mountSustentacionCard() · create() lanza una excepción en tiempo de ejecución: se atrapa, mensaje intacto, sin propagar', () => {
  const { context } = buildContext();
  loadCoreScript(context);
  context.window.__sustentacionCard = { create() { throw new Error('fallo simulado del componente'); } };

  const nodo = new FakeElement('div');
  let resultado;
  assert.doesNotThrow(() => { resultado = vm.runInContext('mountSustentacionCard', context)(nodo, envelope()); });

  assert.equal(resultado, false);
  assert.equal(nodo.children.length, 0, 'ningún nodo huérfano queda agregado si create() falla a mitad de camino');
});

test('mountSustentacionCard() · create() devuelve {ok:false} (sin node): no agrega nada, sin excepción', () => {
  const { context } = buildContext();
  loadCoreScript(context);
  context.window.__sustentacionCard = { create() { return { ok: false, node: null }; } };

  const nodo = new FakeElement('div');
  const resultado = vm.runInContext('mountSustentacionCard', context)(nodo, envelope());

  assert.equal(resultado, false);
  assert.equal(nodo.children.length, 0);
});

test('mountSustentacionCard() · envelope sin presentation, o messageNode inválido: no monta, sin excepción', () => {
  const { context } = buildContext();
  loadCoreScript(context);
  let llamadosACreate = 0;
  context.window.__sustentacionCard = { create() { llamadosACreate++; return { ok: true, node: new FakeElement('div') }; } };

  const nodo = new FakeElement('div');
  assert.equal(vm.runInContext('mountSustentacionCard', context)(nodo, null), false);
  assert.equal(vm.runInContext('mountSustentacionCard', context)(nodo, {}), false);
  assert.equal(vm.runInContext('mountSustentacionCard', context)(null, envelope()), false);
  assert.equal(llamadosACreate, 0, 'ningún caso inválido debe siquiera llamar a create()');
});
