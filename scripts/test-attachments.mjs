// ป้ายบนหน้าจอกับการตรวจตอนบันทึก ต้องพูดตรงกัน
//
// ที่มา: 25 ก.ย. 2569 ทุกช่องแนบไฟล์ขึ้นว่า "(ไม่บังคับ)" แต่กดบันทึกแล้วขึ้นว่า
// "ยังไม่ได้แนบใบเสร็จ!" เพราะช่อง "ภาพแผนที่ / เส้นทาง" ถูกตั้งเป็น *จำเป็น
// แล้วโค้ดนับรวมว่าแอดมินบังคับแนบ ทั้งที่แผนที่ใช้ของระบบได้ ไม่ต้องอัปโหลดไฟล์
//
//   cd public && python3 -m http.server 8099 --bind 127.0.0.1
//   node scripts/test-attachments.mjs
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9583, PROFILE = 'C:/Users/teerapat/AppData/Local/Temp/pb-att';
const APP = process.env.APP_URL || 'http://127.0.0.1:8099';

const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=' + PORT,
  '--user-data-dir=' + PROFILE, '--no-first-run', '--disable-gpu',
  '--window-size=1400,1200', 'about:blank'], { stdio: 'ignore' });
let ws, id = 0; const pending = new Map(); const pageErrors = [];
const send = (m, p = {}) => { const i = ++id; ws.send(JSON.stringify({ id: i, method: m, params: p }));
  return new Promise((r, j) => pending.set(i, { r, j })); };
const ev = async e => {
  const r = await send('Runtime.evaluate', { expression: '(async()=>{' + e + '})()', awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result?.value;
};
const results = [];
const ok = (n, pass, d = '') => { results.push(pass);
  console.log((pass ? '  ผ่าน  ' : '  ตก    ') + n + (d ? '  -> ' + d : '')); };

// หมวดที่ตั้งแบบเดียวกับของจริง: แผนที่บังคับ ส่วนใบเสร็จอื่นไม่บังคับ
const RULES_MAP_ONLY = {
  LOCATION:    { show: true, required: true },
  RECEIPT:     { show: true, required: false },
  TAX_INVOICE: { show: true, required: false },
  PHOTO:       { show: true, required: false }
};
// หมวดที่แอดมินตั้งว่าใบเสร็จบังคับจริง
const RULES_RECEIPT_REQ = {
  LOCATION:    { show: true, required: true },
  RECEIPT:     { show: true, required: true },
  TAX_INVOICE: { show: true, required: false },
  PHOTO:       { show: true, required: false }
};

const stub = rules => [
  "localStorage.setItem('token','x');",
  "window.__saved = null;",
  "const of = window.fetch;",
  "window.fetch = function (u,i) { const s=(typeof u==='string')?u:(u&&u.url)||'';",
  "  if (s.indexOf('/auth/me')>=0) return Promise.resolve(new Response(",
  "    JSON.stringify({id:1,email:'t@ha.or.th',name:'ทดสอบ',role:'admin'}),",
  "    {status:200,headers:{'Content-Type':'application/json'}}));",
  "  if (s.indexOf('/budget-categories')>=0) return Promise.resolve(new Response(",
  "    JSON.stringify([{ id:'ATT', name:'ทดสอบไฟล์แนบ', fuelRate: 5,",
  "      pdfTemplates:['REPORT','TRANSPORT_RECEIPT'],",
  "      attachmentRules:" + JSON.stringify(rules) + ",",
  "      attachmentOrder:['LOCATION','RECEIPT','TAX_INVOICE','PHOTO'] }]),",
  "    {status:200,headers:{'Content-Type':'application/json'}}));",
  "  if (i && (i.method==='POST'||i.method==='PUT') && s.indexOf('/expenses')>=0) {",
  "    window.__saved = i.body; return new Promise(() => {}); }",
  "  if (s.indexOf('/expenses')>=0||s.indexOf('/profiles')>=0)",
  "    return Promise.resolve(new Response('[]',{status:200,headers:{'Content-Type':'application/json'}}));",
  "  return of(u,i); };",
  "window.routeLeg = async (a,b) => ({ km: 100, meters: 100000, coords: [] });"
].join('\n');

// กรอกใบที่มีค่าใช้จ่ายซึ่ง "ควรมีใบเสร็จ" คือ ตั๋วเครื่องบิน ทางด่วน ที่จอดรถ
const FILL = [
  "const s = document.getElementById('categorySelect');",
  "s.value='ATT'; s.dispatchEvent(new Event('change',{bubbles:true}));",
  "await new Promise(r=>setTimeout(r,900));",
  "const set=(id,v)=>{const e=document.getElementById(id); if(e){e.value=v;",
  "  e.dispatchEvent(new Event('input',{bubbles:true})); e.dispatchEvent(new Event('change',{bubbles:true}));}};",
  "set('requestedBy','ทดสอบ ไฟล์แนบ'); set('position','ที่ปรึกษา'); set('affiliation','อิสระ');",
  "set('activityName','ประชุม'); set('docDate','2025-10-20');",
  "set('addrNo','1'); set('addrSub','บางรัก'); set('addrDist','บางรัก');",
  "set('addrProv','กรุงเทพมหานคร'); set('addrZip','10500');",
  "set('dateStart','2025-10-20'); set('dateEnd','2025-10-22');",
  "set('targetProv','กรุงเทพมหานคร');",
  "set('travelFrom','บ้าน'); set('travelTo','ที่ทำงาน');",
  "setPoint('from',13.70,100.50,'บ้าน','exact','user');",
  "setPoint('to',13.80,100.55,'ที่ทำงาน','exact','user');",
  "await new Promise(r=>setTimeout(r,400));",
  "set('airfareCost',55141); set('tollCost',11); set('parkingCost',112);",
  "calculateTravelTotal();"
].join('\n');

const SUBMIT = [
  "window.__saved=null; window.__a=[]; window.alert=m=>window.__a.push(String(m));",
  "const sb=document.getElementById('submitBtn'); sb.disabled=false; sb.click();",
  "await new Promise(r=>setTimeout(r,1400));",
  "return { saved: !!window.__saved, alerts: window.__a.slice(0,2) };"
].join('\n');

try {
  let u;
  for (let i = 0; i < 80; i++) {
    try { const l = await (await fetch('http://127.0.0.1:' + PORT + '/json/list')).json();
      const p = l.find(t => t.type === 'page'); if (p) { u = p.webSocketDebuggerUrl; break; } } catch {}
    await sleep(250);
  }
  ws = new WebSocket(u); await new Promise(r => ws.addEventListener('open', r));
  ws.addEventListener('message', e => { const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { const { r, j } = pending.get(m.id); pending.delete(m.id);
      m.error ? j(new Error(m.error.message)) : r(m.result); return; }
    if (m.method === 'Runtime.exceptionThrown')
      pageErrors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
    if (m.method === 'Page.javascriptDialogOpening') send('Page.handleJavaScriptDialog', { accept: true }); });
  await send('Page.enable'); await send('Runtime.enable');

  // ═══ 1. แผนที่บังคับ ใบเสร็จไม่บังคับ ═══
  console.log('═══ 1. แอดมินตั้งว่า "แผนที่บังคับ · ใบเสร็จไม่บังคับ" ═══');
  // เก็บ id ไว้เพื่อถอดออกก่อนใส่ชุดใหม่ ไม่งั้นสองชุดรันซ้อนกันแล้วประกาศตัวแปรซ้ำ
  let stubId = (await send('Page.addScriptToEvaluateOnNewDocument', { source: stub(RULES_MAP_ONLY) })).identifier;
  await send('Page.navigate', { url: APP + '/expense.html' }); await sleep(4500);
  await ev(FILL);

  const labels = await ev([
    "const box = document.getElementById('evidenceFields') || document.querySelector('#evidenceBox');",
    "const txt = document.body.textContent.replace(/\\s+/g,' ');",
    "const inputs = [...document.querySelectorAll('.general-file-upload')].map(i => ({",
    "  field: i.dataset.field, required: i.classList.contains('required-file') }));",
    "return { inputs: inputs,",
    "         mapRequired: /ภาพแผนที่ \\/ เส้นทาง \\*จำเป็น/.test(txt),",
    "         useAppMap: !!document.getElementById('useAppMapImage')?.checked };"
  ].join('\n'));
  ok('ช่องแผนที่ขึ้นว่า *จำเป็น', labels.mapRequired === true);
  ok('ติ๊ก "ใช้แผนที่จากระบบ" ไว้ให้ตั้งแต่แรก', labels.useAppMap === true);
  ok('ช่องแนบไฟล์ทั้งหมดไม่ถูกตั้งเป็นบังคับ',
     labels.inputs.length === 3 && labels.inputs.every(i => !i.required),
     labels.inputs.map(i => i.field + (i.required ? '=บังคับ' : '=ไม่บังคับ')).join(' · '));

  const r1 = await ev(SUBMIT);
  ok('กดบันทึกแล้วผ่าน ไม่ถูกบังคับให้แนบไฟล์ที่เขียนว่าไม่บังคับ',
     r1.saved === true, (r1.alerts || []).join(' | ').slice(0, 170) || 'ไม่มีคำเตือน');

  // ═══ 2. แผนที่ยังต้องครบจริง ═══
  console.log('');
  console.log('═══ 2. แผนที่ยังต้องครบจริง ไม่ได้ปล่อยผ่านไปด้วย ═══');
  const r2 = await ev([
    "geoTo = null;",                       // แกล้งว่ายังไม่ได้ปักหมุดจุดหมาย
    SUBMIT
  ].join('\n'));
  ok('ยังไม่ได้ปักหมุดครบ → ถูกกันไว้พร้อมบอกเหตุผล',
     r2.saved === false && (r2.alerts || []).some(a => /ปักหมุดไม่ครบ/.test(a)),
     (r2.alerts || []).join(' | ').slice(0, 120));

  const r3 = await ev([
    "setPoint('to',13.80,100.55,'ที่ทำงาน','exact','user');",
    "await new Promise(r=>setTimeout(r,400));",
    "document.getElementById('useAppMapImage').checked = false;",
    "onUseAppMapToggle();",
    "await new Promise(r=>setTimeout(r,300));",
    SUBMIT
  ].join('\n'));
  ok('เอาติ๊กแผนที่ระบบออกแล้วไม่อัปโหลดเอง → ถูกกันไว้',
     r3.saved === false && (r3.alerts || []).some(a => /อัปโหลดรูปภาพแผนที่/.test(a)),
     (r3.alerts || []).join(' | ').slice(0, 120));

  // ═══ 3. ถ้าแอดมินตั้งว่าใบเสร็จบังคับจริง ต้องยังบังคับอยู่ ═══
  console.log('');
  console.log('═══ 3. แอดมินตั้งว่า "ใบเสร็จบังคับ" ต้องยังบังคับอยู่ ═══');
  await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: stubId });
  await send('Page.addScriptToEvaluateOnNewDocument', { source: stub(RULES_RECEIPT_REQ) });
  await send('Page.navigate', { url: APP + '/expense.html' }); await sleep(4500);
  await ev(FILL);
  const labels2 = await ev([
    "const inputs = [...document.querySelectorAll('.general-file-upload')].map(i => ({",
    "  field: i.dataset.field, required: i.classList.contains('required-file') }));",
    "const txt = document.body.textContent.replace(/\\s+/g,' ');",
    "return { inputs: inputs, receiptSaysRequired: /ใบเสร็จรับเงิน \\(แนบได้หลายไฟล์\\) \\*จำเป็น/.test(txt) };"
  ].join('\n'));
  ok('ช่องใบเสร็จขึ้นว่า *จำเป็น ตามที่แอดมินตั้ง', labels2.receiptSaysRequired === true);
  ok('ช่องใบเสร็จถูกทำเครื่องหมายว่าบังคับ',
     labels2.inputs.some(i => i.field === 'RECEIPT' && i.required),
     labels2.inputs.map(i => i.field + (i.required ? '=บังคับ' : '=ไม่บังคับ')).join(' · '));

  const r4 = await ev(SUBMIT);
  ok('ไม่แนบใบเสร็จที่บังคับ → ถูกกันไว้',
     r4.saved === false && (r4.alerts || []).length > 0,
     (r4.alerts || []).join(' | ').slice(0, 150));

  ok('ไม่มี JavaScript error ตลอดการทดสอบ', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '));

  console.log('');
  console.log('══════════════════════════════════════════════════');
  console.log('  ผ่าน ' + results.filter(Boolean).length + ' / ' + results.length);
  console.log('══════════════════════════════════════════════════');
  process.exitCode = results.every(Boolean) ? 0 : 1;
} catch (e) { console.error('ล้มเหลว:', e.message); process.exitCode = 2; }
finally { try { ws.close(); } catch {} chrome.kill(); }
