// Corte 122.30 · integración real de enviar() con la creación de candidato epistemológico
// (§7.5, orden único de escrituras). No repite lo que ya cubren epistemic-ledger.test.mjs,
// epistemic-production-adapter.test.mjs u organismos-epistemico.test.mjs (la lógica de negocio
// de cada pieza) ni sincronizacion-cola.test.mjs (el comportamiento genérico de la cola) -- esto
// verifica exclusivamente el CABLEADO dentro de enviar(): que con el flag completo (§15) y una
// propuesta elegible, se pide la creación del candidato ANTES de continuar, que el recordRef
// devuelto se agrega a la entrada de historial correcta, y que la tarjeta se monta sobre el nodo
// ya renderizado -- y que, apagado cualquiera de los tres requisitos del flag, o sin propuesta
// elegible, el comportamiento es exactamente el histórico (sin request epistemológico, sin
// tarjeta).
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

// microtareas suficientes para que se resuelva por completo la cadena .then del barrido de
// arranque (sincronizarOrganismosConServidor(), disparado una sola vez al final del script --
// ver sincronizacion-cola.test.mjs). Mismo patrón que ese archivo.
async function flush(n = 10) { for (let i = 0; i < n; i++) await Promise.resolve(); }

// loadCoreScript() dispara ese barrido de inmediato (GET /api/organismos sin body). Con el mock
// de fetch de este archivo (una Promise real ya resuelta, no una pendiente controlada a mano),
// su continuación async corre sola apenas se ceden suficientes microtareas -- pero corre DESPUÉS,
// no en el mismo tick. Si una prueba siembra localStorage['ag_core_organismos'] con un organismo
// ANTES de que esa continuación llegue a correr, el barrido lo encuentra, lo cree "local, todavía
// no subido" (la respuesta mockeada del GET es siempre {organismos: []}) y dispara una subida
// histórica (guardar_organismo) no pedida por la prueba -- que puede pisar cualquier variable de
// captura compartida si la prueba también hace su propio POST al mismo organismo. Por eso: SIEMPRE
// hay que drenar el barrido de arranque (mientras todavía no hay nada sembrado, así no sube nada)
// antes de sembrar 'ag_core_organismos' a mano.
async function drenarBarridoArranque(context) {
  await flush();
}

function sembrarSesionYCreditos(localStorage) {
  localStorage.setItem('comprender_sesion', JSON.stringify({ token: 'tok-test', vence: Date.now() + 3600000 }));
  localStorage.setItem('ag_core_saldo', JSON.stringify({ saldo: 1000, momento: Date.now() }));
}

// Respuesta canónica del motor: un [[FICHA:...]] simple para que proponerFicha() devuelva una
// propuesta elegible (campos no vacío). El formato exacto lo interpreta parseMotor(), ya probado
// en otras suites -- acá sólo hace falta que dispare una propuesta real, no se reinventa el parser.
const RAW_CON_FICHA = '[[FICHA:FUNCION=orientar|MODO=M07|TENSIONES=a; b|DIAGNOSTICO=d|PROXIMO=p|PROXIMOS=x;;y]]Encontramos algo importante.';

function anthropicOkResponse() {
  return { ok: true, status: 200, json: async () => ({ content: [{ type: 'text', text: RAW_CON_FICHA }] }) };
}
function organismosOkResponse(extra) {
  return { ok: true, status: 200, json: async () => Object.assign({ ok: true, version: 2 }, extra || {}) };
}

function fetchRouter({ onOrganismos } = {}) {
  return async (recurso, opciones) => {
    const url = String((recurso && recurso.url) ? recurso.url : recurso || '');
    if (url.indexOf('/api/organismos') > -1) {
      // El barrido de arranque (sincronizarOrganismosConServidor(), disparado una sola vez al
      // cargar el script -- ver sincronizacion-cola.test.mjs) hace un GET sin body; no es
      // relevante para estas pruebas, así que se responde de forma neutra sin pasar por
      // onOrganismos (que espera siempre un body de un POST real).
      if (!opciones || !opciones.body) return { ok: true, status: 200, json: async () => ({ organismos: [] }) };
      const body = JSON.parse(opciones.body);
      if (onOrganismos) { const r = onOrganismos(body); if (r) return r; }
      return organismosOkResponse();
    }
    // cualquier otra URL (el endpoint del motor) -> respuesta canónica del Core
    return anthropicOkResponse();
  };
}

async function prepararOrganismo(context) {
  vm.runInContext(`
    state.organismo = { id: 'org-envio-1', nombre: 'Test', ficha: {}, principios: [], history: [] };
    state.history = [];
    state.busy = false;
    state.epoch = state.epoch || 0;
  `, context);
}

test('enviar() con flag completo (staging + preferencia + sesión) y propuesta elegible: pide la creación, agrega recordRef y monta la tarjeta', async () => {
  const llamadasOrganismos = [];
  const fetchImpl = fetchRouter({
    onOrganismos(body) {
      llamadasOrganismos.push(body);
      if (body.operacion === 'create_epistemic_candidate') {
        return organismosOkResponse({
          recordRef: 'ER-TEST-0001', turnRef: body.turnRef, state: 'review_required',
          registro_epistemico: { schema_version: 'vr1-core-ledger/1.1', ledger_version: 1, entries: [], operations: [], reviews: [], review_events: [] },
          presentation: { recordRef: 'ER-TEST-0001', state: 'review_required', level: 'V1', title: 't', summary: 's', evidenceItems: [], pendingItems: [] },
        });
      }
      return null;
    }
  });
  const { context, localStorage } = buildContext(fetchImpl, 'staging.comprenderai.com');
  loadCoreScript(context);
  sembrarSesionYCreditos(localStorage);
  localStorage.setItem('ag_core_pref_integracion_epistemica_staging', '1');
  await prepararOrganismo(context);

  let capturedPresentation = null, capturedActions = null;
  context.window.__sustentacionCard.create = function (presentation, actions) {
    capturedPresentation = presentation; capturedActions = actions;
    return { ok: true, node: new FakeElement('div') };
  };

  await context.enviar('hola');

  const creacion = llamadasOrganismos.find(b => b.operacion === 'create_epistemic_candidate');
  assert.ok(creacion, 'enviar() debe pedir create_epistemic_candidate cuando el flag está completo y la propuesta es elegible');
  assert.equal(creacion.cliente_id, 'org-envio-1');
  assert.match(creacion.turnRef, /^TURN-[0-9a-z-]{6,60}$/);
  assert.equal(creacion.eventRef.type, 'proposal');
  assert.equal(creacion.eventRef.organism_id, 'org-envio-1');
  assert.equal(creacion.eventRef.id, creacion.candidate.proposal.id);

  const entradaAsistente = vm.runInContext('state.history[state.history.length - 1]', context);
  assert.equal(entradaAsistente.role, 'assistant');
  assert.equal(entradaAsistente.recordRef, 'ER-TEST-0001', 'el recordRef confirmado por el servidor se agrega a la entrada correcta del historial');
  assert.equal(entradaAsistente.turnRef, creacion.turnRef);

  assert.ok(capturedPresentation, 'se debe montar la tarjeta con la presentation devuelta por el servidor');
  assert.equal(capturedPresentation.recordRef, 'ER-TEST-0001');
  assert.equal(typeof capturedActions.onAccept, 'function');
  assert.equal(typeof capturedActions.onReject, 'function');

  // Bug real de QA en staging (08/09): una creación confirmada por el servidor (versión 2 en este
  // mock) que no se aplica sobre el organismo en memoria deja org._sv atrasado -- el guardado
  // genérico que sigue en el mismo turno (guardarBorrador(), más abajo en enviar()) viaja
  // entonces con una version_conocida vieja, el servidor lo rechaza (409) y esa versión vieja
  // queda "pegada": cualquier acción posterior sobre la tarjeta (aceptar/no incorporar) hereda el
  // mismo 409 sin salida hasta recargar la página. Esta es la prueba de regresión directa de esa
  // causa: org._sv debe reflejar la versión que el propio servidor confirmó en la respuesta de
  // create_epistemic_candidate, ANTES de que corra ningún guardado posterior.
  // Objeto del realm vm -- deepEqual contra un literal del realm exterior falla por prototipos
  // distintos aunque la estructura sea idéntica (mismo motivo que el resto de esta suite).
  const orgTrasCreacion = JSON.parse(JSON.stringify(vm.runInContext('state.organismo', context)));
  assert.deepEqual(orgTrasCreacion._sv, { version: 2 }, 'org._sv debe actualizarse con la versión que confirmó create_epistemic_candidate, no quedar atrasado');
  assert.ok(orgTrasCreacion.registro_epistemico, 'registro_epistemico devuelto por la creación también se aplica sobre el organismo en memoria');
  assert.equal(orgTrasCreacion.registro_epistemico.ledger_version, 1);
});

test('enviar() con flag apagado (host de producción): no pide creación ni monta tarjeta, camino histórico intacto', async () => {
  const llamadasOrganismos = [];
  const fetchImpl = fetchRouter({ onOrganismos(body) { llamadasOrganismos.push(body); return null; } });
  const { context, localStorage } = buildContext(fetchImpl, 'app.comprenderai.com');
  loadCoreScript(context);
  sembrarSesionYCreditos(localStorage);
  localStorage.setItem('ag_core_pref_integracion_epistemica_staging', '1'); // encendida igual -- el host manda
  await prepararOrganismo(context);

  let tarjetaMontada = false;
  context.window.__sustentacionCard.create = function () { tarjetaMontada = true; return { ok: true, node: new FakeElement('div') }; };

  await context.enviar('hola');

  assert.equal(llamadasOrganismos.some(b => b.operacion === 'create_epistemic_candidate'), false, 'fuera de staging.comprenderai.com el flag es siempre false: ningún request epistemológico');
  assert.equal(tarjetaMontada, false);
  const entradaAsistente = vm.runInContext('state.history[state.history.length - 1]', context);
  assert.equal(entradaAsistente.recordRef, undefined);
});

test('enviar() con flag completo pero sin preferencia local habilitada: tampoco pide creación', async () => {
  const llamadasOrganismos = [];
  const fetchImpl = fetchRouter({ onOrganismos(body) { llamadasOrganismos.push(body); return null; } });
  const { context, localStorage } = buildContext(fetchImpl, 'staging.comprenderai.com');
  loadCoreScript(context);
  sembrarSesionYCreditos(localStorage);
  // preferencia NO seteada
  await prepararOrganismo(context);

  await context.enviar('hola');

  assert.equal(llamadasOrganismos.some(b => b.operacion === 'create_epistemic_candidate'), false);
});

test('enviar() con flag completo salvo sesión (tokenVigente() sin token): tampoco pide creación -- tercera condición del §15', async () => {
  const llamadasOrganismos = [];
  const fetchImpl = fetchRouter({ onOrganismos(body) { llamadasOrganismos.push(body); return null; } });
  const { context, localStorage } = buildContext(fetchImpl, 'staging.comprenderai.com');
  loadCoreScript(context);
  sembrarSesionYCreditos(localStorage);
  localStorage.setItem('ag_core_pref_integracion_epistemica_staging', '1');
  context.tokenVigente = async () => null; // "no hay sesión válida" -- mismo camino autenticado, sin token
  await prepararOrganismo(context);

  await context.enviar('hola');

  assert.equal(llamadasOrganismos.some(b => b.operacion === 'create_epistemic_candidate'), false, 'sin sesión válida, aunque host y preferencia estén encendidos, el flag efectivo sigue siendo false');
});

test('enviar() con flag completo pero sin propuesta elegible (respuesta sin ficha/hito/horizonte/principios): no pide creación', async () => {
  const fetchImpl = async (recurso, opciones) => {
    const url = String((recurso && recurso.url) ? recurso.url : recurso || '');
    if (url.indexOf('/api/organismos') > -1) {
      const body = opciones && opciones.body ? JSON.parse(opciones.body) : null;
      if (body && body.operacion === 'create_epistemic_candidate') throw new Error('no debería pedirse create_epistemic_candidate sin propuesta elegible');
      return organismosOkResponse();
    }
    return { ok: true, status: 200, json: async () => ({ content: [{ type: 'text', text: 'Una respuesta conversacional simple, sin marcadores.' }] }) };
  };
  const { context, localStorage } = buildContext(fetchImpl, 'staging.comprenderai.com');
  loadCoreScript(context);
  sembrarSesionYCreditos(localStorage);
  localStorage.setItem('ag_core_pref_integracion_epistemica_staging', '1');
  await prepararOrganismo(context);

  await assert.doesNotReject(context.enviar('hola'));
  const entradaAsistente = vm.runInContext('state.history[state.history.length - 1]', context);
  assert.equal(entradaAsistente.recordRef, undefined);
});

test('enviar() con flag completo y creación rechazada por el servidor (409 conflicto): no agrega recordRef ni monta tarjeta, mensaje queda intacto', async () => {
  const fetchImpl = fetchRouter({
    onOrganismos(body) {
      if (body.operacion === 'create_epistemic_candidate') {
        return { ok: false, status: 409, json: async () => ({ error: { message: 'conflicto', codigo: 'conflicto_version' }, version: 5 }) };
      }
      return null;
    }
  });
  const { context, localStorage } = buildContext(fetchImpl, 'staging.comprenderai.com');
  loadCoreScript(context);
  sembrarSesionYCreditos(localStorage);
  localStorage.setItem('ag_core_pref_integracion_epistemica_staging', '1');
  await prepararOrganismo(context);

  let tarjetaMontada = false;
  context.window.__sustentacionCard.create = function () { tarjetaMontada = true; return { ok: true, node: new FakeElement('div') }; };

  await context.enviar('hola');

  assert.equal(tarjetaMontada, false, 'si falla la creación, no aparece ninguna tarjeta fantasma');
  const entradaAsistente = vm.runInContext('state.history[state.history.length - 1]', context);
  assert.equal(entradaAsistente.recordRef, undefined);
  // No se asume que el mensaje del motor sea el ÚLTIMO hijo de #stream: proponerFicha() agrega
  // legítimamente su propio aviso de propuesta pendiente (chip 'propaviso') después -- eso es
  // comportamiento histórico correcto, no algo que este corte deba alterar. Se busca el nodo
  // '.msg.motor' con su burbuja, no el último hijo cualquiera.
  const bubbleMontado = vm.runInContext(`
    (function(){
      var s = document.getElementById('stream');
      var motor = s.children.find(function(c){ return c.className === 'msg motor'; });
      return !!motor && motor.children.some(function(c){ return c.className === 'bubble'; });
    })()
  `, context);
  assert.equal(bubbleMontado, true, 'el mensaje conversacional original sigue visible pese al fallo de creación');
});

test('enviar() con flag completo y creación rechazada por 409: recupera el organismo vigente (§7.6) por el camino autenticado, sin inventar versión ni mezclar el blob', async () => {
  const llamadasGet = [];
  // Servidor simulado con estado real de versión (4, ya adelantado por "otra sesión" respecto de
  // lo que este cliente sabe): así el guardado genérico que enviar() dispara igual, después del
  // 409 de creación (guardarBorrador() de fin de turno), también choca de verdad -- igual que en
  // el servidor real, donde la RPC guardar_organismo aplica el mismo chequeo de versión sin
  // importar qué operación la llame (ver api/organismos.js). Un mock que "éxito siempre" acá
  // enmascararía exactamente el escenario que produjo el bug real.
  const VERSION_SERVIDOR = 4;
  const fetchImpl = async (recurso, opciones) => {
    const url = String((recurso && recurso.url) ? recurso.url : recurso || '');
    if (url.indexOf('/api/organismos') > -1) {
      if (!opciones || !opciones.body) {
        // GET sin body: puede ser el barrido de arranque (una vez, al cargar) o la recuperación
        // §7.6 tras el 409 de abajo -- ambas comparten el mismo camino autenticado existente, así
        // que ambas se sirven acá; se cuenta cuántas veces se pidió para probar que sí se disparó.
        llamadasGet.push(true);
        return {
          ok: true, status: 200, json: async () => ({
            organismos: [{
              cliente_id: 'org-envio-1', nombre: 'Test', version: VERSION_SERVIDOR,
              datos: {
                id: 'org-envio-1', nombre: 'Test',
                registro_epistemico: { schema_version: 'vr1-core-ledger/1.1', ledger_version: 3, entries: [], operations: [], reviews: [], review_events: [] },
                momentos: [],
              },
            }],
          }),
        };
      }
      const body = JSON.parse(opciones.body);
      if (body.operacion === 'create_epistemic_candidate') {
        return { ok: false, status: 409, json: async () => ({ error: { message: 'conflicto', codigo: 'conflicto_version' }, version: VERSION_SERVIDOR }) };
      }
      // guardado genérico (guardarBorrador() al final de enviar()): el servidor real aplica el
      // mismo chequeo de version_conocida que las operaciones epistemológicas -- con la versión
      // local todavía atrasada (el bug bajo prueba), esto también debe chocar.
      if (body.version_conocida !== VERSION_SERVIDOR) {
        return { ok: false, status: 409, json: async () => ({ error: { message: 'conflicto', codigo: 'conflicto_version' }, version: VERSION_SERVIDOR }) };
      }
      return { ok: true, status: 200, json: async () => ({ ok: true, id: body.cliente_id, version: VERSION_SERVIDOR + 1 }) };
    }
    return anthropicOkResponse();
  };
  const { context, localStorage } = buildContext(fetchImpl, 'staging.comprenderai.com');
  loadCoreScript(context);
  sembrarSesionYCreditos(localStorage);
  localStorage.setItem('ag_core_pref_integracion_epistemica_staging', '1');
  await prepararOrganismo(context);
  llamadasGet.length = 0; // descarta el GET del barrido de arranque disparado por loadCoreScript()

  let tarjetaMontada = false;
  context.window.__sustentacionCard.create = function () { tarjetaMontada = true; return { ok: true, node: new FakeElement('div') }; };

  await context.enviar('hola');
  // recuperarOrganismoVigente() se dispara sin esperarse (fire-and-forget: enviar() no debe
  // bloquear el resto del turno por una recuperación de fondo) -- se cede microtareas de sobra
  // para que su propia cadena fetch -> r.json() -> aplicarConfirmacionEpistemica() termine antes
  // de leer el resultado.
  await flush();

  assert.equal(tarjetaMontada, false, '§7.6: en conflicto de creación no aparece tarjeta -- esta creación en particular nunca se aplicó');
  assert.ok(llamadasGet.length >= 1, 'ante el 409 de creación, se debe recuperar el organismo vigente por el mismo camino autenticado (GET /api/organismos)');

  // Objeto del realm vm -- mismo motivo de siempre en este archivo (ver el otro test de onAccept):
  // deepEqual entre un objeto de otro realm y un literal del realm exterior falla por prototipos
  // distintos aunque la estructura sea idéntica.
  const orgTrasConflicto = JSON.parse(JSON.stringify(vm.runInContext('state.organismo', context)));
  assert.deepEqual(orgTrasConflicto._sv, { version: 4 }, 'org._sv se corrige con la versión real del servidor -- nunca se inventa ni se deja la vieja');
  assert.equal(orgTrasConflicto.registro_epistemico.ledger_version, 3, 'registro_epistemico también se recupera del renglón vigente');
  assert.equal(orgTrasConflicto.nombre, 'Test', '§8: la recuperación aplica sólo version/registro_epistemico/momentos -- nombre no se toca');
  assert.deepEqual(orgTrasConflicto.ficha, {}, '§8: ficha tampoco se toca por una recuperación §7.6');
});

// ---- construirAccionesTarjetaEpistemica() / resolverRevisionEpistemicaServidor() (§7.4/§11) ----
// El componente (lib/sustentacion-card.mjs, congelado) llama a onAccept(recordRef)/onReject(recordRef)
// esperando una promesa: resuelve -> el propio componente transiciona su estado; rechaza -> reactiva
// botones y muestra aviso de reintento, sin tocar el organismo. No se reimplementa esa lógica acá
// (ya la prueba sustentacion-card.test.mjs) -- esto verifica sólo lo que arma enviar-epistemico: el
// body del request, y que aplicarConfirmacionEpistemica() sólo se aplica cuando el servidor confirma.

test('construirAccionesTarjetaEpistemica().onAccept resuelve, aplica SOLO los subárboles devueltos y actualiza _sv', async () => {
  let capturado = null;
  const fetchImpl = async (recurso, opciones) => {
    const url = String((recurso && recurso.url) ? recurso.url : recurso || '');
    if (url.indexOf('/api/organismos') > -1) {
      if (!opciones || !opciones.body) return { ok: true, status: 200, json: async () => ({ organismos: [] }) };
      capturado = JSON.parse(opciones.body);
      return {
        ok: true, status: 200, json: async () => ({
          ok: true, version: 9, state: 'accepted_as_reference',
          registro_epistemico: { schema_version: 'vr1-core-ledger/1.1', ledger_version: 2, entries: [], operations: [], reviews: [], review_events: [] },
          momentos: [{ f: '2026-01-01T00:00:00.000Z', turno: null, tipo: 'revision_epistemica', texto: 'Comprensión candidata aceptada como referencia del organismo.', lectura: null, epistemic_record_ref: 'ER-ACC-1' }],
        }),
      };
    }
    throw new Error('no debería llamar a otra URL');
  };
  const { context, localStorage } = buildContext(fetchImpl, 'staging.comprenderai.com');
  loadCoreScript(context);
  await drenarBarridoArranque(context);
  sembrarSesionYCreditos(localStorage);
  localStorage.setItem('ag_core_organismos', JSON.stringify([{
    id: 'org-acc-1', nombre: 'Test', campo_no_tocar: 'se-mantiene',
    // §8/§7.1: una resolución epistemológica sólo aplica los subárboles devueltos
    // (registro_epistemico, momentos, _sv) -- ficha, diagnóstico, principios y recuerdos deben
    // quedar byte-equivalentes antes/después de la decisión (§18 "Cliente e integración").
    ficha: { funcion: 'orientar', modo: 'M07' }, diagnostico: 'f-orientar', principios: ['p1', 'p2'], recuerdos: [{ id: 'r1', texto: 'x' }],
  }]));

  // El objeto resuelto se construye dentro del contexto vm (realm propio, con sus propios
  // intrínsecos) -- comparar sus objetos anidados con literales del realm exterior vía
  // assert.deepEqual (== deepStrictEqual bajo 'node:assert/strict') falla por prototipos
  // distintos aunque la estructura sea idéntica. Se serializa a través de JSON antes de cruzar
  // la frontera del realm, igual que ya hacen las demás pruebas de esta suite al leer
  // localStorage vía JSON.parse en el lado exterior.
  const resultadoCrudo = await vm.runInContext(`
    (function(){
      var lista = cargarOrganismos();
      var org = lista[0];
      var acciones = construirAccionesTarjetaEpistemica(org);
      return acciones.onAccept('ER-ACC-1').then(function(){
        var listaFinal = cargarOrganismos();
        return {
          orgSv: org._sv, listaSv: listaFinal[0]._sv, campoNoTocar: listaFinal[0].campo_no_tocar,
          orgMomentos: org.momentos, orgRegistro: org.registro_epistemico,
          ficha: listaFinal[0].ficha, diagnostico: listaFinal[0].diagnostico, principios: listaFinal[0].principios, recuerdos: listaFinal[0].recuerdos,
        };
      });
    })()
  `, context);
  const resultado = JSON.parse(JSON.stringify(resultadoCrudo));

  assert.equal(capturado.operacion, 'resolve_epistemic_review');
  assert.equal(capturado.recordRef, 'ER-ACC-1');
  assert.equal(capturado.accion, 'accept_as_reference');
  assert.equal(typeof capturado.idempotency_key, 'string');
  assert.ok(capturado.idempotency_key.length > 0);

  assert.deepEqual(resultado.orgSv, { version: 9 }, 'org._sv se actualiza a la versión confirmada');
  assert.deepEqual(resultado.listaSv, { version: 9 }, 'la entrada persistida en la lista local también se actualiza');
  assert.equal(resultado.campoNoTocar, 'se-mantiene', '§8: sólo se aplican los subárboles devueltos -- ningún otro campo se pisa');
  assert.equal(resultado.orgMomentos.length, 1);
  assert.equal(resultado.orgMomentos[0].tipo, 'revision_epistemica');
  assert.ok(resultado.orgRegistro, 'registro_epistemico también se aplica sobre el organismo en memoria');

  assert.deepEqual(resultado.ficha, { funcion: 'orientar', modo: 'M07' }, '§7.1/§8: la ficha queda byte-equivalente -- una resolución epistemológica nunca la toca');
  assert.equal(resultado.diagnostico, 'f-orientar', 'el diagnóstico tampoco se toca');
  assert.deepEqual(resultado.principios, ['p1', 'p2'], 'los principios tampoco se tocan');
  assert.deepEqual(resultado.recuerdos, [{ id: 'r1', texto: 'x' }], 'los recuerdos tampoco se tocan');
});

test('construirAccionesTarjetaEpistemica().onReject rechaza su promesa si el servidor no confirma, y no toca el organismo', async () => {
  const fetchImpl = async (recurso, opciones) => {
    const url = String((recurso && recurso.url) ? recurso.url : recurso || '');
    if (url.indexOf('/api/organismos') > -1) {
      if (!opciones || !opciones.body) return { ok: true, status: 200, json: async () => ({ organismos: [] }) };
      return { ok: false, status: 409, json: async () => ({ error: { message: 'ya resuelta', codigo: 'revision_ya_resuelta' } }) };
    }
    throw new Error('no debería llamar a otra URL');
  };
  const { context, localStorage } = buildContext(fetchImpl, 'staging.comprenderai.com');
  loadCoreScript(context);
  await drenarBarridoArranque(context);
  sembrarSesionYCreditos(localStorage);
  localStorage.setItem('ag_core_organismos', JSON.stringify([{ id: 'org-rej-1', nombre: 'Test' }]));

  const resultado = await vm.runInContext(`
    (function(){
      var lista = cargarOrganismos();
      var org = lista[0];
      var acciones = construirAccionesTarjetaEpistemica(org);
      return acciones.onReject('ER-REJ-1').then(
        function(){ return { rechazada: false }; },
        function(){ return { rechazada: true, orgSvDespues: org._sv, orgRegistroDespues: org.registro_epistemico }; }
      );
    })()
  `, context);

  assert.equal(resultado.rechazada, true, 'si el servidor no confirma, la promesa que ve la tarjeta debe rechazar (así muestra el aviso de reintento y no transiciona)');
  assert.equal(resultado.orgSvDespues, undefined, 'sin confirmación, no se toca org._sv');
  assert.equal(resultado.orgRegistroDespues, undefined, 'sin confirmación, tampoco se toca registro_epistemico -- la tarjeta conserva su estado previo (§7.6)');
});
