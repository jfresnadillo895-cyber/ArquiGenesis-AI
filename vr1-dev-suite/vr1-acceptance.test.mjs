// Suite de aceptación del corte final para integración en main (sucesora directa de la
// suite de aceptación de VR1SBCORR01). Reemplaza, dentro del criterio de aceptación de VR-1,
// al test heredado del paquete original ("regresión Core · sandbox recupera P6/P9 sin
// introducir fallos nuevos") que exigía passed===713 y 21 casos recuperados -- ese número
// sólo es válido si se aplica también VR1-SB-LEGACY-01, que Javier dejó explícitamente
// diferido y, para este corte final, EXCLUIDO POR COMPLETO del árbol que entra a main (decisión
// del 2026-09-07: "excluir completamente el parche legacy opcional"). Por eso, a diferencia de
// la versión usada en VR1SBCORR01/staging, esta versión YA NO comprueba que el archivo
// `VR1-SB-LEGACY-01_opcional_no_aplicado.diff` exista en el repositorio -- ese archivo, y la
// suite informativa que lo ejercita (legacy-patch-optional.test.mjs), quedan deliberadamente
// fuera de este corte; ambos siguen disponibles fuera del árbol de main para cuando Javier
// decida evaluarlos por separado.
//
// Este archivo verifica exactamente lo que Javier pidió para poder dar por cerrado el corte:
//   1. los guards legacy permanecen intactos;
//   2. el parche opcional (VR1-SB-LEGACY-01) no fue aplicado ni está presente en este corte;
//   3. el banco Core conserva 692/720;
//   4. no aparecen fallos nuevos frente al baseline conocido.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCoreBankFromHtml } from './core-bank-runner.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const INDEX_PATH = path.join(HERE, '..', 'index.html');
const html = fs.readFileSync(INDEX_PATH, 'utf8');

// Mismos 28 nombres de caso que fallaban en el baseline real (index.html vigente, sin VR-1),
// verificados de forma independiente en el diagnóstico VR1SBCORR01 corriendo el banco Core
// contra el index.html real del repositorio antes de este corte. Lista congelada acá para que
// esta prueba sea autocontenida (no depende de un archivo de resultados aparte).
const KNOWN_BASELINE_FAILURES = new Set([
  'P6-03 · detalle pertinente enterrado en dimensiones (no en resumen) -> recuperado',
  'P6-04 · detalle pertinente dentro de diagnosticos_pro[].datos -> recuperado',
  'P6-05 · evaluación antigua pertinente gana a evaluación nueva irrelevante',
  'P6-06 · máximo de candidatos respetado',
  'P6-07b · el fragmento largo queda acotado dentro del bloque final (integración)',
  'P6-08 · máximo total del bloque -- corta candidatos si el acumulado se pasa del presupuesto',
  'P6-13 · buildSystem() agrega el bloque cuando hay detalle pertinente',
  'P6-14 · orden: ORGANISMO ACTIVO antes que INTERPRETACIONES ESPECIALIZADAS',
  'P6-15 · cuando también hay Recuerdos: ESPECIALIZADAS antes que RECUERDOS PREVIOS',
  'P6-16 · contradicción entre Memoria vigente y especialidad: ambas presentes, Memoria primero',
  'IMP·2 · ejecutarImportForzado avisa si el origen no coincide, y aplica directo si coincide',
  'M11-08 · orden: ORGANISMO ACTIVO < CONTINUIDAD TEMPORAL < INTERPRETACIONES ESPECIALIZADAS < RECUERDOS PREVIOS cuando todos existen',
  'M13-06 · mismo id/path no aparece duplicado en la salida de fragmentosEspecializadosDelOrganismo()',
  'M13-07 · el caso real evaluaciones_negocio_pro[].datos.evaluacion.dimensiones[] no duplica dimensiones',
  'M13-08 · bloqueEspecialidadesParaContexto() usa tres fragmentos DIFERENTES en vez de gastar lugares en duplicados',
  'P9-03 · fragmento de Negocios Pro pertinente llega a la ventana de OPEN (Caso A del brief)',
  'P9-04 · fragmento de Urban Pro pertinente llega a la ventana de OPEN (Caso C del brief)',
  'P9-08 · no se serializa el payload completo (evaluación/diagnóstico) en el prompt de OPEN',
  'P9-09 · el prompt marca expresamente que la interpretación especializada no es evidencia del Campo',
  'P9-10 · ref "especialidad:<id-ofrecido>" sobrevive el parser',
  'P9-13 · el prompt exige un estado proporcional cuando una candidata depende sólo de una especialidad',
  'P9-14 · Memoria vigente y una interpretación especializada contradictoria conviven en el prompt (Caso D)',
  'NEG·8 · sólo un cartel de propuesta a la vez en el hilo',
  'NEG·9 · el cierre de negocio pinta su panel con las seis dimensiones',
  'NEG·10 · el borrador restaura el hilo en curso al reabrir',
  'DERIV·1 · la derivación ofrece un botón directo al módulo',
  'DERIV·2 · la tarjeta interna ofrece los otros modos y excluye el actual',
  'C11 · sólo se ofrecen los módulos que tienen archivo'
]);

test('sandbox · index.html declara el contrato VR-1 y los dos scripts del ensayo', () => {
  assert.match(html, /__VR1_CORE_SANDBOX_CONTRACT__/);
  assert.match(html, /vr1\/pilot-fixtures\.js/);
  assert.match(html, /vr1-core-sandbox-bridge\.mjs/);
  assert.match(html, /directFichaWrite: false/);
});

test('guards legacy · permanecen intactos (VR1-SB-LEGACY-01 no aplicado)', () => {
  assert.match(
    html,
    /if\(entry\.origen === 'urban_pro' && typeof retp601FuenteActivaParaProductor === 'function' && retp601FuenteActivaParaProductor\('urbanism'\) === 'specialty_return'\) return;/,
    'el guard de antecedentes urban_pro debe seguir presente sin modificar'
  );
  assert.match(
    html,
    /if\(typeof retp601FuenteActivaParaProductor !== 'function' \|\| retp601FuenteActivaParaProductor\('business'\) !== 'specialty_return'\)\{/,
    'el guard de antecedentes de negocio debe seguir presente sin modificar'
  );
  assert.doesNotMatch(html, /VR1-SB-LEGACY-01/, 'el marcador del parche legacy no debe aparecer en index.html: no fue aplicado en este corte');
});

test('parche opcional · queda completamente excluido de este corte (no viaja a main)', () => {
  // A diferencia de VR1SBCORR01/staging, el corte final para main NO incluye el .diff separado
  // ni la suite informativa que lo ejercita -- Javier pidió excluir el parche legacy por
  // completo de lo que entra a main (decisión del 2026-09-07). Se comprueba la ausencia en vez
  // de la presencia.
  const legacyDiffPath = path.join(HERE, '..', 'VR1-SB-LEGACY-01_opcional_no_aplicado.diff');
  const legacyTestPath = path.join(HERE, 'legacy-patch-optional.test.mjs');
  assert.equal(fs.existsSync(legacyDiffPath), false, 'el parche opcional no debe estar presente en el árbol de este corte');
  assert.equal(fs.existsSync(legacyTestPath), false, 'la suite informativa del parche opcional no debe estar presente en el árbol de este corte');
});

test('banco Core · conserva 692/720 sobre el index.html vigente (VR-1 sin VR1-SB-LEGACY-01)', () => {
  const result = runCoreBankFromHtml(html);
  assert.equal(result.total, 720);
  assert.equal(result.passed, 692, 'con el parche legacy diferido, el banco debe coincidir con el baseline: nada nuevo se recupera todavía, y tampoco debe empeorar');
});

test('banco Core · cero fallos nuevos frente al baseline conocido', () => {
  const result = runCoreBankFromHtml(html);
  const failedSet = new Set(result.failed);
  const nuevos = result.failed.filter(name => !KNOWN_BASELINE_FAILURES.has(name));
  assert.deepEqual(nuevos, [], 'no debe haber ningún caso que falle en este corte y no fallara ya antes de VR-1');
  // Y, ya que estamos, que el conjunto sea EXACTAMENTE el baseline conocido (ni de más ni de menos):
  // confirma que este corte no "arregla" nada por accidente que debería seguir abierto a propósito
  // (los 21 P6/P9 siguen fallando acá porque el fix que los resuelve está diferido).
  assert.equal(failedSet.size, KNOWN_BASELINE_FAILURES.size);
  for (const name of KNOWN_BASELINE_FAILURES) assert.ok(failedSet.has(name), `caso esperado del baseline ausente: ${name}`);
});
