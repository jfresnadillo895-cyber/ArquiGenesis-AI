// M3.2 dirigido — reubicación del retorno a Comprender: de los 2 botones fijos de header (M3.1,
// tapaban el logo/título en Android) a una única acción dentro del menú Aplicaciones, visible
// SÓLO en la pantalla inicial de Urbanismo (#p-inicio, aclaración funcional de Javier durante este
// mismo corte) -- en Resultados (#p-res) se conservan el botón histórico de Historial y el retorno
// condicional de URB-RET-01, sin duplicar nada en Aplicaciones.
//
// Cubre lo pedido por el brief + la aclaración:
//   - no quedan los dos botones fijos de M3.1 (#btn-volver-organismo-cai / -res);
//   - la acción está en Aplicaciones, y SÓLO quando #p-inicio está visible;
//   - en Resultados (#p-res visible) esa acción NO aparece -- nada se duplica;
//   - ambos textos según contexto ("← Volver al organismo en Comprender" / "← Abrir Comprender");
//   - destino y navegación Android/Web siguen usando irAIncorporarEnCore(), sin duplicarla.
//
// El código bajo prueba se EXTRAE TEXTUALMENTE de urbanismo.html real (tal como quedó tras M3.2) y
// se ejecuta tal cual -- irAIncorporarEnCore(), pintarContinuidadUrbanismo() y construirModulosMenu()
// corren de verdad vía `new Function(...)` en un sandbox mínimo (document/window/location fake).
// La única dependencia stubbeada es caiNavItems() (arma la lista de otros módulos -- depende de
// ACCESO_MODULOS/credPlan()/moduloHabilitado(), maquinaria de planes ajena a este corte; se
// reemplaza por una lista fija controlada, igual de espíritu que fakear document/window). No se
// reimplementa la lógica de retorno ni de menú: construirModulosMenu() e irAIncorporarEnCore() son
// el código real, ejecutado real, con su click real. Sin red, sin Anthropic.

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
  const totalIni = src.split(ini).length - 1;
  if (totalIni !== 1) throw new Error('El anclaje de inicio no es único en ' + archivo + ' (apariciones: ' + totalIni + ') -- ' + ini);
  const j = src.indexOf(fin, i);
  if (j === -1) throw new Error('No se encontró el cierre en ' + archivo + ' -- anchor: ' + fin);
  return src.slice(i, j + fin.length);
}

// ───────────────────────── 1. Los 2 botones fijos de M3.1 ya no existen ─────────────────────────

chk('1a. #btn-volver-organismo-cai (botón fijo de header, M3.1) ya NO existe en urbanismo.html',
  src.split('id="btn-volver-organismo-cai"').length - 1 === 0);
chk('1b. #btn-volver-organismo-res (botón fijo de topbar, M3.1) ya NO existe en urbanismo.html',
  src.split('id="btn-volver-organismo-res"').length - 1 === 0);
chk('1c. Botón histórico de #hist-panel (#btn-volver-comprender-core) sigue existiendo, sin tocar',
  src.split('id="btn-volver-comprender-core"').length - 1 === 1);
chk('1d. Retorno especializado de URB-RET-01 (condicional a hayAlgunEnviado) sigue presente, sin tocar',
  src.includes('var volverHtml = hayAlgunEnviado') &&
  src.includes("? '<button class=\"btn-sec btn-sml\" style=\"margin-top:10px\" onclick=\"irAIncorporarEnCore()\">' + urbRet01EscapeHtml(urbRet01T('Volver al organismo en Comprender')) + '</button>'"));

// ───────────────────────── 2. Extraer construirModulosMenu() e irAIncorporarEnCore() reales ─────────────────────────

const CONSTRUIR_MENU = extraerUnico(
  src,
  'function construirModulosMenu(){',
  'ambos siguen igual.\n}',
  'urbanismo.html (construirModulosMenu)'
);
chk('2a. construirModulosMenu() extraída crea el botón nuevo del menú Aplicaciones (id correcto)',
  CONSTRUIR_MENU.includes("bVolver.id = 'btn-volver-organismo-menu'"));
chk('2b. Ese botón usa EXCLUSIVAMENTE irAIncorporarEnCore() en su click -- no reimplementa la navegación',
  CONSTRUIR_MENU.includes("menu.classList.remove('open'); irAIncorporarEnCore(); }"));
chk('2c. El texto del botón viene de etiquetaVolverMenu (calculado en pintarContinuidadUrbanismo, no acá)',
  CONSTRUIR_MENU.includes('bVolver.textContent = etiquetaVolverMenu;') &&
  !/etiquetaVolverMenu\s*=\s*['"]/.test(CONSTRUIR_MENU));
chk('2d. La creación del botón está condicionada a #p-inicio visible (mismo mecanismo style.display que back())',
  CONSTRUIR_MENU.includes("document.getElementById('p-inicio') && document.getElementById('p-inicio').style.display !== 'none'"));

const IR_A_CORE = extraerUnico(
  src,
  'function irAIncorporarEnCore(){',
  "}catch(e){ location.href = destino; }\n}",
  'urbanismo.html (irAIncorporarEnCore)'
);
chk('2e. irAIncorporarEnCore() extraída construye destino con organismo cuando corresponde', IR_A_CORE.includes("'index.html' + (__organismoIdCoreUrbanismo ? ('?organismo=' + encodeURIComponent(__organismoIdCoreUrbanismo)) : '')"));

const PINTAR = extraerUnico(
  src,
  'function pintarContinuidadUrbanismo(){',
  '\n  }catch(e){}\n}',
  'urbanismo.html (pintarContinuidadUrbanismo)'
);
chk('2f. pintarContinuidadUrbanismo() extraída ya NO sincroniza los botones fijos de M3.1 (removidos)',
  !PINTAR.includes("getElementById('btn-volver-organismo-cai')") &&
  !PINTAR.includes("getElementById('btn-volver-organismo-res')"));
chk('2g. pintarContinuidadUrbanismo() extraída calcula etiquetaVolverMenu y sincroniza el botón del menú si está abierto',
  PINTAR.includes("etiquetaVolverMenu = '←") &&
  PINTAR.includes("getElementById('btn-volver-organismo-menu')"));
chk('2h. Con organismo usa la clave i18n reutilizada de URB-RET-01 ("Volver al organismo en Comprender")',
  PINTAR.includes("t('Volver al organismo en Comprender')"));
chk('2i. Sin organismo usa la clave nueva "Abrir Comprender"',
  PINTAR.includes("t('Abrir Comprender')"));

// ───────────────────────── 3. Claves i18n nuevas/reutilizadas en lib/i18n.js ─────────────────────────

const srcI18n = readFileSync(path.join(REPO, 'lib', 'i18n.js'), 'utf8');
chk('3a. "Volver al organismo en Comprender" ya estaba traducida (EN) antes de este corte -- reutilizada, no nueva',
  srcI18n.includes('"Volver al organismo en Comprender":"Back to the organism in Comprender"'));
chk('3b. "Volver al organismo en Comprender" ya estaba traducida (PT) antes de este corte -- reutilizada, no nueva',
  srcI18n.includes('"Volver al organismo en Comprender":"Voltar ao organismo no Comprender"'));
chk('3c. "Abrir Comprender" -- clave nueva de este corte, traducida a EN', srcI18n.includes('"Abrir Comprender":"Open Comprender"'));
chk('3d. "Abrir Comprender" -- clave nueva de este corte, traducida a PT', srcI18n.includes('"Abrir Comprender":"Abrir Comprender"'));

// ───────────────────────── 4. Sandbox mínimo — fixtures, no reimplementación ─────────────────────────

// document fake para pintarContinuidadUrbanismo() (igual que M3.1)
function crearDocumentoFakePintar() {
  const elementos = new Map();
  function elemento(id) {
    if (!elementos.has(id)) elementos.set(id, { id, textContent: '', style: {}, innerHTML: '' });
    return elementos.get(id);
  }
  ['btn-volver-comprender-core', 'btn-volver-organismo-menu', 'contexto-indicador'].forEach(elemento);
  return {
    getElementById(id) { return elementos.has(id) ? elementos.get(id) : null; },
    createTextNode(t) { return { tipo: 'text', valor: t }; },
    createElement(tag) { return { tag, attrs: {}, textContent: '', setAttribute(k, v) { this.attrs[k] = v; } }; },
  };
}

function correrPintar(organismoId, nombreOrganismo) {
  const doc = crearDocumentoFakePintar();
  globalThis.document = doc;
  globalThis.__organismoIdCoreUrbanismo = organismoId;
  globalThis.marcoOrganismoNombre = nombreOrganismo;
  globalThis.etiquetaVolverMenu = '← Abrir Comprender';
  delete globalThis.ComprenderI18n;
  const factory = new Function(PINTAR + '\nreturn pintarContinuidadUrbanismo;');
  const fn = factory();
  fn();
  return { doc, etiquetaVolverMenu: globalThis.etiquetaVolverMenu };
}

function correrIrACore(organismoId) {
  const llamadasOpen = [];
  const location_ = { href: '__INICIAL__' };
  const window_ = { open(url, target) { llamadasOpen.push([url, target]); } };
  globalThis.window = window_;
  globalThis.location = location_;
  globalThis.__organismoIdCoreUrbanismo = organismoId;
  const factory = new Function(IR_A_CORE + '\nreturn irAIncorporarEnCore;');
  const fn = factory();
  fn();
  return { llamadasOpen, hrefFinal: location_.href };
}

// document fake para construirModulosMenu(): simula #p-inicio visible/oculto (mismo mecanismo real
// de style.display) y el contenedor #modulosMenu (captura los botones que se le agregan).
function crearDocumentoFakeMenu(pantallaInicialVisible) {
  const pInicio = { style: { display: pantallaInicialVisible ? 'flex' : 'none' } };
  const hijos = [];
  const menu = {
    innerHTML: '',
    classList: { remove() {} },
    appendChild(el) { hijos.push(el); },
  };
  const elementos = { 'p-inicio': pInicio, 'modulosMenu': menu };
  return {
    getElementById(id) { return Object.prototype.hasOwnProperty.call(elementos, id) ? elementos[id] : null; },
    createElement(tag) {
      return { tag, className: '', textContent: '', _listeners: {}, addEventListener(ev, fn) { this._listeners[ev] = fn; } };
    },
    _hijos: hijos,
  };
}

// Corre construirModulosMenu() + irAIncorporarEnCore() reales JUNTAS en el mismo sandbox -- el
// click real del botón del menú invoca la función real de navegación, no un mock. caiNavItems()
// se stubbea con una lista fija (dependencia ajena a este corte -- ACCESO_MODULOS/credPlan()).
function correrMenu(pantallaInicialVisible, organismoId) {
  const doc = crearDocumentoFakeMenu(pantallaInicialVisible);
  const llamadasOpen = [];
  const location_ = { href: '__INICIAL__' };
  const window_ = { open(url, target) { llamadasOpen.push([url, target]); } };
  globalThis.document = doc;
  globalThis.window = window_;
  globalThis.location = location_;
  globalThis.__organismoIdCoreUrbanismo = organismoId;
  globalThis.etiquetaVolverMenu = organismoId ? '← Volver al organismo en Comprender' : '← Abrir Comprender';
  globalThis.caiNavItems = function () { return [['Comprender AI →', function () {}]]; };
  const factory = new Function(CONSTRUIR_MENU + '\n' + IR_A_CORE + '\nreturn construirModulosMenu;');
  const fn = factory();
  fn();
  const boton = doc._hijos.find(function (b) { return b.id === 'btn-volver-organismo-menu'; });
  if (boton) boton._listeners.click();
  return { boton, llamadasOpen, hrefFinal: location_.href, totalItems: doc._hijos.length };
}

// ───────────────────────── 5. Caso A: pantalla inicial (#p-inicio), organismo vinculado ─────────────────────────

(function () {
  const ORG_ID = 'org_m32_test_7';
  const r = correrPintar(ORG_ID, 'Municipio de Prueba M3.2');

  chk('4. Con organismo vinculado: botón histórico (#hist-panel) muestra "Volver al organismo"',
    r.doc.getElementById('btn-volver-comprender-core').textContent === '→ Volver al organismo');
  chk('5. Con organismo vinculado: texto calculado para Aplicaciones == "← Volver al organismo en Comprender"',
    r.etiquetaVolverMenu === '← Volver al organismo en Comprender', r.etiquetaVolverMenu);
  chk('6. Con organismo vinculado: badge #contexto-indicador queda visible',
    r.doc.getElementById('contexto-indicador').style.display === 'block');

  const m = correrMenu(true, ORG_ID);
  chk('7. #p-inicio visible + organismo: el botón "volver" SÍ aparece en el menú Aplicaciones', !!m.boton);
  chk('8. Ese botón muestra el texto correcto para organismo vinculado', m.boton && m.boton.textContent === '← Volver al organismo en Comprender', m.boton && m.boton.textContent);
  chk('9. Al clickearlo, navega vía window.open(destino, "_blank") -- misma irAIncorporarEnCore() real',
    m.llamadasOpen.length === 1, JSON.stringify(m.llamadasOpen));
  chk('10. El destino real == index.html?organismo=<id>',
    m.llamadasOpen[0] && m.llamadasOpen[0][0] === 'index.html?organismo=' + encodeURIComponent(ORG_ID),
    JSON.stringify(m.llamadasOpen));
})();

// ───────────────────────── 6. Caso B: pantalla inicial (#p-inicio), sin organismo ─────────────────────────

(function () {
  const r = correrPintar(null, null);

  chk('11. Sin organismo: botón histórico (#hist-panel) muestra "Volver a Comprender AI"',
    r.doc.getElementById('btn-volver-comprender-core').textContent === '→ Volver a Comprender AI');
  chk('12. Sin organismo: texto calculado para Aplicaciones == "← Abrir Comprender" (sin fingir vínculo)',
    r.etiquetaVolverMenu === '← Abrir Comprender', r.etiquetaVolverMenu);
  chk('13. Sin organismo: badge #contexto-indicador queda oculto',
    r.doc.getElementById('contexto-indicador').style.display === 'none');

  const m = correrMenu(true, null);
  chk('14. #p-inicio visible + sin organismo: el botón "volver" SÍ aparece, con texto "← Abrir Comprender"',
    !!m.boton && m.boton.textContent === '← Abrir Comprender', m.boton && m.boton.textContent);
  chk('15. Al clickearlo, destino real == index.html (a secas, sin query)',
    m.llamadasOpen.length === 1 && m.llamadasOpen[0][0] === 'index.html', JSON.stringify(m.llamadasOpen));
})();

// ───────────────────────── 7. Caso C: Resultados (#p-res) -- NO debe aparecer, ni con ni sin organismo ─────────────────────────

(function () {
  const conOrganismo = correrMenu(false, 'org_m32_test_res');
  chk('16. #p-inicio oculto (estamos en Resultados) + organismo: el botón "volver" NO aparece en Aplicaciones (no se duplica)',
    !conOrganismo.boton);
  chk('16b. El resto del menú (otros módulos) sigue armándose igual -- no se rompió nada más',
    conOrganismo.totalItems === 1); // sólo el ítem fijo "Comprender AI →" del stub

  const sinOrganismo = correrMenu(false, null);
  chk('17. #p-inicio oculto + sin organismo: tampoco aparece', !sinOrganismo.boton);
})();

// ───────────────────────── 8. Limpieza de globals de sandbox ─────────────────────────
delete globalThis.document;
delete globalThis.window;
delete globalThis.location;
delete globalThis.__organismoIdCoreUrbanismo;
delete globalThis.marcoOrganismoNombre;
delete globalThis.etiquetaVolverMenu;
delete globalThis.caiNavItems;

console.log(`=== M3.2-RETORNO-APLICACIONES dirigido: ${ok} ok / ${fail} fallas ===`);
process.exit(fail === 0 ? 0 : 1);
