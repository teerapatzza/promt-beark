// ฟอนต์หน้าเว็บเปลี่ยนได้ แต่เอกสารราชการต้องเป็น Sarabun เสมอ
//
// ที่มา: 12 ต.ค. 2569 เปลี่ยนฟอนต์ทั้ง 6 หน้าเป็น Kanit/Prompt ตาม CI ของ สรพ.
// กับดัก: เอกสารใน history.html ใช้แท็ก <h2> เป็นชื่อเรื่องจริง
//        (ใบรายงานการเดินทาง / ใบรับรองแทนใบเสร็จรับเงิน)
//        กฎ h1-h4 แบบเหมารวมจะทำให้ชื่อเอกสารราชการกลายเป็น Kanit
// และ #activityRuler ต้องวัดด้วยฟอนต์เดียวกับกระดาษ ไม่งั้นพรีวิวบอกจำนวนบรรทัดผิด
//
//   cd public && python -m http.server 8099 --bind 127.0.0.1
//   node scripts/test-fonts.mjs
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
const CHROME='C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT=9597, PROFILE='C:/Users/teerapat/AppData/Local/Temp/pb-font';
const APP='http://127.0.0.1:8099';
const chrome=spawn(CHROME,['--headless=new','--remote-debugging-port='+PORT,'--user-data-dir='+PROFILE,'--no-first-run','--disable-gpu','about:blank'],{stdio:'ignore'});
let ws,id=0;const pending=new Map();
const send=(m,p={})=>{const i=++id;ws.send(JSON.stringify({id:i,method:m,params:p}));return new Promise((r,j)=>pending.set(i,{r,j}));};
const ev=async e=>{const r=await send('Runtime.evaluate',{expression:'(async()=>{'+e+'})()',awaitPromise:true,returnByValue:true});
  if(r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text); return r.result?.value;};
const stub=["localStorage.setItem('token','x');","const of=window.fetch;",
"window.fetch=function(u,i){const s=(typeof u==='string')?u:(u&&u.url)||'';",
"  if(s.indexOf('/auth/me')>=0) return Promise.resolve(new Response(JSON.stringify({id:1,email:'t@ha.or.th',name:'t',role:'admin'}),{status:200,headers:{'Content-Type':'application/json'}}));",
"  if(s.indexOf('/budget-categories')>=0||s.indexOf('/profiles')>=0||s.indexOf('/expenses')>=0||s.indexOf('/users')>=0||s.indexOf('/settings')>=0)",
"    return Promise.resolve(new Response('[]',{status:200,headers:{'Content-Type':'application/json'}}));",
"  return of(u,i);};"].join('\n');
let pass=0,fail=0;
const ck=(n,c,d)=>{ if(c){pass++;console.log('ผ่าน  '+n);} else {fail++;console.log('ตก    '+n+'  <-- '+JSON.stringify(d));} };
try{
  let u; for(let i=0;i<80&&!u;i++){ try{const l=await (await fetch('http://127.0.0.1:'+PORT+'/json/list')).json();const p=l.find(t=>t.type==='page'); if(p)u=p.webSocketDebuggerUrl;}catch{} await sleep(250);}
  ws=new WebSocket(u); await new Promise(r=>ws.addEventListener('open',r));
  ws.addEventListener('message',e=>{const m=JSON.parse(e.data); if(m.id&&pending.has(m.id)){const{r,j}=pending.get(m.id);pending.delete(m.id); m.error?j(new Error(m.error.message)):r(m.result);}});
  await send('Page.enable');await send('Runtime.enable');await send('Network.enable');
  await send('Network.setCacheDisabled',{cacheDisabled:true});
  await send('Page.addScriptToEvaluateOnNewDocument',{source:stub});
  for(const page of ['index.html','login.html','expense.html','history.html','admin.html','profile.html']){
    await send('Page.navigate',{url:APP+'/'+page}); await sleep(3200);
    const r=await ev([
      "const f=el=>el?getComputedStyle(el).fontFamily.split(',')[0].replace(/[\"']/g,'').trim():null;",
      "const h=document.querySelector('h1,h2,h3');",
      "return { body:f(document.body), head:f(h), headTag:h?h.tagName:null };"].join('\n'));
    ck(page+' เนื้อหาเป็น Prompt', r.body==='Prompt', r.body);
    if(r.headTag) ck(page+' หัวเรื่อง <'+r.headTag.toLowerCase()+'> เป็น Kanit', r.head==='Kanit', r.head);
  }
  // เอกสารต้องยังเป็น Sarabun
  await send('Page.navigate',{url:APP+'/history.html'}); await sleep(3200);
  const doc=await ev([
    "const d=document.createElement('div'); d.className='pdf-page';",
    "d.innerHTML='<h2>ใบรายงานการเดินทางไปปฏิบัติงาน</h2><p>ข้อความในเอกสาร</p>';",
    "document.body.appendChild(d);",
    "const f=el=>getComputedStyle(el).fontFamily.split(',')[0].replace(/[\"']/g,'').trim();",
    "const out={ page:f(d), h2:f(d.querySelector('h2')), p:f(d.querySelector('p')) };",
    "d.remove(); return out;"].join('\n'));
  ck('เอกสาร .pdf-page เป็น Sarabun', doc.page==='Sarabun', doc.page);
  ck('ชื่อเอกสาร <h2> ยังเป็น Sarabun ไม่ใช่ Kanit', doc.h2==='Sarabun', doc.h2);
  ck('ข้อความในเอกสารเป็น Sarabun', doc.p==='Sarabun', doc.p);
  // ไม้บรรทัดวัดบรรทัด
  await send('Page.navigate',{url:APP+'/expense.html'}); await sleep(3500);
  const rl=await ev([
    "const f=id=>{const e=document.getElementById(id); return e?getComputedStyle(e).fontFamily.split(',')[0].replace(/[\"']/g,'').trim():null;};",
    "return { ruler:f('activityRuler'), size:(document.getElementById('activityRuler')?getComputedStyle(document.getElementById('activityRuler')).fontSize:null) };"].join('\n'));
  ck('ไม้บรรทัดวัดบรรทัดยังเป็น Sarabun', rl.ruler==='Sarabun', rl.ruler);
  ck('ขนาดไม้บรรทัดยังเป็น 13.5px', rl.size==='13.5px', rl.size);
}catch(e){fail++;console.log('ล้มเหลว: '+e.message);}
finally{ try{ws&&ws.close();}catch{} chrome.kill(); }
console.log(''); console.log('สรุป: ผ่าน '+pass+'  ตก '+fail);
process.exit(fail?1:0);
