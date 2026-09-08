// Corte 122.30 · MIMEFIX02 -- prueba de regresión de la secuencia real reportada por QA en
// staging el 08/09: crear un organismo nuevo, enviar un mensaje que produce una propuesta
// elegible (create_epistemic_candidate -> v2), el autosave de fin de turno que sigue en el
// mismo enviar() (guardarBorrador()/guardarOrganismo() -> v3), y aceptar la tarjeta
// ("Aceptar como referencia" -> v4). Antes de esta corrección, el paso de creación nunca
// aplicaba su propia confirmación (version + registro_epistemico) sobre el organismo en
// memoria -- el autosave que sigue viajaba con una version_conocida vieja, el servidor lo
// rechazaba (409, absorbido en silencio) y "aceptar" heredaba esa misma versión vieja: el click
// real reportado por Javier terminó exactamente así, con el servidor en v3 y el cliente
// convencido de seguir en v2.
//
// A diferencia de enviar-epistemico.test.mjs / organismos-epistemico.test.mjs (que prueban cada
// lado por separado con respuestas fabricadas a mano), esta prueba ejecuta AMBOS lados reales:
// el cliente real (enviar(), aplicarConfirmacionEpistemica(), la cola, construirAccionesTarjetaEpistemica())
// del segundo <script> de index.html, contra el handler real de api/organismos.js (que a su vez
// ejecuta lib/epistemic-ledger.mjs y lib/epistemic-production-adapter.mjs de verdad) -- sólo
// Supabase queda mockeado, con el mismo arnés mínimo que ya usa organismos-epistemico.test.mjs.
// Nada de esta lógica se reimplementa acá: se ejecuta tal cual, de punta a punta.
//
// Control negativo explícito (pedido por Javier): cada lectura de organismo se hace SIEMPRE vía
// cargarOrganismos()[0] (relectura fresca desde localStorage, nunca una referencia JS retenida
// de un paso anterior). Si una regresión futura volviera a aplicar una confirmación epistemológica
// sólo sobre un clon/instantánea descartable -- en vez de sobre el organismo canónico realmente
// persistido (state.organismo Y la entrada de cargarOrganismos(), que es lo que
// aplicarConfirmacionEpistemica() ya garantiza) -- esta relectura no vería el cambio y la prueba
// fallaría en el paso correspondiente, no sólo al final.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as adapter from '../lib/epistemic-production-adapter.mjs';

process.env.SUPABASE_URL = 'https://fake.supabase.test';
process.env.SUPABASE_SECRET_KEY = 'fake-service-key';

const TOKEN = 'tok-actor-seq';
const PERFIL = 'actor-uuid-seq';

// ---------- fake Supabase (mismo patrón mínimo que organismos-epistemico.test.mjs) ----------
function makeFakeSupabase(initialRows = []) {
  const rows = new Map(); // clave: perfil + '|' + cliente_id
  for (const row of initialRows) rows.set(row.perfil + '|' + row.cliente_id, { ...row });

  function jsonResponse(status, body) {
    return { ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) };
  }

  async function fetchMock(url, opts = {}) {
    const u = new URL(url);
    if (u.pathname === '/auth/v1/user') {
      const auth = (opts.headers && opts.headers.Authorization) || '';
      const token = auth.replace(/^Bearer /, '');
      if (token === TOKEN) return jsonResponse(200, { id: PERFIL });
      return jsonResponse(401, {});
    }
    if (u.pathname === '/rest/v1/rpc/guardar_organismo') {
      const body = JSON.parse(opts.body);
      const key = body.p_perfil + '|' + body.p_cliente_id;
      const existing = rows.get(key);
      if (existing) {
        if (body.p_version_conocida !== existing.version) {
          return jsonResponse(200, { conflicto: true, version: existing.version, datos: existing.datos });
        }
        existing.datos = body.p_datos;
        existing.nombre = body.p_nombre;
        existing.estado = body.p_estado;
        existing.version = existing.version + 1;
        rows.set(key, existing);
        return jsonResponse(200, { id: existing.id, version: existing.version });
      }
      if (body.p_version_conocida !== null) {
        return jsonResponse(200, { conflicto: true, version: 0, datos: null });
      }
      const nuevo = { perfil: body.p_perfil, cliente_id: body.p_cliente_id, id: 'row-' + (rows.size + 1), nombre: body.p_nombre, estado: body.p_estado, datos: body.p_datos, version: 1 };
      rows.set(key, nuevo);
      return jsonResponse(200, { id: nuevo.id, version: nuevo.version });
    }
    if (u.pathname === '/rest/v1/organismos') {
      const perfil = u.searchParams.get('perfil').replace('eq.', '');
      const clienteIdParam = u.searchParams.get('cliente_id');
      if (clienteIdParam) {
        const clienteId = decodeURIComponent(clienteIdParam.replace('eq.', ''));
        const row = rows.get(perfil + '|' + clienteId);
        return jsonResponse(200, row ? [{ id: row.id, nombre: row.nombre, estado: row.estado, datos: row.datos, version: row.version }] : []);
      }
      const lista = [...rows.values()].filter(r => r.perfil === perfil);
      return jsonResponse(200, lista.map(r => ({ id: r.id, cliente_id: r.cliente_id, nombre: r.nombre, estado: r.estado, datos: r.datos, version: r.version })));
    }
    throw new Error('ruta no simulada: ' + url);
  }

  return { fetchMock, rows };
}

function makeRes() {
  const res = { _status: null, _body: null, _headers: {} };
  res.status = (s) => { res._status = s; return res; };
  res.json = (b) => { res._body = b; return res; };
  res.setHeader = (k, v) => { res._headers[k] = v; };
  return res;
}

async function importHandlerFresh() {
  const mod = await import('../api/organismos.js?test=' + Date.now() + Math.random());
  return mod.default;
}

// ---------- cliente: mismo arnés mínimo que enviar-epistemico.test.mjs ----------
class FakeClassList {
  constructor() { this.s = new Set(); }
  add(...xs) { xs.forEach(x => this.s.add(x)); }
  remove(...xs) { xs.forEach(x => this.s.delete(x)); }
  contains(x) { return this.s.has(x); }
  toggle(x, force) { if (force === undefined) force = !this.s.has(x); force ? this.s.add(x) : this.s.delete(x); return force; }
}
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
  context.window.__sustentacionCard = { create() { return { ok: true, node: new FakeElement('div') }; } };
  context.tokenVigente = async () => 'tok-test'; // idem enviar-epistemico.test.mjs: sólo gatea integracionEpistemicaHabilitada(), no viaja en el fetch real (el envoltorio vive en el primer script, no cargado acá)
  vm.createContext(context);
  return { context, document, localStorage };
}

function loadCoreScript(context) {
  const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map(m => m[1]);
  vm.runInContext(scripts[1], context, { filename: 'index-core.js', timeout: 30000 });
}

async function flush(n = 14) { for (let i = 0; i < n; i++) await Promise.resolve(); }

function sembrarSesionYCreditos(localStorage) {
  localStorage.setItem('comprender_sesion', JSON.stringify({ token: 'tok-test', vence: Date.now() + 3600000 }));
  localStorage.setItem('ag_core_saldo', JSON.stringify({ saldo: 1000, momento: Date.now() }));
}

const RAW_CON_FICHA = '[[FICHA:FUNCION=orientar|MODO=M07|TENSIONES=a; b|DIAGNOSTICO=d|PROXIMO=p|PROXIMOS=x;;y]]Encontramos algo importante.';
function anthropicOkResponse() {
  return { ok: true, status: 200, json: async () => ({ content: [{ type: 'text', text: RAW_CON_FICHA }] }) };
}

test('secuencia real completa (QA 08/09): crear -> v2 (1 entrada/1 revisión) -> autosave -> v3 preservando el ledger -> aceptar usa v3 -> v4 -> replay muestra aceptada', async () => {
  const { fetchMock: fakeSupabaseFetch, rows } = makeFakeSupabase();
  const handler = await importHandlerFresh();

  async function bridgeFetch(opciones) {
    const method = (opciones && opciones.method) || 'GET';
    const body = opciones && opciones.body ? JSON.parse(opciones.body) : undefined;
    const req = { method, body, headers: { authorization: 'Bearer ' + TOKEN }, query: {} };
    const res = makeRes();
    const realFetch = globalThis.fetch;
    globalThis.fetch = fakeSupabaseFetch;
    try { await handler(req, res); } finally { globalThis.fetch = realFetch; }
    return { ok: res._status >= 200 && res._status < 300, status: res._status, json: async () => res._body };
  }

  const fetchImpl = async (recurso, opciones) => {
    const url = String((recurso && recurso.url) ? recurso.url : recurso || '');
    if (url.indexOf('/api/organismos') > -1) return bridgeFetch(opciones);
    return anthropicOkResponse();
  };

  const { context, localStorage } = buildContext(fetchImpl, 'staging.comprenderai.com');
  loadCoreScript(context);
  await flush(); // drena el barrido de arranque (GET real, sin filas todavía -> {organismos:[]})
  sembrarSesionYCreditos(localStorage);
  localStorage.setItem('ag_core_pref_integracion_epistemica_staging', '1');

  // Paso 0 (no listado explícitamente por Javier, pero implícito en "create -> v2"): el
  // organismo nuevo ya existe en el servidor real a v1 -- mismo guardarOrganismo() real que usa
  // toda la app al crear un organismo, no un seed directo de _sv.
  vm.runInContext(`
    state.organismo = { id: 'org-seq-1', nombre: 'QA 122.30 · SMOKE 2', ficha: {}, principios: [], history: [] };
    state.history = []; state.busy = false; state.epoch = state.epoch || 0;
  `, context);
  await vm.runInContext('guardarOrganismo(state.organismo)', context);
  await flush();
  const orgV1 = JSON.parse(JSON.stringify(vm.runInContext('cargarOrganismos()[0]', context)));
  assert.deepEqual(orgV1._sv, { version: 1 }, 'paso 0: organismo recién creado, v1 real confirmada por el servidor real (no un valor inventado por la prueba)');

  // Pasos 1+2: enviar() dispara create_epistemic_candidate (-> v2, 1 entrada/1 revisión) y, en
  // el mismo turno, el autosave de guardarBorrador()/guardarOrganismo() (-> v3).
  await context.enviar('hola, contame algo con ficha');
  await flush();

  const filaTrasEnvio = rows.get(PERFIL + '|org-seq-1');
  assert.ok(filaTrasEnvio, 'la fila debe existir en el servidor real');
  assert.equal(filaTrasEnvio.version, 3, 'servidor real: v1 -> v2 (creación) -> v3 (autosave del mismo turno) -- exactamente v1->v2->v3 de la secuencia reportada por QA, no v1->v2->CONFLICTO');
  assert.equal(filaTrasEnvio.datos.registro_epistemico.entries.length, 1, 'paso 2: el autosave posterior a la creación preserva la entrada del ledger -- no la pisa con el blob viejo (sin ella) que tendría si org._sv no se hubiera actualizado tras la creación');
  assert.equal(filaTrasEnvio.datos.registro_epistemico.reviews.length, 1, 'y preserva también la revisión abierta por la creación');

  // Paso 3: organismo local canónico -- SIEMPRE releído fresco vía cargarOrganismos()[0], nunca
  // una referencia JS retenida de un paso anterior (control negativo: si una regresión futura
  // volviera a aplicar la confirmación sólo sobre un clon/instantánea descartable, esta
  // relectura no vería el cambio y la aserción de abajo fallaría).
  const orgLocalTrasEnvio = JSON.parse(JSON.stringify(vm.runInContext('cargarOrganismos()[0]', context)));
  assert.deepEqual(orgLocalTrasEnvio._sv, { version: 3 }, 'paso 3: el organismo canónico local (relectura fresca desde localStorage) queda en v3, no atrasado en v1 ni v2');
  assert.equal(orgLocalTrasEnvio.registro_epistemico.entries.length, 1);
  assert.equal(orgLocalTrasEnvio.registro_epistemico.reviews.length, 1);
  assert.equal(orgLocalTrasEnvio.registro_epistemico.reviews[0].state, 'pending_human_review');
  // el mismo objeto vivo en memoria (state.organismo) también debe reflejarlo -- no sólo la lista
  const orgEnMemoriaTrasEnvio = JSON.parse(JSON.stringify(vm.runInContext('state.organismo', context)));
  assert.deepEqual(orgEnMemoriaTrasEnvio._sv, { version: 3 }, 'state.organismo (el mismo objeto que enviar() sigue usando) también queda en v3, no sólo la entrada persistida');

  const entradaAsistente = vm.runInContext('state.history[state.history.length - 1]', context);
  const recordRef = entradaAsistente.recordRef;
  assert.match(recordRef, /^ER-[0-9A-F-]{36}$/, 'la creación real confirmó un recordRef con la forma que exige el servidor');

  // Paso 4: aceptar -- construirAccionesTarjetaEpistemica() se arma sobre el organismo canónico
  // recién releído (no sobre una referencia vieja), igual que hace mountSustentacionCard() en
  // enviar() real. Debe usar v3 (versión real ya sincronizada) y terminar en v4.
  const aceptado = await vm.runInContext(`
    (function(){
      var org = cargarOrganismos()[0];
      var acciones = construirAccionesTarjetaEpistemica(org);
      return acciones.onAccept(${JSON.stringify(recordRef)}).then(function(){ return true; }, function(e){ return { rechazado: true, motivo: String(e && e.message) }; });
    })()
  `, context);
  await flush();
  assert.equal(aceptado, true, 'aceptar no debe rechazar: usa la versión real (v3), sin conflicto -- si esto rechaza, la corrección de propagación de versión tras la creación no está funcionando');

  const filaTrasAccept = rows.get(PERFIL + '|org-seq-1');
  assert.equal(filaTrasAccept.version, 4, 'paso 4: aceptar usa v3 y el servidor confirma v4 -- exactamente la progresión esperada, sin 409');
  assert.equal(filaTrasAccept.datos.registro_epistemico.reviews[0].state, 'accepted_as_reference');

  const orgLocalTrasAccept = JSON.parse(JSON.stringify(vm.runInContext('cargarOrganismos()[0]', context)));
  assert.deepEqual(orgLocalTrasAccept._sv, { version: 4 }, 'el organismo canónico local (relectura fresca) queda en v4 tras aceptar');
  assert.equal(orgLocalTrasAccept.registro_epistemico.reviews[0].state, 'accepted_as_reference');
  assert.equal(orgLocalTrasAccept.momentos.length, 1, 'un solo momento nuevo por la resolución confirmada (§18)');
  assert.equal(orgLocalTrasAccept.momentos[0].tipo, 'revision_epistemica');
  assert.equal(orgLocalTrasAccept.momentos[0].epistemic_record_ref, recordRef);

  // Paso 5: recarga/replay -- envelopeReplayEpistemico() reconstruye el ESTADO ACTUAL del
  // registro (no una fotografía del turno original, que todavía estaba pending_human_review) a
  // partir del organismo canónico ya en v4. state:'accepted_as_reference' es el dato que
  // lib/sustentacion-card.mjs (congelado, no tocado acá) traduce al texto visible "Aceptada como
  // referencia" -- esta prueba verifica el dato que ese componente recibe, no reimplementa su
  // render.
  const envelopeReplay = vm.runInContext(`
    envelopeReplayEpistemico(cargarOrganismos()[0], { recordRef: ${JSON.stringify(recordRef)} })
  `, context);
  assert.ok(envelopeReplay, 'el replay debe reconstruir un envoltorio real -- el recordRef existe y el flag sigue activo');
  const presentationReplay = JSON.parse(JSON.stringify(envelopeReplay.presentation));
  assert.equal(presentationReplay.recordRef, recordRef);
  assert.equal(presentationReplay.state, 'accepted_as_reference', 'paso 5: el replay refleja el estado VIGENTE (aceptado), no una fotografía del turno original en que la revisión todavía estaba pendiente');
});

// ---------------------------------------------------------------------------------------------
// CONFLICTOVERSION02 (08/09) -- segundo bug real de QA en staging, reportado DESPUÉS de que el
// anterior (CONFLICTOVERSION01, arriba) ya estuviera aplicado: "Aceptar como referencia" volvió a
// responder 200/v4 correctamente, pero un guardado genérico posterior (autosave o "Guardar
// sesión") que SÍ respondió 200/v5 no se reflejaba de inmediato en el organismo local -- quedaba
// en v4 hasta que un par de escrituras siguientes, todavía con la versión vieja, chocaban con 409
// y disparaban la recuperación (§7.6) que ya corregía todo. Causa demostrada (ver el informe):
// sincronizarOrganismoServidor() tomaba `version_conocida` en el mismo instante en que tomaba la
// foto del CONTENIDO -- al encolar --, no al despachar. Cuando dos guardados del mismo organismo
// se encolaban casi juntos (exactamente lo que hace guardarSesion(): un guardarOrganismo() directo
// + otro dentro de registrarMomento() + otro dentro de crearCheckpointSesion(), demostrado abajo),
// el segundo y el tercero viajaban con la versión previa a que el primero confirmara la suya,
// chocaban por versión contra el servidor real, y su contenido (el checkpoint, el momento) se
// perdía en silencio -- aunque localStorage ya lo mostrara "guardado".
//
// Esta prueba reproduce el escenario real completo con el servidor real (Supabase mockeado, igual
// que la prueba de arriba): organismo ya aceptado en v4 -> "Guardar sesión" (que dispara TRES
// guardados genéricos reales y encadenados del mismo organismo) -> los tres deben terminar
// aplicados en el servidor real, sin ningún 409, y el organismo canónico local (releído fresco)
// debe coincidir exactamente con lo que el servidor terminó guardando -- incluido el checkpoint,
// que antes de esta corrección se perdía.
test('CONFLICTOVERSION02: "Guardar sesión" dispara varios guardados genéricos encadenados del mismo organismo -- todos deben aplicarse en el servidor real, sin 409, sin perder el checkpoint', async () => {
  const { fetchMock: fakeSupabaseFetch, rows } = makeFakeSupabase();
  const handler = await importHandlerFresh();

  async function bridgeFetch(opciones) {
    const method = (opciones && opciones.method) || 'GET';
    const body = opciones && opciones.body ? JSON.parse(opciones.body) : undefined;
    const req = { method, body, headers: { authorization: 'Bearer ' + TOKEN }, query: {} };
    const res = makeRes();
    const realFetch = globalThis.fetch;
    globalThis.fetch = fakeSupabaseFetch;
    try { await handler(req, res); } finally { globalThis.fetch = realFetch; }
    return { ok: res._status >= 200 && res._status < 300, status: res._status, json: async () => res._body };
  }
  const solicitudes = [];
  const fetchImpl = async (recurso, opciones) => {
    const url = String((recurso && recurso.url) ? recurso.url : recurso || '');
    if (url.indexOf('/api/organismos') > -1) {
      if (opciones && opciones.body) solicitudes.push(JSON.parse(opciones.body));
      return bridgeFetch(opciones);
    }
    return anthropicOkResponse();
  };

  const { context, localStorage } = buildContext(fetchImpl, 'app.comprenderai.com'); // fuera de staging: el flag epistemológico no interviene, este bug es del camino genérico
  loadCoreScript(context);
  await flush();
  sembrarSesionYCreditos(localStorage);

  // Organismo ya aceptado como referencia en un turno anterior (v4), tal como quedó la corrección
  // CONFLICTOVERSION01 -- el servidor real ya tiene esa fila a v4.
  rows.set(PERFIL + '|org-seq-2', {
    perfil: PERFIL, cliente_id: 'org-seq-2', id: 'row-1', nombre: 'QA 122.30 · SMOKE 3', estado: 'activo',
    datos: { id: 'org-seq-2', nombre: 'QA 122.30 · SMOKE 3', ficha: {}, principios: [] }, version: 4,
  });
  vm.runInContext(`
    state.organismo = { id: 'org-seq-2', nombre: 'QA 122.30 · SMOKE 3', ficha: {}, principios: [], history: [{role:'user',content:'hola'}], _sv: { version: 4 } };
    state.history = [{role:'user',content:'hola'}];
    state.principios = [];
    state.ultimaLectura = null;
    localStorage.setItem('ag_core_organismos', JSON.stringify([{ id: 'org-seq-2', nombre: 'QA 122.30 · SMOKE 3', ficha: {}, principios: [], _sv: { version: 4 } }]));
  `, context);

  // "Guardar sesión" real -- el mismo botón que en la app real dispara guardarSesion(destilado),
  // que a su vez encadena registrarMomento() (guarda un momento) y crearCheckpointSesion() (guarda
  // un checkpoint), cada uno con su propio guardarOrganismo(). Se demuestra abajo que son tres
  // guardados reales y distintos, no uno solo.
  vm.runInContext(`guardarSesion('destilado de prueba real')`, context);
  // Acá se encolan TRES despachos reales y encadenados del mismo organismo (cada uno con su propio
  // round-trip real: fetch -> handler real -> rpc('guardar_organismo') contra el Supabase mockeado),
  // y la cola por organismo no deja arrancar el siguiente hasta que el anterior resolvió por completo
  // -- a diferencia del resto de las pruebas de este archivo, que sólo tienen UN despacho en vuelo
  // entre cada flush() y por eso les alcanza con el default (14 ticks). Encadenar tres de esos
  // round-trips reales necesita bastantes más ticks de microtarea para drenar del todo (confirmado
  // empíricamente: con flush() default esta prueba capturaba sólo 1 de las 3 solicitudes reales,
  // aunque el log del servidor real mostraba las tres -- no era un bug de la corrección, era que la
  // prueba leía `solicitudes` demasiado pronto).
  await flush(300);

  const guardadosGenericos = solicitudes.filter(s => !s.operacion);
  assert.equal(guardadosGenericos.length, 3, 'demostrado: "Guardar sesión" dispara tres guardados genéricos encadenados del mismo organismo (registrarMomento() adentro de guardarSesion(), el guardarOrganismo() directo, y crearCheckpointSesion()) -- comportamiento histórico legítimo (tres mutaciones distintas: momento, destilado, checkpoint), no una única escritura duplicada tres veces');

  const filaFinal = rows.get(PERFIL + '|org-seq-2');
  assert.equal(filaFinal.version, 7, 'los tres guardados deben aplicarse en secuencia sin ningún 409 (v4 -> v5 -> v6 -> v7)');
  assert.ok(filaFinal.datos.checkpoints && filaFinal.datos.checkpoints.core && filaFinal.datos.checkpoints.core.length === 1, 'el checkpoint creado por "Guardar sesión" SÍ llega a persistirse en el servidor real -- antes de esta corrección, el guardado que lo llevaba chocaba por versión (409) y se perdía en silencio, aunque localStorage ya lo mostrara guardado');
  assert.ok(filaFinal.datos.destilados && filaFinal.datos.destilados.length === 1, 'el destilado también persiste');
  assert.ok(filaFinal.datos.momentos && filaFinal.datos.momentos.some(m => m.tipo === 'destilado'), 'el momento registrado por registrarMomento() también persiste');

  const orgLocalFinal = JSON.parse(JSON.stringify(vm.runInContext('cargarOrganismos()[0]', context)));
  assert.deepEqual(orgLocalFinal._sv, { version: 7 }, 'el organismo canónico local (relectura fresca) coincide exactamente con lo que el servidor real terminó guardando -- sin necesitar ningún 409 ni recuperación para llegar ahí');
});

// ---------------------------------------------------------------------------------------------
test('replay de una tarjeta accepted_as_reference (envelopeReplayEpistemico) es de sólo lectura: no dispara ningún fetch ni muta el organismo', async () => {
  const { context, localStorage } = buildContext(async () => { throw new Error('el replay NO debe llamar a fetch -- es de sólo lectura'); }, 'staging.comprenderai.com');
  loadCoreScript(context);
  sembrarSesionYCreditos(localStorage);
  localStorage.setItem('ag_core_pref_integracion_epistemica_staging', '1');

  const recordRef = 'ER-11111111-1111-1111-1111-111111111111';
  const registroEpistemico = {
    schema_version: 'vr1-core-ledger/1.1', ledger_version: 2,
    entries: [{ record: { record_id: recordRef, revision: { version: 1 }, claim: { claim_id: 'CLAIM-1', content: 'algo aceptado' }, verification: {}, support: [], limits: { uncertainties: [] } } }],
    operations: [], review_events: [],
    reviews: [{ review_id: 'REV-1', state: 'accepted_as_reference', changed_claims: ['CLAIM-1'] }],
    turn_index: {}, change_types: { [recordRef]: [] },
  };
  vm.runInContext(`
    globalThis.__orgReplay = ${JSON.stringify({ id: 'org-replay-1', nombre: 'Test', ficha: { funcion: 'orientar' }, principios: ['p1'], registro_epistemico: registroEpistemico, momentos: [{ tipo: 'revision_epistemica' }], _sv: { version: 4 } })};
  `, context);
  const orgAntesJSON = vm.runInContext('JSON.stringify(__orgReplay)', context);

  const envelope = vm.runInContext(`
    envelopeReplayEpistemico(__orgReplay, { recordRef: ${JSON.stringify(recordRef)} })
  `, context);

  assert.ok(envelope, 'reconstruye un envoltorio real a partir del registro ya persistido');
  assert.equal(envelope.presentation.state, 'accepted_as_reference');
  assert.equal(envelope.presentation.recordRef, recordRef);
  assert.equal(typeof envelope.actions.onAccept, 'function', 'sigue entregando acciones reales (para un eventual re-uso), pero invocarlas es decisión humana -- el replay en sí no las llama');
  // el MISMO objeto (misma referencia dentro del realm vm) pasado como argumento no fue tocado
  const orgDespuesJSON = vm.runInContext('JSON.stringify(__orgReplay)', context);
  assert.equal(orgDespuesJSON, orgAntesJSON, 'envelopeReplayEpistemico() no muta el organismo que recibe -- es puramente de lectura, byte-equivalente antes/después');
});
