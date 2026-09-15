// วัดว่าแต่ละ .pdf-page สูงเกินหนึ่งหน้า A4 ไหม — ถ้าเกิน html2pdf จะผ่าครึ่ง
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import fs from 'node:fs'; import path from 'node:path';
const CHROME='C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT=9501, PROFILE=path.join(process.env.TEMP,'pb-meas');
const APP='http://localhost:8080';
const records=JSON.parse(fs.readFileSync('expenses-input.json','utf8'));

const chrome=spawn(CHROME,['--headless=new',`--remote-debugging-port=${PORT}`,`--user-data-dir=${PROFILE}`,
  '--no-first-run','--disable-gpu','--window-size=1400,1000','about:blank'],{stdio:'ignore'});
let ws,id=0; const pending=new Map();
const send=(m,p={})=>{const i=++id;ws.send(JSON.stringify({id:i,method:m,params:p}));
  return new Promise((r,j)=>pending.set(i,{r,j}));};
const ev=async e=>{const r=await send('Runtime.evaluate',{expression:`(async()=>{${e}})()`,awaitPromise:true,returnByValue:true});
  if(r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);
  return r.result?.value;};
try{
  let u; for(let i=0;i<60;i++){try{const l=await(await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
    const p=l.find(t=>t.type==='page'); if(p){u=p.webSocketDebuggerUrl;break;}}catch{} await sleep(250);}
  ws=new WebSocket(u); await new Promise(r=>ws.addEventListener('open',r));
  ws.addEventListener('message',e=>{const m=JSON.parse(e.data);
    if(m.id&&pending.has(m.id)){const{r,j}=pending.get(m.id);pending.delete(m.id);m.error?j(new Error(m.error.message)):r(m.result);}
    if(m.method==='Page.javascriptDialogOpening')send('Page.handleJavaScriptDialog',{accept:true});});
  await send('Page.enable'); await send('Runtime.enable');
  const cred={email:'tester@ha.or.th',password:'testpass123'};
  let tok=await fetch(APP+'/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify(cred)}).then(r=>r.json()).then(j=>j.token).catch(()=>null);
  await send('Page.navigate',{url:APP+'/login.html'}); await sleep(1200);
  await ev(`localStorage.setItem('token', ${JSON.stringify(tok)}); return 1`);
  await send('Page.navigate',{url:APP+'/history.html'}); await sleep(3500);
  await ev(`window.renderRouteMapImage=async()=>'data:image/png;base64,MAPSTUB';
            window.alert=()=>{}; raw=${JSON.stringify(records)}; draw(); return 1;`);
  await sleep(600);

  // หน้ากระดาษ A4 ที่ใช้ได้จริง: กว้าง 190mm (เท่าที่ .pdf-page ตั้งไว้)
  // สูง 297mm หักขอบบนล่างอย่างละ 5mm = 287mm  แปลงเป็น px ตามอัตราส่วนเดียวกับความกว้าง
  const ratio = await ev(`
    document.getElementById('pdf-container').innerHTML='<div class="pdf-page" id="_m">x</div>';
    const w=document.getElementById('_m').getBoundingClientRect().width;
    document.getElementById('pdf-container').innerHTML='';
    return w;`);
  const pxPerMm = ratio / 190;
  const limit = Math.round(287 * pxPerMm);
  console.log('  .pdf-page กว้าง ' + Math.round(ratio) + 'px = 190mm  →  ' + pxPerMm.toFixed(2) + ' px/mm');
  console.log('  หนึ่งหน้า A4 ใส่ได้สูงสุด ' + limit + 'px (287mm)\n');

  const over = [];
  const allHeights = [];
  let total=0;
  for (const rec of records) {
    const m = await ev(`
      const built = await buildDocumentHtml(${JSON.stringify(rec)});
      document.getElementById('pdf-container').innerHTML =
        '<div id="formal-doc" style="background:white;color:black;margin:0;padding:0;">' + built.html + '</div>';
      const pages=[...document.querySelectorAll('#formal-doc .pdf-page')];
      return JSON.stringify(pages.map(p=>Math.round(p.getBoundingClientRect().height)));`);
    const hs = JSON.parse(m);
    total += hs.length;
    hs.forEach((h,i)=>allHeights.push({id:rec.id,i:i+1,h}));
    const bad = hs.map((h,i)=>({i:i+1,h})).filter(x=>x.h > limit);
    if (bad.length) over.push({ id: rec.id, bad, all: hs });
  }
  console.log('  ตรวจ ' + records.length + ' ใบ  รวม ' + total + ' หน้ากระดาษ');
  console.log('  หน้าที่สูงเกินหนึ่ง A4 (จะถูกผ่าครึ่ง): ' + over.reduce((s,o)=>s+o.bad.length,0) +
              ' หน้า จาก ' + over.length + ' ใบ\n');
  console.log('  หน้าที่สูงที่สุด 5 อันดับ (ยิ่งใกล้ ' + limit + 'px ยิ่งเสี่ยง):');
  allHeights.sort((a,b)=>b.h-a.h).slice(0,5).forEach(x =>
    console.log('    ใบ ' + String(x.id).padEnd(5) + ' หน้า ' + x.i + '  ' + x.h + 'px  เหลือที่ว่าง ' + (limit-x.h) + 'px'));
  over.slice(0,12).forEach(o => {
    console.log('    ใบ ' + String(o.id).padEnd(5) + ' หน้าที่ ' +
      o.bad.map(b=>b.i+' สูง '+b.h+'px (เกิน '+(b.h-limit)+'px)').join(' · '));
  });
}catch(e){console.error('ล้มเหลว:',e.message);}finally{try{ws.close()}catch{};chrome.kill();}
