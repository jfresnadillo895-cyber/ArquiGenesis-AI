let domReady;
global.window=global;
global.navigator={language:'en-US'};
global.location={href:'https://app.comprenderai.com/index.html',origin:'https://app.comprenderai.com'};
global.localStorage={_d:{},getItem(k){return this._d[k]||null},setItem(k,v){this._d[k]=String(v)}};
global.NodeFilter={SHOW_ELEMENT:1,SHOW_TEXT:4};
const root={nodeType:1,classList:{toggle(){}},ownerDocument:null};
global.document={
 readyState:'loading', title:'Comprender AI', documentElement:root, body:null,
 head:{appendChild(){}},
 addEventListener(type,fn){if(type==='DOMContentLoaded')domReady=fn},
 getElementById(){return null}, querySelector(){return null},
 createElement(){return {nodeType:1,setAttribute(){},addEventListener(){},style:{},appendChild(){}}},
 createTreeWalker(){return {nextNode(){return null}}}
};
root.ownerDocument=global.document;
let calls=[];
global.fetch=async function(input,init){ calls.push({input,init}); return {ok:true,json:async()=>({})}; };
require('./i18n.js');
if(domReady)domReady();
const I=global.ComprenderI18n;
let pass=0,fail=0;function chk(n,c){if(c){pass++;console.log('PASS',n)}else{fail++;console.log('FAIL',n)}}
(async()=>{
 await fetch('/api/organismos',{method:'GET',headers:{Authorization:'Bearer x'}});
 let h1=calls.at(-1).init.headers; chk('all Comprender APIs receive locale header',h1.get?h1.get('x-comprender-locale')==='en':h1['x-comprender-locale']==='en');
 await fetch('/api/anthropic',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({model:'x',messages:[{role:'user',content:'hola'}]})});
 let b2=JSON.parse(calls.at(-1).init.body); chk('anthropic without system gets language system',typeof b2.system==='string'&&b2.system.includes('INTERACTION LANGUAGE'));
 let base=[{type:'text',text:'CANON',cache_control:{type:'ephemeral'}}];
 await fetch('/api/anthropic',{method:'POST',body:JSON.stringify({system:base,messages:[]})});
 let b3=JSON.parse(calls.at(-1).init.body); chk('cached system block preserved',Array.isArray(b3.system)&&b3.system[0].text==='CANON'&&b3.system[0].cache_control.type==='ephemeral');
 chk('locale instruction appended last',b3.system.at(-1).text.includes('INTERACTION LANGUAGE'));
 await fetch('https://api.anthropic.com/v1/messages',{method:'POST',body:JSON.stringify({messages:[]})});
 let b4=JSON.parse(calls.at(-1).init.body); chk('direct Anthropic dev path also gets locale',typeof b4.system==='string'&&b4.system.includes('INTERACTION LANGUAGE'));
 console.log(`\n${pass}/${pass+fail} PASS`);if(fail)process.exitCode=1;
})();
