// lib/i18n-perf.test.mjs -- ESEN-CAND-02 · regresión de performance del runtime lib/i18n.js
// Extendido en PTBR-01 (ver PTBR01_INFORME.md) con el ciclo de 3 locales que pide el brief:
// ES -> EN -> PT-BR -> ES -> PT-BR -> EN -> ES. Los casos originales ES<->EN quedan intactos
// tal cual -- esto es una extensión, no un rediseño del arnés.
// Corre en Chromium real (Playwright) contra el propio index.html de producción --
// no reimplementa la lógica de traducción, ejecuta la real.
//
// Requiere: playwright + un Chromium instalado (no es una dependencia del producto,
// es una herramienta de verificación -- igual que el arnés de CTX-URB-LIVE-02 y que
// release-i18n.test.mjs, que también necesita un entorno con Node/Chromium para correr).
// Uso: node lib/i18n-perf.test.mjs [ruta-al-proyecto] [ruta-al-ejecutable-chromium]
// (sin argumentos, asume que este archivo vive en <proyecto>/lib/, igual que
// release-i18n.test.mjs).
//
// PASS/FAIL:
//  - cada setLocale() (ES->EN, EN->ES, cada paso del ciclo ES<->EN repetido, y cada paso
//    del ciclo de 3 locales ES->EN->PT-BR->ES->PT-BR->EN->ES) debe completar en menos de
//    UMBRAL_MS y sin longtasks (>50ms, el umbral estándar de "long task").
//  - el contenido de <script>/<style> nunca debe mutar, en ningún ciclo.
//  - el ciclo ES->EN->ES->EN->ES debe terminar en 'es' con las frases de control
//    correctamente traducidas en cada paso (no "pegoteadas" ni sin traducir).
//  - el ciclo de 3 locales debe terminar en 'es', pasando correctamente por pt-BR en dos
//    puntos distintos del ciclo, sin residuos de ningún otro idioma en el contenido visible
//    (excluyendo <script>/<style>, que nunca se traducen y no cuentan como "residuo").

import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_DIR = path.resolve(process.argv[2] || path.join(__dirname, '..'));
const CHROMIUM_PATH = process.argv[3] || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const UMBRAL_MS = 200;       // muy por encima de lo medido (2-4ms) -- deja margen y sigue siendo "inmediato" para el usuario
const UMBRAL_LONGTASK_MS = 50;

let pass = 0, fail = 0;
function chk(name, cond, detail) {
  if (cond) { pass++; console.log('PASS', name, detail ? '-- ' + detail : ''); }
  else { fail++; console.log('FAIL', name, detail ? '-- ' + detail : ''); }
}

function withTimeout(promise, ms, tag) {
  let to;
  const timeout = new Promise((_, rej) => { to = setTimeout(() => rej(new Error('TIMEOUT>' + ms + 'ms en ' + tag)), ms); });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(to));
}

async function freshPage(browser) {
  const page = await browser.newPage();
  await page.addInitScript(() => {
    window.__longtasks = [];
    try {
      const po = new PerformanceObserver((list) => {
        for (const e of list.getEntries()) window.__longtasks.push({ duration: e.duration });
      });
      po.observe({ entryTypes: ['longtask'] });
    } catch (e) {}
  });
  await page.goto('file://' + path.join(PROJECT_DIR, 'index.html'), { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
  await page.waitForFunction(() => !!(window.ComprenderI18n && window.ComprenderI18n.__runtimeV1), { timeout: 15000 });
  return page;
}

async function timedSetLocale(page, to) {
  const p = page.evaluate((to) => {
    window.__longtasks.length = 0;
    const t0 = performance.now();
    window.ComprenderI18n.setLocale(to, { persist: false });
    const t1 = performance.now();
    return { ms: t1 - t0, longtasks: window.__longtasks.slice() };
  }, to);
  return withTimeout(p, 25000, 'setLocale(' + to + ')');
}

(async () => {
  const browser = await chromium.launch({ executablePath: CHROMIUM_PATH, args: ['--no-sandbox', '--headless=new'] });

  // --- CASO 1: ES -> EN ---
  {
    const page = await freshPage(browser);
    await page.evaluate(() => window.ComprenderI18n.setLocale('es', { persist: false })).catch(() => {});
    await page.waitForTimeout(50);
    try {
      const r = await timedSetLocale(page, 'en');
      const maxLt = r.longtasks.reduce((m, x) => Math.max(m, x.duration), 0);
      chk('ES->EN termina', true, r.ms.toFixed(1) + 'ms');
      chk('ES->EN < ' + UMBRAL_MS + 'ms', r.ms < UMBRAL_MS, r.ms.toFixed(1) + 'ms');
      chk('ES->EN sin longtask severa (>' + UMBRAL_LONGTASK_MS + 'ms)', maxLt <= UMBRAL_LONGTASK_MS, maxLt.toFixed(1) + 'ms');
    } catch (e) {
      chk('ES->EN termina', false, e.message);
      chk('ES->EN < ' + UMBRAL_MS + 'ms', false, 'no terminó');
      chk('ES->EN sin longtask severa', false, 'no terminó');
    }
    await page.close().catch(() => {});
  }

  // --- CASO 2: EN -> ES ---
  {
    const page = await freshPage(browser);
    await page.evaluate(() => window.ComprenderI18n.setLocale('en', { persist: false })).catch(() => {});
    await page.waitForTimeout(50);
    try {
      const r = await timedSetLocale(page, 'es');
      const maxLt = r.longtasks.reduce((m, x) => Math.max(m, x.duration), 0);
      chk('EN->ES termina', true, r.ms.toFixed(1) + 'ms');
      chk('EN->ES < ' + UMBRAL_MS + 'ms', r.ms < UMBRAL_MS, r.ms.toFixed(1) + 'ms');
      chk('EN->ES sin longtask severa (>' + UMBRAL_LONGTASK_MS + 'ms)', maxLt <= UMBRAL_LONGTASK_MS, maxLt.toFixed(1) + 'ms');
    } catch (e) {
      chk('EN->ES termina', false, e.message);
      chk('EN->ES < ' + UMBRAL_MS + 'ms', false, 'no terminó');
      chk('EN->ES sin longtask severa', false, 'no terminó');
    }
    await page.close().catch(() => {});
  }

  // --- CASO 3: ciclo repetido ES->EN->ES->EN->ES + integridad de script/style + roundtrip de contenido ---
  {
    const page = await freshPage(browser);
    const antes = await page.evaluate(() => ({
      scripts: Array.from(document.querySelectorAll('script')).map(s => s.textContent.length),
      styles: Array.from(document.querySelectorAll('style')).map(s => s.textContent.length),
    }));
    const pasos = ['en', 'es', 'en', 'es', 'en', 'es'];
    let cicloOk = true;
    for (const to of pasos) {
      try {
        const r = await timedSetLocale(page, to);
        const maxLt = r.longtasks.reduce((m, x) => Math.max(m, x.duration), 0);
        chk('ciclo -> ' + to + ' < ' + UMBRAL_MS + 'ms', r.ms < UMBRAL_MS, r.ms.toFixed(1) + 'ms');
        chk('ciclo -> ' + to + ' sin longtask severa', maxLt <= UMBRAL_LONGTASK_MS, maxLt.toFixed(1) + 'ms');
        await page.waitForTimeout(20);
      } catch (e) {
        chk('ciclo -> ' + to + ' termina', false, e.message);
        cicloOk = false;
        break;
      }
    }
    if (cicloOk) {
      const despues = await page.evaluate(() => ({
        scripts: Array.from(document.querySelectorAll('script')).map(s => s.textContent.length),
        styles: Array.from(document.querySelectorAll('style')).map(s => s.textContent.length),
        locale: window.ComprenderI18n.getLocale(),
        tiene: {
          Organismos: document.body.textContent.indexOf('Organismos') > -1,
          Organisms: document.body.textContent.indexOf('Organisms') > -1,
          'Guardar sesión': document.body.textContent.indexOf('Guardar sesión') > -1,
          'Save session': document.body.textContent.indexOf('Save session') > -1,
        },
      }));
      chk('ciclo: <script> nunca mutó', JSON.stringify(antes.scripts) === JSON.stringify(despues.scripts), JSON.stringify(despues.scripts));
      chk('ciclo: <style> nunca mutó', JSON.stringify(antes.styles) === JSON.stringify(despues.styles), JSON.stringify(despues.styles));
      chk('ciclo termina en es', despues.locale === 'es', despues.locale);
      chk('ciclo: "Organismos" presente al terminar en ES', despues.tiene.Organismos === true);
      chk('ciclo: "Organisms" (EN) ausente al terminar en ES', despues.tiene.Organisms === false);
      chk('ciclo: "Guardar sesión" presente al terminar en ES', despues.tiene['Guardar sesión'] === true);
      chk('ciclo: "Save session" (EN) ausente al terminar en ES', despues.tiene['Save session'] === false);
    }
    await page.close().catch(() => {});
  }

  // --- CASO 4 (PTBR-01): ciclo de 3 locales ES->EN->PT-BR->ES->PT-BR->EN->ES ---
  // pedido explicitamente por el brief. Ademas de tiempo/longtask en cada paso, verifica en
  // cada visita a un locale que el contenido visible (excluyendo <script>/<style>, que nunca
  // se traducen y por lo tanto no cuentan como "residuo") tiene las frases de control en el
  // idioma correcto y ninguna de las otras dos.
  {
    const page = await freshPage(browser);
    const antes = await page.evaluate(() => ({
      scripts: Array.from(document.querySelectorAll('script')).map(s => s.textContent.length),
      styles: Array.from(document.querySelectorAll('style')).map(s => s.textContent.length),
    }));

    const visibleTextFrases = async () => page.evaluate(() => {
      const clone = document.body.cloneNode(true);
      clone.querySelectorAll('script,style,noscript').forEach(n => n.remove());
      const t = clone.textContent;
      return {
        Organismos: t.indexOf('Organismos') > -1,
        Ayuda: t.indexOf('Ayuda') > -1,
        Help: t.indexOf('Help') > -1,
        Ajuda: t.indexOf('Ajuda') > -1,
        'Guardar sesión': t.indexOf('Guardar sesión') > -1,
        'Save session': t.indexOf('Save session') > -1,
        'Salvar sessão': t.indexOf('Salvar sessão') > -1,
      };
    });

    // paso 0: arranca en es (frescas, sin persistir nada de una corrida anterior)
    await page.evaluate(() => window.ComprenderI18n.setLocale('es', { persist: false })).catch(() => {});
    await page.waitForTimeout(20);

    const pasos = [
      { to: 'en', esperado: { Ayuda: false, Help: true, Ajuda: false, 'Guardar sesión': false, 'Save session': true, 'Salvar sessão': false } },
      { to: 'pt', esperado: { Ayuda: false, Help: false, Ajuda: true, 'Guardar sesión': false, 'Save session': false, 'Salvar sessão': true } },
      { to: 'es', esperado: { Ayuda: true, Help: false, Ajuda: false, 'Guardar sesión': true, 'Save session': false, 'Salvar sessão': false } },
      { to: 'pt', esperado: { Ayuda: false, Help: false, Ajuda: true, 'Guardar sesión': false, 'Save session': false, 'Salvar sessão': true } },
      { to: 'en', esperado: { Ayuda: false, Help: true, Ajuda: false, 'Guardar sesión': false, 'Save session': true, 'Salvar sessão': false } },
      { to: 'es', esperado: { Ayuda: true, Help: false, Ajuda: false, 'Guardar sesión': true, 'Save session': false, 'Salvar sessão': false } },
    ];
    let cicloOk = true;
    for (const paso of pasos) {
      try {
        const r = await timedSetLocale(page, paso.to);
        const maxLt = r.longtasks.reduce((m, x) => Math.max(m, x.duration), 0);
        chk('ciclo 3-locales -> ' + paso.to + ' < ' + UMBRAL_MS + 'ms', r.ms < UMBRAL_MS, r.ms.toFixed(1) + 'ms');
        chk('ciclo 3-locales -> ' + paso.to + ' sin longtask severa', maxLt <= UMBRAL_LONGTASK_MS, maxLt.toFixed(1) + 'ms');
        const t = await visibleTextFrases();
        for (const clave of Object.keys(paso.esperado)) {
          chk('ciclo 3-locales -> ' + paso.to + ': "' + clave + '" ' + (paso.esperado[clave] ? 'presente' : 'ausente'),
            t[clave] === paso.esperado[clave], JSON.stringify(t));
        }
        await page.waitForTimeout(20);
      } catch (e) {
        chk('ciclo 3-locales -> ' + paso.to + ' termina', false, e.message);
        cicloOk = false;
        break;
      }
    }
    if (cicloOk) {
      const despues = await page.evaluate(() => ({
        scripts: Array.from(document.querySelectorAll('script')).map(s => s.textContent.length),
        styles: Array.from(document.querySelectorAll('style')).map(s => s.textContent.length),
        locale: window.ComprenderI18n.getLocale(),
        lang: document.documentElement.lang,
      }));
      chk('ciclo 3-locales: <script> nunca mutó', JSON.stringify(antes.scripts) === JSON.stringify(despues.scripts), JSON.stringify(despues.scripts));
      chk('ciclo 3-locales: <style> nunca mutó', JSON.stringify(antes.styles) === JSON.stringify(despues.styles), JSON.stringify(despues.styles));
      chk('ciclo 3-locales termina en es', despues.locale === 'es', despues.locale);
      chk('ciclo 3-locales: <html lang> termina en es', despues.lang === 'es', despues.lang);
    }
    await page.close().catch(() => {});
  }

  await browser.close();

  console.log(`\n${pass}/${pass + fail} PASS`);
  if (fail) process.exitCode = 1;
})();
