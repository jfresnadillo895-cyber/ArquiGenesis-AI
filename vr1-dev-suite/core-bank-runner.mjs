// Ejecutor portable del "banco Core" (correrPruebasAuto(), definido dentro del segundo
// <script> inline de index.html). Adaptado de sandbox/tests/run-core-bank.mjs del paquete
// VR-1 original (mismo shim de DOM/localStorage mínimo vía vm), factoreado como función
// reutilizable para poder correrlo tanto contra el index.html real en disco como contra un
// string en memoria (usado por legacy-patch-optional.test.mjs para el candidato con el parche
// legacy aplicado). No requiere ningún otro archivo del paquete VR-1 -- sólo Node core (fs, vm).

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
  querySelector() { return new FakeElement(); }
  querySelectorAll() { return []; }
  addEventListener() {}
  setAttribute(k, v) { this.attributes[k] = String(v); }
  getAttribute(k) { return this.attributes[k] ?? null; }
  closest() { return null; }
  focus() {} select() {} setSelectionRange() {} click() {} scrollIntoView() {}
}

export function runCoreBankFromHtml(html) {
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
  const location = { href: 'https://app.comprenderai.com/', origin: 'https://app.comprenderai.com', pathname: '/', hash: '', search: '' };
  const navigator = { language: 'es-AR', clipboard: { writeText: async () => {} } };
  const fakeResponse = { ok: false, status: 401, json: async () => ({ organismos: [] }), text: async () => '' };
  const context = {
    console: { log() {}, warn() {}, error() {} }, document, localStorage, location, navigator, fetch: async () => fakeResponse,
    setTimeout, clearTimeout, setInterval, clearInterval, URL, URLSearchParams, Blob, Map, Set,
    Date, Math, JSON, Object, Array, String, Number, Boolean, RegExp, Error, Promise,
    crypto: globalThis.crypto, performance: globalThis.performance,
    addEventListener() {}, removeEventListener() {}, open() { return null; }, confirm() { return false; }, prompt() { return null; },
    BroadcastChannel: undefined
  };
  context.ComprenderI18n = { localeTag() { return 'es-AR'; }, getLocale() { return 'es'; } };
  context.window = context; context.globalThis = context; context.global = context;
  vm.createContext(context);
  const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map(m => m[1]);
  // El segundo script inline es el Core. El primero es el shell de autenticación (candado).
  vm.runInContext(scripts[1] + '\n;globalThis.__bank = correrPruebasAuto();', context, { filename: 'index-core.js', timeout: 30000 });
  const bank = context.__bank || [];
  const failed = bank.filter(x => !x.ok);
  // Los arrays devueltos por vm.runInContext() pertenecen al realm del contexto vm, no al de
  // este módulo -- aunque su contenido sea idéntico, assert.deepStrictEqual del lado que llama
  // los trata como "misma estructura pero no reference-equal" frente a un [] literal escrito acá
  // (comportamiento real de Node, no un bug de esta función). Normalizar via JSON round-trip
  // asegura que quien llama reciba objetos/arrays nativos de SU propio realm.
  return JSON.parse(JSON.stringify({ total: bank.length, passed: bank.length - failed.length, failed: failed.map(x => x.nombre) }));
}

export function runCoreBankFromFile(path) {
  return runCoreBankFromHtml(fs.readFileSync(path, 'utf8'));
}
