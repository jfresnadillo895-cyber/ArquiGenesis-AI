import { normalizarLocale, localeDe, bi, biLocale, localeTag, fechaLocal, htmlFirma } from './i18n-server.js';
let pass=0,fail=0;function chk(n,c){if(c){pass++;console.log('PASS',n)}else{fail++;console.log('FAIL',n)}}
chk('normalize en-US',normalizarLocale('en-US')==='en');
chk('normalize default es',normalizarLocale('pt-BR')==='es');
chk('header locale',localeDe({headers:{'x-comprender-locale':'en'},query:{},body:{}})==='en');
chk('query fallback',localeDe({headers:{},query:{lang:'en'},body:{}})==='en');
chk('body fallback',localeDe({headers:{},query:{},body:{locale:'en'}})==='en');
chk('bi request',bi({headers:{'x-comprender-locale':'en'}},'Hola','Hello')==='Hello');
chk('bi locale',biLocale('es','Hola','Hello')==='Hola');
chk('locale tag',localeTag('en')==='en-US'&&localeTag('es')==='es-AR');
chk('English signature',htmlFirma('en').includes('A product of ARQUIGÉNESIS'));
chk('Spanish signature',htmlFirma('es').includes('Producto de ARQUIGÉNESIS'));
const d=fechaLocal('2026-09-04T12:00:00Z','en',{year:'numeric'});chk('date format',d.includes('2026'));
console.log(`\n${pass}/${pass+fail} PASS`);if(fail)process.exitCode=1;
