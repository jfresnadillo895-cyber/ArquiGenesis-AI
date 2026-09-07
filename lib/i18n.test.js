global.window=global;
global.navigator={language:'es-AR'};
global.location={href:'https://app.comprenderai.com/index.html'};
global.localStorage={_d:{},getItem(k){return this._d[k]||null},setItem(k,v){this._d[k]=String(v)}};
global.document={readyState:'loading',addEventListener(){},documentElement:{},getElementById(){return null}};
require('./i18n.js');
const I=global.ComprenderI18n;
let pass=0,fail=0;
function chk(n,c){if(c){pass++;console.log('PASS',n)}else{fail++;console.log('FAIL',n)}}
chk('runtime loads',!!I&&I.version==='1.1.0-candidate');
chk('core phrase',I.translateString('¿Qué querés comprender hoy?','en')==='What would you like to understand today?');
chk('urban phrase',I.translateString('Diagnóstico Urbano Sistémico','en')==='Systemic Urban Diagnosis');
chk('business phrase',I.translateString('Campo de decisiones','en')==='Decision field');
chk('sustainability phrase',I.translateString('Estudio de sustentabilidad','en')==='Sustainability study');
chk('technology phrase',I.translateString('Estudio de tecnología','en')==='Technology study');
chk('dynamic memory',I.translateString('Memoria · Casa','en')==='Memory · Casa');
chk('reverse',I.translateString('Memory · Casa','es')==='Memoria · Casa');
let arr=[{type:'text',text:'SYSTEM',cache_control:{type:'ephemeral'}}];
let out=I.appendSystem(arr,'en');
chk('system array cloned',out!==arr&&out.length===2&&out[0].cache_control.type==='ephemeral');
chk('protocol instruction',out[1].text.includes('do NOT translate')&&out[1].text.includes('JSON keys'));
chk('fixed brand',I.translateString('Comprender AI','en')==='Comprender AI');
chk('PT/AP internal display preserved',I.translateString('¿Qué son PT y AP?','en')==='What are PT and AP?');
chk('locale tag EN',I.localeTag('en')==='en-US');
chk('locale tag ES',I.localeTag('es')==='es-AR');
chk('format date EN',/September|Sep/.test(I.formatDate(new Date('2026-09-04T12:00:00Z'),{month:'long',timeZone:'UTC'},'en')));
chk('historical compatibility policy explicit',I.compatibilityPolicy.indexOf('historical prose')>-1);

/* PTBR-01: pt-BR como tercer locale real sobre la misma arquitectura -- ES sigue siendo el
   pivote canonico. Estas pruebas espejan las de EN de arriba, mas las 6 direcciones explicitas
   (es<->en, es<->pt, en<->pt) y la compatibilidad hacia atras de la firma vieja de 2 argumentos. */
chk('dictionaries expone las 6 direcciones',['es_en','en_es','es_pt','pt_es','en_pt','pt_en'].every(function(k){return !!I.dictionaries[k];}));
chk('core phrase es->pt',I.translateString('¿Qué querés comprender hoy?','es','pt')==='O que você quer compreender hoje?');
chk('urban phrase es->pt',I.translateString('Diagnóstico Urbano Sistémico','es','pt')==='Diagnóstico Urbano Sistêmico');
chk('business phrase es->pt',I.translateString('Campo de decisiones','es','pt')==='Campo de decisões');
chk('sustainability phrase es->pt',I.translateString('Estudio de sustentabilidad','es','pt')==='Estudo de sustentabilidade');
chk('technology phrase es->pt',I.translateString('Estudio de tecnología','es','pt')==='Estudo de tecnologia');
chk('dynamic memory es->pt',I.translateString('Memoria · Casa','es','pt')==='Memória · Casa');
chk('reverse pt->es',I.translateString('Memória · Casa','pt','es')==='Memoria · Casa');
chk('en->pt directo',I.translateString('Help','en','pt')==='Ajuda');
chk('pt->en directo',I.translateString('Ajuda','pt','en')==='Help');
chk('fixed brand pt',I.translateString('Comprender AI','es','pt')==='Comprender AI');
chk('PT/AP internal display preserved (pt)',I.translateString('¿Qué son PT y AP?','es','pt')==='O que são PT e AP?');
chk('locale tag PT',I.localeTag('pt')==='pt-BR');
chk('format date PT (mes en portugues)',/setembro/i.test(I.formatDate(new Date('2026-09-04T12:00:00Z'),{month:'long',timeZone:'UTC'},'pt')));
chk('firma vieja de 2 args sigue funcionando tras el refactor a 3 vias',I.translateString('¿Qué querés comprender hoy?','en')==='What would you like to understand today?');
let arrPt=[{type:'text',text:'SYSTEM',cache_control:{type:'ephemeral'}}];
let outPt=I.appendSystem(arrPt,'pt');
chk('system array clonado (pt)',outPt!==arrPt&&outPt.length===2&&outPt[0].cache_control.type==='ephemeral');
chk('protocol instruction en portugues',outPt[1].text.indexOf('IDIOMA DE INTERAÇÃO')>-1&&outPt[1].text.toLowerCase().indexOf('json')>-1);
let outPt2=I.appendSystem(outPt,'pt');
chk('appendSystem no duplica el bloque de idioma (pt)',outPt2.length===outPt.length);

console.log(`\n${pass}/${pass+fail} PASS`);if(fail)process.exitCode=1;
