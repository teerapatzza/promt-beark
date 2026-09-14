// เก็บ "ภาพ" ของเอกสารที่ระบบสร้างจากใบจริงทั้ง 70 ใบ ไว้เทียบก่อน/หลังแก้โค้ด
//   node snapshot-docs.mjs --save     เก็บเป็นตัวตั้งต้น
//   node snapshot-docs.mjs --compare  เทียบกับตัวตั้งต้น ต้องเหมือนกันทุกตัวอักษร
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9456, PROFILE = path.join(process.env.TEMP, 'pb-snap');
const APP = 'http://localhost:8080';
const BASELINE = 'doc-baseline.json';
const MODE = process.argv.includes('--save') ? 'save'
           : process.argv.includes('--compare') ? 'compare' : null;
if (!MODE) { console.error('ต้องใส่ --save หรือ --compare'); process.exit(2); }

const records = JSON.parse(fs.readFileSync('expenses-input.json', 'utf8'));

const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${PROFILE}`, '--no-first-run', '--disable-gpu', 'about:blank'], { stdio:'ignore' });

let ws, id = 0; const pending = new Map(); const errors = [];
const send = (m,p={}) => { const i=++id; ws.send(JSON.stringify({id:i,method:m,params:p}));
  return new Promise((r,j)=>pending.set(i,{r,j})); };
const ev = async e => {
  const r = await send('Runtime.evaluate', { expression:`(async()=>{${e}})()`, awaitPromise:true, returnByValue:true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result?.value;
};
const sha = s => crypto.createHash('sha256').update(String(s)).digest('hex').slice(0, 16);

try {
  let u;
  for (let i=0;i<60;i++){ try{ const l=await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
    const p=l.find(t=>t.type==='page'); if(p){u=p.webSocketDebuggerUrl;break;} }catch{} await sleep(250); }
  ws = new WebSocket(u); await new Promise(r=>ws.addEventListener('open',r));
  ws.addEventListener('message', e => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { const {r,j}=pending.get(m.id); pending.delete(m.id);
      m.error?j(new Error(m.error.message)):r(m.result); return; }
    if (m.method==='Runtime.exceptionThrown')
      errors.push(m.params.exceptionDetails.exception?.description||m.params.exceptionDetails.text);
    if (m.method==='Page.javascriptDialogOpening') send('Page.handleJavaScriptDialog',{accept:true});
  });
  await send('Page.enable'); await send('Runtime.enable');

  const cred={email:'tester@ha.or.th',password:'testpass123'};
  let tok=await fetch(APP+'/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify(cred)}).then(r=>r.json()).then(j=>j.token).catch(()=>null);
  if(!tok) tok=await fetch(APP+'/auth/register',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify(cred)}).then(r=>r.json()).then(j=>j.token);

  await send('Page.navigate',{url:APP+'/login.html'}); await sleep(1200);
  await ev(`localStorage.setItem('token', ${JSON.stringify(tok)}); return 1`);
  await send('Page.navigate',{url:APP+'/history.html'}); await sleep(3500);

  // ปิดการแปลงเป็นไฟล์ และเตรียม event ปลอมให้ฟังก์ชันที่อ่าน event.currentTarget
  await ev(`
    window.html2pdf = () => ({ set:()=>({ from:()=>({ save:()=>Promise.resolve() }) }) });
    const b=document.createElement('button'); b.innerHTML='x'; document.body.appendChild(b);
    window.event={currentTarget:b,target:b};
    window.alert = m => { (window.__alerts=window.__alerts||[]).push(String(m)); };
    // แผนที่วาดใหม่ทุกครั้ง ภาพที่ได้ไม่เหมือนกันเป๊ะแม้ข้อมูลเดิม
    // ตรึงเป็นภาพคงที่ เพื่อให้เทียบ "โครงเอกสาร" ได้แน่นอน
    // (โครงหน้าแผนที่ยังถูกเทียบครบ เปลี่ยนแค่เนื้อภาพ)
    window.renderRouteMapImage = async () => 'data:image/png;base64,MAPSTUB';
    return 1;`);

  const shots = {};
  let failed = 0;
  process.stdout.write('  กำลังสร้างเอกสารจากใบจริง ');
  for (const rec of records) {
    const html = await ev(`
      try {
        document.getElementById('pdf-container').innerHTML = '';
        await exportPDF(${JSON.stringify(rec)});
        const el = document.getElementById('formal-doc');
        return el ? el.innerHTML : '(ไม่มี formal-doc)';
      } catch (e) { return 'ระเบิด: ' + (e && e.message ? e.message : e); }`);
    shots[rec.id] = html;
    if (String(html).startsWith('ระเบิด') || String(html).startsWith('(ไม่มี')) failed++;
    process.stdout.write('.');
  }
  console.log(' เสร็จ');

  const summary = Object.fromEntries(Object.entries(shots).map(([k,v]) => [k, { len:String(v).length, hash:sha(v) }]));
  console.log('  สร้างได้ ' + (records.length-failed) + ' / ' + records.length + ' ใบ');
  if (failed) {
    console.log('  ใบที่สร้างไม่ได้:');
    for (const [k,v] of Object.entries(shots)) if (String(v).startsWith('ระเบิด')) console.log('    ใบ '+k+' : '+String(v).slice(0,90));
  }

  if (MODE === 'save') {
    fs.writeFileSync(BASELINE, JSON.stringify({ summary, shots }));
    console.log('\n  เก็บตัวตั้งต้นแล้ว: ' + BASELINE + '  (' + Math.round(fs.statSync(BASELINE).size/1024) + ' KB)');
  } else {
    const base = JSON.parse(fs.readFileSync(BASELINE, 'utf8'));
    const diffs = [];
    for (const rec of records) {
      const a = base.shots[rec.id], b = shots[rec.id];
      if (a === undefined) { diffs.push('ใบ '+rec.id+' ไม่มีในตัวตั้งต้น'); continue; }
      if (a !== b) {
        let at = 0; while (at < a.length && at < b.length && a[at] === b[at]) at++;
        diffs.push('ใบ '+rec.id+' ต่างกัน (ยาว '+a.length+' → '+b.length+') ตั้งแต่ตัวอักษรที่ '+at+
                   '\n        เดิม: ...' + a.slice(Math.max(0,at-40), at+60).replace(/\s+/g,' ') +
                   '\n        ใหม่: ...' + b.slice(Math.max(0,at-40), at+60).replace(/\s+/g,' '));
      }
    }
    console.log('\n' + '═'.repeat(58));
    if (diffs.length === 0) {
      console.log('  เอกสารทั้ง ' + records.length + ' ใบ เหมือนเดิมทุกตัวอักษร');
    } else {
      console.log('  *** ต่างจากเดิม ' + diffs.length + ' ใบ ***');
      diffs.slice(0,5).forEach(d => console.log('    ' + d));
    }
    console.log('═'.repeat(58));
    process.exitCode = diffs.length ? 1 : 0;
  }

  const realErr = errors.filter(e => !/favicon|fonts\.g|ERR_|html2pdf|tile/i.test(e));
  if (realErr.length) console.log('\n  มี JavaScript error: ' + realErr.slice(0,3).join(' | '));
} catch(e) { console.error('ล้มเหลว:', e.message); process.exitCode = 2; }
finally { try{ws.close();}catch{} chrome.kill(); }
