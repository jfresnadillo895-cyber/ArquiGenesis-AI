// M3.1 dirigido — retorno directo y visible al organismo desde Urbanismo.
//
// Cubre lo pedido por el brief: "Incorporá una prueba dirigida que confirme: organismo vinculado
// → control visible → destino index.html?organismo=<id>; entrada directa → index.html sin
// organismo." También confirma que pintarContinuidadUrbanismo() sincroniza el texto de los TRES
// controles (el histórico de #hist-panel + los dos nuevos de este corte) y que el botón nuevo del
// topbar de #p-res NO reemplaza ni toca el retorno especializado condicional de URB-RET-01.
//
// Todo el código bajo prueba se EXTRAE TEXTUALMENTE de urbanismo.html (real, tal como quedó tras
// M3.1) y se ejecuta tal cual, vía `new Function(...)`, en un sandbox mínimo (document/window/
// location fake). No se reimplementa ninguna lógica de la aplicación. Sin red, sin Anthropic, sin
// localStorage/SQL real (se usa un objeto plano como backing).

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.dirname(fileURLToPath(import.meta.url));

let ok = 0, fail = 0;
function chk(nombre, cond, detalle) {
  if (cond) { ok++; }
  else { fail++; console.log('FALLA:', nombre, detalle !== undefined ? ('-- ' + detalle) : ''); }
}

const src = readFileSync(path.join(REPO, 'urbanismo.html'), 'utf8');

function extraerUnico(src, ini, fin, archivo) {
  const i = src.indexOf(ini);
  if (i === -1) throw new Error('No se encontró el inicio en ' + archivo + ' -- anchor: ' + ini);
  const total = src.split(ini).length - 1;
  if (total !== 1) throw new Error('El anclaje de inicio no es único en ' + archivo + ' (apariciones: ' + total + ') -- ' + ini);
  const j = src.indexOf(fin, i);
  if (j === -1) throw new Error('No se encontró el cierre en ' + archivo + ' -- anchor: ' + fin);
  return src.slice(i, j + fin.length);
}

// ───────────────────────── 1. Extraer el markup real de los 3 controles ─────────────────────────

chk('0a. Botón nuevo del header de #p-inicio presente, id correcto, usa irAIncorporarEnCore()',
  src.split('<button class="btn-back" id="btn-volver-organismo-cai" onclick="irAIncorporarEnCore()">').length - 1 === 1);
chk('0b. Botón nuevo del topbar de #p-res presente, id correcto, usa irAIncorporarEnCore()',
  src.split('<button class="btn-back" id="btn-volver-organismo-res" onclick="irAIncorporarEnCore()">').length - 1 === 1);
chk('0c. Botón histórico de #hist-panel sigue existiendo (no se tocó)',
  src.split('id="btn-volver-comprender-core"').length - 1 === 1);
// El botón nuevo de #p-inicio tiene que estar dentro de <div id="p-inicio"> ... antes del primer </header>
{
  const iInicio = src.indexOf('<div id="p-inicio">');
  const iBtnCai = src.indexOf('id="btn-volver-organismo-cai"');
  const iCierreHeader = src.indexOf('</header>', iInicio);
  chk('0d. Botón de #p-inicio está dentro de <header class="cai-header"> de #p-inicio', iInicio !== -1 && iBtnCai > iInicio && iBtnCai < iCierreHeader);
}
// El botón nuevo de #p-res tiene que estar dentro de <div id="p-res"> ... dentro del primer <div class="topbar">
{
  const iRes = src.indexOf('<div id="p-res">');
  const iBtnRes = src.indexOf('id="btn-volver-organismo-res"');
  const iCierreEtapas = src.indexOf('<div class="etapas">', iRes);
  chk('0e. Botón de #p-res está dentro de #p-res, antes de la franja de etapas (topbar compartido por Diagnóstico/Validación/Proyectivo)', iRes !== -1 && iBtnRes > iRes && iBtnRes < iCierreEtapas);
}
// El retorno especializado de URB-RET-01 sigue intacto y separado
chk('0f. Retorno especializado de URB-RET-01 (condicional a hayAlgunEnviado) sigue presente, sin tocar',
  src.includes('var volverHtml = hayAlgunEnviado') &&
  src.includes("? '<button class=\"btn-sec btn-sml\" style=\"margin-top:10px\" onclick=\"irAIncorporarEnCore()\">' + urbRet01EscapeHtml(urbRet01T('Volver al organismo en Comprender')) + '</button>'"));

// ───────────────────────── 2. Extraer irAIncorporarEnCore() real ─────────────────────────

const IR_A_CORE = extraerUnico(
  src,
  'function irAIncorporarEnCore(){',
  "}catch(e){ location.href = destino; }\n}",
  'urbanismo.html (irAIncorporarEnCore)'
);
chk('1a. irAIncorporarEnCore() extraída construye destino con organismo cuando corresponde', IR_A_CORE.includes("'index.html' + (__organismoIdCoreUrbanismo ? ('?organismo=' + encodeURIComponent(__organismoIdCoreUrbanismo)) : '')"));

// ───────────────────────── 3. Extraer pintarContinuidadUrbanismo() real ─────────────────────────

const PINTAR = extraerUnico(
  src,
  'function pintarContinuidadUrbanismo(){',
  '\n  }catch(e){}\n}',
  'urbanismo.html (pintarContinuidadUrbanismo)'
);
chk('2a. pintarContinuidadUrbanismo() extraída sincroniza los 3 controles',
  PINTAR.includes("getElementById('btn-volver-comprender-core')") &&
  PINTAR.includes("getElementById('btn-volver-organismo-cai')") &&
  PINTAR.includes("getElementById('btn-volver-organismo-res')"));
chk('2b. pintarContinuidadUrbanismo() extraída reutiliza las claves i18n existentes (sin claves nuevas)',
  PINTAR.includes("t('Volver al organismo')") && PINTAR.includes("t('Volver a Comprender AI')"));

// ───────────────────────── 4. Sandbox mínimo — fixtures, no reimplementación ─────────────────────────

// document fake: getElementById devuelve el mismo objeto elemento cada vez que se pide el mismo id
// (Map compartido), con textContent/style/innerHTML como propiedades simples -- suficiente para lo
// que pintarContinuidadUrbanismo() real usa.
function crearDocumentoFake() {
  const elementos = new Map();
  function elemento(id) {
    if (!elementos.has(id)) {
      elementos.set(id, { id, textContent: '', style: {}, innerHTML: '', hijos: [] });
    }
    return elementos.get(id);
  }
  // ids reales que pintarContinuidadUrbanismo() busca
  ['btn-volver-comprender-core', 'btn-volver-organismo-cai', 'btn-volver-organismo-res', 'contexto-indicador'].forEach(elemento);
  return {
    getElementById(id) { return elementos.has(id) ? elementos.get(id) : null; },
    createTextNode(t) { return { tipo: 'text', valor: t }; },
    createElement(tag) { return { tag, attrs: {}, textContent: '', setAttribute(k, v) { this.attrs[k] = v; } }; },
    _elementos: elementos,
  };
}

// Corre pintarContinuidadUrbanismo() real con __organismoIdCoreUrbanismo/marcoOrganismoNombre
// dados, sobre un documento fake nuevo. La función real referencia esas dos variables y
// `document`/`ComprenderI18n` como identificadores libres (mismo modelo que en el navegador, donde
// son globales del módulo/página) -- por eso se exponen acá como globals de Node antes de invocar
// la función extraída, en vez de reimplementarla con otra firma.
function correrPintar(organismoId, nombreOrganismo) {
  const doc = crearDocumentoFake();
  globalThis.document = doc;
  globalThis.__organismoIdCoreUrbanismo = organismoId;
  globalThis.marcoOrganismoNombre = nombreOrganismo;
  delete globalThis.ComprenderI18n; // fuerza el fallback identidad t(s)=s, igual que si el módulo de i18n no cargó
  const factory = new Function(PINTAR + '\nreturn pintarContinuidadUrbanismo;');
  const fn = factory();
  fn();
  return doc;
}

// Corre irAIncorporarEnCore() real con __organismoIdCoreUrbanismo dado, con window/location fake
// espiados (mismo patrón que correrNav() de m1u_canal_dirigido.mjs).
function correrIrACore(organismoId) {
  const llamadasOpen = [];
  const location_ = { href: '__INICIAL__' };
  const window_ = { open(url, target) { llamadasOpen.push([url, target]); } }; // sin ComprenderCanal -> rama window.open (web normal)
  globalThis.window = window_;
  globalThis.location = location_;
  globalThis.__organismoIdCoreUrbanismo = organismoId;
  const factory = new Function(IR_A_CORE + '\nreturn irAIncorporarEnCore;');
  const fn = factory();
  fn();
  return { llamadasOpen, hrefFinal: location_.href };
}

// ───────────────────────── 5. Caso A: organismo vinculado ─────────────────────────

(function () {
  const ORG_ID = 'org_m31_test_42';
  const doc = correrPintar(ORG_ID, 'Municipio de Prueba M3.1');

  chk('3. Con organismo vinculado: botón histórico (#hist-panel) muestra "Volver al organismo"',
    doc.getElementById('btn-volver-comprender-core').textContent === '→ Volver al organismo');
  chk('4. Con organismo vinculado: botón nuevo del header de #p-inicio muestra "Volver al organismo" (control visible)',
    doc.getElementById('btn-volver-organismo-cai').textContent === '→ Volver al organismo');
  chk('5. Con organismo vinculado: botón nuevo del topbar de #p-res muestra "Volver al organismo" (control visible)',
    doc.getElementById('btn-volver-organismo-res').textContent === '→ Volver al organismo');
  chk('6. Con organismo vinculado: badge #contexto-indicador queda visible',
    doc.getElementById('contexto-indicador').style.display === 'block');

  const r = correrIrACore(ORG_ID);
  chk('7. Con organismo vinculado, canal web (sin ComprenderCanal.esAndroidTwa()): irAIncorporarEnCore() navega via window.open(destino, "_blank") -- pestaña/ventana nueva, NO location.href (ese es el comportamiento real fuera de la TWA Android)',
    r.llamadasOpen.length === 1, JSON.stringify(r.llamadasOpen));
  chk('8. Con organismo vinculado: destino real == index.html?organismo=<id>',
    r.llamadasOpen[0] && r.llamadasOpen[0][0] === 'index.html?organismo=' + encodeURIComponent(ORG_ID),
    JSON.stringify(r.llamadasOpen));
})();

// ───────────────────────── 6. Caso B: entrada directa, sin organismo ─────────────────────────

(function () {
  const doc = correrPintar(null, null);

  chk('9. Sin organismo: botón histórico (#hist-panel) muestra "Volver a Comprender AI" (vuelta comprensible, sin fingir vínculo)',
    doc.getElementById('btn-volver-comprender-core').textContent === '→ Volver a Comprender AI');
  chk('10. Sin organismo: botón nuevo del header de #p-inicio muestra "Volver a Comprender AI"',
    doc.getElementById('btn-volver-organismo-cai').textContent === '→ Volver a Comprender AI');
  chk('11. Sin organismo: botón nuevo del topbar de #p-res muestra "Volver a Comprender AI"',
    doc.getElementById('btn-volver-organismo-res').textContent === '→ Volver a Comprender AI');
  chk('12. Sin organismo: badge #contexto-indicador queda oculto (nada que fingir)',
    doc.getElementById('contexto-indicador').style.display === 'none');

  const r = correrIrACore(null);
  chk('13. Sin organismo: irAIncorporarEnCore() destino real == index.html (a secas, sin query)',
    r.llamadasOpen.length === 1 && r.llamadasOpen[0][0] === 'index.html', JSON.stringify(r.llamadasOpen));
})();

// ───────────────────────── 7. Limpieza de globals de sandbox ─────────────────────────
delete globalThis.document;
delete globalThis.window;
delete globalThis.location;
delete globalThis.__organismoIdCoreUrbanismo;
delete globalThis.marcoOrganismoNombre;

console.log(`=== M3.1-RETORNO-HEADER dirigido: ${ok} ok / ${fail} fallas ===`);
process.exit(fail === 0 ? 0 : 1);
