// Corte 122.30 · §7.5 -- prueba de la cola única en la frontera remota
// (encolarSincronizacionOrganismo / sincronizarOrganismoServidor / sincronizarOrganismoServidorAhora,
// todo en index.html).
//
// No repite lo que ya cubre addmotormsg-hook.test.mjs ni vr1-acceptance.test.mjs (banco Core) --
// esto verifica exclusivamente el comportamiento NUEVO introducido por la cola:
//   1. Dos guardados seguidos del mismo organismo despachan sus POST en orden, uno por vez
//      (nunca en paralelo), y cada uno viaja con la foto del organismo tal como estaba EN EL
//      INSTANTE de encolarse -- no una referencia que pueda seguir mutando mientras espera turno.
//   2. Si el primer POST de la cola falla (sin conexión), el segundo igual se despacha después
//      -- la cola nunca queda trabada por un fallo previo.
//   3. Al confirmar version nueva, sólo se actualiza el campo _sv de la entrada ya persistida en
//      la lista local -- nunca se pisa la entrada entera con la foto vieja que viajó en la cola,
//      así no se pierde un cambio más fresco que ya se haya guardado en esa entrada mientras la
//      tarea esperaba turno.
//   4. sincronizarOrganismosConServidor() (el barrido de arranque) sigue las llamadas por el
//      mismo camino -- no quedó ningún despacho directo sin pasar por la cola.
//
// Mismo shim mínimo de DOM/localStorage y misma técnica de extracción del segundo <script>
// inline que ya usan core-bank-runner.mjs y addmotormsg-hook.test.mjs.
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
  querySelector(sel) {
    if (sel === '.lectura') return this.children.find(c => c.className && String(c.className).includes('lectura')) || null;
    return this.children.find(c => true) || null;
  }
  querySelectorAll() { return []; }
  addEventListener() {}
  setAttribute(k, v) { this.attributes[k] = String(v); }
  getAttribute(k) { return this.attributes[k] ?? null; }
  closest() { return null; }
  focus() {} select() {} setSelectionRange() {} click() {} scrollIntoView() {}
}

function buildContext(fetchImpl) {
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
  vm.createContext(context);
  return { context, document, localStorage };
}

function loadCoreScript(context) {
  const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map(m => m[1]);
  vm.runInContext(scripts[1], context, { filename: 'index-core.js', timeout: 30000 });
}

// microtareas suficientes para que se resuelvan las cadenas .then encadenadas por la cola
async function flush(n = 6) { for (let i = 0; i < n; i++) await Promise.resolve(); }

// Espera hasta que `pending` alcance (al menos) `n` elementos, cediendo de a una microtarea por
// vez -- más robusto que un flush() de cantidad fija: la cadena real de sincronizarOrganismoServidorAhora()
// (fetch -> r.json() [async, propia vuelta de microtarea] -> .then de armado -> .then de procesamiento
// de versión -> .catch) tiene más saltos de microtarea en el camino feliz (resolve) que en el camino
// de error (reject corta directo al .catch), así que un conteo fijo que alcanza para uno puede
// quedarse corto para el otro. Tope de 200 vueltas para no colgarse si algo realmente no despacha.
async function waitForPending(pending, n) {
  for (let i = 0; i < 200 && pending.length < n; i++) await Promise.resolve();
  return pending.length;
}

function makeControlledFetch() {
  const pending = [];
  const calls = [];
  const fetchImpl = (url, opts) => new Promise((resolve, reject) => {
    calls.push({ url, body: opts && opts.body ? JSON.parse(opts.body) : null });
    pending.push({ resolve, reject });
  });
  return { fetchImpl, pending, calls };
}

function fakeOkResponse(version) {
  return { ok: true, status: 200, json: async () => ({ version }) };
}

// index.html dispara sincronizarOrganismosConServidor() una sola vez, al final del script
// (línea "sincronizarOrganismosConServidor();   // Corte 0.5"), como parte de la carga normal
// de la página -- no de la cola que estamos probando acá. Eso significa que loadCoreScript()
// por sí solo ya despacha un GET /api/organismos apenas se carga el contexto. Lo resolvemos acá
// (sin resultados, para no disparar ninguna subida de arranque) y reseteamos los arreglos de
// captura, así cada prueba empieza con una foto limpia de lo que ELLA misma despacha.
async function setup() {
  const { fetchImpl, pending, calls } = makeControlledFetch();
  const { context, localStorage } = buildContext(fetchImpl);
  loadCoreScript(context);
  await flush();
  assert.equal(pending.length, 1, 'la carga del script dispara el barrido de arranque (GET /api/organismos) una sola vez');
  pending[0].resolve({ ok: true, status: 200, json: async () => ({ organismos: [] }) });
  await flush();
  pending.length = 0;
  calls.length = 0;
  return { context, localStorage, pending, calls };
}

test('cola · dos guardados seguidos del mismo organismo despachan sus POST en orden, uno por vez, con la foto de cada instante', async () => {
  const { context, pending, calls } = await setup();

  const org = { id: 'org-A', nombre: 'Primero', datos: 1 };
  const p1 = context.sincronizarOrganismoServidor(org);
  // mutamos el organismo (como si el usuario siguiera editando) y encolamos un segundo guardado
  // ANTES de que el primero resuelva -- la cola debe esperar su turno, no despachar en paralelo
  org.nombre = 'Segundo';
  const p2 = context.sincronizarOrganismoServidor(org);

  await flush();
  assert.equal(pending.length, 1, 'sólo se despachó el primer POST; el segundo espera su turno mientras el primero sigue pendiente (nunca en paralelo)');
  assert.equal(calls[0].body.nombre, 'Primero', 'el primer POST viaja con la foto tomada en el instante del primer llamado');

  pending[0].resolve(fakeOkResponse(1));
  await waitForPending(pending, 2);
  assert.equal(pending.length, 2, 'recién al resolver el primero se despacha el segundo POST, en su turno');
  assert.equal(calls[1].body.nombre, 'Segundo', 'el segundo POST viaja con la foto tomada en el instante del segundo llamado (ya mutada), no con una referencia compartida con el primero');

  pending[1].resolve(fakeOkResponse(2));
  await Promise.all([p1, p2]);
  assert.equal(calls.length, 2);
});

test('cola · si el primer POST de la cola falla (sin conexión), el segundo igual se despacha después', async () => {
  const { context, pending, calls } = await setup();

  const org = { id: 'org-B', nombre: 'uno' };
  const p1 = context.sincronizarOrganismoServidor(org);
  const p2 = context.sincronizarOrganismoServidor(org);
  await flush();
  assert.equal(pending.length, 1);

  pending[0].reject(new Error('sin conexión (simulado)'));
  await flush();

  assert.equal(pending.length, 2, 'la cola no queda trabada por el fallo del primer POST -- el segundo se despacha igual');
  pending[1].resolve(fakeOkResponse(9));
  await Promise.all([p1, p2]); // ninguna de las dos promesas debe rechazar -- la cola absorbe el error
  assert.equal(calls.length, 2);
});

test('cola · al confirmar version nueva sólo actualiza _sv en la lista local, sin pisar la entrada entera con la foto vieja', async () => {
  const { context, localStorage, pending } = await setup();

  const org = { id: 'org-C', nombre: 'original', campo_extra: 'valor-original' };
  // la lista local ya tiene una entrada para este organismo -- simulamos que, mientras la tarea
  // de sync espera turno en la cola, otra parte del código ya actualizó esa entrada con un campo
  // más fresco que la foto vieja no debería pisar
  localStorage.setItem('ag_core_organismos', JSON.stringify([
    { id: 'org-C', nombre: 'original', campo_extra: 'valor-MAS-FRESCO-que-la-foto' }
  ]));

  const p = context.sincronizarOrganismoServidor(org);
  await flush();
  pending[0].resolve(fakeOkResponse(7));
  await p;

  const listaFinal = JSON.parse(localStorage.getItem('ag_core_organismos'));
  const entrada = listaFinal.find(o => o.id === 'org-C');
  assert.deepEqual(entrada._sv, { version: 7 }, 'la version confirmada sí se refleja');
  assert.equal(entrada.campo_extra, 'valor-MAS-FRESCO-que-la-foto', 'ningún otro campo de la entrada persistida se pisa con la foto vieja que viajó en la cola -- sólo _sv');
});

test('cola · un guardado genérico exitoso N -> N+1 actualiza _sv.version de inmediato (antes de que la promesa encolada resuelva)', async () => {
  const { context, localStorage, pending, calls } = await setup();
  localStorage.setItem('ag_core_organismos', JSON.stringify([{ id: 'org-F', nombre: 'Original' }]));
  vm.runInContext(`state.organismo = { id: 'org-F', nombre: 'Original' };`, context);

  const org = vm.runInContext('state.organismo', context);
  const p = context.sincronizarOrganismoServidor(org);
  await flush();
  assert.equal(calls[0].body.version_conocida, null, 'primer guardado de este organismo: sin versión previa conocida (ni en la lista ni en el organismo)');
  pending[0].resolve(fakeOkResponse(1));
  await p; // §7.5/CONFLICTOVERSION02: la promesa encolada NO debe resolver hasta que la confirmación ya esté aplicada localmente

  const orgTrasResolver = JSON.parse(JSON.stringify(vm.runInContext('state.organismo', context)));
  assert.deepEqual(orgTrasResolver._sv, { version: 1 }, 'state.organismo._sv ya refleja N+1 apenas resuelve la promesa devuelta, sin esperar a un flush adicional');
  const entrada = JSON.parse(localStorage.getItem('ag_core_organismos')).find(o => o.id === 'org-F');
  assert.deepEqual(entrada._sv, { version: 1 }, 'la entrada persistida también, en el mismo instante');
});

test('cola · dos guardados consecutivos del mismo organismo usan N y luego N+1, sin 409 -- el segundo lee la versión que el primero confirmó, no la que tenía al encolarse', async () => {
  const { context, localStorage, pending, calls } = await setup();
  // el organismo ya tenía una versión confirmada (3) antes de este par de guardados -- mismo
  // punto de partida que "aceptación -> autosave -> Guardar sesión" en la app real.
  localStorage.setItem('ag_core_organismos', JSON.stringify([{ id: 'org-Q', nombre: 'Q', _sv: { version: 3 } }]));
  vm.runInContext(`state.organismo = { id: 'org-Q', nombre: 'Q', _sv: { version: 3 } };`, context);

  const org = vm.runInContext('state.organismo', context);
  const p1 = context.sincronizarOrganismoServidor(org);
  // segundo guardado del MISMO organismo, encolado casi junto con el primero -- como
  // guardarOrganismo() directo seguido de crearCheckpointSesion() dentro de guardarSesion() en
  // la app real. org._sv en memoria sigue siendo {version:3} en este instante -- el primero
  // todavía no respondió.
  vm.runInContext(`state.organismo.checkpoints = { core: [{ fecha: 'x' }] };`, context);
  const p2 = context.sincronizarOrganismoServidor(vm.runInContext('state.organismo', context));

  await flush();
  assert.equal(pending.length, 1, 'sólo se despachó el primero; el segundo espera su turno');
  assert.equal(calls[0].body.version_conocida, 3, 'el primero viaja con la versión confirmada anterior (3)');

  pending[0].resolve(fakeOkResponse(4));
  await waitForPending(pending, 2);
  assert.equal(pending.length, 2, 'recién al resolver el primero se despacha el segundo, en su turno');
  // CONFLICTOVERSION02: ésta es la aserción que antes de la corrección fallaba -- el segundo
  // guardado leía version_conocida=3 (la foto vieja tomada al encolarse) y el servidor real lo
  // rechazaba con 409, perdiendo en silencio el contenido que ese segundo guardado quería
  // persistir (en la app real, el checkpoint de "Guardar sesión"). Ahora debe leer la versión
  // RECIÉN confirmada por el primero, no la que tenía al encolarse.
  assert.equal(calls[1].body.version_conocida, 4, 'el segundo debe leer la versión que el primero ACABA de confirmar (4), no la vieja (3) que tenía al encolarse -- así nunca choca por versión contra el servidor real');
  assert.ok(calls[1].body.datos.checkpoints, 'y su propio contenido (el checkpoint, en este ejemplo) sigue siendo el capturado en SU momento de encolarse -- sólo la versión se difiere hasta el despacho');

  pending[1].resolve(fakeOkResponse(5));
  await Promise.all([p1, p2]);
  const entrada = JSON.parse(localStorage.getItem('ag_core_organismos')).find(o => o.id === 'org-Q');
  assert.deepEqual(entrada._sv, { version: 5 }, 'tras ambos guardados exitosos y encadenados, la versión final es la del último confirmado');
});

test('cola · un 409 real de un guardado genérico (versión ya vieja también en el momento de despachar) sigue sin pisar nada local -- comportamiento preexistente, no degradado por CONFLICTOVERSION02', async () => {
  const { context, localStorage, pending, calls } = await setup();
  localStorage.setItem('ag_core_organismos', JSON.stringify([{ id: 'org-R', nombre: 'R', campo_extra: 'antes', _sv: { version: 2 } }]));
  vm.runInContext(`state.organismo = { id: 'org-R', nombre: 'R', _sv: { version: 2 } };`, context);

  const org = vm.runInContext('state.organismo', context);
  const p = context.sincronizarOrganismoServidor(org);
  await flush();
  assert.equal(calls[0].body.version_conocida, 2);

  // el servidor real ya está más adelante (otra sesión guardó mientras tanto) -- conflicto real,
  // no causado por una foto vieja de ESTA cola.
  pending[0].resolve({ ok: false, status: 409, json: async () => ({ error: { message: 'conflicto', codigo: 'conflicto_version' }, version: 9 }) });
  await p;

  const entrada = JSON.parse(localStorage.getItem('ag_core_organismos')).find(o => o.id === 'org-R');
  assert.deepEqual(entrada._sv, { version: 2 }, '§7.6/comportamiento preexistente: ante un 409 real, no se inventa ni se pisa ninguna versión -- la entrada local sigue exactamente como estaba');
  assert.equal(entrada.campo_extra, 'antes');
});

test('cola · sincronizarOrganismosConServidor() despacha las subidas locales por el mismo camino de la cola', async () => {
  const { context, localStorage, pending, calls } = await setup();

  // organismo local que el servidor todavía no tiene -- sincronizarOrganismosConServidor() debe
  // subirlo llamando a sincronizarOrganismoServidor(), que ahora pasa siempre por la cola
  localStorage.setItem('ag_core_organismos', JSON.stringify([{ id: 'org-D', nombre: 'local-nuevo' }]));

  context.sincronizarOrganismosConServidor();
  await flush();

  // primer fetch: el GET inicial de sincronizarOrganismosConServidor()
  assert.equal(pending.length, 1);
  assert.equal(calls[0].url, '/api/organismos');
  pending[0].resolve({ ok: true, status: 200, json: async () => ({ organismos: [] }) });
  await waitForPending(pending, 2);

  // segundo fetch: el POST de subida de org-D, despachado vía encolarSincronizacionOrganismo
  assert.equal(pending.length, 2, 'sincronizarOrganismosConServidor() debe terminar despachando el POST de subida del organismo local');
  assert.equal(calls[1].body.cliente_id, 'org-D');
  pending[1].resolve(fakeOkResponse(1));
  await flush();
});

// 122.30 · §18 "Cliente e integración": "una sincronización iniciada por
// sincronizarOrganismosConServidor() o window.alConfirmarSesion compite con una operación
// epistemológica del mismo organismo: ambas se ejecutan en orden por la misma cola, sin fetch
// remoto paralelo ni versión perdida". crearCandidatoEpistemicoServidor() y
// resolverRevisionEpistemicaServidor() (§7.5) encolan mediante la MISMA encolarSincronizacionOrganismo()
// que sincronizarOrganismoServidor() -- esta prueba lo verifica con las funciones reales del
// segundo script, no reimplementando la cola.
test('cola · crearCandidatoEpistemicoServidor() comparte la misma cola que sincronizarOrganismoServidor() para el mismo organismo: nunca en paralelo', async () => {
  const { context, pending, calls } = await setup();

  const org = { id: 'org-E', nombre: 'Compite', _sv: { version: 3 } };
  const proposal = { id: 'prop-1', organismo_id: 'org-E', campos: ['funcion'], hito: null, horizonte: null, principios_candidatos: [] };
  const eventRef = { type: 'proposal', id: 'prop-1', organism_id: 'org-E' };

  // primero, un guardado genérico del organismo (como si un guardarOrganismo() previo ya
  // estuviera en vuelo) -- despacha su POST y ocupa la cola de 'org-E'
  const p1 = context.sincronizarOrganismoServidor(org);
  await flush();
  assert.equal(pending.length, 1, 'el primer guardado genérico despacha su POST de inmediato');

  // mientras el primero sigue pendiente, se pide la creación de un candidato epistemológico
  // para el MISMO organismo -- debe esperar su turno, nunca despachar en paralelo
  const p2 = context.crearCandidatoEpistemicoServidor(org, 'TURN-compite-1', eventRef, proposal, 'texto visible');
  await flush();
  assert.equal(pending.length, 1, 'crearCandidatoEpistemicoServidor() no despacha su POST mientras el guardado genérico anterior del mismo organismo sigue pendiente -- comparten la misma cola, nunca en paralelo');

  pending[0].resolve(fakeOkResponse(4));
  await waitForPending(pending, 2);
  assert.equal(pending.length, 2, 'recién al resolver el primero se despacha el POST de creación epistemológica, en su turno');
  assert.equal(calls[1].body.operacion, 'create_epistemic_candidate');
  assert.equal(calls[1].body.cliente_id, 'org-E');

  pending[1].resolve({ ok: true, status: 200, json: async () => ({ ok: true, version: 5, recordRef: 'ER-COMPITE-1', turnRef: 'TURN-compite-1', state: 'review_required', registro_epistemico: {}, presentation: {} }) });
  const [, r2] = await Promise.all([p1, p2]);
  assert.equal(r2.ok, true, 'la creación epistemológica, ya sin contención, confirma normalmente');
  assert.equal(calls.length, 2, 'nunca se despachó un tercer fetch: ningún camino paralelo por fuera de la cola');
});
