import { LOCALES, normalizarLocale, localeDe, bi, biLocale, localeTag, fechaLocal, htmlFirma } from './i18n-server.js';
let pass=0,fail=0;function chk(n,c){if(c){pass++;console.log('PASS',n)}else{fail++;console.log('FAIL',n)}}
chk('normalize en-US',normalizarLocale('en-US')==='en');
/* PTBR-01: antes de este corte pt-BR no existia como locale real y normalizarLocale('pt-BR')
   caia al default 'es'. Ahora pt-BR es un locale real de la app, asi que este mismo input debe
   normalizar a 'pt' -- el fallback a 'es' se verifica ahora con un input que no es ningun locale
   soportado (p.ej. frances), no con pt-BR. */
chk('normalize pt-BR -> pt',normalizarLocale('pt-BR')==='pt');
chk('normalize pt-PT -> pt',normalizarLocale('pt-PT')==='pt');
chk('normalize pt -> pt',normalizarLocale('pt')==='pt');
chk('normalize unknown -> default es',normalizarLocale('fr-FR')==='es');
chk('LOCALES incluye pt',LOCALES.includes('es')&&LOCALES.includes('en')&&LOCALES.includes('pt')&&LOCALES.length===3);
chk('header locale',localeDe({headers:{'x-comprender-locale':'en'},query:{},body:{}})==='en');
chk('header locale pt',localeDe({headers:{'x-comprender-locale':'pt'},query:{},body:{}})==='pt');
chk('query fallback',localeDe({headers:{},query:{lang:'en'},body:{}})==='en');
chk('query fallback pt',localeDe({headers:{},query:{lang:'pt-BR'},body:{}})==='pt');
chk('body fallback',localeDe({headers:{},query:{},body:{locale:'en'}})==='en');
chk('body fallback pt',localeDe({headers:{},query:{},body:{locale:'pt'}})==='pt');
chk('bi request',bi({headers:{'x-comprender-locale':'en'}},'Hola','Hello')==='Hello');
chk('bi request pt',bi({headers:{'x-comprender-locale':'pt'}},'Hola','Hello','Olá')==='Olá');
chk('bi locale',biLocale('es','Hola','Hello')==='Hola');
chk('bi locale pt',biLocale('pt','Hola','Hello','Olá')==='Olá');
chk('bi locale pt sin argumento pt cae a en (defensivo, no debe darse en produccion)',biLocale('pt','Hola','Hello')==='Hello');
chk('locale tag',localeTag('en')==='en-US'&&localeTag('es')==='es-AR'&&localeTag('pt')==='pt-BR');
chk('English signature',htmlFirma('en').includes('A product of ARQUIGÉNESIS'));
chk('Spanish signature',htmlFirma('es').includes('Producto de ARQUIGÉNESIS'));
chk('Portuguese signature',htmlFirma('pt').includes('Um produto de ARQUIGÉNESIS'));
const d=fechaLocal('2026-09-04T12:00:00Z','en',{year:'numeric'});chk('date format',d.includes('2026'));
const dpt=fechaLocal('2026-09-04T12:00:00Z','pt',{month:'long',timeZone:'UTC'});chk('date format pt-BR (mes en portugues)',/setembro/i.test(dpt));
console.log(`\n${pass}/${pass+fail} PASS`);if(fail)process.exitCode=1;
