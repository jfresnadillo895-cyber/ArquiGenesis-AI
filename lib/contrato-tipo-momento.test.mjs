// Corte 122.30 · §12 -- "El valor se declara también como constante nominada en el handler y una
// prueba de contrato impide que cliente y servidor diverjan silenciosamente." Prueba mínima,
// puramente textual (no requiere cargar ninguno de los dos scripts completos): confirma que la
// constante TIPO_MOMENTO_REVISION_EPISTEMICA tiene el mismo valor literal en index.html
// (cliente, sólo para renderizar el Recorrido) y en api/organismos.js (servidor, el único que
// realmente la escribe en un momento).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('TIPO_MOMENTO_REVISION_EPISTEMICA · mismo valor literal en index.html y en api/organismos.js', () => {
  const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const server = fs.readFileSync(new URL('../api/organismos.js', import.meta.url), 'utf8');

  const reCliente = /var TIPO_MOMENTO_REVISION_EPISTEMICA\s*=\s*'([^']+)'/;
  const reServidor = /const TIPO_MOMENTO_REVISION_EPISTEMICA\s*=\s*'([^']+)'/;

  const mCliente = html.match(reCliente);
  const mServidor = server.match(reServidor);

  assert.ok(mCliente, 'index.html debe declarar var TIPO_MOMENTO_REVISION_EPISTEMICA = \'...\'');
  assert.ok(mServidor, 'api/organismos.js debe declarar const TIPO_MOMENTO_REVISION_EPISTEMICA = \'...\'');
  assert.equal(mCliente[1], mServidor[1], 'el valor literal debe coincidir EXACTO entre cliente y servidor');
  assert.equal(mCliente[1], 'revision_epistemica');

  // También se verifica que el cliente registre una etiqueta humana para ese tipo en TIPO_MOMENTO
  // (si no, el Recorrido renderizaría "undefined" para cualquier momento de este tipo ya persistido).
  assert.match(html, /TIPO_MOMENTO\[TIPO_MOMENTO_REVISION_EPISTEMICA\]\s*=\s*'[^']+'/);
});
