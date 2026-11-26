// ตาราง FM-SAM-003-06 ต้องเติมแถวค่าที่พักให้เอง + เตือนเมื่อยอดไม่ตรง
//
// 26 พ.ย. 2569 — เจ้าของงานเปิดหน้ากรอกแล้วบอกว่า "งง" เพราะต้องพิมพ์ค่าที่พัก
// สองที่ คือหมวด 1 ค่าที่พัก กับตาราง FM-SAM-003-06 ด้านล่าง
//
// ตรวจฐานข้อมูล production (439 ใบ) พบว่ามี 19 ใบที่ใช้ตารางนี้
//   13 ใบ พิมพ์ค่าที่พักซ้ำสองที่ ตรงกันเป๊ะทั้งข้อความและตัวเลข
//   1 ใบ (id 470) ซ้ำแล้วไม่ตรงกัน ช่องค่าที่พัก 3,530 แต่ตารางบอก 1,980
//   ไม่มีโค้ดไหนเทียบสองยอดนี้เลยสักบรรทัด ใบนั้นจึงผ่านออกไปเงียบ ๆ
//
// สองกล่องนี้ทำคนละหน้าที่จริง และต้องแยกกันต่อไป
//   หมวด 1 ค่าที่พัก -> บวกเข้ายอดเบิก และพิมพ์ลงใบรายงาน 001-04 ข้อ 1
//   ตาราง 003-06    -> พิมพ์ลงใบรับรองแทนใบเสร็จเท่านั้น ไม่บวกเข้ายอด
//                      (ถ้าบวกทั้งสองที่ เงินจะเด้งเป็นสองเท่า)
// แต่เคสปกติตารางแค่เขียนค่าที่พักใหม่ ระบบจึงเติมให้ได้ แล้วให้แก้ทับได้
//
// สิ่งที่ห้ามพัง
//   - หมวดที่ไม่ได้ออกใบ 003-06 (TRAVEL001 / 003 / 004) ต้องไม่มีแถวงอกมา
//   - ยอดเบิกห้ามเปลี่ยน แถวที่เติมให้เป็นแค่ข้อความบนกระดาษ ไม่ใช่เงิน
//   - ผู้ใช้แก้แถวนั้นเองเมื่อไหร่ ระบบต้องเลิกยุ่งกับแถวนั้นตลอดไป
//
//   cd public && python -m http.server 8311 --bind 127.0.0.1
//   APP_URL=http://127.0.0.1:8311 node scripts/test-gr-autofill.mjs
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9676, PROFILE = 'C:/Users/teerapat/AppData/Local/Temp/pb-grauto';
const APP = process.env.APP_URL || 'http://127.0.0.1:8099';
const NEWLINE = String.fromCharCode(10);

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
const ok = (n, pass, d) => { results.push(pass);
  console.log((pass ? '  ผ่าน  ' : '  ตก    ') + n + (d ? '  -> ' + d : '')); };

/* หมวดจริงบน production ทั้ง 5 หมวด (อ่านจากฐานข้อมูล 26 พ.ย. 2569)
   สองหมวดที่ออกใบ 003-06 คือ TRAVEL002 กับ TRAVEL005 */
const CATS = [
  { id: 'TRAVEL001', name: 'เบิกค่าเดินทาง+ที่พัก',                   t: ['REPORT', 'TRANSPORT_RECEIPT'] },
  { id: 'TRAVEL002', name: 'เบิกค่าเดินทาง+ค่าที่พัก (กรณีบิลเงินสด)', t: ['REPORT', 'TRANSPORT_RECEIPT', 'GENERAL_RECEIPT'] },
  { id: 'TRAVEL003', name: 'เบิกค่าที่พัก',                            t: ['NORMAL', 'REPORT'] },
  { id: 'TRAVEL004', name: 'เบิกค่าพาหนะ',                            t: ['TRANSPORT_RECEIPT'] },
  { id: 'TRAVEL005', name: 'เบิกค่าที่พัก (กรณีบิลเงินสด)',            t: ['REPORT', 'GENERAL_RECEIPT'] }
];

/* ใบเก่าที่บันทึกไว้ก่อนมีการเติมอัตโนมัติ — ผู้ใช้พิมพ์แถวในตารางเองไว้แล้ว
   เคสนี้คือความเสี่ยงที่ใหญ่ที่สุด ถ้าระบบเติมซ้ำ เอกสารจะมีค่าที่พักสองแถว
   และ "รวมทั้งสิ้น" ของใบ 003-06 จะกลายเป็นสองเท่าทันที */
const SAVED_OLD = {
  id: 9470, requestedBy: 'ทดสอบ ใบเก่า', amount: 1980,
  category: 'TRAVEL005', date: '2026-10-01', status: 'pending', attachments: [],
  inputMetadata: {
    _pdfTemplates: ['REPORT', 'GENERAL_RECEIPT'],
    _activityName: 'ประชุม', _extraActivities: [],
    _position: 'ผู้เยี่ยมสำรวจ', _affiliation: 'สรพ.', _docDate: '2026-10-01',
    _activityStart: '2026-10-01', _activityEnd: '2026-10-02',
    _addr: { no: '141/36', soi: '', road: '', sub: 'บางปะกอก',
             dist: 'ราษฎร์บูรณะ', prov: 'กรุงเทพมหานคร', zip: '10140' },
    _travel: { startDate: '2026-10-01', endDate: '2026-10-02',
               startTime: '08:00', endTime: '17:00',
               from: 'บ้าน', to: 'สรพ.', distOut: '10', distRet: '10' },
    _carType: 'ไป-กลับ', _fuelMethod: 'distance',
    _costs: { hotelEntries: { name: 'อีโคบลิส รีสอร์ท',
                              entries: [{ type: 'พักเดี่ยว', rate: '990', nights: '2', withWho: '' }] },
              fuelRate: '5', taxiEntries: [], airAmount: 0,
              tollAmount: 0, parkingAmount: 0, otherAmount: 0 },
    _generalReceiptItems: [
      { date: '2026-10-01', description: 'ค่าที่พัก : อีโคบลิส รีสอร์ท 990 บาท x 2 คืน', amount: 1980 }
    ]
  }
};

/* ตัวช่วยที่ฝังไว้ในหน้า — เลือกหมวด กรอกค่าที่พัก แล้วอ่านตาราง 003-06 */
const HELP = [
  "window.__pick = async function (catId) {",
  "  const s = document.getElementById('categorySelect');",
  "  s.value = catId; s.dispatchEvent(new Event('change', { bubbles: true }));",
  "  await new Promise(r => setTimeout(r, 1200));",
  "  return s.value;",
  "};",
  "window.__hotel = async function (rate, nights, name) {",
  "  const d = document.getElementById('dateStart');",
  "  if (d && !d.value) { d.value = '2026-11-26'; d.dispatchEvent(new Event('change', { bubbles: true })); }",
  "  const hn = document.getElementById('hotelName');",
  "  if (hn && name !== undefined) hn.value = name;",
  "  let box = document.querySelectorAll('#accommodationEntriesContainer .accommodation-entry');",
  "  if (!box.length && typeof addAccommodationEntry === 'function') {",
  "    addAccommodationEntry();",
  "    box = document.querySelectorAll('#accommodationEntriesContainer .accommodation-entry');",
  "  }",
  "  if (!box.length) return 'ไม่มีช่องค่าที่พัก';",
  "  const e = box[0];",
  "  const r = e.querySelector('.accommodation-rate');",
  "  const n = e.querySelector('.accommodation-nights');",
  "  r.value = rate; r.dispatchEvent(new Event('input', { bubbles: true }));",
  "  n.value = nights; n.dispatchEvent(new Event('input', { bubbles: true }));",
  "  await new Promise(r2 => setTimeout(r2, 500));",
  "  return 'ok';",
  "};",
  "window.__rows = function () {",
  "  return [...document.querySelectorAll('#generalReceiptBody .gr-row')].map(function (tr) {",
  "    return { auto: tr.dataset.auto === '1',",
  "             date: (tr.querySelector('.gr-date') || {}).value || '',",
  "             desc: (tr.querySelector('.gr-desc') || {}).value || '',",
  "             amt:  (tr.querySelector('.gr-amt')  || {}).value || '' };",
  "  });",
  "};",
  "window.__total = function () {",
  "  return parseFloat(document.getElementById('totalAmount').dataset.value || 0);",
  "};",
  "window.__warn = function () {",
  "  const w = document.getElementById('grHotelMismatch');",
  "  if (!w) return { มี: false };",
  "  return { มี: true, เห็น: !w.classList.contains('hidden'),",
  "           ข้อความ: (w.textContent || '').replace(/\\s+/g, ' ').trim() };",
  "};",
  "return 1;"
].join(NEWLINE);

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
    "const CATS = " + JSON.stringify(CATS.map(c => ({
      id: c.id, name: c.name, pdfTemplates: c.t, attachmentRules: {}, attachmentOrder: []
    }))) + ";",
    "const of = window.fetch;",
    "window.fetch = function (u, i) {",
    "  const s = (typeof u === 'string') ? u : (u && u.url) || '';",
    "  if (s.indexOf('/auth/me') >= 0) return Promise.resolve(new Response(",
    "    JSON.stringify({id:1,email:'t@ha.or.th',name:'ทดสอบ',role:'admin'}),",
    "    {status:200, headers:{'Content-Type':'application/json'}}));",
    "  if (s.indexOf('/budget-categories') >= 0) return Promise.resolve(new Response(",
    "    JSON.stringify(CATS), {status:200, headers:{'Content-Type':'application/json'}}));",
    /* ใบเก่าที่มีแถวในตารางอยู่แล้ว จำลองจากใบจริงบน production
       (ค่าที่พัก 990 x 2 = 1,980 และตารางมีบรรทัดนั้นอยู่แล้วหนึ่งแถว)
       โหมดแก้ไขของหน้านี้ดึง /expenses ทั้งรายการแล้วค่อยหาตาม id
       จึงต้องคืนเป็นอาร์เรย์ ไม่ใช่ตอบที่ /expenses/<id> */
    "  if (s.indexOf('/expenses') >= 0 && (!i || !i.method || i.method === 'GET'))",
    "    return Promise.resolve(new Response(JSON.stringify([" + JSON.stringify(SAVED_OLD) + "]),",
    "      {status:200, headers:{'Content-Type':'application/json'}}));",
    "  if (s.indexOf('/expenses') >= 0 || s.indexOf('/profiles') >= 0)",
    "    return Promise.resolve(new Response('[]',{status:200,headers:{'Content-Type':'application/json'}}));",
    "  return of(u, i);",
    "};"
  ].join(NEWLINE) });

  await send('Page.navigate', { url: APP + '/expense.html' }); await sleep(6500);
  await ev(HELP);

  // ══════════════════════════════════════════════════════════
  console.log('=== 1. หมวดที่ไม่ได้ออกใบ 003-06 ต้องไม่มีแถวงอกมา ===');
  for (const c of ['TRAVEL001', 'TRAVEL003', 'TRAVEL004']) {
    await ev('return await window.__pick("' + c + '");');
    const res = await ev('return await window.__hotel(600, 1, "โรงแรมไทรโยค");');
    const rows = await ev('return window.__rows();');
    ok(c + ' ไม่มีแถวในตาราง 003-06', rows.length === 0,
       (res === 'ok' ? '' : '(' + res + ') ') + rows.length + ' แถว');
  }

  console.log('');
  console.log('=== 2. หมวดที่ออกใบ 003-06 ต้องเติมแถวค่าที่พักให้เอง ===');
  for (const c of ['TRAVEL005', 'TRAVEL002']) {
    await send('Page.navigate', { url: APP + '/expense.html' }); await sleep(6000);
    await ev(HELP);
    await ev('return await window.__pick("' + c + '");');
    await ev('return await window.__hotel(600, 1, "โรงแรมไทรโยค");');
    const rows = await ev('return window.__rows();');
    const r0 = rows[0] || {};
    ok(c + ' มีแถวที่ระบบเติมให้ 1 แถว', rows.length === 1 && r0.auto === true,
       JSON.stringify(rows));
    ok(c + ' ยอดในแถว = 600', String(r0.amt) === '600', String(r0.amt));
    ok(c + ' ข้อความบอกว่าเป็นค่าที่พัก พร้อมอัตราและจำนวนคืน',
       /ค่าที่พัก/.test(r0.desc || '') && /600/.test(r0.desc || '') && /1\s*คืน/.test(r0.desc || ''),
       r0.desc || '-');
    ok(c + ' วันที่เติมตามวันเริ่มเดินทาง และเห็นในช่องจริง (แก้ได้)',
       r0.date === '2026-11-26', r0.date || '(ว่าง)');
  }

  console.log('');
  console.log('=== 3. ยอดเบิกห้ามเปลี่ยน แถวที่เติมให้ไม่ใช่เงิน ===');
  const total = await ev('return window.__total();');
  ok('ยอดเบิกยังเป็น 600 ไม่ใช่ 1,200 (ไม่นับซ้ำ)', total === 600, String(total));

  console.log('');
  console.log('=== 4. แก้แถวเองแล้ว ระบบต้องเลิกยุ่งกับแถวนั้น ===');
  await ev([
    // กันพังตอนยังไม่ได้แก้โค้ด (ยังไม่มีแถวให้แก้) เทสต์จะได้รันครบทุกข้อ
    "const tr = document.querySelector('#generalReceiptBody .gr-row');",
    "if (!tr) return 'ไม่มีแถว';",
    "const d = tr.querySelector('.gr-desc');",
    "d.value = 'ค่าที่พัก จ่ายสดไม่มีใบเสร็จ';",
    "d.dispatchEvent(new Event('input', { bubbles: true }));",
    "return 1;"
  ].join(NEWLINE));
  await ev('return await window.__hotel(800, 2, "โรงแรมไทรโยค");');
  const afterEdit = await ev('return window.__rows();');
  const e0 = afterEdit[0] || {};
  ok('ข้อความที่ผู้ใช้พิมพ์เองไม่ถูกเขียนทับ',
     e0.desc === 'ค่าที่พัก จ่ายสดไม่มีใบเสร็จ', e0.desc || '-');
  ok('ยอดที่ผู้ใช้ไม่ได้แตะ ก็ไม่ถูกเขียนทับด้วย (ทั้งแถวถือว่าเป็นของผู้ใช้แล้ว)',
     String(e0.amt) === '600', String(e0.amt));
  ok('ยังมีแถวเดียว ไม่งอกแถวใหม่ซ้อน', afterEdit.length === 1, afterEdit.length + ' แถว');

  console.log('');
  console.log('=== 5. เตือนเมื่อยอดในตารางไม่ตรงกับค่าที่พัก (ไม่บล็อก) ===');
  // ตอนนี้ค่าที่พัก 800 x 2 = 1,600 แต่ในตารางยังเป็น 600
  const w1 = await ev('return window.__warn();');
  ok('มีที่แสดงคำเตือน', w1['มี'] === true, JSON.stringify(w1));
  ok('ยอดต่างกัน -> เห็นคำเตือน', w1['เห็น'] === true, w1['ข้อความ'] || '-');
  ok('คำเตือนบอกตัวเลขทั้งสองฝั่ง',
     /1,?600/.test(w1['ข้อความ'] || '') && /600/.test(w1['ข้อความ'] || ''), w1['ข้อความ'] || '-');

  await ev([
    "const a = document.querySelector('#generalReceiptBody .gr-amt');",
    "if (!a) return 'ไม่มีแถว';",
    "a.value = '1600'; a.dispatchEvent(new Event('input', { bubbles: true }));",
    "await new Promise(r => setTimeout(r, 300)); return 1;"
  ].join(NEWLINE));
  const w2 = await ev('return window.__warn();');
  ok('ยอดตรงกันแล้ว -> คำเตือนหายไป', w2['เห็น'] === false, w2['ข้อความ'] || '-');

  console.log('');
  console.log('=== 6. บันทึกได้ตามปกติ ไม่มีด่านใหม่มาขวาง ===');
  const blocked = await ev([
    "let msg = '';",
    "const realAlert = window.alert;",
    "window.alert = function (m) { msg = String(m); };",
    "try { if (typeof validateBeforeSave === 'function') validateBeforeSave(); } catch (e) {}",
    "window.alert = realAlert;",
    "return msg;"
  ].join(NEWLINE));
  ok('คำเตือนไม่ได้กลายเป็นด่านบล็อกการบันทึก',
     !/ไม่ตรง|ไม่เท่า/.test(blocked || ''), blocked || '(ไม่มีข้อความ)');

  console.log('');
  console.log('=== 7. หัวกล่องต้องบอกตรง ๆ ว่าไม่ได้บวกเข้ายอดเบิก ===');
  const note = await ev([
    "const sec = document.getElementById('generalReceiptSection');",
    "return sec ? (sec.textContent || '').replace(/\\s+/g,' ').trim().slice(0, 400) : '';"
  ].join(NEWLINE));
  ok('มีข้อความอธิบายว่าตารางนี้ไม่ได้บวกเข้ายอดเบิก',
     /ไม่ได้บวก|ไม่บวก|ไม่ถูกนับ|ไม่เกี่ยวกับยอด/.test(note), note.slice(0, 160) || '-');

  console.log('');
  console.log('=== 8. เคสยกเลิก: ลบค่าที่พักออก แถวที่ระบบเติมต้องหายไปด้วย ===');
  await send('Page.navigate', { url: APP + '/expense.html' }); await sleep(6000);
  await ev(HELP);
  await ev('return await window.__pick("TRAVEL005");');
  await ev('return await window.__hotel(600, 1, "โรงแรมไทรโยค");');
  const before8 = await ev('return window.__rows();');
  await ev('return await window.__hotel("", "", "โรงแรมไทรโยค");');
  const after8 = await ev('return window.__rows();');
  ok('ก่อนลบมี 1 แถว', before8.length === 1, before8.length + ' แถว');
  ok('ลบค่าที่พักแล้ว แถวที่ระบบเติมหายไป', after8.length === 0, after8.length + ' แถว');

  console.log('');
  console.log('=== 9. แถวที่ผู้ใช้เพิ่มเอง ห้ามถูกแตะ ===');
  await ev('return await window.__hotel(600, 1, "โรงแรมไทรโยค");');
  await ev([
    "addGeneralReceiptRow();",
    "const rows = document.querySelectorAll('#generalReceiptBody .gr-row');",
    "const last = rows[rows.length - 1];",
    "if (!last) return 'ไม่มีแถว';",
    "last.querySelector('.gr-desc').value = 'ค่าอาหาร';",
    "const a = last.querySelector('.gr-amt');",
    "a.value = '250'; a.dispatchEvent(new Event('input', { bubbles: true }));",
    "return 1;"
  ].join(NEWLINE));
  await ev('return await window.__hotel(900, 1, "โรงแรมไทรโยค");');
  const rows9 = await ev('return window.__rows();');
  const manual = rows9.find(r => r.desc === 'ค่าอาหาร');
  const auto9 = rows9.find(r => r.auto === true);
  ok('แถวที่ผู้ใช้เพิ่มเองยังอยู่ครบ ไม่ถูกแก้', !!manual && String(manual.amt) === '250',
     JSON.stringify(rows9));
  ok('แถวที่ระบบเติมอัปเดตตามค่าที่พักใหม่ 900', !!auto9 && String(auto9.amt) === '900',
     auto9 ? String(auto9.amt) : '-');
  ok('มี 2 แถว ไม่งอกเกิน', rows9.length === 2, rows9.length + ' แถว');

  console.log('');
  console.log('=== 10. เปิดใบเก่ามาแก้ ห้ามได้แถวค่าที่พักซ้ำสองแถว ===');
  await send('Page.navigate', { url: APP + '/expense.html?edit=9470' }); await sleep(8000);
  await ev(HELP);
  const rows10 = await ev('return window.__rows();');
  ok('ยังมีแถวเดียวเท่าที่บันทึกไว้ ไม่มีแถวใหม่งอก', rows10.length === 1,
     JSON.stringify(rows10));
  ok('ข้อความเดิมของผู้ใช้ไม่ถูกเขียนทับ',
     (rows10[0] || {}).desc === 'ค่าที่พัก : อีโคบลิส รีสอร์ท 990 บาท x 2 คืน',
     (rows10[0] || {}).desc || '-');
  ok('ยอดในตารางยังเป็น 1980 เท่าเดิม', String((rows10[0] || {}).amt) === '1980',
     String((rows10[0] || {}).amt));
  const t10 = await ev('return window.__total();');
  ok('ยอดเบิกของใบเก่ายังเป็น 1,980 ไม่เด้งเป็นสองเท่า', t10 === 1980, String(t10));
  const w10 = await ev('return window.__warn();');
  ok('ยอดตรงกันอยู่แล้ว จึงไม่มีคำเตือนมากวน', w10['เห็น'] === false,
     w10['ข้อความ'] || '-');

  console.log('');
  ok('ไม่มี JavaScript error ตลอดการทดสอบ', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '));

  console.log('');
  console.log('══════════════════════════════════════════════════');
  console.log('  ผ่าน ' + results.filter(Boolean).length + ' / ' + results.length);
  console.log('══════════════════════════════════════════════════');
  process.exitCode = results.every(Boolean) ? 0 : 1;
} catch (e) { console.error('ล้มเหลว:', e.message); process.exitCode = 2; }
finally { try { ws.close(); } catch {} chrome.kill(); }
