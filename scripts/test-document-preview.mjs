// ทดสอบปุ่ม "ตรวจสอบ" กับใบจริงทั้ง 70 ใบ — ต้องเปิดได้ทุกใบ ไม่มีใบไหนพัง
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import fs from 'node:fs';
import path from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9467, PROFILE = path.join(process.env.TEMP, 'pb-prev');
const APP = 'http://localhost:8080';
const records = JSON.parse(fs.readFileSync('expenses-input.json', 'utf8'));

const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${PROFILE}`, '--no-first-run', '--disable-gpu',
  '--window-size=1400,1000', 'about:blank'], { stdio:'ignore' });

let ws, id = 0; const pending = new Map(); const errors = [];
const send = (m,p={}) => { const i=++id; ws.send(JSON.stringify({id:i,method:m,params:p}));
  return new Promise((r,j)=>pending.set(i,{r,j})); };
const ev = async e => {
  const r = await send('Runtime.evaluate', { expression:`(async()=>{${e}})()`, awaitPromise:true, returnByValue:true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result?.value;
};
const results=[]; const check=(n,ok,d='')=>{results.push({n,ok});console.log((ok?'  PASS  ':'  FAIL  ')+n+(d?'  → '+d:''));};

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

  // ใส่ใบจริงเข้าไปในหน้า แล้ววาดตารางใหม่
  await ev(`
    window.renderRouteMapImage = async () => 'data:image/png;base64,MAPSTUB';
    window.alert = m => { (window.__alerts=window.__alerts||[]).push(String(m)); };
    window.__alerts = [];
    raw = ${JSON.stringify(records)};
    draw();
    return raw.length;`);
  await sleep(800);

  console.log('═══ 1. ตารางแสดงครบ ═══');
  const rowCount = await ev(`return document.querySelectorAll('button[onclick^="openDetailsModal"]').length`);
  check('มีปุ่มตรวจสอบครบทุกแถว', rowCount === records.length, rowCount + ' / ' + records.length);

  const attrLen = await ev(`
    const b=document.querySelector('button[onclick^="openDetailsModal"]');
    return b ? b.getAttribute('onclick').length : -1;`);
  check('ปุ่มส่งแค่เลขที่ใบ ไม่ใช่ข้อมูลทั้งก้อน', attrLen > 0 && attrLen < 60, 'ความยาว onclick = ' + attrLen + ' ตัวอักษร');

  const pageWeight = await ev(`return document.documentElement.outerHTML.length`);
  check('หน้าเว็บไม่บวมจากข้อมูลที่ฝังใน HTML', pageWeight < 2_000_000,
        Math.round(pageWeight/1024) + ' KB');

  console.log('\n═══ 2. กดตรวจสอบทีละใบ ทั้ง ' + records.length + ' ใบ ═══');
  let ok=0; const broken=[];
  process.stdout.write('  ');
  for (const rec of records) {
    const r = await ev(`
      try {
        closeDetailsModal();
        await openDetailsModal('${rec.id}');
        const box = document.getElementById('detailsContent');
        const shown = !document.getElementById('detailsModal').classList.contains('hidden');
        const hasDoc = !!box.querySelector('.doc-preview-inner .pdf-page');
        const hasErr = /แสดงตัวอย่างเอกสารไม่สำเร็จ/.test(box.textContent);
        const stuck  = /กำลังจัดเอกสาร/.test(box.textContent);
        return JSON.stringify({shown, hasDoc, hasErr, stuck, len: box.textContent.length});
      } catch (e) { return JSON.stringify({crash: String(e && e.message || e)}); }`);
    const R = JSON.parse(r);
    if (R.shown && R.hasDoc && !R.hasErr && !R.stuck) ok++;
    else broken.push(rec.id + ' ' + r);
    process.stdout.write(R.shown && R.hasDoc && !R.hasErr && !R.stuck ? '.' : 'X');
  }
  console.log('');
  check('เปิดตัวอย่างเอกสารได้ทุกใบ', ok === records.length, ok + ' / ' + records.length);
  if (broken.length) broken.slice(0,5).forEach(b => console.log('      ' + b.slice(0,140)));

  console.log('\n═══ 3. เนื้อหาในตัวอย่างถูกต้อง ═══');
  const withReport = records.find(r => ((r.inputMetadata||{})._pdfTemplates||[]).includes('REPORT'));
  await ev(`closeDetailsModal(); await openDetailsModal('${withReport.id}'); return 1`);
  await sleep(400);
  const txt = await ev(`return document.getElementById('detailsContent').textContent.replace(/\\s+/g,' ')`);
  check('เห็นหัวเอกสารจริง', txt.includes('ใบรายงานการเดินทางไปปฏิบัติงาน'), txt.slice(0,60));
  check('เห็นรหัสแบบฟอร์ม', txt.includes('FM-SAM-001-04'));
  check('เห็นชื่อผู้ขอเบิก', txt.includes(String(withReport.requestedBy||'').split(' ')[0]));

  const both = records.find(r => {
    const t = (r.inputMetadata||{})._pdfTemplates||[];
    return t.includes('REPORT') && t.includes('TRANSPORT_RECEIPT');
  });
  await ev(`closeDetailsModal(); await openDetailsModal('${both.id}'); return 1`);
  await sleep(400);
  const txt2 = await ev(`return document.getElementById('detailsContent').textContent.replace(/\\s+/g,' ')`);
  check('ใบที่ออกสองเอกสาร เห็นครบทั้งสอง',
        txt2.includes('ใบรายงานการเดินทางไปปฏิบัติงาน') && txt2.includes('ใบรับรองแทนใบเสร็จรับเงิน'));
  const pages = await ev(`return document.querySelectorAll('.doc-preview-inner .pdf-page').length`);
  check('แสดงหลายหน้าได้', pages >= 2, pages + ' หน้า');

  console.log('\n═══ 4. การย่อให้พอดีจอ ═══');
  const fit = await ev(`
    const box=document.getElementById('detailsContent');
    const inner=box.querySelector('.doc-preview-inner');
    return JSON.stringify({box: box.clientWidth, doc: inner.scrollWidth, t: inner.style.transform});`);
  const F = JSON.parse(fit);
  check('เอกสารไม่ล้นกล่อง', F.doc * (parseFloat((F.t.match(/[\d.]+/)||[1])[0])) <= F.box + 2,
        'กล่อง ' + F.box + 'px  เอกสาร ' + F.doc + 'px  ' + F.t);

  // ต้องแคบกว่าตัวเอกสาร (718px) จริง ๆ ไม่งั้นไม่มีการย่อเกิดขึ้นเลย
  await send('Emulation.setDeviceMetricsOverride',{width:600,height:900,deviceScaleFactor:1,mobile:false});
  await sleep(600);
  await ev(`fitPreview(document.getElementById('detailsContent')); return 1`);
  await sleep(300);
  const fit2 = await ev(`
    const box=document.getElementById('detailsContent');
    const inner=box.querySelector('.doc-preview-inner');
    const s=parseFloat((inner.style.transform.match(/[\\d.]+/)||[1])[0]);
    return JSON.stringify({box:box.clientWidth, doc:inner.scrollWidth, s, fits: inner.scrollWidth*s <= box.clientWidth+2});`);
  const F2 = JSON.parse(fit2);
  check('จอแคบลงแล้วย่อให้พอดี', F2.fits === true, 'กล่อง ' + F2.box + 'px  ย่อ ' + F2.s.toFixed(2) + ' เท่า');
  check('ย่อจริง ไม่ใช่ผ่านเพราะบังเอิญพอดี', F2.s < 0.99, 'อัตราย่อ ' + F2.s.toFixed(3));
  await send('Emulation.clearDeviceMetricsOverride');

  console.log('\n═══ 5. ปุ่มและการปิด ═══');
  check('มีปุ่มดาวน์โหลด PDF ในกล่อง',
        (await ev(`return !!document.querySelector('button[onclick="downloadPreviewPDF()"]')`)) === true);
  await ev(`closeDetailsModal(); return 1`); await sleep(300);
  check('ปิดกล่องได้',
        (await ev(`return document.getElementById('detailsModal').classList.contains('hidden')`)) === true);

  console.log('\n═══ 6. กรณีใบไม่มีอยู่จริง ═══');
  await ev(`window.__alerts=[]; await openDetailsModal('ไม่มีใบนี้'); return 1`); await sleep(300);
  const al = await ev(`return JSON.stringify(window.__alerts||[])`);
  check('บอกว่าไม่พบรายการ ไม่ใช่พังเงียบ', al.includes('ไม่พบรายการ'), al.slice(0,80));
  check('ไม่เปิดกล่องเปล่าค้างไว้',
        (await ev(`return document.getElementById('detailsModal').classList.contains('hidden')`)) === true);

  const realErr = errors.filter(e => !/favicon|fonts\.g|ERR_|tile/i.test(e));
  check('ไม่มี JavaScript error ตลอดการทดสอบ', realErr.length===0, realErr.slice(0,2).join(' | '));

  const pass=results.filter(r=>r.ok).length, fail=results.filter(r=>!r.ok);
  console.log('\n'+'═'.repeat(60));
  console.log('  ผ่าน '+pass+' / '+results.length);
  fail.forEach(f=>console.log('    ✗ '+f.n));
  console.log('═'.repeat(60));
  process.exitCode = fail.length?1:0;
} catch(e){ console.error('ล้มเหลว:', e.message); process.exitCode=2; }
finally { try{ws.close();}catch{} chrome.kill(); }
