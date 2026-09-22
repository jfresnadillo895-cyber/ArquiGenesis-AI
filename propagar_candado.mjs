#!/usr/bin/env node
/*
 * propagar_candado.mjs — propagador controlado del bloque ComprenderCanal (corte M1-U)
 * =====================================================================================
 *
 * QUÉ ES: la herramienta que dejó resuelta, para este único bloque, la deuda operativa de
 * `gen_deploy.py` ausente (ver 211-AG-M1U_DETENIDO_INFORME.md). NO es un reemplazo de
 * `gen_deploy.py`: ese generador seguiría faltando para inyectar `candado.txt` COMPLETO (sesión,
 * planes, recuperación, etc.) en una copia nueva. Esta herramienta está acotada, a propósito, al
 * bloque `ComprenderCanal.esAndroidTwa()` que agregó M1-U -- el mismo propagador ad hoc que se usó
 * durante ese corte, ahora con nombre, uso documentado y guardado en la carpeta real.
 *
 * QUÉ HACE:
 *   1. Toma `candado.txt` como fuente única de verdad: extrae de ahí el bloque
 *      `var ComprenderCanal = (function(){ ... })();` (con un contador de llaves, no con un
 *      patrón de texto frágil).
 *   2. Lo propaga a los CUATRO HTML vivos: index.html, urbanismo.html, negocios.html,
 *      contextos.html. Si el archivo ya tiene un bloque ComprenderCanal (de una corrida
 *      anterior), lo reemplaza entero; si todavía no lo tiene, lo inserta justo después del
 *      cierre del candado inyectado (`})();` antes de `</script><script>`).
 *   3. NO toca `software_urbanismo.html` ni `software_contextos.html` -- no están en la lista de
 *      destinos y el script nunca los abre. Son placeholders sin inyección real de candado.txt,
 *      confirmado en 211-AG-M1U_PLAN_PROPUESTO.md §0; no son parte de lo desplegado.
 *   4. Verifica TODAS las anclas de los 5 lugares (candado.txt + los 4 HTML) ANTES de escribir
 *      nada. Si falta una sola, no escribe en ningún archivo -- todo o nada.
 *   5. Al terminar de aplicar, vuelve a leer los 5 archivos y confirma por hash que el bloque
 *      quedó byte-idéntico en los cinco.
 *
 * USO:
 *   node propagar_candado.mjs             (= --check) modo verificación: no escribe nada.
 *   node propagar_candado.mjs --check     idéntico, explícito.
 *   node propagar_candado.mjs --apply     aplica los cambios pendientes (si las anclas cierran)
 *                                         y verifica el resultado.
 *
 * CÓDIGO DE SALIDA: 0 si, al terminar la corrida, los 5 lugares quedan sincronizados entre sí.
 *   1 si falta una ancla (no se pudo ni verificar) o, en --check, si hay diffs pendientes de
 *   aplicar con --apply.
 *
 * Este script vive en la carpeta real del proyecto y sólo toca los 5 archivos listados arriba.
 * No hace push, no hace deploy, no toca `api/anthropic.js`, `vercel.json`, backend ni créditos.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.dirname(fileURLToPath(import.meta.url));
const FUENTE = 'candado.txt';
const DESTINOS = ['index.html', 'urbanismo.html', 'negocios.html', 'contextos.html'];
// Placeholders deliberadamente excluidos -- nunca deben aparecer en DESTINOS:
const PLACEHOLDERS_EXCLUIDOS = ['software_urbanismo.html', 'software_contextos.html'];
for (const p of PLACEHOLDERS_EXCLUIDOS) {
  if (DESTINOS.includes(p)) throw new Error('Error de configuración: ' + p + ' no debe estar en DESTINOS.');
}

const START_MARK = 'var ComprenderCanal = (function(){';
const ANCLA_SIN_PROPAGAR = '})();\n</script>\n<script>';

function sha256(texto) {
  return createHash('sha256').update(texto, 'utf8').digest('hex');
}

// Extrae 'var ComprenderCanal = (function(){ ... })();' contando llaves (no un patrón frágil de
// texto), para tolerar que el cuerpo del bloque cambie de forma en el futuro.
function extraerBloqueComprenderCanal(src) {
  const i = src.indexOf(START_MARK);
  if (i === -1) return null;
  let depth = 1; // la '{' de "(function(){" ya está contada en START_MARK
  let j = i + START_MARK.length;
  while (j < src.length && depth > 0) {
    const c = src[j];
    if (c === '{') depth++;
    else if (c === '}') depth--;
    j++;
  }
  if (depth !== 0) return null; // no balanceado -- no confiar, tratar como ancla ausente
  const cierre = src.slice(j, j + 4);
  if (cierre !== ')();') return null;
  const fin = j + 4;
  return { texto: src.slice(i, fin), inicio: i, fin };
}

function contarOcurrencias(src, sub) {
  let n = 0, pos = 0;
  while (true) {
    const k = src.indexOf(sub, pos);
    if (k === -1) break;
    n++;
    pos = k + 1;
  }
  return n;
}

// Diff simple, línea por línea, con contexto -- suficiente para un reemplazo de bloque contiguo,
// no pretende ser un algoritmo LCS general.
function diffLineas(antes, despues, etiqueta) {
  const a = antes.split('\n');
  const b = despues.split('\n');
  let ini = 0;
  while (ini < a.length && ini < b.length && a[ini] === b[ini]) ini++;
  let finA = a.length - 1, finB = b.length - 1;
  while (finA >= ini && finB >= ini && a[finA] === b[finB]) { finA--; finB--; }
  const CTX = 2;
  const ctxIni = Math.max(0, ini - CTX);
  const ctxFinA = Math.min(a.length - 1, finA + CTX);
  const out = [];
  out.push('--- ' + etiqueta + ' (antes)');
  out.push('+++ ' + etiqueta + ' (despues)');
  for (let k = ctxIni; k < ini; k++) out.push(' ' + a[k]);
  for (let k = ini; k <= finA; k++) out.push('-' + a[k]);
  for (let k = ini; k <= finB; k++) out.push('+' + b[k]);
  for (let k = finA + 1; k <= ctxFinA; k++) out.push(' ' + a[k]);
  return out.join('\n');
}

function resolverAncla(nombreArchivo, src) {
  const bloqueExistente = extraerBloqueComprenderCanal(src);
  if (bloqueExistente) {
    return { archivo: nombreArchivo, modo: 'reemplazar', ancla: bloqueExistente, error: null };
  }
  const nOcurrencias = contarOcurrencias(src, ANCLA_SIN_PROPAGAR);
  if (nOcurrencias === 1) {
    const idx = src.indexOf(ANCLA_SIN_PROPAGAR);
    return { archivo: nombreArchivo, modo: 'insertar', ancla: { inicio: idx + '})();'.length, fin: idx + '})();'.length }, error: null };
  }
  if (nOcurrencias === 0) {
    return { archivo: nombreArchivo, modo: null, ancla: null, error: 'no se encontró ni un bloque ComprenderCanal existente ni el ancla de candado sin propagar ("})();\\n</script>\\n<script>")' };
  }
  return { archivo: nombreArchivo, modo: null, ancla: null, error: 'el ancla de candado sin propagar aparece ' + nOcurrencias + ' veces (se esperaba 1) -- ambiguo, no se toca' };
}

function aplicarResolucion(src, resolucion, bloqueNuevo) {
  if (resolucion.modo === 'reemplazar') {
    return src.slice(0, resolucion.ancla.inicio) + bloqueNuevo + src.slice(resolucion.ancla.fin);
  }
  // insertar: justo después de '})();' del candado, antes de '\n</script>\n<script>'
  return src.slice(0, resolucion.ancla.inicio) + '\n' + bloqueNuevo + src.slice(resolucion.ancla.fin);
}

function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const check = args.includes('--check') || !apply;

  console.log('=== propagar_candado.mjs --', apply ? 'APLICAR' : 'VERIFICACION (sin escribir)', '===');
  console.log('Fuente:', FUENTE, '| Destinos:', DESTINOS.join(', '));
  console.log('Excluidos a propósito (placeholders, no tocar):', PLACEHOLDERS_EXCLUIDOS.join(', '));
  console.log();

  const srcFuente = readFileSync(path.join(REPO, FUENTE), 'utf8');
  const bloqueFuente = extraerBloqueComprenderCanal(srcFuente);
  if (!bloqueFuente) {
    console.log('ABORTO: no se encontró el bloque ComprenderCanal en', FUENTE, '-- no hay nada que propagar.');
    process.exit(1);
  }
  console.log('Bloque fuente (', FUENTE, '):', bloqueFuente.texto.length, 'caracteres, hash', sha256(bloqueFuente.texto));
  console.log();

  // Paso 1: resolver anclas de los 4 destinos SIN escribir nada todavía.
  const contenidos = {};
  const resoluciones = {};
  let faltaAlguna = false;
  for (const d of DESTINOS) {
    const src = readFileSync(path.join(REPO, d), 'utf8');
    contenidos[d] = src;
    const r = resolverAncla(d, src);
    resoluciones[d] = r;
    if (r.error) {
      faltaAlguna = true;
      console.log('ANCLA FALTANTE en', d + ':', r.error);
    } else {
      console.log(d, '-> ancla resuelta, modo:', r.modo);
    }
  }
  console.log();

  if (faltaAlguna) {
    console.log('ABORTO: falta al menos un ancla. No se escribió ningún archivo.');
    process.exit(1);
  }

  // Paso 2: para cada destino, calcular si hace falta cambio (drift) comparando contra la fuente.
  let hayDrift = false;
  const nuevosContenidos = {};
  for (const d of DESTINOS) {
    const r = resoluciones[d];
    const yaSincronizado = r.modo === 'reemplazar' && r.ancla.texto === bloqueFuente.texto;
    if (yaSincronizado) {
      console.log(d, '-> ya sincronizado con', FUENTE, '(sin cambios).');
      continue;
    }
    hayDrift = true;
    const nuevo = aplicarResolucion(contenidos[d], r, bloqueFuente.texto);
    nuevosContenidos[d] = nuevo;
    const etiquetaDiff = r.modo === 'insertar' ? (d + ' (insercion nueva)') : (d + ' (bloque desactualizado)');
    console.log();
    console.log(diffLineas(contenidos[d], nuevo, etiquetaDiff));
    console.log();
  }

  if (!hayDrift) {
    console.log('Los 4 destinos ya están sincronizados con', FUENTE + '.');
  }

  if (check) {
    console.log();
    console.log(hayDrift
      ? 'VERIFICACION: hay diffs pendientes -- correr con --apply para sincronizar.'
      : 'VERIFICACION: los 5 lugares (fuente + 4 destinos) están sincronizados. Nada que hacer.');
    process.exit(hayDrift ? 1 : 0);
  }

  // --apply: escribir sólo lo que cambió.
  for (const d of Object.keys(nuevosContenidos)) {
    writeFileSync(path.join(REPO, d), nuevosContenidos[d], 'utf8');
    console.log('Escrito:', d);
  }

  // Verificación final: releer los 5 y confirmar hash idéntico del bloque en cada uno.
  console.log();
  console.log('=== Verificación final: bloque idéntico en los 5 lugares ===');
  const hashes = {};
  const srcFuenteFinal = readFileSync(path.join(REPO, FUENTE), 'utf8');
  hashes[FUENTE] = sha256(extraerBloqueComprenderCanal(srcFuenteFinal).texto);
  for (const d of DESTINOS) {
    const srcFinal = readFileSync(path.join(REPO, d), 'utf8');
    const b = extraerBloqueComprenderCanal(srcFinal);
    hashes[d] = b ? sha256(b.texto) : null;
  }
  for (const [k, v] of Object.entries(hashes)) console.log(k, '->', v);
  const valores = Object.values(hashes);
  const identicos = valores.every((v) => v !== null) && new Set(valores).size === 1;
  console.log(identicos ? 'OK: los 5 bloques son idénticos.' : 'ERROR: los bloques NO quedaron idénticos.');
  process.exit(identicos ? 0 : 1);
}

main();
