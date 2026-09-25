// เทียบ "ข้อความที่พิมพ์ออกมา" ก่อน/หลังแก้ — ต้องไม่เปลี่ยนแม้แต่ตัวเดียว
// เปลี่ยนได้แค่ระยะห่าง ไม่ใช่เนื้อความ
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import fs from 'node:fs'; import path from 'node:path';

const CHROME='C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT=9504, PROFILE=path.join(process.env.TEMP,'pb-cmp');
const APP='http://localhost:8080';
const records=JSON.parse(fs.readFileSync('expenses-input.json','utf8'));
const base=JSON.parse(fs.readFileSync('doc-baseline.json','utf8'));

const chrome=spawn(CHROME,['--headless=new',`--remote-debugging-port=${PORT}`,`--user-data-dir=${PROFILE}`,
  '--no-first-run','--disable-gpu','about:blank'],{stdio:'ignore'});
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
  // ปิดแคชของเบราว์เซอร์ ไม่งั้นโปรไฟล์ที่ใช้ซ้ำจะเสิร์ฟไฟล์เก่าจากดิสก์
  // แล้วผลทดสอบจะเป็นของโค้ดรุ่นก่อนโดยไม่มีใครรู้
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  const cred={email:'tester@ha.or.th',password:'testpass123'};
  let tok=await fetch(APP+'/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify(cred)}).then(r=>r.json()).then(j=>j.token).catch(()=>null);
  await send('Page.navigate',{url:APP+'/login.html'}); await sleep(1200);
  await ev(`localStorage.setItem('token', ${JSON.stringify(tok)}); return 1`);
  await send('Page.navigate',{url:APP+'/history.html'}); await sleep(3000);
  await ev(`window.renderRouteMapImage=async()=>'data:image/png;base64,MAPSTUB'; window.alert=()=>{}; return 1;`);

  let same=0; const diff=[];
  process.stdout.write('  เทียบข้อความทีละใบ ');
  for (const rec of records) {
    const r = await ev(`
      const toText = html => {
        const d=document.createElement('div'); d.innerHTML=html;
        return (d.textContent||'').replace(/\\s+/g,' ').trim();
      };
      const built = await buildDocumentHtml(${JSON.stringify(rec)});
      // ถอดข้อความทั้งของเก่าและของใหม่ด้วยวิธีเดียวกัน ไม่งั้นช่องว่างจะต่างกันเองโดยที่เนื้อความไม่ได้เปลี่ยน
      return JSON.stringify({ now: toText(built.html), old: toText(${JSON.stringify(base.shots[rec.id] || '')}) });`);
    const P = JSON.parse(r);
    const oldText = P.old.replace(/\s+/g,' ').trim();
    const nowText = P.now.replace(/\s+/g,' ').trim();
    if (oldText === nowText) same++;
    else {
      let at=0; while(at<oldText.length && at<nowText.length && oldText[at]===nowText[at]) at++;
      diff.push('ใบ '+rec.id+' ต่างที่ตัวอักษร '+at+
        '\n        เดิม: ...'+oldText.slice(Math.max(0,at-50),at+70)+
        '\n        ใหม่: ...'+nowText.slice(Math.max(0,at-50),at+70));
    }
    process.stdout.write(oldText===nowText?'.':'X');
  }
  console.log('');
  console.log('\n'+'═'.repeat(60));
  if (!diff.length) console.log('  ข้อความบนเอกสารทั้ง '+records.length+' ใบ เหมือนเดิมทุกตัวอักษร (เปลี่ยนแค่ระยะห่าง)');
  else { console.log('  *** ข้อความเปลี่ยนไป '+diff.length+' ใบ ***'); diff.slice(0,4).forEach(d=>console.log('    '+d)); }
  console.log('═'.repeat(60));
  process.exitCode = diff.length?1:0;
}catch(e){console.error('ล้มเหลว:',e.message); process.exitCode=2;}
finally{try{ws.close()}catch{};chrome.kill();}
