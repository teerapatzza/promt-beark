// ชื่อกิจกรรม: ไหลลงเป็นค่าตั้งต้นทางเดียว แก้ข้างล่างแล้วข้างบนต้องไม่เปลี่ยน
//
// 20 ต.ค. 2569 — เจ้าของงานทักว่า
//   "ตอนนี้ชื่อกิจกรรมมันเชื่อมกันแบบถ้าข้างล่างลบ ข้างบนก็ถูกลบไปด้วย
//    ซึ่งมันไม่ตรงจุดประสงค์ที่ผมออกแบบ คือจริง ๆ มันต้องดึงไปข้างล่าง
//    ให้เป็น default อะดีแล้ว แต่ว่าถ้าแก้ข้างล่าง ข้างบนไม่ควรถูกแก้ด้วย"
//
// สองช่องนี้คนละความหมาย
//   บน  #activityName      ชื่อกิจกรรมของใบ ขึ้นใบรับรองแทนใบเสร็จฯ
//   ล่าง .extra-act-text   แถวกิจกรรมท้ายตารางในเอกสาร มีได้หลายแถว
//
// "ค่าตั้งต้น" = ใช้ได้จนกว่าจะถูกแก้ทับ พอผู้ใช้พิมพ์ในแถวล่างแล้ว
// ช่องบนจะไม่ไหลลงมาทับอีก หลักเดียวกับเส้นทางแถว Taxi และช่องวันที่
//
//   cd public && python3 -m http.server 8099 --bind 127.0.0.1
//   node scripts/test-activity-oneway.mjs
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9615, PROFILE = 'C:/Users/teerapat/AppData/Local/Temp/pb-actoneway';
const APP = process.env.APP_URL || 'http://127.0.0.1:8099';

const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=' + PORT,
  '--user-data-dir=' + PROFILE, '--no-first-run', '--disable-gpu',
  '--window-size=1400,1200', 'about:blank'], { stdio: 'ignore' });

let ws, id = 0; const pending = new Map(); const pageErrors = [];
const send = (m, p = {}) => { const i = ++id; ws.send(JSON.stringify({ id: i, method: m, params: p }));
  return new Promise((r, j) => pending.set(i, { r, j })); };
const ev = async e => {
  const r = await send('Runtime.evaluate',
    { expression: '(async()=>{' + e + '})()', awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result?.value;
};
const results = [];
const ok = (n, pass, d = '') => { results.push(pass);
  console.log((pass ? '  ผ่าน  ' : '  ตก    ') + n + (d ? '  -> ' + d : '')); };

/** พิมพ์ลงช่อง เหมือนคนพิมพ์จริง (ยิง input event) */
const type = (sel, val) => "{ const el = " + sel + ";"
  + " el.value = " + JSON.stringify(val) + ";"
  + " el.dispatchEvent(new Event('input', { bubbles: true }));"
  + " await new Promise(r => setTimeout(r, 300)); }";

const state = "({ main: document.getElementById('activityName').value,"
  + " rows: [...document.querySelectorAll('.extra-act-text')].map(x => x.value) })";

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
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Page.addScriptToEvaluateOnNewDocument', { source: [
    "localStorage.setItem('token','x');",
    "const of=window.fetch;",
    "window.fetch=function(u,i){const s=(typeof u==='string')?u:(u&&u.url)||'';",
    "  if(s.indexOf('/auth/me')>=0) return Promise.resolve(new Response(",
    "    JSON.stringify({id:1,email:'t@ha.or.th',name:'test',role:'admin'}),",
    "    {status:200,headers:{'Content-Type':'application/json'}}));",
    "  if(s.indexOf('/budget-categories')>=0) return Promise.resolve(new Response(",
    "    JSON.stringify([{id:'TRAVEL002',name:'test',pdfTemplates:['REPORT','TRANSPORT_RECEIPT'],",
    "      attachmentRules:{},attachmentOrder:[]}]),",
    "    {status:200,headers:{'Content-Type':'application/json'}}));",
    "  if(s.indexOf('/expenses')>=0||s.indexOf('/profiles')>=0)",
    "    return Promise.resolve(new Response('[]',{status:200,headers:{'Content-Type':'application/json'}}));",
    "  return of(u,i);};"
  ].join('\n') });
  await send('Page.navigate', { url: APP + '/expense.html' }); await sleep(5000);

  await ev([
    "const s=document.getElementById('categorySelect');",
    "s.value='TRAVEL002'; s.dispatchEvent(new Event('change',{bubbles:true}));",
    "await new Promise(r=>setTimeout(r,1200));"
  ].join('\n'));

  /* 21 ต.ค. 2569 — ดีไซน์เปลี่ยน การไหลลงถูกยกเลิกตามคำสั่งเจ้าของงาน
       บน  = ประเภทกิจกรรม เลือกจาก dropdown สั้น ๆ
       ล่าง = รายละเอียดของกิจกรรม ยาวได้ ผู้ใช้พิมพ์เอง
     ถ้ายังไหลลง ผู้ใช้ต้องมานั่งลบชื่อประเภททิ้งทุกใบ
     กติกาที่เหลือของชุดนี้ (แก้ล่างแล้วบนต้องไม่เปลี่ยน) ยังเหมือนเดิมทุกข้อ */
  console.log('═══ 1. มีแถวล่างให้พิมพ์เสมอ และต้องว่าง ไม่ถูกเติมจากช่องบน ═══');
  const a = await ev(type("document.getElementById('activityName')", 'ประชุมคณะทำงาน ครั้งที่ 3')
    + "\nreturn " + state + ";");
  ok('ช่องบนเก็บค่าที่พิมพ์', a.main === 'ประชุมคณะทำงาน ครั้งที่ 3', a.main);
  ok('มีแถวล่างให้พิมพ์โดยไม่ต้องกด "เพิ่มแถว"', a.rows.length >= 1, a.rows.length + ' แถว');
  ok('แถวล่างว่าง ไม่ถูกเติมประเภทจากช่องบนมาทับ',
     a.rows[0] === '', JSON.stringify(a.rows));

  console.log('');
  console.log('═══ 2. แก้ข้างล่าง ข้างบนต้องไม่เปลี่ยน ═══');
  const b = await ev(type("document.querySelector('.extra-act-text')", 'ประชุมคณะทำงาน ครั้งที่ 3 (ภาคเช้า)')
    + "\nreturn " + state + ";");
  ok('แถวล่างเปลี่ยนตามที่พิมพ์',
     b.rows[0] === 'ประชุมคณะทำงาน ครั้งที่ 3 (ภาคเช้า)', b.rows[0]);
  ok('ช่องบนยังเป็นค่าเดิม ไม่ถูกแก้ตาม',
     b.main === 'ประชุมคณะทำงาน ครั้งที่ 3', b.main);

  console.log('');
  console.log('═══ 3. ลบแถวล่าง ข้างบนต้องไม่หาย (เคสที่เจ้าของงานเจอ) ═══');
  const c = await ev([
    "const btn = document.querySelector('.extra-activity button');",
    "if (btn) btn.click();",
    "await new Promise(r=>setTimeout(r,400));",
    "return " + state + ";"
  ].join('\n'));
  ok('แถวล่างถูกลบจริง', c.rows.length === 0, JSON.stringify(c.rows));
  ok('ชื่อกิจกรรมข้างบนยังอยู่ ไม่ถูกลบตาม',
     c.main === 'ประชุมคณะทำงาน ครั้งที่ 3', c.main || '(ว่าง)');

  console.log('');
  console.log('═══ 4. แก้ข้างบนต่อ ต้องไม่ไปทับแถวล่างที่ตั้งเอง ═══');
  const d = await ev([
    // สร้างแถวใหม่แล้วพิมพ์ของตัวเอง
    "addExtraActivity(); await new Promise(r=>setTimeout(r,250));",
    type("document.querySelector('.extra-act-text')", 'กิจกรรมที่ผู้ใช้ตั้งเอง'),
    type("document.getElementById('activityName')", 'ชื่อใหม่ที่พิมพ์ทีหลัง'),
    "return " + state + ";"
  ].join('\n'));
  ok('ช่องบนเปลี่ยนตามที่พิมพ์', d.main === 'ชื่อใหม่ที่พิมพ์ทีหลัง', d.main);
  ok('แถวล่างที่ตั้งเองไม่ถูกเขียนทับ',
     d.rows[0] === 'กิจกรรมที่ผู้ใช้ตั้งเอง', d.rows[0]);

  console.log('');
  console.log('═══ 5. ลบแถวหมดแล้วพิมพ์ช่องบน ต้องได้แถวว่างคืนมา ไม่ใช่ชื่อประเภท ═══');
  const e2 = await ev([
    // ล้างแถวทั้งหมดก่อน แล้วพิมพ์ใหม่ให้ระบบสร้างแถวให้
    "document.querySelectorAll('.extra-activity button').forEach(b=>b.click());",
    "await new Promise(r=>setTimeout(r,400));",
    type("document.getElementById('activityName')", 'กิจกรรม ก'),
    type("document.getElementById('activityName')", 'กิจกรรม ข'),
    "return " + state + ";"
  ].join('\n'));
  ok('ได้แถวให้พิมพ์กลับมา', e2.rows.length >= 1, e2.rows.length + ' แถว');
  ok('แถวที่ได้คืนมาว่าง ไม่ใช่ชื่อประเภทจากช่องบน',
     e2.rows[0] === '', JSON.stringify(e2.rows));

  ok('ไม่มี JavaScript error ตลอดการทดสอบ', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '));

  console.log('');
  console.log('══════════════════════════════════════════════════');
  console.log('  ผ่าน ' + results.filter(Boolean).length + ' / ' + results.length);
  console.log('══════════════════════════════════════════════════');
  process.exitCode = results.every(Boolean) ? 0 : 1;
} catch (e) { console.error('ล้มเหลว:', e.message); process.exitCode = 2; }
finally { try { ws.close(); } catch {} chrome.kill(); }
