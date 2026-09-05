import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';

const root=path.resolve(path.dirname(new URL(import.meta.url).pathname),'..');
const htmls=['index.html','contextos.html','urbanismo.html','negocios.html','sustentabilidad.html','tecnologia.html'];
let pass=0, fail=0;
function chk(name,cond){ if(cond){pass++;console.log('PASS',name);} else {fail++;console.log('FAIL',name);} }
for(const f of htmls){
  const s=fs.readFileSync(path.join(root,f),'utf8');
  chk(`${f} loads I18N exactly once`,(s.match(/src="\.\/lib\/i18n\.js"/g)||[]).length===1);
  const i18=s.indexOf('src="./lib/i18n.js"');
  const firstInline=s.search(/<script(?:\s[^>]*)?>/i);
  chk(`${f} I18N is the first script`,i18>=0 && firstInline>=0 && i18>=firstInline && s.slice(firstInline,i18).indexOf('</script>')===-1);
  chk(`${f} has no hard-coded es-AR formatter`,!/toLocale(?:DateString|TimeString|String)\(['"]es-AR['"]/.test(s));
}
const candado=fs.readFileSync(path.join(root,'candado.txt'),'utf8');
chk('candado has no hard-coded es-AR formatter',!/toLocale(?:DateString|TimeString|String)\(['"]es-AR['"]/.test(candado));
const runtime=fs.readFileSync(path.join(root,'lib/i18n.js'),'utf8');
chk('runtime v1.1 candidate',runtime.includes("version:'1.1.0-candidate'"));
chk('startup fetch wrapper installed immediately',runtime.includes('wrapFetch();\n  if(document.readyState'));
chk('historical compatibility is explicitly non-blocking',runtime.includes("compatibilityPolicy:'pre-i18n historical prose may remain"));
console.log(`\n${pass}/${pass+fail} PASS`);
if(fail) process.exitCode=1;
