global.window=global;
global.navigator={language:'es-AR'};
global.location={href:'https://app.comprenderai.com/'};
global.localStorage={getItem(){return null},setItem(){}};
global.document={readyState:'loading',addEventListener(){},documentElement:{},getElementById(){return null}};
require('./i18n.js');
const I=global.ComprenderI18n, fs=require('fs'), path=require('path');
const root=path.resolve(__dirname,'..');
const files=['index.html','contextos.html','negocios.html','urbanismo.html','sustentabilidad.html','tecnologia.html','candado.txt'];
const sp=/[áéíóúñ¿¡]|\b(qué|cómo|para|con|sin|una|uno|un|tu|vos|está|están|nuevo|nueva|guardar|cerrar|volver|diagnóstico|organismo|cuenta|ayuda|créditos|evaluación|informe|territorio|sustentabilidad|tecnología|urbanismo|negocios|comprendé|podés|elegí|confirmá|ajustá|alcance|persistencia|sesión|plan|error|eliminar|cancelar|continuar|cambiar|función|tensión|campo|frente|memoria|principio|propuesta)\b/i;
const ign=/^(?:es|en|activo|archivado|gratis|profesional|estudio|magister|urbanismo|contextos|negocio|negocios|sustentabilidad|tecnologia|tecnología|universal|diagnostico|diagnóstico|proximo|proximos|funcion|tensiones|cerrado|abierto|pendiente)$/i;
function unesc(s){return s.replace(/\\n/g,'\n').replace(/\\'/g,"'").replace(/\\"/g,'"');}
let rows=[];
for(const f of files){
 const src=fs.readFileSync(path.join(root,f),'utf8');
 // Approximate JS/HTML quoted strings. Deliberately heuristic.
 const re=/(?:'((?:\\.|[^'\\]){3,500})'|"((?:\\.|[^"\\]){3,500})")/g; let m;
 const seen=new Set();
 while((m=re.exec(src))){
   let s=unesc(m[1]!==undefined?m[1]:m[2]).trim();
   if(!s || s.length<3 || s.length>500 || seen.has(s) || ign.test(s)) continue;
   seen.add(s);
   if(!sp.test(s)) continue;
   // Exclude obvious code/selectors/URLs/internal SQL/prompt protocol-heavy strings
   if(/^(?:https?:|\/rest\/|\/api\/|\.|#|\[|\{|SELECT |UPDATE |INSERT |DELETE |rpc |eq\.|Bearer |content-type|application\/|data-|aria-|--)/i.test(s)) continue;
   if(/[{};]/.test(s) && /function|return|var |const |let |=>/.test(s)) continue;
   const t=I.translateString(s,'en');
   if(t===s) rows.push({file:f,text:s.slice(0,500)});
 }
}
console.log(JSON.stringify(rows,null,2));
console.error('UNTRANSLATED_CANDIDATES',rows.length);
