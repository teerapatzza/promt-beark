// หมวดที่แอดมินสร้างเองในอนาคต — ติ๊กใบ 003-06 คู่กับใบอื่นแบบไหนก็ต้องไม่พัง
//
// 26 พ.ย. 2569 — เจ้าของงานถามว่า "ถ้าผมสร้างหมวดใหม่เองแล้วติ๊กใบนี้คู่กับใบอื่น
// มันจะทำงานเหมือนกันไหม ได้คำนึงถึงจุดนี้ป่าว" ตรวจแล้วพบว่ายังไม่ครบ
//
// ตัวเติมแถวค่าที่พักรุ่นแรกดูแค่ว่า "หมวดนี้ออกใบ 003-06 ไหม"
// แต่ในระบบเดิม ค่าที่พักผูกกับใบรายงานการเดินทาง (REPORT) อีกชั้นหนึ่ง
//     expense.html  show('secHotel', hasReport)         <- ไม่ติ๊ก REPORT = ซ่อนกล่อง
//     expense.html  const hotel = onReport ? getHotelTotal() : 0   <- และไม่นับเป็นเงิน
// ช่องที่ถูกซ่อนไม่ได้ถูกล้างค่า ของค้างจากหมวดก่อนหน้าจึงยังอยู่ในช่อง
// หมวดอย่าง "ใบพาหนะ + 003-06" จึงจะได้แถวค่าที่พักผีขึ้นมาในเอกสาร
// ทั้งที่เงินก้อนนั้นไม่ได้อยู่ในใบเบิกเลย
//
// กฎที่ถูกต้อง: ค่าที่พักจะไปอยู่ในตาราง 003-06 ได้ ต้องเข้าเงื่อนไขครบสองข้อ
//   1. หมวดนี้ออกใบ 003-06   (ไม่งั้นไม่มีตารางให้ใส่)
//   2. หมวดนี้ออกใบรายงาน     (ไม่งั้นค่าที่พักไม่ใช่ส่วนหนึ่งของใบเบิกนี้)
//
// เทสต์นี้จงใจสร้างหมวดที่ "ยังไม่มีใครสร้าง" ขึ้นมาทดลอง เพราะเป็นของที่
// แอดมินกดสร้างเองได้ทุกเมื่อ โดยไม่ต้องแก้โค้ด
//
//   cd public && python -m http.server 8311 --bind 127.0.0.1
//   APP_URL=http://127.0.0.1:8311 node scripts/test-gr-custom-categories.mjs
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9678, PROFILE = 'C:/Users/teerapat/AppData/Local/Temp/pb-grcustom';
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

/* สองหมวดแรกคือของจริงที่มีอยู่ ใช้เป็นตัวควบคุม
   ที่เหลือคือหมวดสมมุติที่แอดมินกดสร้างเองได้ทุกเมื่อ */
const CATS = [
  { id: 'C_REP_GR',      name: 'ใบรายงาน + 003-06',              t: ['REPORT', 'GENERAL_RECEIPT'],                     หวังว่า: 'เติม' },
  { id: 'C_REP_RC_GR',   name: 'ใบรายงาน + ใบพาหนะ + 003-06',    t: ['REPORT', 'TRANSPORT_RECEIPT', 'GENERAL_RECEIPT'], หวังว่า: 'เติม' },
  { id: 'C_RC_GR',       name: 'ใบพาหนะ + 003-06',               t: ['TRANSPORT_RECEIPT', 'GENERAL_RECEIPT'],          หวังว่า: 'ไม่เติม' },
  { id: 'C_GR_ONLY',     name: '003-06 อย่างเดียว',               t: ['GENERAL_RECEIPT'],                               หวังว่า: 'ไม่เติม' },
  { id: 'C_NORMAL_GR',   name: 'บันทึกข้อความ + 003-06',          t: ['NORMAL', 'GENERAL_RECEIPT'],                     หวังว่า: 'ไม่เติม' },
  { id: 'C_REP_RC',      name: 'ใบรายงาน + ใบพาหนะ (ไม่มี 003-06)', t: ['REPORT', 'TRANSPORT_RECEIPT'],                 หวังว่า: 'ไม่มีตาราง' }
];

const HELP = [
  "window.__pick = async function (catId) {",
  "  const s = document.getElementById('categorySelect');",
  "  s.value = catId; s.dispatchEvent(new Event('change', { bubbles: true }));",
  "  await new Promise(r => setTimeout(r, 1300));",
  "  return s.value;",
  "};",
  "window.__hotel = async function (rate, nights) {",
  "  const d = document.getElementById('dateStart');",
  "  if (d && !d.value) { d.value = '2026-11-26'; d.dispatchEvent(new Event('change', { bubbles: true })); }",
  "  const hn = document.getElementById('hotelName'); if (hn) hn.value = 'โรงแรมไทรโยค';",
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
  /* เขย่าให้ระบบคิดยอดใหม่ โดยไม่แตะช่องค่าที่พัก
     จำลองเหตุการณ์จริงคือผู้ใช้ไปกรอกช่องอื่นต่อหลังสลับหมวด */
  "window.__nudge = async function () {",
  "  const t = document.getElementById('tollCost');",
  "  if (t) { t.value = t.value || ''; t.dispatchEvent(new Event('input', { bubbles: true })); }",
  "  if (typeof calculateTravelTotal === 'function') { try { calculateTravelTotal(); } catch (e) {} }",
  "  await new Promise(r => setTimeout(r, 500));",
  "  return 1;",
  "};",
  "window.__rows = function () {",
  "  return [...document.querySelectorAll('#generalReceiptBody .gr-row')].map(function (tr) {",
  "    return { auto: tr.dataset.auto === '1',",
  "             desc: (tr.querySelector('.gr-desc') || {}).value || '',",
  "             amt:  (tr.querySelector('.gr-amt')  || {}).value || '' };",
  "  });",
  "};",
  "window.__hotelShown = function () {",
  "  const b = document.getElementById('secHotel');",
  "  return !!b && !b.classList.contains('hidden');",
  "};",
  "window.__grShown = function () {",
  "  const b = document.getElementById('generalReceiptSection');",
  "  return !!b && !b.classList.contains('hidden');",
  "};",
  "window.__hotelRaw = function () {",
  "  const e = document.querySelector('#accommodationEntriesContainer .accommodation-entry');",
  "  if (!e) return '';",
  "  return (e.querySelector('.accommodation-rate') || {}).value + ' x ' +",
  "         (e.querySelector('.accommodation-nights') || {}).value;",
  "};",
  "window.__total = function () {",
  "  return parseFloat(document.getElementById('totalAmount').dataset.value || 0);",
  "};",
  "window.__warnShown = function () {",
  "  const w = document.getElementById('grHotelMismatch');",
  "  return !!w && !w.classList.contains('hidden');",
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
    "  if (s.indexOf('/expenses') >= 0 || s.indexOf('/profiles') >= 0)",
    "    return Promise.resolve(new Response('[]',{status:200,headers:{'Content-Type':'application/json'}}));",
    "  return of(u, i);",
    "};"
  ].join(NEWLINE) });

  // ══════════════════════════════════════════════════════════
  console.log('=== 1. เปิดหมวดสด ๆ ทีละหมวด (ไม่มีของค้าง) ===');
  for (const c of CATS) {
    await send('Page.navigate', { url: APP + '/expense.html' }); await sleep(6000);
    await ev(HELP);
    await ev('return await window.__pick("' + c.id + '");');
    const hotelShown = await ev('return window.__hotelShown();');
    const grShown = await ev('return window.__grShown();');
    await ev('return await window.__hotel(600, 1);');
    const rows = await ev('return window.__rows();');
    const auto = rows.filter(r => r.auto).length;

    if (c['หวังว่า'] === 'เติม') {
      ok(c.name + ' -> เติมแถวให้ 1 แถว', auto === 1 && rows.length === 1, JSON.stringify(rows));
      ok(c.name + ' -> กล่องค่าที่พักแสดงอยู่จริง', hotelShown === true, String(hotelShown));
    } else if (c['หวังว่า'] === 'ไม่เติม') {
      ok(c.name + ' -> ไม่มีแถวงอกมา', rows.length === 0,
         'กล่องที่พักแสดง ' + hotelShown + ' · ตาราง 003-06 แสดง ' + grShown + ' · ' + JSON.stringify(rows));
    } else {
      ok(c.name + ' -> ไม่มีตาราง 003-06 และไม่มีแถว',
         grShown === false && rows.length === 0,
         'ตารางแสดง ' + grShown + ' · ' + JSON.stringify(rows));
    }
  }

  // ══════════════════════════════════════════════════════════
  console.log('');
  console.log('=== 2. เคสจริงที่อันตรายที่สุด: มีค่าที่พักค้างในช่องที่ซ่อนอยู่ ===');
  console.log('    (กรอกค่าที่พักในหมวดที่มีใบรายงานก่อน แล้วค่อยสลับไปหมวดที่ไม่มี)');
  for (const target of ['C_RC_GR', 'C_GR_ONLY', 'C_NORMAL_GR']) {
    const c = CATS.find(x => x.id === target);
    await send('Page.navigate', { url: APP + '/expense.html' }); await sleep(6000);
    await ev(HELP);
    await ev('return await window.__pick("C_REP_GR");');
    await ev('return await window.__hotel(600, 1);');
    const before = await ev('return window.__rows();');

    await ev('return await window.__pick("' + target + '");');
    await ev('return await window.__nudge();');
    const raw = await ev('return window.__hotelRaw();');
    const after = await ev('return window.__rows();');
    const warn = await ev('return window.__warnShown();');

    ok('ตั้งต้น: หมวดที่มีใบรายงาน เติมแถวให้แล้ว 1 แถว', before.length === 1,
       JSON.stringify(before));
    ok('สลับไป "' + c.name + '" แล้ว แถวค่าที่พักต้องหายไป',
       after.filter(r => r.auto).length === 0,
       'ค่าที่ค้างในช่องที่ซ่อน = ' + raw + ' · ' + JSON.stringify(after));
    ok('และต้องไม่มีคำเตือนโผล่มาจากค่าที่มองไม่เห็น', warn === false, String(warn));
  }

  // ══════════════════════════════════════════════════════════
  console.log('');
  console.log('=== 3. สลับกลับไปหมวดเดิม ต้องกลับมาทำงานถูกต้อง ===');
  await send('Page.navigate', { url: APP + '/expense.html' }); await sleep(6000);
  await ev(HELP);
  await ev('return await window.__pick("C_REP_GR");');
  await ev('return await window.__hotel(600, 1);');
  await ev('return await window.__pick("C_RC_GR");');
  await ev('return await window.__nudge();');
  await ev('return await window.__pick("C_REP_GR");');
  await ev('return await window.__nudge();');
  const back = await ev('return window.__rows();');
  ok('กลับมาหมวดเดิม ได้แถวค่าที่พักคืน 1 แถว',
     back.length === 1 && back[0].auto === true, JSON.stringify(back));
  ok('ยอดในแถวถูกต้อง 600', String((back[0] || {}).amt) === '600',
     String((back[0] || {}).amt));

  console.log('');
  ok('ไม่มี JavaScript error ตลอดการทดสอบ', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '));

  console.log('');
  console.log('══════════════════════════════════════════════════');
  console.log('  ผ่าน ' + results.filter(Boolean).length + ' / ' + results.length);
  console.log('══════════════════════════════════════════════════');
  process.exitCode = results.every(Boolean) ? 0 : 1;
} catch (e) { console.error('ล้มเหลว:', e.message); process.exitCode = 2; }
finally { try { ws.close(); } catch {} chrome.kill(); }
