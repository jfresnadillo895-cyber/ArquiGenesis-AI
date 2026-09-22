// M1U-CANAL dirigido — pruebas reales sobre el detector ComprenderCanal.esAndroidTwa() (v2, con
// ?canal=android/?canal=web determinista) y sobre los dos diffs de navegación ya aplicados en
// abrirModulo() (index.html) e irAIncorporarEnCore() (urbanismo.html).
//
// Todo el código bajo prueba se EXTRAE TEXTUALMENTE de los archivos reales (candado.txt,
// index.html, urbanismo.html) y se ejecuta tal cual, dentro de un sandbox mínimo (window/document/
// sessionStorage/location fake). No se reimplementa ninguna lógica de la aplicación. Sin red, sin
// Anthropic, sin localStorage/SQL.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.dirname(fileURLToPath(import.meta.url));

let ok = 0, fail = 0;
function chk(nombre, cond, detalle) {
  if (cond) { ok++; }
  else { fail++; console.log('FALLA:', nombre, detalle !== undefined ? ('-- ' + detalle) : ''); }
}

// ───────────────────────── 1. Extraer el bloque real ComprenderCanal desde candado.txt ─────────────────────────
const srcCandado = readFileSync(path.join(REPO, 'candado.txt'), 'utf8');
const M_START = 'var ComprenderCanal = (function(){';
const iStart = srcCandado.indexOf(M_START);
if (iStart === -1) throw new Error('No se encontró el inicio del bloque ComprenderCanal en candado.txt');
const iEnd = srcCandado.indexOf('\n})();', iStart);
if (iEnd === -1) throw new Error('No se encontró el cierre del bloque ComprenderCanal en candado.txt');
const BLOQUE_CANAL = srcCandado.slice(iStart, iEnd + '\n})();'.length);
chk('0a. El bloque extraído de candado.txt contiene esAndroidTwa real', BLOQUE_CANAL.includes('function esAndroidTwa()'));
chk('0b. El bloque extraído usa URLSearchParams sobre window.location.search (no depende sólo de referrer)', BLOQUE_CANAL.includes("URLSearchParams(window.location.search).get('canal')"));

// El mismo bloque debe estar, byte a byte, en los cuatro HTML vivos (ya lo verificó el propagador
// por hash; acá lo re-confirmamos de forma independiente, extrayéndolo de nuevo de cada archivo).
const VIVOS = ['index.html', 'urbanismo.html', 'negocios.html', 'contextos.html'];
for (const f of VIVOS) {
  const src = readFileSync(path.join(REPO, f), 'utf8');
  const s = src.indexOf(M_START);
  const e = src.indexOf('\n})();', s);
  const bloqueArchivo = src.slice(s, e + '\n})();'.length);
  chk('0c. ' + f + ': mismo bloque ComprenderCanal que candado.txt', bloqueArchivo === BLOQUE_CANAL);
}

// ───────────────────────── 2. Extraer los dos diffs de navegación reales (sin tocarlos) ─────────────────────────
const srcIndex = readFileSync(path.join(REPO, 'index.html'), 'utf8');
const srcUrb = readFileSync(path.join(REPO, 'urbanismo.html'), 'utf8');

function extraerUnico(src, ini, fin, archivo) {
  const i = src.indexOf(ini);
  if (i === -1) throw new Error('No se encontró el inicio de navegación en ' + archivo);
  const j = src.indexOf(fin, i);
  if (j === -1) throw new Error('No se encontró el cierre de navegación en ' + archivo);
  const bloque = src.slice(i, j + fin.length);
  const total = src.split(ini).length - 1;
  if (total !== 1) throw new Error('El anclaje de navegación no es único en ' + archivo + ' (apariciones: ' + total + ')');
  return bloque;
}

const NAV_INDEX = extraerUnico(
  srcIndex,
  "  try{\n    if(window.ComprenderCanal && window.ComprenderCanal.esAndroidTwa()){ location.href = m.archivo; }",
  "}catch(e){ location.href = m.archivo; }",
  'index.html'
);
const NAV_URB = extraerUnico(
  srcUrb,
  "  try{\n    if(window.ComprenderCanal && window.ComprenderCanal.esAndroidTwa()){ location.href = destino; }",
  "}catch(e){ location.href = destino; }",
  'urbanismo.html'
);

chk('0d. Diff de navegación de index.html intacto (mismo texto que la Etapa 2)', NAV_INDEX.includes("window.open(m.archivo, '_blank')"));
chk('0e. Diff de navegación de urbanismo.html intacto (mismo texto que la Etapa 2)', NAV_URB.includes("window.open(destino, '_blank')"));

// ───────────────────────── 3. Sandbox mínimo — fixtures, no reimplementación ─────────────────────────

// sessionStorage real (Storage-like), respaldado en un objeto plano
function crearSessionStorage(backing) {
  return {
    getItem(k) { return Object.prototype.hasOwnProperty.call(backing, k) ? backing[k] : null; },
    setItem(k, v) { backing[k] = String(v); },
    removeItem(k) { delete backing[k]; },
  };
}

// Evalúa el BLOQUE_CANAL real como lo haría el navegador al cargar la página: crea un scope nuevo
// (equivalente a un <script>) con window/document/sessionStorage fake, ejecuta el bloque (que se
// auto-inicializa con inicializar() al final, igual que en el archivo real) y devuelve el objeto
// ComprenderCanal resultante.
function cargarPagina(searchStr, referrerStr, backingSessionStorage) {
  const window_ = { location: { search: searchStr } };
  const document_ = { referrer: referrerStr };
  const sessionStorage_ = crearSessionStorage(backingSessionStorage);
  // URLSearchParams es global en Node; el bloque real lo usa vía window.location.search.
  const factory = new Function('window', 'document', 'sessionStorage', 'URLSearchParams',
    BLOQUE_CANAL + '\nreturn ComprenderCanal;');
  return factory(window_, document_, sessionStorage_, URLSearchParams);
}

// Ejecuta el diff de navegación real (index.html o urbanismo.html) con un window.open espiado y
// una location fake, y devuelve qué pasó.
function correrNav(navSnippet, comprenderCanal, argNombre, valorArg) {
  const llamadasOpen = [];
  const location_ = { href: '__INICIAL__' };
  const window_ = {
    ComprenderCanal: comprenderCanal,
    open(url, target) { llamadasOpen.push([url, target]); },
  };
  const args = {};
  args[argNombre] = valorArg;
  const fn = new Function('window', 'location', argNombre, navSnippet);
  fn(window_, location_, valorArg);
  return { llamadasOpen, hrefFinal: location_.href };
}

// ───────────────────────── 4. Pruebas: activación determinista por URL ─────────────────────────

(function () {
  const store = {};
  const p = cargarPagina('?canal=android', '', store);
  chk('1. ?canal=android activa esAndroidTwa() sin depender de referrer', p.esAndroidTwa() === true);
  chk('1b. Queda persistido en sessionStorage como "1"', store['ag_canal_twa'] === '1');
})();

(function () {
  const store = {};
  // referrer que simularía Android, pero el override explícito a web debe ganar
  const p = cargarPagina('?canal=web', 'android-app://com.comprenderai.app', store);
  chk('2. ?canal=web fuerza esAndroidTwa()=false incluso con referrer de Android (no depende sólo de referrer)', p.esAndroidTwa() === false);
  chk('2b. Queda persistido en sessionStorage como "0"', store['ag_canal_twa'] === '0');
})();

(function () {
  const store = {};
  const p = cargarPagina('', 'android-app://com.comprenderai.app', store);
  chk('3. Sin parámetro, con referrer de Android real: esAndroidTwa() sigue funcionando como respaldo auxiliar', p.esAndroidTwa() === true);
})();

(function () {
  const store = {};
  const p = cargarPagina('', '', store);
  chk('4. Sin parámetro y sin referrer (web normal): esAndroidTwa()=false', p.esAndroidTwa() === false);
})();

// ───────────────────────── 5. Pruebas: navegación interna real según canal ─────────────────────────

(function () {
  const store = {};
  const pIndex = cargarPagina('?canal=android', '', store);
  const r = correrNav(NAV_INDEX, pIndex, 'm', { archivo: 'urbanismo.html' });
  chk('5. Core→Urbanismo en canal Android: NO llama window.open', r.llamadasOpen.length === 0, JSON.stringify(r.llamadasOpen));
  chk('6. Core→Urbanismo en canal Android: navega con location.href = urbanismo.html', r.hrefFinal === 'urbanismo.html');
})();

(function () {
  const store = {};
  const pIndex = cargarPagina('', '', store); // web normal, sin canal ni referrer
  const r = correrNav(NAV_INDEX, pIndex, 'm', { archivo: 'urbanismo.html' });
  chk('7. Core→Urbanismo en web: SÍ llama window.open(archivo, "_blank")', r.llamadasOpen.length === 1 && r.llamadasOpen[0][0] === 'urbanismo.html' && r.llamadasOpen[0][1] === '_blank', JSON.stringify(r.llamadasOpen));
  chk('8. Core→Urbanismo en web: location.href NO se tocó', r.hrefFinal === '__INICIAL__');
})();

(function () {
  const store = {};
  const pUrb = cargarPagina('?canal=android', '', store);
  const r = correrNav(NAV_URB, pUrb, 'destino', 'index.html?organismo=org_m1u_test');
  chk('9. Urbanismo→Core en canal Android: NO llama window.open', r.llamadasOpen.length === 0, JSON.stringify(r.llamadasOpen));
  chk('10. Urbanismo→Core en canal Android: navega con location.href al mismo destino de siempre', r.hrefFinal === 'index.html?organismo=org_m1u_test');
})();

(function () {
  const store = {};
  const pUrb = cargarPagina('', '', store);
  const r = correrNav(NAV_URB, pUrb, 'destino', 'index.html?organismo=org_m1u_test');
  chk('11. Urbanismo→Core en web: SÍ llama window.open(destino, "_blank")', r.llamadasOpen.length === 1 && r.llamadasOpen[0][0] === 'index.html?organismo=org_m1u_test' && r.llamadasOpen[0][1] === '_blank', JSON.stringify(r.llamadasOpen));
})();

// ───────────────────────── 6. Prueba central: persistencia de la sesión Android Core→Urbanismo→Core ─────────────────────────

(function () {
  // Un único sessionStorage compartido simula la misma pestaña/sesión real del navegador a lo
  // largo de toda la ida y vuelta -- exactamente lo que pide el brief: "mantenerse entre
  // index.html y urbanismo.html".
  const store = {};

  // Paso 1: Core (index.html) se abre con ?canal=android (por ejemplo, primer deep link de la TWA).
  const pagina1_index = cargarPagina('?canal=android', '', store);
  chk('12. Paso 1 (index.html, ?canal=android): esAndroidTwa()=true', pagina1_index.esAndroidTwa() === true);

  // Paso 2: navegación real Core→Urbanismo. La URL real de destino (m.archivo = 'urbanismo.html')
  // NO lleva ?canal=android -- por eso importa que la sesión persista sola.
  const nav1 = correrNav(NAV_INDEX, pagina1_index, 'm', { archivo: 'urbanismo.html' });
  chk('13. Paso 2: Core navega internamente (sin window.open) hacia urbanismo.html', nav1.llamadasOpen.length === 0 && nav1.hrefFinal === 'urbanismo.html');

  // Paso 3: se "carga" urbanismo.html en la misma pestaña (mismo store de sessionStorage), sin
  // ningún ?canal en su URL real de entrada.
  const pagina2_urb = cargarPagina('', '', store);
  chk('14. Paso 3 (urbanismo.html, sin parámetro): la sesión Android persistió sola', pagina2_urb.esAndroidTwa() === true);

  // Paso 4: retorno real Urbanismo→Core, con el destino real (organismo por query, sin ?canal).
  const nav2 = correrNav(NAV_URB, pagina2_urb, 'destino', 'index.html?organismo=org_m1u_test');
  chk('15. Paso 4: Urbanismo vuelve internamente (sin window.open) a index.html?organismo=...', nav2.llamadasOpen.length === 0 && nav2.hrefFinal === 'index.html?organismo=org_m1u_test');

  // Paso 5: index.html se vuelve a cargar (retorno real), otra vez sin ?canal en la URL.
  const pagina3_index = cargarPagina('?organismo=org_m1u_test', '', store);
  chk('16. Paso 5 (index.html de vuelta, con ?organismo pero sin ?canal): la sesión Android sigue viva', pagina3_index.esAndroidTwa() === true);
})();

// ───────────────────────── 7. Prueba de reversión explícita persistente (para pruebas) ─────────────────────────

(function () {
  const store = {};
  const p1 = cargarPagina('?canal=android', '', store);
  chk('17. Sesión queda en Android', p1.esAndroidTwa() === true);
  const p2 = cargarPagina('?canal=web', '', store);
  chk('18. ?canal=web revierte explícitamente a web', p2.esAndroidTwa() === false);
  const p3 = cargarPagina('', '', store); // página siguiente, sin parámetro
  chk('19. La reversión a web persiste sola en la página siguiente (sin ?canal)', p3.esAndroidTwa() === false);
  const r = correrNav(NAV_INDEX, p3, 'm', { archivo: 'urbanismo.html' });
  chk('20. Con la sesión ya revertida a web, la navegación vuelve a usar window.open', r.llamadasOpen.length === 1);
})();

console.log('=== M1U-CANAL dirigido:', ok, 'ok /', fail, 'fallas ===');
process.exitCode = fail === 0 ? 0 : 1;
process.exit(process.exitCode);
