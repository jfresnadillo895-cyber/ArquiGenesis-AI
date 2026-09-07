global.window=global;global.navigator={language:'es-AR'};global.location={href:'https://x/'};global.localStorage={getItem(){return null},setItem(){}};global.document={readyState:'loading',addEventListener(){},documentElement:{},getElementById(){return null}};
require('./i18n.js');const I=global.ComprenderI18n,fs=require('fs');const a=JSON.parse(fs.readFileSync('/mnt/data/ui_assign_candidates.json','utf8'));
let same=[];for(const r of a){if(I.translateString(r.text,'en')===r.text)same.push(r)}
console.log(JSON.stringify(same,null,2));console.error('TOTAL',a.length,'UNCHANGED',same.length,'COVERED',a.length-same.length);
