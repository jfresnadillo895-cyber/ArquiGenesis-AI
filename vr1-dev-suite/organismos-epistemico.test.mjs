// Pruebas de api/organismos.js -- operaciones epistemológicas 122.30 (§18 "Servidor").
//
// Mock mínimo de Supabase vía fetch global (mismo criterio de todo el proyecto: sin
// dependencias nuevas). El handler real se importa y se ejecuta tal cual -- no se
// reimplementa su lógica acá.

import test from 'node:test';
import assert from 'node:assert/strict';

process.env.SUPABASE_URL = 'https://fake.supabase.test';
process.env.SUPABASE_SECRET_KEY = 'fake-service-key';

const TOKEN_VALIDO = 'tok-actor-1';
const PERFIL = 'actor-uuid-1';
const TOKEN_VALIDO_2 = 'tok-actor-2';
const PERFIL_2 = 'actor-uuid-2';

function makeFakeSupabase(initialRows = []) {
  // clave: perfil + '|' + cliente_id
  const rows = new Map();
  for (const row of initialRows) rows.set(row.perfil + '|' + row.cliente_id, { ...row });
  const log = [];

  async function fetchMock(url, opts = {}) {
    log.push({ url, opts });
    const u = new URL(url);
    if (u.pathname === '/auth/v1/user') {
      const auth = (opts.headers && opts.headers.Authorization) || '';
      const token = auth.replace(/^Bearer /, '');
      if (token === TOKEN_VALIDO) return jsonResponse(200, { id: PERFIL });
      if (token === TOKEN_VALIDO_2) return jsonResponse(200, { id: PERFIL_2 });
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
      return jsonResponse(200, lista);
    }
    throw new Error('ruta no simulada: ' + url);
  }

  function jsonResponse(status, body) {
    return { ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) };
  }

  return { fetchMock, rows, log };
}

function makeRes() {
  const res = { _status: null, _body: null, _headers: {} };
  res.status = (s) => { res._status = s; return res; };
  res.json = (b) => { res._body = b; return res; };
  res.setHeader = (k, v) => { res._headers[k] = v; };
  return res;
}

async function importHandlerWithFetch(fetchMock) {
  const realFetch = globalThis.fetch;
  globalThis.fetch = fetchMock;
  const mod = await import('../api/organismos.js?test=' + Date.now() + Math.random());
  globalThis.fetch = realFetch;
  return mod.default;
}

const ELIGIBLE_PROPOSAL = (organismoId) => ({ id: 'p_1_abc', organismo_id: organismoId, campos: ['uso_predominante'], hito: null, horizonte: null, principios_candidatos: [] });

function baseReq({ method = 'POST', body, token = TOKEN_VALIDO } = {}) {
  return { method, body, headers: { authorization: 'Bearer ' + token }, query: {} };
}

test('POST sin operacion conserva el contrato histórico byte-equivalente (guarda y devuelve {ok,id,version})', async () => {
  const { fetchMock, rows } = makeFakeSupabase();
  // fetch usado también dentro de fetchMock -- pero acá el propio handler llama a fetch
  // global, que reemplazamos temporalmente durante el import Y durante la llamada.
  const handler = await importHandlerWithFetch(fetchMock);
  const realFetch = globalThis.fetch;
  globalThis.fetch = fetchMock;
  try {
    const req = baseReq({ body: { cliente_id: 'org-hist-1', datos: { ficha: { uso: 'residencial' } } } });
    const res = makeRes();
    await handler(req, res);
    assert.equal(res._status, 200);
    assert.equal(res._body.ok, true);
    assert.equal(res._body.version, 1);
    assert.equal(rows.get(PERFIL + '|org-hist-1').datos.ficha.uso, 'residencial');
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('operacion desconocida devuelve 400 operacion_no_permitida', async () => {
  const { fetchMock } = makeFakeSupabase();
  const handler = await importHandlerWithFetch(fetchMock);
  const realFetch = globalThis.fetch;
  globalThis.fetch = fetchMock;
  try {
    const req = baseReq({ body: { operacion: 'algo_inventado', cliente_id: 'org-x' } });
    const res = makeRes();
    await handler(req, res);
    assert.equal(res._status, 400);
    assert.equal(res._body.error.codigo, 'operacion_no_permitida');
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('sin sesión (sin token) responde 401 antes de evaluar cualquier operación', async () => {
  const { fetchMock } = makeFakeSupabase();
  const handler = await importHandlerWithFetch(fetchMock);
  const realFetch = globalThis.fetch;
  globalThis.fetch = fetchMock;
  try {
    const req = { method: 'POST', body: { operacion: 'create_epistemic_candidate' }, headers: {}, query: {} };
    const res = makeRes();
    await handler(req, res);
    assert.equal(res._status, 401);
  } finally {
    globalThis.fetch = realFetch;
  }
});

async function crearOrganismoBase(handler, fetchMock, clienteId = 'org-1', perfil = PERFIL, token = TOKEN_VALIDO) {
  const realFetch = globalThis.fetch;
  globalThis.fetch = fetchMock;
  try {
    const req = baseReq({ body: { cliente_id: clienteId, datos: { ficha: {}, principios: [], momentos: [] } }, token });
    const res = makeRes();
    await handler(req, res);
    return res._body; // { ok, id, version }
  } finally {
    globalThis.fetch = realFetch;
  }
}

async function crearCandidato(handler, fetchMock, { clienteId = 'org-1', versionConocida = 1, token = TOKEN_VALIDO, turnRef = 'TURN-abc123', idempotencyKey = 'idem-1', proposal } = {}) {
  const realFetch = globalThis.fetch;
  globalThis.fetch = fetchMock;
  try {
    const prop = proposal || ELIGIBLE_PROPOSAL(clienteId);
    const req = baseReq({
      body: {
        operacion: 'create_epistemic_candidate', cliente_id: clienteId, version_conocida: versionConocida,
        turnRef, eventRef: { type: 'proposal', id: prop.id, organism_id: clienteId },
        idempotency_key: idempotencyKey, candidate: { proposal: prop, visibleText: 'Texto visible de la respuesta.' },
      }, token,
    });
    const res = makeRes();
    await handler(req, res);
    return res;
  } finally {
    globalThis.fetch = realFetch;
  }
}

test('create_epistemic_candidate: creación autenticada exitosa, devuelve presentation review_required y no toca ficha/principios', async () => {
  const { fetchMock, rows } = makeFakeSupabase();
  const handler = await importHandlerWithFetch(fetchMock);
  const creado = await crearOrganismoBase(handler, fetchMock);
  assert.equal(creado.ok, true);

  const res = await crearCandidato(handler, fetchMock, { versionConocida: creado.version });
  assert.equal(res._status, 200, JSON.stringify(res._body));
  assert.equal(res._body.state, 'review_required');
  assert.match(res._body.recordRef, /^ER-[0-9A-F-]{36}$/);
  assert.equal(res._body.presentation.state, 'review_required');
  assert.equal(res._body.presentation.recordRef, res._body.recordRef);

  const fila = rows.get(PERFIL + '|org-1');
  assert.deepStrictEqual(fila.datos.ficha, {}); // ficha sin tocar
  assert.deepStrictEqual(fila.datos.principios, []); // principios sin tocar
  assert.equal(fila.datos.registro_epistemico.entries.length, 1);
});

test('create_epistemic_candidate: candidato no elegible (propuesta vacía) falla con 400 sin escribir nada', async () => {
  const { fetchMock, rows } = makeFakeSupabase();
  const handler = await importHandlerWithFetch(fetchMock);
  const creado = await crearOrganismoBase(handler, fetchMock);
  const propuestaVacia = { id: 'p_vacia', organismo_id: 'org-1', campos: [], hito: null, horizonte: null, principios_candidatos: [] };
  const res = await crearCandidato(handler, fetchMock, { versionConocida: creado.version, proposal: propuestaVacia });
  assert.equal(res._status, 400);
  assert.equal(res._body.error.codigo, 'candidato_no_elegible');
  assert.equal(rows.get(PERFIL + '|org-1').datos.registro_epistemico, undefined);
});

test('create_epistemic_candidate: eventRef inconsistente (organismo_id no coincide) falla cerrado', async () => {
  const { fetchMock } = makeFakeSupabase();
  const handler = await importHandlerWithFetch(fetchMock);
  const creado = await crearOrganismoBase(handler, fetchMock);
  const propuestaOtroOrganismo = { id: 'p_otro', organismo_id: 'otro-organismo', campos: ['uso'], hito: null, horizonte: null, principios_candidatos: [] };
  const res = await crearCandidato(handler, fetchMock, { versionConocida: creado.version, proposal: propuestaOtroOrganismo });
  assert.equal(res._status, 400);
  assert.equal(res._body.error.codigo, 'event_ref_invalido');
});

test('create_epistemic_candidate: conflicto de versión devuelve 409 sin escribir', async () => {
  const { fetchMock } = makeFakeSupabase();
  const handler = await importHandlerWithFetch(fetchMock);
  const creado = await crearOrganismoBase(handler, fetchMock);
  const res = await crearCandidato(handler, fetchMock, { versionConocida: creado.version + 5 });
  assert.equal(res._status, 409);
  assert.equal(res._body.error.codigo, 'conflicto_version');
});

test('create_epistemic_candidate: organismo inexistente devuelve 404', async () => {
  const { fetchMock } = makeFakeSupabase();
  const handler = await importHandlerWithFetch(fetchMock);
  const res = await crearCandidato(handler, fetchMock, { clienteId: 'no-existe', versionConocida: 1 });
  assert.equal(res._status, 404);
});

test('create_epistemic_candidate: payload sobredimensionado (visibleText enorme) falla con 400', async () => {
  const { fetchMock } = makeFakeSupabase();
  const handler = await importHandlerWithFetch(fetchMock);
  const creado = await crearOrganismoBase(handler, fetchMock);
  const realFetch = globalThis.fetch;
  globalThis.fetch = fetchMock;
  try {
    const prop = ELIGIBLE_PROPOSAL('org-1');
    const req = baseReq({ body: { operacion: 'create_epistemic_candidate', cliente_id: 'org-1', version_conocida: creado.version, turnRef: 'TURN-abc', eventRef: { type: 'proposal', id: prop.id, organism_id: 'org-1' }, idempotency_key: 'idem-x', candidate: { proposal: prop, visibleText: 'x'.repeat(10000) } } });
    const res = makeRes();
    await handler(req, res);
    assert.equal(res._status, 400);
    assert.equal(res._body.error.codigo, 'payload_invalido');
  } finally { globalThis.fetch = realFetch; }
});

test('create_epistemic_candidate: propiedad desconocida en el body es rechazada (400)', async () => {
  const { fetchMock } = makeFakeSupabase();
  const handler = await importHandlerWithFetch(fetchMock);
  const creado = await crearOrganismoBase(handler, fetchMock);
  const realFetch = globalThis.fetch;
  globalThis.fetch = fetchMock;
  try {
    const prop = ELIGIBLE_PROPOSAL('org-1');
    const req = baseReq({ body: { operacion: 'create_epistemic_candidate', cliente_id: 'org-1', version_conocida: creado.version, turnRef: 'TURN-abc123', eventRef: { type: 'proposal', id: prop.id, organism_id: 'org-1' }, idempotency_key: 'idem-y', candidate: { proposal: prop, visibleText: 'texto' }, actorId: 'intento-de-suplantar' } });
    const res = makeRes();
    await handler(req, res);
    assert.equal(res._status, 400);
    assert.equal(res._body.error.codigo, 'payload_invalido');
  } finally { globalThis.fetch = realFetch; }
});

async function resolverRevision(handler, fetchMock, { clienteId = 'org-1', recordRef, accion = 'accept_as_reference', versionConocida, idempotencyKey = 'resolve-1', token = TOKEN_VALIDO } = {}) {
  const realFetch = globalThis.fetch;
  globalThis.fetch = fetchMock;
  try {
    const req = baseReq({ body: { operacion: 'resolve_epistemic_review', cliente_id: clienteId, recordRef, accion, version_conocida: versionConocida, idempotency_key: idempotencyKey }, token });
    const res = makeRes();
    await handler(req, res);
    return res;
  } finally { globalThis.fetch = realFetch; }
}

test('resolve_epistemic_review: aceptar como referencia persiste el momento y deja ficha/principios intactos', async () => {
  const { fetchMock, rows } = makeFakeSupabase();
  const handler = await importHandlerWithFetch(fetchMock);
  const creado = await crearOrganismoBase(handler, fetchMock);
  const creadoRes = await crearCandidato(handler, fetchMock, { versionConocida: creado.version });
  const recordRef = creadoRes._body.recordRef;
  const versionTrasCandidato = creadoRes._body.version;

  const res = await resolverRevision(handler, fetchMock, { recordRef, accion: 'accept_as_reference', versionConocida: versionTrasCandidato });
  assert.equal(res._status, 200, JSON.stringify(res._body));
  assert.equal(res._body.state, 'accepted_as_reference');
  assert.equal(res._body.momentos.length, 1);
  assert.equal(res._body.momentos[0].tipo, 'revision_epistemica');
  assert.equal(res._body.momentos[0].epistemic_record_ref, recordRef);
  assert.equal(res._body.momentos[0].lectura, null);

  const fila = rows.get(PERFIL + '|org-1');
  assert.deepStrictEqual(fila.datos.ficha, {});
  assert.deepStrictEqual(fila.datos.principios, []);
});

test('resolve_epistemic_review: rechazar conserva el registro (no lo borra) y dice rejected_as_reference en la vista', async () => {
  const { fetchMock } = makeFakeSupabase();
  const handler = await importHandlerWithFetch(fetchMock);
  const creado = await crearOrganismoBase(handler, fetchMock);
  const creadoRes = await crearCandidato(handler, fetchMock, { versionConocida: creado.version });
  const recordRef = creadoRes._body.recordRef;

  const res = await resolverRevision(handler, fetchMock, { recordRef, accion: 'reject', versionConocida: creadoRes._body.version });
  assert.equal(res._status, 200);
  assert.equal(res._body.state, 'rejected');
  assert.equal(res._body.registro_epistemico.entries.length, 1); // el resultado candidato sigue ahí
});

test('resolve_epistemic_review: una revisión ya resuelta con decisión distinta y clave nueva devuelve 409, sin reescritura', async () => {
  const { fetchMock } = makeFakeSupabase();
  const handler = await importHandlerWithFetch(fetchMock);
  const creado = await crearOrganismoBase(handler, fetchMock);
  const creadoRes = await crearCandidato(handler, fetchMock, { versionConocida: creado.version });
  const recordRef = creadoRes._body.recordRef;

  const first = await resolverRevision(handler, fetchMock, { recordRef, accion: 'accept_as_reference', versionConocida: creadoRes._body.version, idempotencyKey: 'resolve-a' });
  assert.equal(first._status, 200);
  const second = await resolverRevision(handler, fetchMock, { recordRef, accion: 'reject', versionConocida: first._body.version, idempotencyKey: 'resolve-b' });
  assert.equal(second._status, 409);
  assert.equal(second._body.error.codigo, 'revision_ya_resuelta');
});

test('resolve_epistemic_review: recordRef inexistente para este organismo devuelve 404', async () => {
  const { fetchMock } = makeFakeSupabase();
  const handler = await importHandlerWithFetch(fetchMock);
  const creado = await crearOrganismoBase(handler, fetchMock);
  const res = await resolverRevision(handler, fetchMock, { recordRef: 'ER-' + 'A'.repeat(8) + '-' + 'A'.repeat(4) + '-' + 'A'.repeat(4) + '-' + 'A'.repeat(4) + '-' + 'A'.repeat(12), versionConocida: creado.version });
  assert.equal(res._status, 404);
});

test('dos usuarios y dos organismos: el organismo del actor 2 no puede resolverse con la sesión del actor 1', async () => {
  const { fetchMock } = makeFakeSupabase();
  const handler = await importHandlerWithFetch(fetchMock);
  const creadoActor2 = await crearOrganismoBase(handler, fetchMock, 'org-de-actor-2', PERFIL_2, TOKEN_VALIDO_2);
  assert.equal(creadoActor2.ok, true);
  // El actor 1 intenta crear un candidato sobre el organismo del actor 2 -- no existe para SU
  // perfil (la fila está scoped por perfil+cliente_id), así que responde 404, nunca lo toca.
  const res = await crearCandidato(handler, fetchMock, { clienteId: 'org-de-actor-2', versionConocida: creadoActor2.version, token: TOKEN_VALIDO });
  assert.equal(res._status, 404);
});

test('no hay filtración de datos sensibles en los logs (console.log): ni recordRef completo ni idempotency_key completo', async () => {
  const { fetchMock } = makeFakeSupabase();
  const handler = await importHandlerWithFetch(fetchMock);
  const creado = await crearOrganismoBase(handler, fetchMock);

  const originalLog = console.log;
  const captured = [];
  console.log = (...args) => { captured.push(args.join(' ')); };
  let recordRef;
  try {
    const res = await crearCandidato(handler, fetchMock, { versionConocida: creado.version, idempotencyKey: 'idempotency-key-secreta-larga-0123456789' });
    recordRef = res._body.recordRef;
  } finally {
    console.log = originalLog;
  }
  const joined = captured.join('\n');
  assert.doesNotMatch(joined, /idempotency-key-secreta-larga-0123456789/);
  if (recordRef) assert.doesNotMatch(joined, new RegExp(recordRef.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});
