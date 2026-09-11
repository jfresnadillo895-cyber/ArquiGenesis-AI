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
  const location = { href: 'https://' + hostname + '/', origin: 'https://' + hostname, hostname, pathname: '/', hash: '', search: '', reload() {} };
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

// ---------------------------------------------------------------------------------------------
// AISLAMIENTO DE IDENTIDADES (08/09) -- pedido explícito de Javier: probar, con ejecución real,
// que cambiar entre dos identidades en el MISMO almacenamiento del navegador (mismo perfil de
// Chrome/Edge, dos cuentas distintas -- el caso real es una compu compartida, o simplemente
// cerrar sesión y volver a entrar con otra cuenta) no deja ningún organismo ni historial de la
// primera cuenta visible o utilizable por la segunda.
//
// Se generaliza acá el mismo mock mínimo de Supabase que usan las pruebas de arriba, para
// soportar DOS identidades reales (dos tokens -> dos perfiles), en vez de la única identidad fija
// que alcanza para las pruebas de un solo actor.
function makeFakeSupabaseMultiIdentidad(tokenAPerfil) {
  const rows = new Map(); // clave: perfil + '|' + cliente_id -- misma forma que makeFakeSupabase()
  function jsonResponse(status, body) {
    return { ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) };
  }
  async function fetchMock(url, opts = {}) {
    const u = new URL(url);
    if (u.pathname === '/auth/v1/user') {
      const auth = (opts.headers && opts.headers.Authorization) || '';
      const token = auth.replace(/^Bearer /, '');
      const perfil = tokenAPerfil[token];
      if (perfil) return jsonResponse(200, { id: perfil });
      return jsonResponse(401, {});
    }
    if (u.pathname === '/rest/v1/rpc/guardar_organismo') {
      const body = JSON.parse(opts.body);
      const key = body.p_perfil + '|' + body.p_cliente_id;
      const existing = rows.get(key);
      if (existing) {
        if (body.p_version_conocida !== existing.version) return jsonResponse(200, { conflicto: true, version: existing.version, datos: existing.datos });
        existing.datos = body.p_datos; existing.nombre = body.p_nombre; existing.estado = body.p_estado; existing.version += 1;
        rows.set(key, existing);
        return jsonResponse(200, { id: existing.id, version: existing.version });
      }
      if (body.p_version_conocida !== null) return jsonResponse(200, { conflicto: true, version: 0, datos: null });
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

// Carga AMBOS <script> inline de index.html -- a diferencia de loadCoreScript() (que sólo carga
// el segundo, el que usan el resto de las pruebas de este archivo), esta prueba necesita también
// el PRIMERO: ahí viven borrar()/cerrarSesionComprender()/tokenVigente() y el envoltorio real de
// window.fetch (index.html:~2355) que agrega el Authorization real en cada llamada -- exactamente
// la maquinaria de sesión cuyo aislamiento entre dos cuentas hay que probar. Usar sólo el segundo
// script (como el resto de las pruebas) sería probar el síntoma sin poder ejercer la causa real.
function loadFullScript(context) {
  const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map(m => m[1]);
  vm.runInContext(scripts[0], context, { filename: 'index-script0.js', timeout: 30000 });
  vm.runInContext(scripts[1], context, { filename: 'index-core.js', timeout: 30000 });
}

test('aislamiento de identidades: cerrar sesión y entrar con otra cuenta en el mismo navegador no deja ver ni usar organismos ni historial de la cuenta anterior', async () => {
  const TOKEN_A = 'tok-identidad-a', PERFIL_A = 'perfil-a-uuid-real';
  const TOKEN_B = 'tok-identidad-b', PERFIL_B = 'perfil-b-uuid-real';
  const { fetchMock: fakeSupabaseFetch, rows } = makeFakeSupabaseMultiIdentidad({ [TOKEN_A]: PERFIL_A, [TOKEN_B]: PERFIL_B });
  const handler = await importHandlerFresh();

  async function bridgeFetch(opciones) {
    const method = (opciones && opciones.method) || 'GET';
    const body = opciones && opciones.body ? JSON.parse(opciones.body) : undefined;
    // El puente reenvía el Authorization que el CLIENTE REAL mandó (via el envoltorio real de
    // window.fetch, ahora sí cargado) -- para que el servidor real (identificar()) resuelva la
    // identidad efectiva de cada solicitud exactamente como en producción, no una fija de prueba.
    const authHeader = (opciones && opciones.headers && (opciones.headers.Authorization || opciones.headers.authorization)) || '';
    const req = { method, body, headers: { authorization: authHeader }, query: {} };
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
      if (opciones && opciones.body) {
        const authHeader = (opciones.headers && (opciones.headers.Authorization || opciones.headers.authorization)) || '';
        solicitudes.push({ authHeader, body: JSON.parse(opciones.body) });
      }
      return bridgeFetch(opciones);
    }
    // Cualquier otra llamada (p.ej. sincronizarSaldo() pegándole directo a Supabase /rest/v1/perfiles
    // desde el primer script) recibe una respuesta neutra -- no aporta nada a lo que esta prueba
    // verifica, y una forma vacía evita que ese camino, ajeno al aislamiento, rompa algo por su cuenta.
    return { ok: true, status: 200, json: async () => ({}), text: async () => '{}', headers: { get() { return null; } } };
  };

  const { context, localStorage } = buildContext(fetchImpl, 'app.comprenderai.com');
  // La sesión de A se siembra ANTES de cargar los scripts: el primer script corre arrancar() de
  // inmediato (document.readyState ya es 'complete' en este arnés) y, sin sesión previa, intenta
  // pintar el portal de login -- que necesita más DOM del que este arnés mínimo ofrece. Con sesión
  // ya presente toma el camino real de "ya hay sesión" (sincronizarSaldo()), igual que un navegador
  // real abriendo la página con una sesión ya guardada.
  vm.runInContext(`
    localStorage.setItem('comprender_sesion', JSON.stringify({ token: ${JSON.stringify(TOKEN_A)}, refresco: '', vence: Date.now() + 3600000, correo: 'identidad-a@example.com' }));
  `, context);
  loadFullScript(context);
  await flush(80);

  // A crea y guarda, por el camino real (guardarOrganismo -> cola -> POST real, con el Authorization
  // real de A puesto por el envoltorio de fetch), un organismo con contenido propio y sensible.
  vm.runInContext(`
    state.organismo = { id: 'org-de-identidad-A', nombre: 'Proyecto privado de A', ficha: { funcion: 'orientar', diagnostico: 'diagnóstico confidencial de A' }, principios: ['principio secreto de A'], history: [], momentos: [], _sv: null };
    guardarOrganismo(state.organismo);
  `, context);
  await flush(80);
  assert.equal(rows.get(PERFIL_A + '|org-de-identidad-A') && rows.get(PERFIL_A + '|org-de-identidad-A').version, 1, 'paso previo: el organismo de A quedó guardado de verdad en el servidor real, bajo la cuenta de A');

  // ---- A cierra sesión -- camino real de producción (window.cerrarSesionComprender(), el mismo
  // botón "Salir"), no un removeItem manual: si mañana cambia qué borra el logout, esta prueba lo
  // sigue ejerciendo tal cual es, no una copia de lo que hacía en el momento de escribirla. ----
  vm.runInContext(`window.cerrarSesionComprender()`, context);
  // cerrarSesionComprender() termina con location.reload() -- en este arnés es un no-op (no hay
  // navegación real posible dentro de una única instancia de vm), así que sólo falta simular lo que
  // en un F5 real TAMBIÉN se pierde: el estado JS en memoria (los `var` de nivel de módulo vuelven a
  // su valor inicial). localStorage, que es lo que SÍ sobrevive a una recarga real -- y es exactamente
  // lo que esta prueba necesita seguir observando -- queda intacto tal cual lo dejó cerrarSesionComprender().
  vm.runInContext(`state.organismo = null; state.history = [];`, context);
  await flush();

  // ---- Identidad B inicia sesión en el MISMO navegador (mismo localStorage, sin recargar la
  // página -- el caso "cerrar sesión y entrar con otra cuenta" dentro de la misma pestaña) ----
  vm.runInContext(`
    localStorage.setItem('comprender_sesion', JSON.stringify({ token: ${JSON.stringify(TOKEN_B)}, refresco: '', vence: Date.now() + 3600000, correo: 'identidad-b@example.com' }));
  `, context);
  // camino real de "sesión recién confirmada" -- candado.txt llama exactamente a esto tras un
  // login exitoso dentro del portal, sin recargar la página (index.html:~3544).
  vm.runInContext(`window.alConfirmarSesion()`, context);
  await flush(80);

  // 1) B no debe ver el organismo de A en su lista local (ni en cargarOrganismos(), de donde sale
  //    toda la UI: el selector, "Ver alcance", etc.).
  const organismosVisiblesParaB = JSON.parse(JSON.stringify(vm.runInContext('cargarOrganismos()', context)));
  assert.ok(!organismosVisiblesParaB.some(o => o.id === 'org-de-identidad-A'), 'el organismo de A no debe aparecer en la lista local de organismos una vez que B inició sesión en el mismo navegador');

  // 2) El servidor real -- fuente de verdad -- no debe tener el organismo de A guardado bajo la
  //    cuenta de B (ni copiado, ni con otro cliente_id: se busca por contenido, no sólo por id).
  assert.equal(rows.get(PERFIL_B + '|org-de-identidad-A'), undefined, 'el organismo de A no debe haberse subido al servidor bajo la cuenta de B');
  const posibleFugaEnB = [...rows.values()].find(r => r.perfil === PERFIL_B && r.datos && JSON.stringify(r.datos).indexOf('secreto de A') > -1);
  assert.equal(posibleFugaEnB, undefined, 'ningún contenido de A (ficha, principios) debe aparecer en ninguna fila real de la cuenta de B');

  // 3) El organismo de A, en su propia cuenta, sigue intacto y sin tocar -- esto NO es sólo "no se
  //    filtró": tampoco se dañó ni se perdió por el cambio de identidad.
  const filaDeA = rows.get(PERFIL_A + '|org-de-identidad-A');
  assert.ok(filaDeA, 'el organismo de A debe seguir existiendo en el servidor, en su propia cuenta');
  assert.equal(filaDeA.version, 1, 'sin ninguna escritura adicional sobre el organismo de A disparada por la sesión de B');

  // 4) Ninguna solicitud real viajó hacia /api/organismos con el token de B llevando contenido de A
  //    -- control directo sobre el tráfico real, no sólo sobre el resultado final.
  const fugasReales = solicitudes.filter(s => s.authHeader === 'Bearer ' + TOKEN_B && s.body && JSON.stringify(s.body).indexOf('org-de-identidad-A') > -1);
  assert.equal(fugasReales.length, 0, 'ninguna solicitud real con el token de B debe mencionar el organismo de A');
});

// ---------------------------------------------------------------------------------------------
// AISLAMIENTO02 (08/09) -- la prueba de arriba ("aislamiento de identidades") cubre lo que queda
// PERSISTIDO (localStorage + servidor) una vez que B ya inició sesión, con A habiendo cerrado
// sesión por el camino explícito (window.cerrarSesionComprender(), que recarga la página de verdad
// y por eso ya empieza con el heap de JS en blanco). Lo que NO cubre -- y es el hueco real
// encontrado al auditar 122.31 -- es la ventana en que la sesión vence a mitad de uso (401, SIN
// recarga) y/o cambia de identidad sin pasar por un logout explícito: hasta esta corrección, el
// organismo/la conversación de la cuenta anterior seguían enteros en la MEMORIA del script del
// núcleo (nadie los tocaba), y cualquier sincronización que ya estuviera en la cola de
// encolarSincronizacionOrganismo() para ese organismo podía despachar recién cuando le tocara el
// turno -- con el token de la cuenta que fuera a estar activa EN ESE MOMENTO, sin importar cuál
// era la cuenta cuando la tarea se había encolado.
//
// Esta prueba reproduce exactamente ese escenario con ejecución real de punta a punta (cliente
// real -- los dos <script> vía loadFullScript, igual que la prueba de arriba -- y servidor real):
// A deja DOS ediciones del mismo organismo encoladas (el caso real ya demostrado por
// CONFLICTOVERSION02: tipeo/edición rápida, dos guardarOrganismo() casi juntos) y, en la MISMA
// vuelta síncrona -- sin ningún await entremedio, el peor caso real, más ajustado que esperar a
// que la primera ya hubiera salido -- la sesión vence (window.alVencerSesion(), lo que dispara un
// 401 real) y entra una cuenta distinta (window.alConfirmarSesion(), lo que dispara un login
// real). Si el guardia frena esta ventana -- la más angosta posible --, frena cualquier ventana
// más ancha también.
test('AISLAMIENTO02: una sincronización ya encolada de la cuenta anterior no debe despachar con el token de la cuenta nueva tras vencer la sesión y/o cambiar de identidad sin recargar', async () => {
  const TOKEN_A = 'tok-aisl02-a', PERFIL_A = 'perfil-aisl02-a';
  const TOKEN_B = 'tok-aisl02-b', PERFIL_B = 'perfil-aisl02-b';
  const { fetchMock: fakeSupabaseFetch, rows } = makeFakeSupabaseMultiIdentidad({ [TOKEN_A]: PERFIL_A, [TOKEN_B]: PERFIL_B });
  const handler = await importHandlerFresh();

  async function bridgeFetch(opciones) {
    const method = (opciones && opciones.method) || 'GET';
    const body = opciones && opciones.body ? JSON.parse(opciones.body) : undefined;
    const authHeader = (opciones && opciones.headers && (opciones.headers.Authorization || opciones.headers.authorization)) || '';
    const req = { method, body, headers: { authorization: authHeader }, query: {} };
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
      if (opciones && opciones.body) {
        const authHeader = (opciones.headers && (opciones.headers.Authorization || opciones.headers.authorization)) || '';
        solicitudes.push({ authHeader, body: JSON.parse(opciones.body) });
      }
      return bridgeFetch(opciones);
    }
    return { ok: true, status: 200, json: async () => ({}), text: async () => '{}', headers: { get() { return null; } } };
  };

  const { context, localStorage } = buildContext(fetchImpl, 'app.comprenderai.com');
  vm.runInContext(`
    localStorage.setItem('comprender_sesion', JSON.stringify({ token: ${JSON.stringify(TOKEN_A)}, refresco: '', vence: Date.now() + 3600000, correo: 'identidad-a@example.com' }));
  `, context);
  loadFullScript(context);
  await flush(80);

  vm.runInContext(`
    state.organismo = { id: 'org-aisl02-de-A', nombre: 'Trabajo privado de A', ficha: { diagnostico: 'diagnóstico secreto de A' }, principios: ['nunca debería llegar a la cuenta de B'], history: [], momentos: [], _sv: null };
    guardarOrganismo(state.organismo);
    state.organismo.nombre = 'Trabajo privado de A (editado)';
    guardarOrganismo(state.organismo);
  `, context);
  // Sin flush entremedio: la sesión vence y B entra en la MISMA vuelta síncrona en que A dejó las
  // dos ediciones encoladas -- exactamente lo que hacen de verdad el 401 (window.alVencerSesion) y
  // un login exitoso (window.alConfirmarSesion), ninguno de los dos esperado por su llamador. El
  // 401 real SIEMPRE llama primero a borrar() (AISLAMIENTO01, ya certificado en el primer script) y
  // recién después a window.alVencerSesion() -- borrar() vive en el cierre privado del primer
  // script, no expuesta en window, así que acá se reproduce EXACTAMENTE lo que ese borrar() deja
  // hecho (mismas 5 claves) en vez de llamar a una función que no se puede alcanzar desde afuera.
  // Esto es a propósito la parte DIFÍCIL del escenario real, no un atajo: aunque localStorage ya
  // esté limpio de la cuenta de A (AISLAMIENTO01 haciendo su parte), las DOS tareas que A ya había
  // dejado encoladas en memoria (arriba) no dependen de localStorage para nada -- son lo único que
  // AISLAMIENTO02 tiene que frenar.
  vm.runInContext(`
    localStorage.removeItem('comprender_sesion');
    localStorage.removeItem('ag_core_saldo');
    localStorage.removeItem('ag_core_organismos');
    localStorage.removeItem('ag_core_propuestas');
    localStorage.removeItem('ag_core_sesiones');
    window.alVencerSesion();
  `, context);
  vm.runInContext(`
    localStorage.setItem('comprender_sesion', JSON.stringify({ token: ${JSON.stringify(TOKEN_B)}, refresco: '', vence: Date.now() + 3600000, correo: 'identidad-b@example.com' }));
    window.alConfirmarSesion();
  `, context);

  await flush(120);

  // 1) El organismo de A no debe haber llegado al servidor bajo la cuenta de B.
  assert.equal(rows.get(PERFIL_B + '|org-aisl02-de-A'), undefined, 'el organismo de A no debe haberse subido al servidor bajo la cuenta de B');
  // 2) Ningún contenido de A debe aparecer en ninguna fila real, de ninguna cuenta.
  const posibleFuga = [...rows.values()].find(r => r.datos && JSON.stringify(r.datos).indexOf('secreto de A') > -1);
  assert.equal(posibleFuga, undefined, 'ningún contenido del organismo de A debe haber quedado guardado en el servidor real tras el cambio de identidad');
  // 3) Control directo sobre el tráfico real: ninguna solicitud con el token de B debe mencionar el organismo de A.
  const fugasConTokenB = solicitudes.filter(s => s.authHeader === 'Bearer ' + TOKEN_B && s.body && JSON.stringify(s.body).indexOf('org-aisl02-de-A') > -1);
  assert.equal(fugasConTokenB.length, 0, 'ninguna solicitud real con el token de B debe mencionar el organismo de A');
  // 4) Prueba directa de que el guardia frenó el DESPACHO -- ninguna de las dos ediciones
  //    encoladas por A debe haber generado un POST real, ni con A ni con B.
  const solicitudesDelOrganismo = solicitudes.filter(s => s.body && s.body.cliente_id === 'org-aisl02-de-A');
  assert.equal(solicitudesDelOrganismo.length, 0, 'ninguna de las dos ediciones encoladas por A debe haber despachado un POST real -- el guardia de identidadEpoch debe frenarlas antes de llegar a la red');
});

// La prueba de arriba certifica la propiedad de seguridad de punta a punta. Esta segunda prueba
// aísla, con ejecución real (llama a la función real, no una reimplementación) pero sin la
// maquinaria completa de sesión/servidor, el mecanismo concreto que la hace posible:
// alRotarIdentidad() -- expuesta como window.alVencerSesion() (401) y llamada también, siempre,
// desde dentro de window.alConfirmarSesion() (login) -- debe retirar de la vista el organismo y la
// conversación anteriores, limpiar el estado asociado, e invalidar cualquier respuesta en vuelo.
// Usa loadCoreScript() (sólo el segundo <script>, no el candado de sesión): alRotarIdentidad() y
// ambos ganchos viven ahí, y así se evita ejercer portal() -- pantalla de login real, sin cambios
// en esta corrección, y que este arnés mínimo no sabe renderizar (no parsea innerHTML a DOM real).
test('AISLAMIENTO02: alRotarIdentidad() retira el organismo, la conversación y los principios de la vista, y arruina cualquier tarea en vuelo', async () => {
  const fetchImpl = async () => ({ ok: true, status: 200, json: async () => ({ organismos: [] }), text: async () => '{}', headers: { get() { return null; } } });
  const { context, localStorage } = buildContext(fetchImpl, 'app.comprenderai.com');
  loadCoreScript(context);
  await flush();
  sembrarSesionYCreditos(localStorage);

  vm.runInContext(`
    state.organismo = { id: 'org-b1', nombre: 'Organismo visible', ficha: {}, principios: [{texto:'p1',fam:'x'}], history: [] };
    state.history = [{ role:'user', content:'hola' }];
    state.principios = [{ texto: 'principio de esta sesión', fam: 'x', estado: 'emergente' }];
    state.c1g3Sesiones = { 'org-b1': { openingId: 'x', estado: 'abierta', vista: {} } };
    el.stream.innerHTML = '<div>mensaje visible de la cuenta anterior</div>';
    el.hilo.innerHTML = '<div>fila de principio de la cuenta anterior</div>';
    el.orgchip.style.display = 'inline-flex';
    el.chat.style.display = 'flex';
    el.welcome.style.display = 'none';
    globalThis.__epochAntes = { epoch: state.epoch, c1g3Epoch: state.c1g3Epoch, identidadEpoch: state.identidadEpoch };
  `, context);

  vm.runInContext(`window.alVencerSesion()`, context);
  await flush();

  // Los valores que vuelven de vm.runInContext son objetos del realm de la vm (otro Array/Object
  // intrínseco que el del proceso host, aunque tengan el mismo aspecto) -- igual que el resto de
  // este archivo, se comparan tras un JSON.parse(JSON.stringify(...)), no directo.
  assert.equal(vm.runInContext('state.organismo', context), null, 'sin organismo abierto tras retirar la identidad');
  assert.deepEqual(JSON.parse(JSON.stringify(vm.runInContext('state.history', context))), [], 'sin historial de la cuenta anterior');
  assert.deepEqual(JSON.parse(JSON.stringify(vm.runInContext('state.principios', context))), [], 'sin principios de sesión de la cuenta anterior');
  assert.deepEqual(JSON.parse(JSON.stringify(vm.runInContext('state.c1g3Sesiones', context))), {}, 'sin aperturas de Contextos Universal pendientes de la cuenta anterior');
  assert.equal(vm.runInContext('el.stream.innerHTML', context), '', 'la conversación anterior se retira de la vista');
  assert.notEqual(vm.runInContext('el.hilo.innerHTML', context), '<div>fila de principio de la cuenta anterior</div>', 'los principios de la cuenta anterior se retiran del Hilo');
  assert.equal(vm.runInContext('el.chat.style.display', context), 'none', 'no deja la conversación anterior a la vista');
  assert.equal(vm.runInContext('el.welcome.style.display', context), 'flex', 'vuelve a la pantalla de bienvenida');
  assert.equal(vm.runInContext('el.orgchip.style.display', context), 'none', 'el chip del organismo anterior se oculta');

  const antes = vm.runInContext('globalThis.__epochAntes', context);
  const despues = vm.runInContext('({ epoch: state.epoch, c1g3Epoch: state.c1g3Epoch, identidadEpoch: state.identidadEpoch })', context);
  assert.ok(despues.epoch > antes.epoch, 'el epoch del chat principal avanza -- cualquier respuesta del motor en vuelo de la cuenta anterior se descarta');
  assert.ok(despues.c1g3Epoch > antes.c1g3Epoch, 'el epoch de Contextos Universal avanza -- cualquier tarjeta de ese módulo en vuelo de la cuenta anterior se descarta');
  assert.ok(despues.identidadEpoch > antes.identidadEpoch, 'el token de identidad avanza -- bloquea cualquier sincronización ya encolada de la cuenta anterior (certificado de punta a punta en la prueba anterior)');
});

// ================= 122.31 · Continuidad cognitiva -- Modo Conversación / Modo Investigación =====
// Todas las funciones nuevas de 122.31 (activo122_31, modoInvestigacionActivo,
// debeMostrarInterrupcionesInmediatas122_31, comprensionesPendientesDeRevision,
// contarPendientesRevision122_31, actualizarEtiquetaGuardar, alternarModoInvestigacion122_31) son
// declaraciones de función de primer nivel dentro del SEGUNDO <script> de index.html (no están
// envueltas en un IIFE, igual que el resto de las funciones que ya prueba este archivo) -- por
// eso loadCoreScript() (sin el primer script) alcanza para llamarlas directo por nombre vía
// vm.runInContext(), exactamente como ya hace la prueba de AISLAMIENTO02 de arriba con
// window.alVencerSesion. mostrarCuenta() (la relocación de "Idioma") es la única pieza de 122.31
// que vive en el PRIMER script (candado.txt/"Candado de acceso"), envuelta en su propio IIFE y
// sin exponerse a window -- no es alcanzable desde ningún arnés headless existente (tampoco lo
// eran, antes de este corte, ninguna otra vista de "Mi cuenta": no es una brecha nueva). Esa
// pieza se verificó por lectura cuidadosa contra el patrón ya existente de irClave()/irEliminar()
// (mismo `cablear()`, mismo `botonSecundario()`/`enlace()`) y queda señalada en el informe de
// cierre como el único punto de este corte sin cobertura automatizada.

test('122.31: fuera de staging, avisoPropuesta se sigue mostrando sin condición -- 122.31 no cambia nada ahí', async () => {
  const fetchImpl = async () => ({ ok: true, status: 200, json: async () => ({ organismos: [] }), text: async () => '{}', headers: { get() { return null; } } });
  const { context, localStorage } = buildContext(fetchImpl, 'app.comprenderai.com');
  loadCoreScript(context);
  await flush();
  sembrarSesionYCreditos(localStorage);
  vm.runInContext(`state.organismo = { id: 'org-p31-1', nombre: 'Fuera de staging', ficha: { funcion: 'estabilizar' }, principios: [], history: [] };`, context);
  vm.runInContext(`proponerFicha({ funcion: 'conectar' }, null, null, null, [])`, context);
  await flush();
  const huboAviso = vm.runInContext("el.stream.children.some(function(c){ return c.className === 'propaviso'; })", context);
  assert.equal(huboAviso, true, 'fuera de staging, avisoPropuesta debe seguir mostrándose sin condición');
});

test('122.31: en staging, Modo Conversación (default) NO muestra avisoPropuesta -- pero la propuesta se genera y persiste igual que siempre', async () => {
  const fetchImpl = async () => ({ ok: true, status: 200, json: async () => ({ organismos: [] }), text: async () => '{}', headers: { get() { return null; } } });
  const { context, localStorage } = buildContext(fetchImpl, 'staging.comprenderai.com');
  loadCoreScript(context);
  await flush();
  sembrarSesionYCreditos(localStorage);
  vm.runInContext(`state.organismo = { id: 'org-p31-2', nombre: 'Staging Conversación', ficha: { funcion: 'estabilizar' }, principios: [], history: [] };`, context);
  const prop = vm.runInContext(`proponerFicha({ funcion: 'conectar' }, null, null, null, [])`, context);
  await flush();
  assert.ok(prop && prop.id, 'la propuesta se generó y se devolvió igual que siempre (§6 recolección silenciosa)');
  const huboAviso = vm.runInContext("el.stream.children.some(function(c){ return c.className === 'propaviso'; })", context);
  assert.equal(huboAviso, false, 'Modo Conversación (default en staging) no debe mostrar el cartel inmediato');
  const pendientesReales = vm.runInContext("propuestasPendientes('org-p31-2').length", context);
  assert.equal(pendientesReales, 1, 'la propuesta quedó persistida y pendiente -- disponible para la revisión consolidada, no se perdió por no mostrarse');
});

test('122.31: activar Modo Investigación reproduce exactamente el comportamiento de avisoPropuesta de 122.30 dentro de staging', async () => {
  const fetchImpl = async () => ({ ok: true, status: 200, json: async () => ({ organismos: [] }), text: async () => '{}', headers: { get() { return null; } } });
  const { context, localStorage } = buildContext(fetchImpl, 'staging.comprenderai.com');
  loadCoreScript(context);
  await flush();
  sembrarSesionYCreditos(localStorage);
  localStorage.setItem('ag_core_pref_modo_investigacion_staging', '1');
  vm.runInContext(`state.organismo = { id: 'org-p31-3', nombre: 'Staging Investigación', ficha: { funcion: 'estabilizar' }, principios: [], history: [] };`, context);
  vm.runInContext(`proponerFicha({ funcion: 'conectar' }, null, null, null, [])`, context);
  await flush();
  const huboAviso = vm.runInContext("el.stream.children.some(function(c){ return c.className === 'propaviso'; })", context);
  assert.equal(huboAviso, true, 'con Modo Investigación activo, el cartel inmediato vuelve a mostrarse -- mismo comportamiento que 122.30 sin este contrato');
});

test('122.31: mountSustentacionCard vía addMotorMsg respeta Modo Conversación/Investigación en staging y no cambia nada fuera de staging', async () => {
  async function correr(hostname, prefInvestigacion) {
    const fetchImpl = async () => ({ ok: true, status: 200, json: async () => ({ organismos: [] }), text: async () => '{}', headers: { get() { return null; } } });
    const { context, localStorage } = buildContext(fetchImpl, hostname);
    loadCoreScript(context);
    await flush();
    sembrarSesionYCreditos(localStorage);
    if (prefInvestigacion) localStorage.setItem('ag_core_pref_modo_investigacion_staging', '1');
    vm.runInContext(`
      var __creates = 0;
      var __origCreate = window.__sustentacionCard.create;
      window.__sustentacionCard.create = function(){ __creates++; return __origCreate.apply(this, arguments); };
      addMotorMsg({ visible: 'hola', cristaliza: [], principios: [], tension: null, funcion: null, diag: null }, false, { presentation: { state: 'review_required' }, actions: {} });
    `, context);
    return vm.runInContext('__creates', context);
  }
  assert.equal(await correr('app.comprenderai.com', false), 1, 'fuera de staging, la tarjeta se monta siempre -- sin cambios');
  assert.equal(await correr('staging.comprenderai.com', false), 0, 'staging + Modo Conversación (default): no se monta');
  assert.equal(await correr('staging.comprenderai.com', true), 1, 'staging + Modo Investigación: se monta, igual que 122.30');
});

test('122.31: modoInvestigacionActivo()/alternarModoInvestigacion122_31() -- apagado por defecto (§4.2), opt-in local, y siempre false fuera de staging pase lo que pase en localStorage', async () => {
  const fetchImpl = async () => ({ ok: true, status: 200, json: async () => ({ organismos: [] }), text: async () => '{}', headers: { get() { return null; } } });
  {
    const { context, localStorage } = buildContext(fetchImpl, 'app.comprenderai.com');
    loadCoreScript(context);
    await flush();
    localStorage.setItem('ag_core_pref_modo_investigacion_staging', '1');   // aunque esté "prendida" en el storage...
    assert.equal(vm.runInContext('modoInvestigacionActivo()', context), false, 'fuera de staging, siempre false, sin importar localStorage');
    assert.equal(vm.runInContext('activo122_31()', context), false);
    assert.equal(vm.runInContext('debeMostrarInterrupcionesInmediatas122_31()', context), true, 'fuera de staging, las interrupciones inmediatas siguen mostrándose siempre');
  }
  {
    const { context, localStorage } = buildContext(fetchImpl, 'staging.comprenderai.com');
    loadCoreScript(context);
    await flush();
    assert.equal(vm.runInContext('modoInvestigacionActivo()', context), false, 'apagado por defecto');
    assert.equal(vm.runInContext('debeMostrarInterrupcionesInmediatas122_31()', context), false, 'Modo Conversación (default) oculta las interrupciones inmediatas');
    const nuevo = vm.runInContext('alternarModoInvestigacion122_31()', context);
    assert.equal(nuevo, true, 'el toggle devuelve el nuevo estado');
    assert.equal(vm.runInContext('modoInvestigacionActivo()', context), true);
    assert.equal(vm.runInContext('debeMostrarInterrupcionesInmediatas122_31()', context), true, 'con Investigación activo, las interrupciones vuelven a mostrarse');
    assert.equal(localStorage.getItem('ag_core_pref_modo_investigacion_staging'), '1');
    vm.runInContext('alternarModoInvestigacion122_31()', context);
    assert.equal(vm.runInContext('modoInvestigacionActivo()', context), false, 'vuelve a apagarse');
  }
});

test('122.31: actualizarEtiquetaGuardar()/contarPendientesRevision122_31() son no-op fuera de staging -- #btnGuardar nunca cambia de texto ahí', async () => {
  const fetchImpl = async () => ({ ok: true, status: 200, json: async () => ({ organismos: [] }), text: async () => '{}', headers: { get() { return null; } } });
  const { context, localStorage } = buildContext(fetchImpl, 'app.comprenderai.com');
  loadCoreScript(context);
  await flush();
  sembrarSesionYCreditos(localStorage);
  vm.runInContext(`
    state.organismo = { id: 'org-p31-5', nombre: 'Fuera de staging', ficha: {}, principios: [], history: [] };
    el.btnGuardar.textContent = 'Guardar sesión';
  `, context);
  assert.equal(vm.runInContext('contarPendientesRevision122_31()', context), 0, 'fuera de staging, el conteo siempre es 0');
  vm.runInContext(`addPrincipio('otro principio', 'energia')`, context);   // dispara actualizarEtiquetaGuardar() internamente
  assert.equal(vm.runInContext('el.btnGuardar.textContent', context), 'Guardar sesión', 'sin cambios fuera de staging, aunque haya un principio emergente nuevo');
});

test('122.31: comprensionesPendientesDeRevision()/contarPendientesRevision122_31()/actualizarEtiquetaGuardar() reflejan el estado real del ledger, propuestas y principios -- de punta a punta, con Modo Conversación activo (sin interrupción inmediata)', async () => {
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
  await flush();
  sembrarSesionYCreditos(localStorage);
  localStorage.setItem('ag_core_pref_integracion_epistemica_staging', '1');
  // Modo Investigación queda OFF (default) a propósito: éste es justo el escenario que 122.31
  // introduce -- la comprensión se crea igual (ver aserción del ledger más abajo), sólo que no
  // interrumpe (ya cubierto por la prueba de mountSustentacionCard de arriba).

  vm.runInContext(`
    state.organismo = { id: 'org-p31-4', nombre: 'QA 122.31 · revisión consolidada', ficha: {}, principios: [], history: [] };
    state.history = []; state.busy = false; state.epoch = state.epoch || 0;
  `, context);
  await vm.runInContext('guardarOrganismo(state.organismo)', context);
  await flush();

  await context.enviar('hola, contame algo con ficha');
  await flush();

  const org1 = JSON.parse(JSON.stringify(vm.runInContext('cargarOrganismos()[0]', context)));
  assert.equal(org1.registro_epistemico.entries.length, 1, 'la comprensión candidata se creó en el servidor real, aunque Modo Conversación no haya mostrado ninguna tarjeta');

  const nComprensiones = vm.runInContext("comprensionesPendientesDeRevision(cargarOrganismos()[0]).length", context);
  const nPropuestas = vm.runInContext("propuestasPendientes('org-p31-4').length", context);
  const nPrincipiosEmergentes = vm.runInContext("state.principios.filter(function(p){return p.estado==='emergente';}).length", context);
  const total = vm.runInContext('contarPendientesRevision122_31()', context);
  assert.ok(nComprensiones >= 1, 'al menos la comprensión creada en este turno aparece pendiente de revisión');
  assert.equal(total, nComprensiones + nPropuestas + nPrincipiosEmergentes, 'el conteo consolidado es exactamente la suma de sus tres partes (Comprensiones + Memoria + Principios emergentes)');

  vm.runInContext('actualizarEtiquetaGuardar()', context);
  const etiqueta1 = vm.runInContext('el.btnGuardar.textContent', context);
  assert.equal(etiqueta1, 'Revisar y guardar · ' + total, 'el texto de #btnGuardar refleja el mismo total (§7: "Revisar y guardar · N")');

  // Aceptar la comprensión (mismo camino real que ya certifica "secuencia real completa" más
  // arriba) la saca de comprensionesPendientesDeRevision() -- el conteo y la etiqueta bajan.
  const entradaAsistente = vm.runInContext('state.history[state.history.length - 1]', context);
  const recordRef = entradaAsistente.recordRef;
  const aceptado = await vm.runInContext(`
    (function(){
      var org = cargarOrganismos()[0];
      var acciones = construirAccionesTarjetaEpistemica(org);
      return acciones.onAccept(${JSON.stringify(recordRef)}).then(function(){ return true; }, function(e){ return { rechazado:true, motivo:String(e && e.message) }; });
    })()
  `, context);
  await flush();
  assert.equal(aceptado, true, 'aceptar debe funcionar igual que siempre -- 122.31 no toca construirAccionesTarjetaEpistemica()');

  const nComprensionesTrasAceptar = vm.runInContext("comprensionesPendientesDeRevision(cargarOrganismos()[0]).length", context);
  assert.ok(nComprensionesTrasAceptar < nComprensiones, 'aceptada, ya no aparece como pendiente de revisión');

  const totalTrasAceptar = vm.runInContext('contarPendientesRevision122_31()', context);
  assert.ok(totalTrasAceptar < total, 'el conteo consolidado baja en consecuencia');
  // Sin llamar actualizarEtiquetaGuardar() a mano acá: construirAccionesTarjetaEpistemica() ya la
  // llama sola tras aplicar la confirmación (ver el nuevo call site agregado dentro de esa
  // función) -- si ese call site faltara, esta aserción compararía contra la etiqueta vieja
  // (todavía con `total`) y fallaría.
  assert.equal(vm.runInContext('el.btnGuardar.textContent', context), 'Revisar y guardar · ' + totalTrasAceptar, 'la etiqueta se actualizó sola al aceptar, sin intervención manual del test');
});

// ---------------------------------------------------------------------------------------------
// 122.31-CORR01 (09/09, defecto bloqueante reportado en la caminata humana en staging) -- dentro
// de pintarRevisarYGuardar() (§7, "Revisar y guardar"), el botón "Guardar sesión y revisar
// después" (bPostergar) reusaba ofrecerGuardado(null), que abre la compuerta legacy "Destilado de
// la sesión" con sus propias dos acciones (Descartar / Guardar sesión) -- una SEGUNDA decisión
// obligatoria que el contrato no permite en esa salida (§7 "Libertad para postergar": ninguna
// salida debería exigir terminar de revisar, y mucho menos abrir otra compuerta). La corrección
// hace que bPostergar guarde la sesión directo (mismo guardarSesion() de siempre, sin cambios) y
// cierre el overlay sin abrir ninguna otra pantalla.
//
// Nota de arnés: FakeElement no parsea innerHTML como DOM real (mismo límite ya señalado en el
// comentario de la prueba de AISLAMIENTO02, arriba) -- "el.cardContent.innerHTML = ''" sólo vacía
// la propiedad string, nunca el arreglo real .children. Por eso la forma correcta de comprobar acá
// "¿se abrió la compuerta legacy?" es buscar, en TODO el árbol de .children de el.cardContent
// (viejos y nuevos mezclados), si apareció el título propio de ofrecerGuardado() -- no alcanza con
// mirar sólo el primer hijo.
test('122.31-CORR01: "Guardar sesión y revisar después" guarda directo y vuelve al recorrido -- NO abre "Destilado de la sesión", y conserva íntegros comprensiones/principios/propuestas pendientes', async () => {
  const fetchImpl = async () => ({ ok: true, status: 200, json: async () => ({ organismos: [] }), text: async () => '{}', headers: { get() { return null; } } });
  const { context, localStorage } = buildContext(fetchImpl, 'staging.comprenderai.com');
  loadCoreScript(context);
  await flush();
  sembrarSesionYCreditos(localStorage);
  localStorage.setItem('ag_core_pref_integracion_epistemica_staging', '1');   // gatea envelopeReplayEpistemico()/comprensionesPendientesDeRevision(), sin lo cual quedarían siempre en 0

  // Los tres tipos de pendiente a la vez: una comprensión candidata todavía 'pending_human_review'
  // (registro_epistemico, misma forma exacta que ya usa la prueba de replay de arriba), un
  // principio 'emergente' de esta sesión, y una propuesta de memoria real (proponerFicha() real,
  // mismo patrón que ya usan las pruebas de 122.31 de arriba).
  const recordRef = 'ER-22222222-2222-2222-2222-222222222222';
  const registroEpistemico = {
    schema_version: 'vr1-core-ledger/1.1', ledger_version: 1,
    entries: [{ record: { record_id: recordRef, revision: { version: 1 }, claim: { claim_id: 'CLAIM-CORR01', content: 'comprensión candidata de prueba' }, verification: {}, support: [], limits: { uncertainties: [] } } }],
    operations: [], review_events: [],
    reviews: [{ review_id: 'REV-CORR01', state: 'pending_human_review', changed_claims: ['CLAIM-CORR01'] }],
    turn_index: {}, change_types: { [recordRef]: [] },
  };
  vm.runInContext(`
    state.organismo = { id: 'org-corr01', nombre: 'QA CORR01', ficha: { funcion: 'estabilizar' }, principios: [], history: [{role:'user',content:'hola'}],
                         registro_epistemico: ${JSON.stringify(registroEpistemico)} };
    state.history = [{role:'user',content:'hola'}];
    state.principios = [];
  `, context);
  vm.runInContext(`addPrincipio('un principio emergente de prueba', 'energia')`, context);
  vm.runInContext(`proponerFicha({ funcion: 'conectar' }, null, null, null, [])`, context);
  await flush();

  const nComprensionesAntes = vm.runInContext('comprensionesPendientesDeRevision(state.organismo).length', context);
  const nPropuestasAntes = vm.runInContext(`propuestasPendientes('org-corr01').length`, context);
  const principiosAntes = JSON.parse(vm.runInContext('JSON.stringify(state.principios)', context));
  assert.equal(nComprensionesAntes, 1, 'la comprensión candidata de prueba queda pendiente de revisión, como esperado');
  assert.equal(nPropuestasAntes, 1, 'la propuesta de memoria real (proponerFicha) queda pendiente, como esperado');
  assert.equal(principiosAntes.length, 1);
  assert.equal(principiosAntes[0].estado, 'emergente');
  assert.equal(vm.runInContext('!!state.organismo.destilados', context), false, 'todavía no se guardó ningún destilado');

  const c1g3EpochAntes = vm.runInContext('state.c1g3Epoch', context);
  vm.runInContext('pintarRevisarYGuardar()', context);
  assert.equal(vm.runInContext('el.overlay.classList.contains("open")', context), true, 'la pantalla de revisión consolidada se abrió');

  const bPostergarEncontrado = vm.runInContext(`
    (function(){
      function buscar(nodo, vistos){
        vistos = vistos || new Set();
        if(vistos.has(nodo)) return null; vistos.add(nodo);
        if(nodo.textContent === 'Guardar sesión y revisar después' && typeof nodo.onclick === 'function') return nodo;
        for(var i=0;i<(nodo.children||[]).length;i++){ var r = buscar(nodo.children[i], vistos); if(r) return r; }
        return null;
      }
      globalThis.__bPostergar = buscar(el.cardContent);
      return !!globalThis.__bPostergar;
    })()
  `, context);
  assert.ok(bPostergarEncontrado, 'el botón "Guardar sesión y revisar después" existe en la pantalla de revisión');

  vm.runInContext('__bPostergar.onclick()', context);
  await flush();

  assert.equal(vm.runInContext('el.overlay.classList.contains("open")', context), false, 'el overlay se cerró: vuelve directo al recorrido, sin otra pantalla en el medio');
  const seAbrioDestiladoLegacy = vm.runInContext(`el.cardContent.children.some(function(c){ return c.textContent === 'Destilado de la sesión'; })`, context);
  assert.equal(seAbrioDestiladoLegacy, false, 'la compuerta legacy "Destilado de la sesión" (título propio de ofrecerGuardado()) NUNCA aparece -- ofrecerGuardado() no se llamó desde esta ruta');

  // guardarSesion() sí corrió de verdad -- mismo camino productivo de siempre, real, sin
  // reimplementar: el destilado y el checkpoint quedan en el organismo real.
  assert.equal(vm.runInContext('state.organismo.destilados.length', context), 1, 'guardarSesion() guardó un destilado real');
  assert.match(vm.runInContext('state.organismo.destilados[0].destilado', context), /^PRINCIPIOS/, 'el destilado es el que arma generarDestiladoLocal(), no un texto inventado por la prueba');
  assert.equal(vm.runInContext('state.organismo.checkpoints && state.organismo.checkpoints.core && state.organismo.checkpoints.core.length', context), 1, 'crearCheckpointSesion() también corrió -- mismo mecanismo de "Guardar sesión" de siempre (OMV-F5)');

  // Los pendientes quedan íntegros -- ni confirmados, ni descartados, ni transformados.
  assert.equal(vm.runInContext('comprensionesPendientesDeRevision(state.organismo).length', context), nComprensionesAntes, 'la comprensión candidata sigue pendiente de revisión, intacta');
  assert.equal(vm.runInContext(`propuestasPendientes('org-corr01').length`, context), nPropuestasAntes, 'la propuesta de memoria sigue pendiente, intacta');
  const principiosDespues = JSON.parse(vm.runInContext('JSON.stringify(state.principios)', context));
  assert.deepEqual(principiosDespues, principiosAntes, 'los principios emergentes de la sesión no se tocan');

  // Recuperables: reabrir "Revisar y guardar" después de guardar sigue mostrando exactamente lo
  // mismo -- nada quedó "consumido" por el hecho de haber guardado la sesión.
  vm.runInContext('pintarRevisarYGuardar()', context);
  assert.equal(vm.runInContext('comprensionesPendientesDeRevision(state.organismo).length', context), nComprensionesAntes, 'reabierta la pantalla, la comprensión pendiente sigue ahí, recuperable');
  assert.equal(vm.runInContext(`propuestasPendientes('org-corr01').length`, context), nPropuestasAntes, 'reabierta la pantalla, la propuesta de memoria sigue ahí, recuperable');

  // Aislamiento de identidades / sincronización por epoch (AISLAMIENTO02): esta corrección no
  // toca identidadEpoch ni el punto único de la cola remota -- cerrarOverlay() sigue avanzando
  // c1g3Epoch exactamente igual que siempre (una sola vez por cierre real del overlay).
  assert.equal(vm.runInContext('state.c1g3Epoch', context), c1g3EpochAntes + 1, 'c1g3Epoch avanza exactamente lo mismo que antes de esta corrección -- un solo cerrarOverlay() real ocurrió (el de bPostergar); reabrir pintarRevisarYGuardar() arriba no lo toca');
});

test('122.31-CORR01: "Guardar decisiones" (bGuardar) no cambió -- sigue yendo por ofrecerGuardado(null); sólo se corrigió la ruta de bPostergar', async () => {
  const fetchImpl = async () => ({ ok: true, status: 200, json: async () => ({ organismos: [] }), text: async () => '{}', headers: { get() { return null; } } });
  const { context, localStorage } = buildContext(fetchImpl, 'staging.comprenderai.com');
  loadCoreScript(context);
  await flush();
  sembrarSesionYCreditos(localStorage);
  vm.runInContext(`state.organismo = { id: 'org-corr01b', nombre: 'QA CORR01b', ficha: {}, principios: [], history: [] };`, context);
  vm.runInContext('pintarRevisarYGuardar()', context);

  const bGuardarEncontrado = vm.runInContext(`
    (function(){
      function buscar(nodo, vistos){
        vistos = vistos || new Set();
        if(vistos.has(nodo)) return null; vistos.add(nodo);
        if(nodo.textContent === 'Guardar decisiones' && typeof nodo.onclick === 'function') return nodo;
        for(var i=0;i<(nodo.children||[]).length;i++){ var r = buscar(nodo.children[i], vistos); if(r) return r; }
        return null;
      }
      globalThis.__bGuardar = buscar(el.cardContent);
      return !!globalThis.__bGuardar;
    })()
  `, context);
  assert.ok(bGuardarEncontrado, 'el botón "Guardar decisiones" existe');
  vm.runInContext('__bGuardar.onclick()', context);
  const seAbrioDestiladoLegacy = vm.runInContext(`el.cardContent.children.some(function(c){ return c.textContent === 'Destilado de la sesión'; })`, context);
  assert.equal(seAbrioDestiladoLegacy, true, '"Guardar decisiones" sigue abriendo la compuerta legacy sin cambios -- sólo bPostergar fue corregido, el resto de ofrecerGuardado() sigue intacto');
});

// ---------------------------------------------------------------------------------------------
// 122.31-CORR02 (09/09, hallazgo menor de la caminata humana en staging) -- el chat nunca tuvo un
// renderizador de markdown (.bubble usa textContent a propósito); cuando el texto del motor incluye
// "**negrita**", se veía literal, asteriscos incluidos. limpiarNegritaMarkdown122_31() retira sólo
// esos delimitadores -- sin construir ningún parser de markdown ni tocar parsed.visible en sí
// (parseMotor() no se toca) -- y sólo se aplica en staging, igual que el resto de 122.31.
test('122.31-CORR02: limpiarNegritaMarkdown122_31() retira los delimitadores dobles de negrita, sin tocar el resto del texto', async () => {
  const fetchImpl = async () => ({ ok: true, status: 200, json: async () => ({ organismos: [] }), text: async () => '{}', headers: { get() { return null; } } });
  const { context } = buildContext(fetchImpl, 'staging.comprenderai.com');
  loadCoreScript(context);
  await flush();
  assert.equal(vm.runInContext(`limpiarNegritaMarkdown122_31('**Qué información falta:** el tramo B')`, context), 'Qué información falta: el tramo B');
  assert.equal(vm.runInContext(`limpiarNegritaMarkdown122_31('sin negrita acá')`, context), 'sin negrita acá', 'texto sin delimitadores no se toca');
  assert.equal(vm.runInContext(`limpiarNegritaMarkdown122_31('**a** y **b**')`, context), 'a y b', 'varias ocurrencias en el mismo texto');
  assert.equal(vm.runInContext(`limpiarNegritaMarkdown122_31('2 ** 3 = 8')`, context), '2 ** 3 = 8', 'un "**" suelto (ej. potencia) sin cierre no se toca -- no hay par completo que retirar');
  assert.equal(vm.runInContext(`limpiarNegritaMarkdown122_31(null)`, context), null, 'entrada no-string se devuelve tal cual, defensivo');
  assert.equal(vm.runInContext(`limpiarNegritaMarkdown122_31('')`, context), '', 'string vacío se devuelve tal cual');
});

test('122.31-CORR02: addMotorMsg() pinta el texto sin los delimitadores de negrita SOLO en staging -- fuera de staging, el texto crudo del motor no cambia (cero impacto en producción)', async () => {
  const fetchImpl = async () => ({ ok: true, status: 200, json: async () => ({ organismos: [] }), text: async () => '{}', headers: { get() { return null; } } });
  {
    const { context } = buildContext(fetchImpl, 'staging.comprenderai.com');
    loadCoreScript(context);
    await flush();
    vm.runInContext(`globalThis.__d = addMotorMsg({ visible: '**Qué información falta:** el tramo B', cristaliza: [], tension: null, funcion: null, diag: null }, false, null);`, context);
    const texto = vm.runInContext('__d.children[0].textContent', context);
    assert.equal(texto, 'Qué información falta: el tramo B', 'en staging, la negrita se retira del texto pintado en el globo');
  }
  {
    const { context } = buildContext(fetchImpl, 'app.comprenderai.com');
    loadCoreScript(context);
    await flush();
    vm.runInContext(`globalThis.__d = addMotorMsg({ visible: '**Qué información falta:** el tramo B', cristaliza: [], tension: null, funcion: null, diag: null }, false, null);`, context);
    const texto = vm.runInContext('__d.children[0].textContent', context);
    assert.equal(texto, '**Qué información falta:** el tramo B', 'fuera de staging, el texto crudo del motor no cambia -- producción sigue exactamente igual, mismo criterio que el resto de 122.31');
  }
});

// ---------------------------------------------------------------------------------------------
// NUEVACOMP01 (09/09) -- decisión de producto de Javier tras la auditoría de Fase A
// (NUEVACOMP01_AUDITORIA.md): (1) eliminar "+ Nueva comprensión" (#teNueva) de la interfaz --
// duplicaba la acción global "Nueva" (#btnNueva) y agregaba ruido visual, sin semántica propia
// ("nuevo recorrido dentro del mismo organismo" queda para el futuro diseño multiescalar, fuera
// de este corte); "Nueva" (#btnNueva) NO cambia; #btnOrgNuevo/"+ Guardar un nuevo tema" queda
// totalmente fuera de alcance, sin tocar. (2) corregir la asimetría de enviar() (§8 de la
// auditoría): la rama que cierra una lectura especializada (Urbanismo/Negocios/Contextos) en el
// mismo turno vaciaba o.borrador sin preservar los principios emergentes de ESA sesión, a
// diferencia de la rama normal (guardarBorrador()). Un principio que emergía justo en el turno
// de cierre desaparecía del Hilo/chat al reabrir el organismo (Escenario 2 de la auditoría),
// aunque la propuesta de Memoria asociada seguía intacta.
test('NUEVACOMP01: "+ Nueva comprensión" (#teNueva) se eliminó de la interfaz; "Nueva" del encabezado (#btnNueva) sigue exactamente igual', async () => {
  // El harness de pruebas (FakeElement) crea automáticamente cualquier id que se le pida vía
  // document.getElementById -- por diseño (ver buildContext arriba), así que no distingue un id
  // ausente del HTML real de uno presente. La prueba real y honesta acá es sobre el HTML/script
  // que efectivamente se carga: ni el marcado ni el wiring de "teNueva" deben seguir existiendo.
  const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  // Los comentarios de esta misma corrección (HTML y JS) mencionan "teNueva"/"+ Nueva
  // comprensión" a propósito, como documentación -- se descartan antes de buscar, así la prueba
  // verifica el HTML/script FUNCIONAL, no la prosa explicativa alrededor.
  const htmlSinComentarios = html.replace(/<!--[\s\S]*?-->/g, '');
  const scriptSinComentarios = htmlSinComentarios.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
  assert.equal(/id=["']teNueva["']/.test(htmlSinComentarios), false, 'ya no existe ningún elemento con id="teNueva" en el HTML');
  assert.equal(/getElementById\(\s*['"]teNueva['"]\s*\)/.test(scriptSinComentarios), false, 'ya no queda ningún acceso/listener registrado sobre "teNueva" en el script');
  assert.equal(/\+\s*Nueva comprensión/.test(htmlSinComentarios), false, 'el texto visible "+ Nueva comprensión" ya no aparece en ningún lado del documento');
  // NUEVACOMP02 (10/09) cambió deliberadamente este wiring (autoguardado antes de nuevaSesion();
  // ver esas pruebas más abajo) -- esta prueba de NUEVACOMP01 ya no puede exigir el wiring
  // directo a nuevaSesion(), sólo que #btnNueva siga teniendo ALGÚN listener de click real.
  assert.match(scriptSinComentarios, /el\.btnNueva\.addEventListener\(\s*['"]click['"]\s*,\s*\w+\s*\)/, '"Nueva" del encabezado (#btnNueva) sigue teniendo un listener de click real (el wiring exacto y su comportamiento de autoguardado los cubre la suite de NUEVACOMP02 más abajo)');

  // Regresión funcional real (no sólo textual): el script sigue cargando y ejecutando sin errores
  // con #teNueva ausente -- ninguna otra parte del código depende de su existencia para arrancar.
  const fetchImpl = async () => ({ ok: true, status: 200, json: async () => ({ organismos: [] }), text: async () => '{}', headers: { get() { return null; } } });
  const { context } = buildContext(fetchImpl, 'staging.comprenderai.com');
  loadCoreScript(context);
  await flush();
  assert.equal(vm.runInContext('typeof nuevaSesion', context), 'function', 'nuevaSesion() sigue existiendo y accesible -- la única función detrás de #btnNueva ahora (antes, también detrás de #teNueva)');
});

test('NUEVACOMP01: un principio emergente en el mismo turno en que cierra una lectura de Urbanismo sigue visible al reabrir el organismo (antes desaparecía del Hilo, aunque la propuesta de Memoria seguía intacta)', async () => {
  // Turno real único: el motor emite un PRINCIPIO nuevo Y, en la misma respuesta, cierra la
  // lectura de Urbanismo (UDIM + PROYECTIVO) -- exactamente la secuencia de la asimetría
  // reportada (Escenario 2 de NUEVACOMP01_AUDITORIA.md §3). addPrincipio()/proponerFicha() para
  // el PRINCIPIO y cerrarLecturaUrban() para el cierre corren TAL CUAL en enviar() (nada de esto
  // se reimplementa en la prueba); la única pieza bajo prueba es qué hace la rama cerroLectura con
  // el borrador. ficha:{} a propósito -- así abrirOrganismoContinuar() no dispara un segundo turno
  // real ("Retomemos...") que contaminaría la respuesta fabricada de abajo con un segundo PRINCIPIO.
  const RAW_CIERRE_URBAN = '[[PRINCIPIO:un principio que emergió justo cuando cerró la lectura urbana]][[UDIM:VINC|estable|nota de prueba]][[PROYECTIVO:hacia una integración posible]]Cerramos la lectura urbana.';
  const fetchImpl = async (recurso) => {
    const url = String((recurso && recurso.url) ? recurso.url : recurso || '');
    if (url.indexOf('/api/organismos') > -1) return { ok: true, status: 200, json: async () => ({ organismos: [] }), text: async () => '{}', headers: { get() { return null; } } };
    return { ok: true, status: 200, json: async () => ({ content: [{ type: 'text', text: RAW_CIERRE_URBAN }] }) };
  };
  const { context, localStorage } = buildContext(fetchImpl, 'staging.comprenderai.com');
  loadCoreScript(context);
  await flush();
  sembrarSesionYCreditos(localStorage);

  vm.runInContext(`
    state.organismo = { id: 'org-nc-integridad', nombre: 'NC Integridad', ficha: {}, principios: [], history: [], lecturas_urban: [] };
    state.history = [];
    state.principios = [];
    state.modoUrban = true;
  `, context);

  await context.enviar('contame cómo cerró la lectura urbana');
  await flush();

  // El cierre real ocurrió (no es un supuesto de la prueba): cerrarLecturaUrban() corrió de verdad.
  assert.equal(vm.runInContext('state.organismo.lecturas_urban.length', context), 1, 'cerrarLecturaUrban() corrió de verdad en este turno -- el cierre no es simulado por la prueba');
  assert.equal(vm.runInContext('state.modoUrban', context), false, 'cerrarLecturaUrban() apagó modoUrban, como siempre');

  const principiosAntesDeCerrar = JSON.parse(vm.runInContext('JSON.stringify(state.principios)', context));
  assert.equal(principiosAntesDeCerrar.length, 1, 'el principio emergió en este mismo turno, en sesión');
  assert.equal(principiosAntesDeCerrar[0].estado, 'emergente');

  // Forma exacta del borrador que deja la corrección: SIN `history` (para no revivir el hilo de
  // chat ya cerrado ni desplazar la tarjeta "Recuerdo guardado" de OMV-F5.1 -- ver la prueba
  // siguiente), pero CON los principios de esta sesión.
  const orgTrasCierre = JSON.parse(vm.runInContext(`JSON.stringify(cargarOrganismos().find(function(o){ return o.id === 'org-nc-integridad'; }))`, context));
  assert.ok(orgTrasCierre.borrador, 'la rama cerroLectura ya no deja el borrador en null cuando emergió un principio');
  assert.equal(orgTrasCierre.borrador.history, undefined, 'el borrador sigue sin `history` -- no revive el hilo de chat cerrado (distinto del borrador normal de guardarBorrador())');
  assert.equal(orgTrasCierre.borrador.principios.length, 1);
  assert.equal(orgTrasCierre.borrador.principios[0].texto, 'un principio que emergió justo cuando cerró la lectura urbana');

  const propuestasAntesDeReabrir = vm.runInContext(`propuestasPendientes('org-nc-integridad').length`, context);
  assert.equal(propuestasAntesDeReabrir, 1, 'la propuesta de Memoria (proponerFicha real) quedó pendiente, como siempre');

  // "+ Nueva comprensión"/"Nueva" (nuevaSesion real) y reabrir el organismo (abrirOrganismo real)
  // -- la misma secuencia de Escenario 2 de la auditoría, ahora contra el código corregido.
  vm.runInContext(`nuevaSesion(); abrirOrganismo(cargarOrganismos().find(function(o){ return o.id === 'org-nc-integridad'; }));`, context);
  await flush();

  const principiosTrasReabrir = JSON.parse(vm.runInContext('JSON.stringify(state.principios)', context));
  assert.equal(principiosTrasReabrir.length, 1, 'CORREGIDO: el principio emergente sigue en state.principios al reabrir -- antes de NUEVACOMP01 esto quedaba en 0');
  assert.equal(principiosTrasReabrir[0].texto, 'un principio que emergió justo cuando cerró la lectura urbana');
  assert.equal(principiosTrasReabrir[0].estado, 'emergente', 'sigue marcado como emergente -- no se confirma ni se transforma nada automáticamente');

  // Visible de verdad en el Hilo (no sólo en el estado en memoria) -- mismo criterio que ya usan
  // las pruebas de restaurarBorrador()/restaurarCheckpoint() más arriba.
  // crearFilaPrincipio() arma la fila con dos spans hijos (texto + tag de estado); en el harness
  // de pruebas FakeElement.textContent NO se propaga desde los hijos (es una propiedad plana, no
  // computada -- ver FakeElement arriba), así que hay que mirar dentro de los hijos, no en el
  // textContent del propio nodo .principio.
  const visibleEnHilo = vm.runInContext(`el.hilo.children.some(function(c){ return c.className && c.className.indexOf('principio') > -1 && (c.children||[]).some(function(h){ return h.textContent && h.textContent.indexOf('un principio que emergió justo cuando cerró la lectura urbana') > -1; }); })`, context);
  assert.equal(visibleEnHilo, true, 'el principio aparece de verdad en el Hilo tras reabrir -- visible, no sólo recuperable "indirectamente" vía Memoria como antes de esta corrección');

  // La propuesta de Memoria sigue intacta -- la corrección no la duplica, ni la confirma, ni la
  // descarta: simplemente deja de perder la VISTA de sesión que ya tenía antes.
  assert.equal(vm.runInContext(`propuestasPendientes('org-nc-integridad').length`, context), propuestasAntesDeReabrir, 'la propuesta de Memoria sigue pendiente, sin duplicarse ni alterarse');
});

test('NUEVACOMP01: la tarjeta "Recuerdo guardado" (OMV-F5.1) sigue apareciendo igual que antes cuando existe un checkpoint manual -- la corrección de la asimetría no la reemplaza ni la oculta', async () => {
  // Mismo turno de cierre que la prueba anterior, pero esta vez el usuario además guarda la
  // sesión explícitamente (guardarSesion() real, el mismo camino de siempre -- OMV-F5) antes de
  // irse. Eso crea un checkpoint manual real. Al reabrir, la corrección de NUEVACOMP01 debe
  // convivir con OMV-F5.1: los principios emergentes se recuperan (prueba anterior) Y la tarjeta
  // "Recuerdo guardado" sigue ofreciéndose exactamente igual que antes -- ninguna de las dos rutas
  // reemplaza a la otra.
  const RAW_CIERRE_URBAN = '[[PRINCIPIO:un principio que emergió justo cuando cerró la lectura urbana]][[UDIM:VINC|estable|nota de prueba]][[PROYECTIVO:hacia una integración posible]]Cerramos la lectura urbana.';
  const fetchImpl = async (recurso) => {
    const url = String((recurso && recurso.url) ? recurso.url : recurso || '');
    if (url.indexOf('/api/organismos') > -1) return { ok: true, status: 200, json: async () => ({ organismos: [] }), text: async () => '{}', headers: { get() { return null; } } };
    return { ok: true, status: 200, json: async () => ({ content: [{ type: 'text', text: RAW_CIERRE_URBAN }] }) };
  };
  const { context, localStorage } = buildContext(fetchImpl, 'staging.comprenderai.com');
  loadCoreScript(context);
  await flush();
  sembrarSesionYCreditos(localStorage);

  vm.runInContext(`
    state.organismo = { id: 'org-nc-recuerdo', nombre: 'NC Recuerdo', ficha: {}, principios: [], history: [], lecturas_urban: [] };
    state.history = [];
    state.principios = [];
    state.modoUrban = true;
  `, context);
  await context.enviar('contame cómo cerró la lectura urbana');
  await flush();
  assert.equal(vm.runInContext('state.organismo.lecturas_urban.length', context), 1, 'el cierre real volvió a ocurrir en esta prueba también');

  // "Guardar sesión" real (mismo guardarSesion() de siempre, OMV-F5) -- crea el checkpoint manual.
  vm.runInContext(`guardarSesion('destilado de prueba')`, context);
  const orgConCheckpoint = JSON.parse(vm.runInContext(`JSON.stringify(cargarOrganismos().find(function(o){ return o.id === 'org-nc-recuerdo'; }))`, context));
  // moduloDeSesionActual() clasifica el checkpoint por el panel especializado más reciente de la
  // sesión (acá, "urban" -- el mismo que acaba de cerrar cerrarLecturaUrban()), no por "core" --
  // mismo criterio de siempre (OMV-F5), sin relación con esta corrección.
  assert.equal(orgConCheckpoint.checkpoints && orgConCheckpoint.checkpoints.urban && orgConCheckpoint.checkpoints.urban.length, 1, 'crearCheckpointSesion() real corrió -- hay un checkpoint manual');

  vm.runInContext(`nuevaSesion(); abrirOrganismo(cargarOrganismos().find(function(o){ return o.id === 'org-nc-recuerdo'; }));`, context);
  await flush();

  // La tarjeta "Recuerdo guardado" (ofrecerRecuerdoGuardado(), OMV-F5.1) sigue apareciendo -- no
  // fue reemplazada ni saltada por la recuperación de principios de NUEVACOMP01.
  // ofrecerRecuerdoGuardado() arma la tarjeta con el texto en un span hijo (n), no en el
  // textContent del propio div de la tarjeta -- mismo detalle de FakeElement que en el Hilo
  // (ver comentario más arriba): hay que mirar dentro de los hijos.
  const apareceRecuerdoGuardado = vm.runInContext(`el.stream.children.some(function(c){ return (c.children||[]).some(function(h){ return h.textContent && h.textContent.indexOf('Recuerdo guardado.') === 0; }); })`, context);
  assert.equal(apareceRecuerdoGuardado, true, 'la tarjeta "Recuerdo guardado" sigue ofreciéndose exactamente igual que antes de NUEVACOMP01');

  // Y, a la vez, el principio emergente también quedó visible (las dos rutas conviven).
  // crearFilaPrincipio() arma la fila con dos spans hijos (texto + tag de estado); en el harness
  // de pruebas FakeElement.textContent NO se propaga desde los hijos (es una propiedad plana, no
  // computada -- ver FakeElement arriba), así que hay que mirar dentro de los hijos, no en el
  // textContent del propio nodo .principio.
  const visibleEnHilo = vm.runInContext(`el.hilo.children.some(function(c){ return c.className && c.className.indexOf('principio') > -1 && (c.children||[]).some(function(h){ return h.textContent && h.textContent.indexOf('un principio que emergió justo cuando cerró la lectura urbana') > -1; }); })`, context);
  assert.equal(visibleEnHilo, true, 'el principio emergente también se recuperó -- ambas correcciones convivien sin pisarse');
});

// ---------------------------------------------------------------------------------------------
// NUEVACOMP02 (10/09) -- decisión de producto de Javier: "Nueva" (#btnNueva; #teNueva ya no
// existe, NUEVACOMP01) guarda automáticamente la sesión en curso ANTES de salir, si tiene
// conversación significativa sin consolidar -- sin ninguna pantalla propia (ni "Destilado de la
// sesión" ni ninguna otra), sin tocar comprensiones/propuestas pendientes, preservando
// conversación/principios/Memoria pendiente/checkpoints, sin crear sesiones vacías, sin duplicar
// un guardado idéntico, y sin abandonar la sesión en silencio si el guardado falla. Camino de
// datos reutilizado: guardarSesion(generarDestiladoLocal()) -> crearCheckpointSesion(), el mismo
// que ya certificó 122.31-CORR01 para "Guardar sesión y revisar después" -- nada de esto se
// reimplementa; las pruebas de abajo ejecutan las funciones reales (alPulsarBtnNueva(),
// intentarGuardadoAutomaticoAntesDeNueva(), sesionIdenticaAlUltimoCheckpoint(), nuevaSesion(),
// abrirOrganismo(), restaurarCheckpoint()) tal cual están en index.html.
test('NUEVACOMP02: sin conversación significativa que guardar (sin organismo, o con historial vacío), alPulsarBtnNueva() no crea ningún checkpoint/destilado -- no crea sesiones vacías -- y nuevaSesion() corre igual que siempre', async () => {
  const fetchImpl = async () => ({ ok: true, status: 200, json: async () => ({ organismos: [] }), text: async () => '{}', headers: { get() { return null; } } });
  const { context, localStorage } = buildContext(fetchImpl, 'staging.comprenderai.com');
  loadCoreScript(context);
  await flush();
  sembrarSesionYCreditos(localStorage);

  // Caso 1: sin organismo activo (chat libre, o recién salido con "Nueva").
  vm.runInContext(`state.organismo = null; state.history = []; state.principios = [];`, context);
  vm.runInContext('alPulsarBtnNueva()', context);
  assert.equal(vm.runInContext('state.organismo', context), null, 'nuevaSesion() corrió -- organismo ya era null, sigue null');
  assert.equal(vm.runInContext('cargarOrganismos().length', context), 0, 'no se creó ningún organismo/checkpoint de la nada');

  // Caso 2: con organismo activo, pero sin ningún mensaje todavía en esta sesión.
  vm.runInContext(`
    state.organismo = { id: 'org-nc2-vacio', nombre: 'NC2 Vacío', ficha: {}, principios: [], history: [] };
    guardarOrganismo(state.organismo);
    state.history = [];
    state.principios = [];
  `, context);
  await flush();
  vm.runInContext('alPulsarBtnNueva()', context);
  assert.equal(vm.runInContext('state.organismo', context), null, 'nuevaSesion() corrió -- sale del organismo igual que siempre');
  const orgVacio = JSON.parse(vm.runInContext(`JSON.stringify(cargarOrganismos().find(function(o){ return o.id === 'org-nc2-vacio'; }))`, context));
  assert.equal(!!orgVacio.destilados, false, 'no se creó ningún destilado -- no había nada que guardar');
  assert.equal(!!orgVacio.checkpoints, false, 'no se creó ningún checkpoint -- no se crean sesiones vacías');
});

test('NUEVACOMP02: con conversación significativa y sin checkpoint previo, alPulsarBtnNueva() la guarda automáticamente (sin pantalla propia, sin tocar pendientes) antes de nuevaSesion() -- y el organismo reabierto la recupera íntegra', async () => {
  const fetchImpl = async () => ({ ok: true, status: 200, json: async () => ({ organismos: [] }), text: async () => '{}', headers: { get() { return null; } } });
  const { context, localStorage } = buildContext(fetchImpl, 'staging.comprenderai.com');
  loadCoreScript(context);
  await flush();
  sembrarSesionYCreditos(localStorage);
  localStorage.setItem('ag_core_pref_integracion_epistemica_staging', '1');

  // Organismo con conversación real de esta sesión, a propósito SIN borrador (o.borrador nunca
  // se seteó -- ni guardarBorrador() ni nuevaSesion() lo tocan) para que la recuperación al
  // reabrir dependa EXCLUSIVAMENTE del checkpoint nuevo, no del autosave de guardarBorrador().
  // También con una comprensión candidata + una propuesta de Memoria pendientes reales, para
  // probar que alPulsarBtnNueva() no las toca (mismo patrón que ya certificó 122.31-CORR01).
  const registroEpistemico = {
    schema_version: 'vr1-core-ledger/1.1', ledger_version: 1,
    entries: [{ record: { record_id: 'ER-33333333-3333-3333-3333-333333333333', revision: { version: 1 }, claim: { claim_id: 'CLAIM-NC2FELIZ', content: 'comprensión candidata de prueba' }, verification: {}, support: [], limits: { uncertainties: [] } } }],
    operations: [], review_events: [],
    reviews: [{ review_id: 'REV-NC2FELIZ', state: 'pending_human_review', changed_claims: ['CLAIM-NC2FELIZ'] }],
    turn_index: {}, change_types: {},
  };
  vm.runInContext(`
    state.organismo = { id: 'org-nc2-feliz', nombre: 'NC2 Feliz', ficha: { funcion: 'estabilizar' }, principios: [], history: [],
                         registro_epistemico: ${JSON.stringify(registroEpistemico)} };
    state.history = [{role:'user', content:'hola, contame de este organismo'}, {role:'assistant', content:'ok, veamos'}];
    state.principios = [];
  `, context);
  vm.runInContext(`addPrincipio('un principio de esta sesión', 'energia')`, context);
  vm.runInContext(`proponerFicha({}, null, null, null, [{ texto: 'un principio de esta sesión', fam: 'energia' }])`, context);
  await flush();

  assert.equal(vm.runInContext('!!(state.organismo.borrador)', context), false, 'a propósito, sin borrador -- la recuperación de abajo depende sólo del checkpoint nuevo');
  const nComprensionesAntes = vm.runInContext('comprensionesPendientesDeRevision(state.organismo).length', context);
  const nPropuestasAntes = vm.runInContext(`propuestasPendientes('org-nc2-feliz').length`, context);
  assert.equal(nComprensionesAntes, 1);
  assert.equal(nPropuestasAntes, 1);
  const historyOriginal = JSON.parse(vm.runInContext('JSON.stringify(state.history)', context));

  vm.runInContext('alPulsarBtnNueva()', context);
  await flush();

  // Salida real: nuevaSesion() corrió, exactamente igual que siempre.
  assert.equal(vm.runInContext('state.organismo', context), null, 'nuevaSesion() corrió tras el guardado');
  assert.equal(vm.runInContext('state.history.length', context), 0);

  // Cero pantallas propias -- ni "Destilado de la sesión" ni ninguna otra compuerta.
  assert.equal(vm.runInContext('el.overlay.classList.contains("open")', context), false, 'guardado 100% silencioso -- no se abrió ninguna pantalla propia');

  // El guardado sí ocurrió de verdad -- releído desde localStorage, nunca de una referencia en memoria.
  const totalCheckpointsDespues = vm.runInContext(`totalCheckpoints(cargarOrganismos().find(function(o){ return o.id === 'org-nc2-feliz'; }))`, context);
  assert.equal(totalCheckpointsDespues, 1, 'crearCheckpointSesion() real corrió -- hay exactamente un checkpoint nuevo');
  const orgGuardado = JSON.parse(vm.runInContext(`JSON.stringify(cargarOrganismos().find(function(o){ return o.id === 'org-nc2-feliz'; }))`, context));
  assert.equal(orgGuardado.destilados && orgGuardado.destilados.length, 1, 'guardarSesion() real corrió -- hay un destilado');

  // Pendientes intactos -- ni aceptados, ni descartados, ni transformados.
  assert.equal(vm.runInContext('comprensionesPendientesDeRevision(cargarOrganismos().find(function(o){ return o.id === "org-nc2-feliz"; })).length', context), nComprensionesAntes, 'la comprensión candidata sigue pendiente, intacta');
  assert.equal(vm.runInContext(`propuestasPendientes('org-nc2-feliz').length`, context), nPropuestasAntes, 'la propuesta de Memoria sigue pendiente, intacta');

  // Reabrir: sin borrador, restaurarBorrador() no tiene nada que reproducir -- pero el checkpoint
  // nuevo ofrece "Recuerdo guardado" (OMV-F5.1, sin cambios), y "Retomar" (restaurarCheckpoint(),
  // función real y ya certificada) recupera el Hilo completo, íntegro.
  vm.runInContext(`abrirOrganismo(cargarOrganismos().find(function(o){ return o.id === 'org-nc2-feliz'; }));`, context);
  await flush();
  assert.equal(vm.runInContext('state.history.length', context), 0, 'reabrir solo no restaura nada todavía -- "Recuerdo guardado" nunca restaura sola (mismo criterio ya certificado de OMV-F5.1)');
  const bRetomarEncontrado = vm.runInContext(`
    (function(){
      function buscar(nodo, vistos){
        vistos = vistos || new Set();
        if(vistos.has(nodo)) return null; vistos.add(nodo);
        if(nodo.textContent && nodo.textContent.indexOf('Retomar en') === 0 && typeof nodo.onclick === 'function') return nodo;
        for(var i=0;i<(nodo.children||[]).length;i++){ var r = buscar(nodo.children[i], vistos); if(r) return r; }
        return null;
      }
      globalThis.__bRetomarNC2 = buscar(el.stream);
      return !!globalThis.__bRetomarNC2;
    })()
  `, context);
  assert.ok(bRetomarEncontrado, 'la tarjeta "Recuerdo guardado" ofrece "Retomar" -- el checkpoint nuevo es recuperable');
  vm.runInContext('__bRetomarNC2.onclick()', context);
  await flush();

  const historyRecuperado = JSON.parse(vm.runInContext('JSON.stringify(state.history)', context));
  assert.deepEqual(historyRecuperado, historyOriginal, 'el Hilo completo (todo el historial de la conversación) se recuperó íntegro tras "Retomar"');
  const principioVisible = vm.runInContext(`el.hilo.children.some(function(c){ return c.className && c.className.indexOf('principio') > -1 && (c.children||[]).some(function(h){ return h.textContent && h.textContent.indexOf('un principio de esta sesión') > -1; }); })`, context);
  assert.equal(principioVisible, true, 'el principio emergente de esa sesión también se recuperó');
});

test('NUEVACOMP02: si la sesión ya quedó guardada sin cambios desde entonces, alPulsarBtnNueva() no duplica el checkpoint -- pero nuevaSesion() sigue corriendo igual', async () => {
  const fetchImpl = async () => ({ ok: true, status: 200, json: async () => ({ organismos: [] }), text: async () => '{}', headers: { get() { return null; } } });
  const { context, localStorage } = buildContext(fetchImpl, 'staging.comprenderai.com');
  loadCoreScript(context);
  await flush();
  sembrarSesionYCreditos(localStorage);

  vm.runInContext(`
    state.organismo = { id: 'org-nc2-dedup', nombre: 'NC2 Dedup', ficha: {}, principios: [], history: [] };
    state.history = [{role:'user', content:'una conversación cualquiera'}, {role:'assistant', content:'ok'}];
    state.principios = [];
  `, context);
  await flush();

  vm.runInContext('alPulsarBtnNueva()', context);   // primer guardado real
  await flush();
  const totalTrasPrimerGuardado = vm.runInContext(`totalCheckpoints(cargarOrganismos().find(function(o){ return o.id === 'org-nc2-dedup'; }))`, context);
  assert.equal(totalTrasPrimerGuardado, 1, 'el primer guardado real corrió -- hay un checkpoint');

  // Reabrir y "Retomar" el mismo checkpoint recién guardado -- state.history/principios quedan
  // EXACTAMENTE iguales a lo que el checkpoint ya tiene (mismo camino real de la prueba anterior).
  vm.runInContext(`abrirOrganismo(cargarOrganismos().find(function(o){ return o.id === 'org-nc2-dedup'; }));`, context);
  await flush();
  const entrada = vm.runInContext(`checkpointMasReciente(cargarOrganismos().find(function(o){ return o.id === 'org-nc2-dedup'; }))`, context);
  vm.runInContext(`restaurarCheckpoint(cargarOrganismos().find(function(o){ return o.id === 'org-nc2-dedup'; }), ${JSON.stringify(entrada.modulo)}, ${entrada.indice});`, context);
  await flush();

  // Click "Nueva" de nuevo, sin haber escrito ni cambiado nada -- idéntica al último checkpoint.
  vm.runInContext('alPulsarBtnNueva()', context);
  await flush();
  const totalTrasSegundoClick = vm.runInContext(`totalCheckpoints(cargarOrganismos().find(function(o){ return o.id === 'org-nc2-dedup'; }))`, context);
  assert.equal(totalTrasSegundoClick, 1, 'no se duplicó el checkpoint -- nada cambió desde el último guardado');
  assert.equal(vm.runInContext('state.organismo', context), null, 'nuevaSesion() corrió igual -- se salteó sólo el guardado, nunca la salida');
});

test('NUEVACOMP02: si el guardado local realmente falla, alPulsarBtnNueva() NO abandona la sesión en silencio -- no llama a nuevaSesion() y avisa con un mensaje pasivo, sin ninguna alerta ni compuerta', async () => {
  const fetchImpl = async () => ({ ok: true, status: 200, json: async () => ({ organismos: [] }), text: async () => '{}', headers: { get() { return null; } } });
  const { context, localStorage } = buildContext(fetchImpl, 'staging.comprenderai.com');
  loadCoreScript(context);
  await flush();
  sembrarSesionYCreditos(localStorage);

  vm.runInContext(`
    state.organismo = { id: 'org-nc2-fallo', nombre: 'NC2 Fallo', ficha: {}, principios: [], history: [] };
    state.history = [{role:'user', content:'una conversación que no debería perderse'}, {role:'assistant', content:'ok'}];
    state.principios = [];
  `, context);
  await flush();
  const historyAntes = JSON.parse(vm.runInContext('JSON.stringify(state.history)', context));

  // persistirOrganismos() traga cualquier excepción real de la escritura local por diseño (try/
  // catch vacío) -- por eso la única forma real de simular ese fallo es que la escritura en sí no
  // persista nada (igual efecto observable que si localStorage.setItem hubiera lanzado).
  vm.runInContext(`globalThis.__nc2PersistirOriginal = persistirOrganismos; persistirOrganismos = function(){ /* simula un fallo real de la escritura local -- no persiste nada */ };`, context);
  try{
    vm.runInContext('alPulsarBtnNueva()', context);
    await flush();

    assert.equal(vm.runInContext('!!state.organismo', context), true, 'NO se llamó a nuevaSesion() -- la sesión actual sigue activa, nada se abandonó en silencio');
    assert.deepEqual(JSON.parse(vm.runInContext('JSON.stringify(state.history)', context)), historyAntes, 'la conversación en memoria sigue exactamente igual que antes del intento fallido');
    assert.equal(vm.runInContext('el.overlay.classList.contains("open")', context), false, 'tampoco se abrió ninguna pantalla propia ni "Destilado de la sesión" -- el aviso de fallo no es una compuerta');
    const avisoPasivo = vm.runInContext(`el.stream.children.some(function(c){ return (c.children||[]).some(function(h){ return h.className === 'errormsg'; }); })`, context);
    assert.equal(avisoPasivo, true, 'se avisó con un mensaje pasivo en el chat (addError(), mismo patrón que los errores de red de enviar()) -- nunca una alerta ni una confirmación que exija una decisión');
  } finally {
    vm.runInContext('persistirOrganismos = globalThis.__nc2PersistirOriginal; delete globalThis.__nc2PersistirOriginal;', context);
  }
});

test('NUEVACOMP02 + NUEVACOMP01: tras cerrar una lectura especializada en el mismo turno (borrador sin `history`, sólo principios -- ver NUEVACOMP01), alPulsarBtnNueva() de todos modos preserva el Hilo completo vía un checkpoint nuevo', async () => {
  // Mismo turno real de cierre de lectura urbana que ya certificó NUEVACOMP01 -- reproducido tal
  // cual, no reimplementado. La diferencia: acá, en vez de sólo reabrir el organismo (que ya
  // certificó NUEVACOMP01 -- el principio sigue visible, pero NO el resto de la conversación),
  // se pulsa "Nueva" primero.
  const RAW_CIERRE_URBAN = '[[PRINCIPIO:un principio que emergió justo cuando cerró la lectura urbana]][[UDIM:VINC|estable|nota de prueba]][[PROYECTIVO:hacia una integración posible]]Cerramos la lectura urbana.';
  const fetchImpl = async (recurso) => {
    const url = String((recurso && recurso.url) ? recurso.url : recurso || '');
    if (url.indexOf('/api/organismos') > -1) return { ok: true, status: 200, json: async () => ({ organismos: [] }), text: async () => '{}', headers: { get() { return null; } } };
    return { ok: true, status: 200, json: async () => ({ content: [{ type: 'text', text: RAW_CIERRE_URBAN }] }) };
  };
  const { context, localStorage } = buildContext(fetchImpl, 'staging.comprenderai.com');
  loadCoreScript(context);
  await flush();
  sembrarSesionYCreditos(localStorage);

  vm.runInContext(`
    state.organismo = { id: 'org-nc2-cerrolectura', nombre: 'NC2 CerroLectura', ficha: {}, principios: [], history: [], lecturas_urban: [] };
    state.history = [];
    state.principios = [];
    state.modoUrban = true;
  `, context);
  await context.enviar('contame cómo cerró la lectura urbana');
  await flush();
  assert.equal(vm.runInContext('state.organismo.lecturas_urban.length', context), 1, 'el cierre real de la lectura urbana volvió a ocurrir (NUEVACOMP01, sin cambios)');
  const historyOriginal = JSON.parse(vm.runInContext('JSON.stringify(state.history)', context));
  assert.equal(vm.runInContext('!!(state.organismo.borrador && state.organismo.borrador.history)', context), false, 'el borrador de NUEVACOMP01 sigue sin `history` en este caso -- por diseño');

  vm.runInContext('alPulsarBtnNueva()', context);
  await flush();
  assert.equal(vm.runInContext('state.organismo', context), null, 'nuevaSesion() corrió tras el guardado automático');

  // Reabrir: NUEVACOMP01 recupera el principio (borrador sin history); NUEVACOMP02 además ofrece
  // "Recuerdo guardado" -- el checkpoint nuevo SÍ tiene el historial completo, a diferencia del
  // borrador de NUEVACOMP01.
  vm.runInContext(`abrirOrganismo(cargarOrganismos().find(function(o){ return o.id === 'org-nc2-cerrolectura'; }));`, context);
  await flush();
  const principioVisible = vm.runInContext(`el.hilo.children.some(function(c){ return c.className && c.className.indexOf('principio') > -1 && (c.children||[]).some(function(h){ return h.textContent && h.textContent.indexOf('un principio que emergió justo cuando cerró la lectura urbana') > -1; }); })`, context);
  assert.equal(principioVisible, true, 'NUEVACOMP01 sigue funcionando -- el principio emergente sigue visible en el Hilo');
  const bRetomarEncontrado = vm.runInContext(`
    (function(){
      function buscar(nodo, vistos){
        vistos = vistos || new Set();
        if(vistos.has(nodo)) return null; vistos.add(nodo);
        if(nodo.textContent && nodo.textContent.indexOf('Retomar en') === 0 && typeof nodo.onclick === 'function') return nodo;
        for(var i=0;i<(nodo.children||[]).length;i++){ var r = buscar(nodo.children[i], vistos); if(r) return r; }
        return null;
      }
      globalThis.__bRetomarNC2CL = buscar(el.stream);
      return !!globalThis.__bRetomarNC2CL;
    })()
  `, context);
  assert.ok(bRetomarEncontrado, 'NUEVACOMP02 además ofrece "Recuerdo guardado" -- el checkpoint nuevo cubre lo que el borrador de NUEVACOMP01 no cubre (el historial completo)');
  vm.runInContext('__bRetomarNC2CL.onclick()', context);
  await flush();
  const historyRecuperado = JSON.parse(vm.runInContext('JSON.stringify(state.history)', context));
  assert.deepEqual(historyRecuperado, historyOriginal, 'el Hilo completo (toda la conversación del turno de cierre) se recupera íntegro -- NUEVACOMP01 y NUEVACOMP02 conviven sin pisarse');
});

// ---------------------------------------------------------------------------------------------
// DERIVACION01 (11/09) -- "Continuidad de acceso a especialidades". Defecto real reportado por
// Javier durante la comprobación humana de NUEVACOMP01: el Core activa una lectura territorial
// ([[DERIVAR:urban]] real del motor), mostrarDerivacion() ofrece "Abrir en Urbanismo →" y
// marcarOrganismoDerivable() persiste org.derivable=['urban'] (todo esto YA existía, sin cambios,
// desde OMV-F3) -- pero si el usuario pulsa "Nueva" ANTES de abrirla y después reabre el
// organismo, la conversación y el principio se recuperan (NUEVACOMP01/NUEVACOMP02, sin cambios)
// pero el botón desaparece.
//
// Fase A (auditoría, sin tocar código): el único contrato real de derivación motor-válida en toda
// la app es [[DERIVAR:urban]] (SYSTEM_PROMPT, línea ~2645) -- no existe [[DERIVAR:negocio]] ni
// [[DERIVAR:contexto]], y ningún camino productivo llama nunca a marcarOrganismoDerivable(org,
// 'negocio'/'contexto') (grep exhaustivo sobre index.html). "Leer en Urbanismo/Negocios/Contextos"
// (ofrecerDerivacionInterna(), acceso permanente basado en org.tipo) es un mecanismo DISTINTO,
// siempre disponible, que no se ve afectado por este defecto -- no depende de una tarjeta pintada
// una sola vez que sobreviva una reapertura, se reconstruye entera cada vez que se llama. La causa
// raíz real, confirmada con ejecución real más abajo: abrirOrganismo() llama a
// ofrecerContinuidadUrban(org) ANTES de intentar restaurarBorrador(org)/restaurarCheckpoint()
// (esta última usada tanto por "Recuerdo guardado -> Retomar" como por "Sesiones anteriores ->
// Restaurar") -- ambas hacen `el.stream.innerHTML = ''` para reconstruir la conversación desde
// cero, lo que borra la tarjeta recién pintada en el mismo tick de JS (sin repintado del navegador
// entre medio: el usuario nunca la ve). La corrección (ver index.html, comentarios "DERIVACION01"
// junto a restaurarBorrador()/restaurarCheckpoint()/marcarOrganismoDerivable()) es exactamente esa
// reconstrucción reordenada, más un mecanismo de consumo real (consumirDerivablePendiente()) para
// que una derivación ya usada no vuelva a ofrecerse como "pendiente". Como Negocios y Contextos no
// tienen hoy ningún contrato real que alguna vez escriba en org.derivable, extender
// ofrecerContinuidadUrban() a esos dos tipos sería código especulativo sin ningún disparador real
// contra el que probarlo con ejecución real (y, para Contextos en particular, hay dos destinos
// reales distintos -- Contextos Universal vs. el producto standalone Pro -- cuya desambiguación no
// está pedida ni es necesaria para este defecto) -- fuera de alcance de la modificación mínima
// necesaria; el plumbing de datos (org.derivable, marcarOrganismoDerivable(org, tipo), ya genérico)
// queda listo para sostenerlo el día que exista un contrato real equivalente.
// Nota de arnés (mismo límite ya señalado en varios comentarios de este archivo, p.ej. junto a
// AISLAMIENTO02 y sincronizacion-cola): FakeElement.innerHTML es una propiedad de texto plana --
// asignarle '' (lo que restaurarBorrador()/restaurarCheckpoint() hacen de verdad para reconstruir
// la conversación) NO vacía .children como sí lo haría un navegador real. Buscar un botón en TODO
// el árbol de el.stream después de varias reaperturas dentro de la misma prueba, por lo tanto,
// también encontraría cualquier nodo "viejo" que un navegador real ya habría eliminado --
// falsos positivos que no distinguirían código roto de código corregido. Por eso estas pruebas NO
// buscan en el.stream entero después de un punto de "limpieza" real (restaurarBorrador/
// restaurarCheckpoint) -- buscan sólo en los hijos agregados A PARTIR de un índice capturado justo
// antes de esa reconstrucción (el.stream.children.length en ese momento), que es exactamente lo
// que un navegador real mostraría: sólo lo que se pintó después de la limpieza.
const DERIVACION01_BUSCADORES_JS = `
  function __buscarEnRango(nodos, prefijo, vistos){
    vistos = vistos || new Set();
    for(var i=0;i<nodos.length;i++){
      var nodo = nodos[i];
      if(!nodo || vistos.has(nodo)) continue;
      vistos.add(nodo);
      if(nodo.className && String(nodo.className).indexOf('btn') > -1 && nodo.textContent && nodo.textContent.indexOf(prefijo) === 0 && typeof nodo.onclick === 'function') return nodo;
      var enHijos = __buscarEnRango(nodo.children || [], prefijo, vistos);
      if(enHijos) return enHijos;
    }
    return null;
  }
  function __contarEnRango(nodos, prefijo, vistos){
    vistos = vistos || new Set();
    var n = 0;
    for(var i=0;i<nodos.length;i++){
      var nodo = nodos[i];
      if(!nodo || vistos.has(nodo)) continue;
      vistos.add(nodo);
      if(nodo.className && String(nodo.className).indexOf('btn') > -1 && nodo.textContent && nodo.textContent.indexOf(prefijo) === 0) n++;
      n += __contarEnRango(nodo.children || [], prefijo, vistos);
    }
    return n;
  }
`;
const RAW_DERIVAR_URBAN = '[[DERIVAR:urban]]Este caso pertenece al dominio urbano-territorial y se beneficiaría de un diagnóstico completo en Comprender Urbanismo.';

test('DERIVACION01: una derivación real ([[DERIVAR:urban]] del motor) sobrevive a "Nueva" (autoguardado NUEVACOMP02) y a la reapertura del organismo -- y se consume de verdad al abrir Urbanismo, sin reaparecer después', async () => {
  const fetchImpl = async (recurso) => {
    const url = String((recurso && recurso.url) ? recurso.url : recurso || '');
    if (url.indexOf('/api/organismos') > -1) return { ok: true, status: 200, json: async () => ({ organismos: [] }), text: async () => '{}', headers: { get() { return null; } } };
    return { ok: true, status: 200, json: async () => ({ content: [{ type: 'text', text: RAW_DERIVAR_URBAN }] }) };
  };
  const { context, localStorage } = buildContext(fetchImpl, 'staging.comprenderai.com');
  loadCoreScript(context);
  await flush();
  sembrarSesionYCreditos(localStorage);

  // Emulación puntual, sólo acá, de la semántica real de `innerHTML=''` para el.stream: en un
  // navegador real, restaurarBorrador() hace ese wipe DENTRO del mismo llamado sincrónico a
  // abrirOrganismo() que ya pintó una tarjeta (el llamado temprano a ofrecerContinuidadUrban(), sin
  // cambios de este corte) -- así que el nodo viejo se borra de verdad ANTES de que, con la
  // corrección de este corte, restaurarBorrador() pinte uno nuevo al final. Sin esta emulación, la
  // limitación ya documentada del arnés (FakeElement.innerHTML es una propiedad de texto plana sin
  // efecto sobre .children -- ver nota junto a DERIVACION01_BUSCADORES_JS más arriba) dejaría
  // ambos nodos "vivos" a la vez en .children dentro de un mismo llamado, dando un falso positivo
  // de duplicación que no existe en un navegador real (a diferencia de la prueba de "Retomar" de
  // abajo, acá los dos pintados ocurren dentro del MISMO llamado sincrónico a abrirOrganismo(), sin
  // ningún punto intermedio donde el test pueda capturar un índice entre uno y otro). Se aplica
  // sólo a esta instancia (el.stream) en el contexto propio de esta prueba -- no toca la clase
  // FakeElement compartida ni ninguna otra prueba de este archivo.
  vm.runInContext(`
    (function(){
      var actual = '';
      Object.defineProperty(el.stream, 'innerHTML', {
        configurable: true,
        get: function(){ return actual; },
        set: function(v){ actual = v; if(v === '') el.stream.children = []; }
      });
    })();
  `, context);

  vm.runInContext(`
    state.organismo = { id: 'org-deriv-1', nombre: 'Barrio Derivación', tipo: 'ciudad', ficha: {}, principios: [], history: [] };
    state.history = [];
    state.principios = [];
  `, context);

  // Turno real: el motor emite [[DERIVAR:urban]] -- mostrarDerivacion()/marcarOrganismoDerivable()
  // corren tal cual (nada de esto se reimplementa en la prueba).
  await context.enviar('contame de este barrio, quiero avanzar');
  await flush();

  const orgTrasEnvio = JSON.parse(vm.runInContext(`JSON.stringify(cargarOrganismos().find(function(o){ return o.id === 'org-deriv-1'; }))`, context));
  assert.deepEqual(orgTrasEnvio.derivable, ['urban'], 'marcarOrganismoDerivable() real persistió la derivación en el organismo, tal como hacía antes de este corte');

  const tarjetaInicial = vm.runInContext(DERIVACION01_BUSCADORES_JS + `!!__buscarEnRango(el.stream.children, 'Abrir en Urbanismo →')`, context);
  assert.equal(tarjetaInicial, true, 'mostrarDerivacion() pintó el botón apenas el motor emitió DERIVAR:urban -- sin cambios de este corte');

  const historyPrevioANueva = JSON.parse(vm.runInContext('JSON.stringify(state.history)', context));

  // "Nueva" real (autoguardado silencioso de NUEVACOMP02, sin cambios de este corte) ANTES de
  // haber abierto Urbanismo -- exactamente la secuencia reportada por Javier.
  vm.runInContext('alPulsarBtnNueva()', context);
  await flush();
  assert.equal(vm.runInContext('state.organismo', context), null, 'nuevaSesion() corrió tras el autoguardado, sin cambios de este corte');

  // Reapertura real del organismo. Gracias a la emulación de innerHTML='' agregada arriba,
  // el.stream.children ahora refleja de verdad sólo lo actualmente pintado (como en un navegador
  // real), así que alcanza con buscar en el árbol completo -- sin necesidad de índices ni slicing.
  vm.runInContext(`abrirOrganismo(cargarOrganismos().find(function(o){ return o.id === 'org-deriv-1'; }));`, context);
  await flush();

  const historyTrasReabrir = JSON.parse(vm.runInContext('JSON.stringify(state.history)', context));
  assert.deepEqual(historyTrasReabrir, historyPrevioANueva, 'sanity: la conversación se recuperó íntegra (restaurarBorrador() real, sin cambios) -- mismo escenario exacto que reportó Javier');
  assert.equal(vm.runInContext('state.modoUrban', context), false, 'la reconstrucción de la tarjeta nunca activa el modo Urban en el chat -- sólo ofrece la puerta, no reactiva ninguna lectura');

  const trasReabrir = vm.runInContext(DERIVACION01_BUSCADORES_JS + `
    (function(){
      var b = __buscarEnRango(el.stream.children, 'Abrir en Urbanismo →');
      globalThis.__btnDerivTrasReabrir = b;
      return { presente: !!b, conteo: __contarEnRango(el.stream.children, 'Abrir en Urbanismo →') };
    })()
  `, context);
  assert.equal(trasReabrir.presente, true, 'CORREGIDO: el botón "Abrir en Urbanismo →" sigue disponible tras Nueva + reapertura -- antes de DERIVACION01, restaurarBorrador() borraba la tarjeta que ofrecerContinuidadUrban() acababa de pintar, en el mismo tick, y nada la reemplazaba después');
  assert.equal(trasReabrir.conteo, 1, 'no se duplica: exactamente un botón nuevo, pintado después de la reconstrucción real de la conversación');

  // Consumo real: abrir Urbanismo de verdad desde la propia tarjeta (plan "gratis" por defecto ya
  // habilita Urbanismo en prueba -- moduloHabilitado('urbanismo') real, sin mockear).
  assert.equal(vm.runInContext(`moduloHabilitado('urbanismo')`, context), true, 'sanity: plan por defecto SÍ habilita Urbanismo (prueba en gratis)');
  vm.runInContext('__btnDerivTrasReabrir.onclick()', context);
  await flush();

  const orgTrasClick = JSON.parse(vm.runInContext(`JSON.stringify(cargarOrganismos().find(function(o){ return o.id === 'org-deriv-1'; }))`, context));
  assert.deepEqual(orgTrasClick.derivable, [], 'CONSUMIDA: tras abrir realmente Urbanismo desde la tarjeta, consumirDerivablePendiente() real retiró la derivación de org.derivable');

  // Reabrir una vez más: la derivación ya consumida no debe reaparecer.
  vm.runInContext(`abrirOrganismo(cargarOrganismos().find(function(o){ return o.id === 'org-deriv-1'; }));`, context);
  await flush();
  const trasConsumo = vm.runInContext(DERIVACION01_BUSCADORES_JS + `!!__buscarEnRango(el.stream.children, 'Abrir en Urbanismo →')`, context);
  assert.equal(trasConsumo, false, 'no reaparece: una derivación ya consumida no vuelve a ofrecerse en una reapertura posterior');
});

test('DERIVACION01: si el plan no habilita Urbanismo, el clic en "Abrir en Urbanismo →" no consume la derivación pendiente -- respeta plan/permisos/módulos habilitados', async () => {
  const fetchImpl = async (recurso) => {
    const url = String((recurso && recurso.url) ? recurso.url : recurso || '');
    if (url.indexOf('/api/organismos') > -1) return { ok: true, status: 200, json: async () => ({ organismos: [] }), text: async () => '{}', headers: { get() { return null; } } };
    return { ok: true, status: 200, json: async () => ({ content: [{ type: 'text', text: RAW_DERIVAR_URBAN }] }) };
  };
  const { context, localStorage } = buildContext(fetchImpl, 'staging.comprenderai.com');
  loadCoreScript(context);
  await flush();
  sembrarSesionYCreditos(localStorage);

  vm.runInContext(`
    state.organismo = { id: 'org-deriv-bloqueado', nombre: 'Barrio Bloqueado', tipo: 'ciudad', ficha: {}, principios: [], history: [] };
    state.history = [];
    state.principios = [];
  `, context);
  await context.enviar('contame de este barrio');
  await flush();

  // Plan real fuera de ORDEN_PLANES (cuenta suspendida/vencida) -- moduloHabilitado('urbanismo')
  // real debe bloquear, sin mockear la función.
  localStorage.setItem('ag_core_plan', 'suspendido');
  assert.equal(vm.runInContext(`moduloHabilitado('urbanismo')`, context), false, 'sanity: con este plan, moduloHabilitado() real bloquea Urbanismo');

  const boton = vm.runInContext(DERIVACION01_BUSCADORES_JS + `
    (function(){
      var b = __buscarEnRango(el.stream.children, 'Abrir en Urbanismo →');
      globalThis.__btnDerivBloqueado = b;
      return !!b;
    })()
  `, context);
  assert.ok(boton, 'sanity: la tarjeta se pintó igual (mostrarDerivacion() no gatea por plan, sólo abrirModulo() lo hace)');

  vm.runInContext('__btnDerivBloqueado.onclick()', context);
  await flush();

  const orgTrasClick = JSON.parse(vm.runInContext(`JSON.stringify(cargarOrganismos().find(function(o){ return o.id === 'org-deriv-bloqueado'; }))`, context));
  assert.deepEqual(orgTrasClick.derivable, ['urban'], 'la derivación pendiente NO se consume si el plan no permite abrir Urbanismo -- sigue disponible para cuando la cuenta tenga el plan que le falta');
});

test('DERIVACION01: la reconstrucción también funciona vía checkpoint ("Recuerdo guardado" -> "Retomar", restaurarCheckpoint() real, sin borrador de por medio)', async () => {
  const fetchImpl = async () => ({ ok: true, status: 200, json: async () => ({ organismos: [] }), text: async () => '{}', headers: { get() { return null; } } });
  const { context, localStorage } = buildContext(fetchImpl, 'staging.comprenderai.com');
  loadCoreScript(context);
  await flush();
  sembrarSesionYCreditos(localStorage);

  // Mismo patrón que ya usa la prueba "NUEVACOMP02: con conversación significativa..." para
  // garantizar que o.borrador NUNCA se setea (sesión sembrada a mano, sin pasar por enviar()) --
  // así la recuperación de "Abrir en Urbanismo →" depende EXCLUSIVAMENTE de restaurarCheckpoint(),
  // no de restaurarBorrador() (ya cubierto por la prueba anterior).
  vm.runInContext(`
    state.organismo = { id: 'org-deriv-chk', nombre: 'Barrio Checkpoint', tipo: 'ciudad', ficha: { funcion: 'orientar' }, principios: [], history: [] };
    state.history = [{role:'user', content:'hola'}, {role:'assistant', content:'ok, avancemos'}];
    state.principios = [];
  `, context);
  // marcarOrganismoDerivable() real -- simula que el motor ya había emitido DERIVAR:urban en un
  // turno anterior de esta misma sesión (no hace falta repetir el turno completo: la función bajo
  // prueba acá es la reconstrucción al reabrir, no la emisión).
  vm.runInContext(`marcarOrganismoDerivable(state.organismo, 'urban')`, context);
  await flush();

  const orgSembrado = JSON.parse(vm.runInContext(`JSON.stringify(cargarOrganismos().find(function(o){ return o.id === 'org-deriv-chk'; }))`, context));
  assert.deepEqual(orgSembrado.derivable, ['urban']);
  assert.equal(!!orgSembrado.borrador, false, 'a propósito, sin borrador -- la recuperación de abajo depende sólo del checkpoint');

  vm.runInContext('alPulsarBtnNueva()', context);
  await flush();
  assert.equal(vm.runInContext('state.organismo', context), null, 'nuevaSesion() corrió tras el autoguardado (crea el checkpoint real)');

  vm.runInContext(`abrirOrganismo(cargarOrganismos().find(function(o){ return o.id === 'org-deriv-chk'; }));`, context);
  await flush();
  assert.equal(vm.runInContext('state.history.length', context), 0, 'reabrir solo no restaura nada todavía -- "Recuerdo guardado" nunca restaura sola');

  const antesDeRetomar = vm.runInContext(DERIVACION01_BUSCADORES_JS + `!!__buscarEnRango(el.stream.children, 'Abrir en Urbanismo →')`, context);
  assert.equal(antesDeRetomar, true, 'la tarjeta ya está disponible ANTES de retomar el checkpoint -- pintada por la llamada temprana de abrirOrganismo(), que acá todavía no se borró (restaurarBorrador() no corrió, no había nada que reproducir)');

  const bRetomarEncontrado = vm.runInContext(`
    (function(){
      function buscar(nodo, vistos){
        vistos = vistos || new Set();
        if(vistos.has(nodo)) return null; vistos.add(nodo);
        if(nodo.textContent && nodo.textContent.indexOf('Retomar en') === 0 && typeof nodo.onclick === 'function') return nodo;
        for(var i=0;i<(nodo.children||[]).length;i++){ var r = buscar(nodo.children[i], vistos); if(r) return r; }
        return null;
      }
      globalThis.__bRetomarDeriv = buscar(el.stream);
      return !!globalThis.__bRetomarDeriv;
    })()
  `, context);
  assert.ok(bRetomarEncontrado, 'el checkpoint real ofrece "Retomar"');
  // Índice capturado JUSTO ANTES del clic en "Retomar" -- restaurarCheckpoint() hace
  // `el.stream.innerHTML = ''` para reconstruir la conversación, pero en este harness fake
  // .innerHTML='' no vacía realmente .children (ver comentario junto a DERIVACION01_BUSCADORES_JS
  // más arriba): todo lo pintado ANTES de este índice (la tarjeta original de abrirOrganismo(),
  // ya verificada en `antesDeRetomar` de arriba) sigue viviendo en el array aunque un navegador
  // real ya la habría borrado. Sólo lo pintado A PARTIR de este índice refleja lo que un navegador
  // real mostraría tras el wipe-and-rebuild de restaurarCheckpoint().
  const indiceAntesDeRetomar = vm.runInContext('el.stream.children.length', context);
  vm.runInContext('__bRetomarDeriv.onclick()', context);
  await flush();

  const trasRetomar = vm.runInContext(DERIVACION01_BUSCADORES_JS + `
    (function(){
      var rango = el.stream.children.slice(${indiceAntesDeRetomar});
      return { presente: !!__buscarEnRango(rango, 'Abrir en Urbanismo →'), conteo: __contarEnRango(rango, 'Abrir en Urbanismo →') };
    })()
  `, context);
  assert.equal(trasRetomar.presente, true, 'CORREGIDO: restaurarCheckpoint() (vía "Retomar") también reconstruye la tarjeta -- antes de DERIVACION01 quedaba borrada por el mismo `el.stream.innerHTML = \'\'` que restaurarCheckpoint() hace para reconstruir la conversación');
  assert.equal(trasRetomar.conteo, 1, 'no se duplica tampoco en este camino');
});

test('DERIVACION01: si el motor vuelve a emitir una derivación válida después de que la anterior ya se consumió, el botón vuelve a aparecer', async () => {
  const fetchImpl = async (recurso) => {
    const url = String((recurso && recurso.url) ? recurso.url : recurso || '');
    if (url.indexOf('/api/organismos') > -1) return { ok: true, status: 200, json: async () => ({ organismos: [] }), text: async () => '{}', headers: { get() { return null; } } };
    return { ok: true, status: 200, json: async () => ({ content: [{ type: 'text', text: RAW_DERIVAR_URBAN }] }) };
  };
  const { context, localStorage } = buildContext(fetchImpl, 'staging.comprenderai.com');
  loadCoreScript(context);
  await flush();
  sembrarSesionYCreditos(localStorage);

  vm.runInContext(`
    state.organismo = { id: 'org-deriv-reemitida', nombre: 'Barrio Reemisión', tipo: 'ciudad', ficha: {}, principios: [], history: [] };
  `, context);
  // Simula una derivación anterior ya consumida (marcarOrganismoDerivable + consumirDerivablePendiente
  // reales, sin pasar por un turno completo -- ambas funciones ya están certificadas por separado).
  vm.runInContext(`marcarOrganismoDerivable(state.organismo, 'urban')`, context);
  vm.runInContext(`consumirDerivablePendiente(state.organismo.id, 'urban')`, context);
  const orgPreviaConsumida = JSON.parse(vm.runInContext(`JSON.stringify(cargarOrganismos().find(function(o){ return o.id === 'org-deriv-reemitida'; }))`, context));
  assert.deepEqual(orgPreviaConsumida.derivable, [], 'sanity: la derivación anterior ya está consumida');

  // Nueva sesión real sobre el mismo organismo (state.derivarAvisado se resetea a false, como
  // siempre) y el motor vuelve a emitir DERIVAR:urban -- comportamiento legítimo y ya certificado
  // de marcarOrganismoDerivable() (no duplica, pero sí re-agrega si ya no está).
  vm.runInContext(`
    state.organismo = cargarOrganismos().find(function(o){ return o.id === 'org-deriv-reemitida'; });
    state.history = [];
    state.principios = [];
    state.derivarAvisado = false;
  `, context);
  await context.enviar('retomemos, quiero avanzar de nuevo');
  await flush();

  const orgTrasReemision = JSON.parse(vm.runInContext(`JSON.stringify(cargarOrganismos().find(function(o){ return o.id === 'org-deriv-reemitida'; }))`, context));
  assert.deepEqual(orgTrasReemision.derivable, ['urban'], 'una nueva emisión real de DERIVAR:urban vuelve a marcar la derivación como pendiente');
  const tarjetaReemitida = vm.runInContext(DERIVACION01_BUSCADORES_JS + `!!__buscarEnRango(el.stream.children, 'Abrir en Urbanismo →')`, context);
  assert.equal(tarjetaReemitida, true, 'y el botón vuelve a aparecer de verdad, en el mismo turno');
});

test('DERIVACION01: la derivación pendiente de un organismo no contamina a otro -- reabrir un organismo sin derivación no ofrece "Abrir en Urbanismo →" aunque exista otro con la derivación pendiente', async () => {
  const fetchImpl = async () => ({ ok: true, status: 200, json: async () => ({ organismos: [] }), text: async () => '{}', headers: { get() { return null; } } });
  const { context, localStorage } = buildContext(fetchImpl, 'staging.comprenderai.com');
  loadCoreScript(context);
  await flush();
  sembrarSesionYCreditos(localStorage);

  vm.runInContext(`
    guardarOrganismo({ id: 'org-deriv-A', nombre: 'Organismo A (con derivación)', tipo: 'ciudad', ficha: {}, principios: [], history: [] });
    guardarOrganismo({ id: 'org-deriv-B', nombre: 'Organismo B (sin derivación)', tipo: 'ciudad', ficha: {}, principios: [], history: [] });
    marcarOrganismoDerivable(cargarOrganismos().find(function(o){ return o.id === 'org-deriv-A'; }), 'urban');
  `, context);
  await flush();

  vm.runInContext(`abrirOrganismo(cargarOrganismos().find(function(o){ return o.id === 'org-deriv-B'; }));`, context);
  await flush();
  const enB = vm.runInContext(DERIVACION01_BUSCADORES_JS + `!!__buscarEnRango(el.stream.children, 'Abrir en Urbanismo →')`, context);
  assert.equal(enB, false, 'el organismo B, sin derivación propia, no ofrece la tarjeta de A -- sin contaminación entre organismos');

  vm.runInContext(`abrirOrganismo(cargarOrganismos().find(function(o){ return o.id === 'org-deriv-A'; }));`, context);
  await flush();
  const enA = vm.runInContext(DERIVACION01_BUSCADORES_JS + `!!__buscarEnRango(el.stream.children, 'Abrir en Urbanismo →')`, context);
  assert.equal(enA, true, 'y el organismo A, con su propia derivación pendiente, sí la ofrece -- cada uno con su propio estado, sin cruzarse');
});
