global.window=global;global.navigator={language:'es-AR'};global.location={href:'https://x/'};global.localStorage={getItem(){return null},setItem(){}};global.document={readyState:'loading',addEventListener(){},documentElement:{},getElementById(){return null}};
require('./i18n.js');const fs=require('fs'),I=global.ComprenderI18n;const a=JSON.parse(fs.readFileSync('/mnt/data/static_texts.json','utf8'));
const sp=/[áéíóúñ¿¡]|\b(qué|cómo|para|con|sin|una|un|tu|vos|está|están|nuevo|nueva|guardar|cerrar|volver|diagnóstico|organismo|cuenta|ayuda|créditos|evaluación|informe|territorio|sustentabilidad|tecnología|urbanismo|negocios|comprendé|podés|elegí|confirmá|ajustá|alcance|persistencia)\b/i;
let src=a.filter(x=>sp.test(x));let changed=[],same=[];for(const s of src){const t=I.translateString(s,'en');(t!==s?changed:same).push([s,t]);}
console.log('Spanish-like static:',src.length,'changed:',changed.length,'same:',same.length,'coverage',Math.round(changed.length/src.length*100)+'%');
for(const [s,t] of same) console.log('UNCHANGED\t'+s);
