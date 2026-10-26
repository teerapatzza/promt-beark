// ใบรับรองแทนใบเสร็จรับเงิน (FM-SAM-003-06) — แถวกิจกรรม วันที่ และชื่อเอกสาร
//
// 26 ต.ค. 2569 — เจ้าของงานส่งเอกสารจริงมาสามรอบ เจอสามเรื่องในใบเดียวกัน
//
// เรื่องที่ 1 — ช่องกรอกแถวกิจกรรมถูกซ่อน ทั้งที่เอกสารพิมพ์แถวนั้น
//   เอกสารดึงข้อความจาก _extraActivities (history.html:1481)
//   แต่ฟอร์มซ่อนช่องนั้นด้วย show('extraEntriesBox', hasReceipt)
//   หมวดที่ออกใบนี้แต่ไม่ออกใบรับรองค่าพาหนะ จึงกรอกไม่ได้ แถวออกมาว่าง
//   ใบ 151 ที่มีข้อความเป็นความบังเอิญ เพราะเจ้าตัวเลือกหมวดอื่นก่อนแล้วค่อยสลับมา
//
// เรื่องที่ 2 — วันใต้ลายเซ็นไม่ตรงกับวันในตาราง
//   ผู้ใช้กรอกวันเข้าพัก 07/10 ในตาราง แต่ใต้ลายเซ็นพิมพ์ 09/10 (วันที่เบิก)
//   เจ้าของงานยืนยันว่าต้องเป็นวันตามตาราง ไม่ใช่วันที่เบิก
//   ตรวจฐานข้อมูลแล้วมี 7 ใบจาก 8 ใบที่วันไม่ตรงกันแบบนี้ (ไม่มีใบไหนมีหลายแถว)
//
// เรื่องที่ 3 — เอกสารใบเดียวถูกเรียกคนละชื่อสามที่ จนผู้ใช้หาช่องตั้งค่าไม่เจอ
//   ชิปในฟอร์ม "ใบรับรองทั่วไป (เงินสด)" · ช่องตั้งวัน "ใบสำคัญรับเงิน"
//   หัวกระดาษจริง "ใบรับรองแทนใบเสร็จรับเงิน"
//   ตกลงกันว่ายึดชื่อบนหัวกระดาษจริง เพราะเป็นชื่อที่การเงินเห็น
//
//   cd public && python3 -m http.server 8099 --bind 127.0.0.1
//   node scripts/test-general-receipt.mjs
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9713, PROFILE = 'C:/Users/teerapat/AppData/Local/Temp/pb-genrecv';
const APP = process.env.APP_URL || 'http://127.0.0.1:8099';
const NL = String.fromCharCode(10);

const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=' + PORT,
  '--user-data-dir=' + PROFILE, '--no-first-run', '--disable-gpu',
  '--window-size=1400,1800', 'about:blank'], { stdio: 'ignore' });

let ws, id = 0; const pending = new Map(); const pageErrors = [];
const send = (m, p = {}) => { const i = ++id; ws.send(JSON.stringify({ id: i, method: m, params: p }));
  return new Promise((r, j) => pending.set(i, { r, j })); };
const ev = async (e, ms) => {
  const r = await send('Runtime.evaluate',
    { expression: '(async()=>{' + e + '})()', awaitPromise: true, returnByValue: true, timeout: ms || 150000 });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result?.value;
};
const results = [];
const ok = (n, pass, d = '') => { results.push(pass);
  console.log((pass ? '  ผ่าน  ' : '  ตก    ') + n + (d ? '  -> ' + d : '')); };

/* หมวดจริงบนโปรดักชัน — 005 ออกใบรับรองแทนใบเสร็จแต่ไม่ออกใบรับรองค่าพาหนะ
   004 ออกใบรับรองค่าพาหนะอย่างเดียว · 003 ไม่ออกทั้งคู่ */
const CATS = [
  { id: 'TRAVEL002', name: 'เบิกค่าเดินทาง+ค่าที่พัก (กรณีบิลเงินสด)',
    pdfTemplates: ['REPORT', 'TRANSPORT_RECEIPT', 'GENERAL_RECEIPT'], fuelRate: 5, taxiMaxPerTrip: 750 },
  { id: 'TRAVEL003', name: 'เบิกค่าที่พัก',
    pdfTemplates: ['NORMAL', 'REPORT'], fuelRate: 5, taxiMaxPerTrip: 750 },
  { id: 'TRAVEL004', name: 'เบิกค่าพาหนะ',
    pdfTemplates: ['TRANSPORT_RECEIPT'], fuelRate: 5, taxiMaxPerTrip: 750 },
  { id: 'TRAVEL005', name: 'เบิกค่าที่พัก (กรณีบิลเงินสด)',
    pdfTemplates: ['REPORT', 'GENERAL_RECEIPT'], fuelRate: 5, taxiMaxPerTrip: 750 }
];

/** ใบจำลองของจริง id=151 — วันเข้าพัก 7 ต.ค. แต่วันที่เบิก 9 ต.ค. */
const REC = {
  id: 9991, requestedBy: 'ผู้เบิกทดสอบ', position: 'ผู้เยี่ยมสำรวจ',
  amount: 3400, category: 'TRAVEL005', date: '2026-10-09',
  description: 'เบิกค่าที่พัก', attachments: { images: [] },
  inputMetadata: {
    _pdfTemplates: ['REPORT', 'GENERAL_RECEIPT'], _budgetCategoryId: 'TRAVEL005',
    _activityName: 'กิจกรรมเยี่ยมสำรวจ',
    _extraActivities: ['RS โรงพยาบาลทดสอบ จังหวัดทดสอบ วันที่ 8 - 9 ตุลาคม 2569'],
    _position: 'ผู้เยี่ยมสำรวจ', _affiliation: 'อิสระ',
    _docDate: '2026-10-09', _docDates: {},
    _addr: { no: '19 หมู่ 6', soi: '', road: '', sub: 'ทดสอบ',
             dist: 'ทดสอบ', prov: 'พระนครศรีอยุธยา', zip: '13000' },
    _travel: { startDate: '2026-10-07', endDate: '2026-10-09',
               periodStart: '2026-10-08', periodEnd: '2026-10-09' },
    _carType: 'ไม่ระบุ',
    _generalReceiptItems: [{ date: '2026-10-07', description: 'ค่าที่พัก 1,700 บาท x 2 คืน', amount: 3400 }],
    _costs: { fuelRate: '5', airAmount: 0, tollAmount: 0, parkingAmount: 0, otherAmount: 0,
              taxiEntries: [], hotelEntries: { entries: [] } }
  }
};

const STUB = [
  "localStorage.setItem('token','x');",
  "const CATS=" + JSON.stringify(CATS) + ";",
  "const of=window.fetch;",
  "window.fetch=function(u,i){const s=(typeof u==='string')?u:(u&&u.url)||'';",
  "  if(s.indexOf('/auth/me')>=0) return Promise.resolve(new Response(",
  "    JSON.stringify({id:1,email:'t@example.invalid',name:'t',role:'admin'}),",
  "    {status:200,headers:{'Content-Type':'application/json'}}));",
  "  if(s.indexOf('/settings')>=0&&s.indexOf('list-append')<0) return Promise.resolve(new Response(",
  "    JSON.stringify({fuelRate:5,taxiMaxPerTrip:750,positionList:[],affiliationList:[],activityList:[]}),",
  "    {status:200,headers:{'Content-Type':'application/json'}}));",
  "  if(s.indexOf('/budget-categories')>=0) return Promise.resolve(new Response(",
  "    JSON.stringify(CATS),{status:200,headers:{'Content-Type':'application/json'}}));",
  "  if(s.indexOf('/expenses')>=0||s.indexOf('/profiles')>=0) return Promise.resolve(new Response('[]',",
  "    {status:200,headers:{'Content-Type':'application/json'}}));",
  "  return of(u,i);};"
].join(NL);

/** ดึงวันที่ใต้ลายเซ็นของใบรับรองแทนใบเสร็จ (ทั่วไป) ออกมา */
const PICK_SIGN_DATE = [
  "const txt = String(html).replace(/<[^>]+>/g,' ').replace(/&nbsp;/g,' ').replace(/\\s+/g,' ');",
  /* ในเอกสารมีช่องว่างหลัง "ขอรับรองว่า" และใบรับรองค่าพาหนะก็มีประโยคเดียวกัน
     จึงใช้ตำแหน่ง "สุดท้าย" ซึ่งเป็นของใบรับรองแทนใบเสร็จ (ทั่วไป) เสมอ
     เพราะในลำดับการพิมพ์ ใบทั่วไปมาหลังใบค่าพาหนะ */
  "const i = txt.lastIndexOf('ขอรับรองว่า รายจ่ายข้างต้น');",
  "if (i < 0) return { found:false, dates:[] };",
  "const tail = txt.slice(i, i + 420);",
  "return { found:true, dates: tail.match(/\\d{1,2}\\/\\d{1,2}\\/25\\d{2}/g) || [] };"
].join(NL);

try {
  let u;
  for (let i = 0; i < 100; i++) {
    try { const l = await (await fetch('http://127.0.0.1:' + PORT + '/json/list')).json();
      const p = l.find(t => t.type === 'page'); if (p) { u = p.webSocketDebuggerUrl; break; } } catch {}
    await sleep(250);
  }
  if (!u) throw new Error('Chrome ไม่ขึ้น');
  ws = new WebSocket(u); await new Promise(r => ws.addEventListener('open', r));
  ws.addEventListener('message', e => { const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { const { r, j } = pending.get(m.id); pending.delete(m.id);
      m.error ? j(new Error(m.error.message)) : r(m.result); return; }
    if (m.method === 'Runtime.exceptionThrown')
      pageErrors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text); });
  await send('Page.enable'); await send('Runtime.enable');
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Page.addScriptToEvaluateOnNewDocument', { source: STUB });

  // ══════════ 1. ช่องแถวกิจกรรม ══════════
  console.log('═══ 1. ช่องกรอกแถวกิจกรรม ต้องโผล่ตามเอกสารที่หมวดนั้นออกจริง ═══');
  const vis = {};
  for (const cat of ['TRAVEL002', 'TRAVEL004', 'TRAVEL005', 'TRAVEL003']) {
    await send('Page.navigate', { url: APP + '/expense.html' });
    await sleep(4500);
    vis[cat] = await ev([
      "const s=document.getElementById('categorySelect');",
      "s.value='" + cat + "'; s.dispatchEvent(new Event('change',{bubbles:true}));",
      "await new Promise(r=>setTimeout(r,1600));",
      "const e=document.getElementById('extraEntriesBox');",
      "const a=document.getElementById('extraAddrRow');",
      "return { box: e ? (e.offsetParent !== null) : null,",
      "         addr: a ? (a.offsetParent !== null) : null };"
    ].join(NL));
  }
  const addrVis = {};
  for (const k of Object.keys(vis)) { addrVis[k] = vis[k] && vis[k].addr; vis[k] = vis[k] && vis[k].box; }
  ok('หมวดที่ออกทั้งสองใบ (002) เห็นช่อง', vis.TRAVEL002 === true, String(vis.TRAVEL002));
  ok('หมวดที่ออกใบรับรองค่าพาหนะ (004) เห็นช่อง', vis.TRAVEL004 === true, String(vis.TRAVEL004));
  ok('หมวดที่ออกใบรับรองแทนใบเสร็จ (005) เห็นช่อง',
     vis.TRAVEL005 === true, vis.TRAVEL005 ? 'เห็น' : 'ถูกซ่อน ทั้งที่เอกสารพิมพ์แถวนี้');
  ok('หมวดที่ไม่ออกทั้งสองใบ (003) ต้องไม่เห็นช่อง',
     vis.TRAVEL003 === false, vis.TRAVEL003 ? 'เห็น ทั้งที่ไม่มีเอกสารใบไหนใช้' : 'ซ่อนถูกต้อง');

  /* ช่อง "ที่อยู่" ในกล่องเดียวกัน พิมพ์เฉพาะใบรับรองค่าพาหนะ — ใบรับรองแทนใบเสร็จไม่มีบรรทัดที่อยู่
     ถ้าเปิดทั้งกล่องให้หมวดที่ออกแต่ใบหลัง ช่องนี้จะโผล่ให้กรอกแล้วหายเงียบ */
  ok('ช่อง "ที่อยู่" เห็นในหมวดที่ออกใบรับรองค่าพาหนะ (004)', addrVis.TRAVEL004 === true, String(addrVis.TRAVEL004));
  ok('ช่อง "ที่อยู่" เห็นในหมวดที่ออกทั้งสองใบ (002)', addrVis.TRAVEL002 === true, String(addrVis.TRAVEL002));
  ok('ช่อง "ที่อยู่" ซ่อนในหมวด 005 เพราะใบรับรองแทนใบเสร็จไม่พิมพ์บรรทัดที่อยู่',
     addrVis.TRAVEL005 === false,
     addrVis.TRAVEL005 ? 'เห็น = กรอกแล้วหายเงียบ' : 'ซ่อนถูกต้อง');

  // ══════════ 2. วันใต้ลายเซ็น ══════════
  console.log('');
  console.log('═══ 2. วันใต้ลายเซ็นต้องตามวันในตาราง ไม่ใช่วันที่เบิก ═══');
  await send('Page.navigate', { url: APP + '/history.html' });
  await sleep(5500);

  const base = await ev([
    "const REC=" + JSON.stringify(REC) + ";",
    "const b = await buildDocumentHtml(REC, function(){});",
    "const html = b.html;", PICK_SIGN_DATE
  ].join(NL));
  ok('หาใบรับรองแทนใบเสร็จในเอกสารเจอ', base.found === true);
  ok('ลงวัน 07/10/2569 ตามแถวในตาราง (ไม่ใช่ 09/10 ซึ่งเป็นวันที่เบิก)',
     base.dates.includes('07/10/2569') && !base.dates.includes('09/10/2569'),
     base.dates.join(' '));

  const forced = await ev([
    "const REC=" + JSON.stringify(REC) + ";",
    "REC.inputMetadata._docDates = { GENERAL_RECEIPT: '2026-10-11' };",
    "const b = await buildDocumentHtml(REC, function(){});",
    "const html = b.html;", PICK_SIGN_DATE
  ].join(NL));
  ok('ถ้าผู้ใช้ตั้งวันเองไว้ ต้องใช้ของผู้ใช้ ไม่ใช่วันในตาราง',
     forced.dates.includes('11/10/2569'), forced.dates.join(' '));

  const noRows = await ev([
    "const REC=" + JSON.stringify(REC) + ";",
    "REC.inputMetadata._generalReceiptItems = [];",
    "const b = await buildDocumentHtml(REC, function(){});",
    "const html = b.html;", PICK_SIGN_DATE
  ].join(NL));
  ok('ตารางว่าง ถอยไปใช้วันที่เบิกเหมือนเดิม',
     noRows.dates.includes('09/10/2569'), noRows.dates.join(' '));

  /* วันหลังสุดต้อง "ไม่ตรง" กับวันที่เบิก (09/10) ไม่งั้นข้อนี้ผ่านโดยบังเอิญ
     ตั้งแถวเป็น 06 / 08 / 07 (ไม่เรียงลำดับ) คำตอบที่ถูกคือ 08 ซึ่งต่างจากทั้งวันที่เบิก
     วันแรกสุด (06) และแถวสุดท้ายในลิสต์ (07) จึงแยกได้ว่าเลือก "วันหลังสุด" จริง */
  const many = await ev([
    "const REC=" + JSON.stringify(REC) + ";",
    "REC.inputMetadata._generalReceiptItems = [",
    "  { date:'2026-10-06', description:'ค่าที่พัก', amount: 1000 },",
    "  { date:'2026-10-08', description:'ค่าอาหาร', amount: 300 },",
    "  { date:'2026-10-07', description:'ค่าอื่น ๆ', amount: 100 } ];",
    "const b = await buildDocumentHtml(REC, function(){});",
    "const html = b.html;", PICK_SIGN_DATE
  ].join(NL));
  ok('หลายแถวคนละวัน (ไม่เรียงลำดับ) ใช้วันหลังสุด = 08/10 (ยังไม่มีใบจริงแบบนี้)',
     many.dates.includes('08/10/2569') && !many.dates.includes('09/10/2569'),
     many.dates.join(' '));

  /* แถวมีข้อความแต่ไม่ได้กรอกวัน — ห้ามเอาค่าว่างมาตัดสิน ต้องถอยไปใช้วันที่เบิก */
  const blank = await ev([
    "const REC=" + JSON.stringify(REC) + ";",
    "REC.inputMetadata._generalReceiptItems = [",
    "  { date:'', description:'ค่าที่พัก', amount: 3400 } ];",
    "const b = await buildDocumentHtml(REC, function(){});",
    "const html = b.html;", PICK_SIGN_DATE
  ].join(NL));
  ok('แถวมีรายการแต่ไม่ได้กรอกวัน ถอยไปใช้วันที่เบิก ไม่ใช่ค่าว่าง',
     blank.dates.includes('09/10/2569'), blank.dates.join(' '));

  // ══════════ 3. ชื่อเอกสาร ══════════
  console.log('');
  console.log('═══ 3. เรียกชื่อเอกสารให้ตรงกับหัวกระดาษจริง ═══');
  await send('Page.navigate', { url: APP + '/expense.html' });
  await sleep(4500);
  const names = await ev([
    "const s=document.getElementById('categorySelect');",
    "s.value='TRAVEL002'; s.dispatchEvent(new Event('change',{bubbles:true}));",
    "await new Promise(r=>setTimeout(r,1600));",
    "const chips = [...document.querySelectorAll('#pdfTemplateChips *, [id*=\"TemplateChip\"] *')]",
    "  .map(e=>e.textContent.trim()).filter(Boolean);",
    "const body = document.body.innerText || '';",
    "const btn=[...document.querySelectorAll('button,a')].find(b=>/วันที่แยกรายเอกสาร/.test(b.textContent||''));",
    "if (btn) btn.click();",
    "await new Promise(r=>setTimeout(r,500));",
    "const labels=[...document.querySelectorAll('[data-doc]')].map(i=>{",
    "  const l=i.parentElement.querySelector('span'); return l?l.textContent.trim():''; });",
    "return { body: body, labels: labels };"
  ].join(NL));

  ok('ไม่มีคำว่า "ใบรับรองทั่วไป (เงินสด)" เหลืออยู่',
     names.body.indexOf('ใบรับรองทั่วไป (เงินสด)') === -1,
     names.body.indexOf('ใบรับรองทั่วไป (เงินสด)') >= 0 ? 'ยังมีอยู่' : 'ไม่มีแล้ว');
  ok('ไม่มีคำว่า "ใบสำคัญรับเงิน" เหลืออยู่',
     names.body.indexOf('ใบสำคัญรับเงิน') === -1 &&
     !names.labels.some(l => l.indexOf('ใบสำคัญรับเงิน') >= 0),
     names.labels.join(' | '));
  ok('ช่องตั้งวันเรียกชื่อตามหัวกระดาษจริง',
     names.labels.some(l => l.indexOf('ใบรับรองแทนใบเสร็จ') >= 0),
     names.labels.join(' | '));

  console.log('');
  ok('ไม่มี JavaScript error ตลอดการทดสอบ', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '));

  console.log('');
  console.log('══════════════════════════════════════════════════');
  console.log('  ผ่าน ' + results.filter(Boolean).length + ' / ' + results.length);
  console.log('══════════════════════════════════════════════════');
  process.exitCode = results.every(Boolean) ? 0 : 1;
} catch (e) { console.error('ล้มเหลว:', e.message); process.exitCode = 2; }
finally { try { ws.close(); } catch {} chrome.kill(); }
