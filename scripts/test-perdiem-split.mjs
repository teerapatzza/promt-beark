// แยก "ค่าเบี้ยเลี้ยง" ออกจาก "อื่นๆ" + ตัวอักษรจำนวนเงินของใบ FM-SAM-003-06
//
// 26 พ.ย. 2569 — เจ้าของงานส่งใบจริงสามใบมาให้ดู แล้วสั่งสองเรื่อง
//
// เรื่องที่ 1 — ข้อ 3 ของใบรายงาน (FM-SAM-001-04) พิมพ์ว่า "ค่าเบี้ยเลี้ยง / อื่นๆ"
//   รวมกันอยู่บรรทัดเดียว คนตรวจแยกไม่ออกว่ายอดนั้นคือเบี้ยเลี้ยงหรือค่าอะไร
//   ต้องการให้แยกเป็นสองบรรทัด และบรรทัด "อื่นๆ" ต้องบอกได้ว่าอื่นๆ คืออะไร
//   เช่นผู้ใช้พิมพ์ "ค่ารถในสนามบิน" เอกสารต้องขึ้น "อื่นๆ (ค่ารถในสนามบิน)"
//   คำสั่งที่ย้ำคือ "วิธีคำนวณทุกๆ อย่างยังทำงานถูกเหมือนเดิมนะ"
//
// เรื่องที่ 2 — ใบรับรองแทนใบเสร็จรับเงิน (FM-SAM-003-06) วางตัวอักษรจำนวนเงิน
//   ไว้ในคอลัมน์ "จำนวนเงิน" ที่กว้างแค่ 22% ไม่เหมือนอีกสองใบซึ่งใช้แถวเต็มความกว้าง
//   จัดกึ่งกลางและครอบวงเล็บ เจ้าของงานสั่งให้ "ปรับให้เป็นฟอร์มเหมือนอันอื่นๆ"
//   และเลือกให้ใช้คำว่า "จำนวนเงินตัวอักษร" เหมือนใบ 095-00
//
// กติกาที่ห้ามพัง (ตรวจไว้ในเทสต์นี้ด้วย)
//   - ใบเก่าที่บันทึกไว้ก่อนวันนี้มีตัวเลขก้อนเดียว แยกไม่ได้ ต้องพิมพ์
//     "ค่าเบี้ยเลี้ยง / อื่นๆ" เหมือนเดิมทุกตัวอักษร ห้ามเปลี่ยนความหมายย้อนหลัง
//   - ใบ 095-00 แบบฟอร์มจริงมีแถว "ค่าใช้จ่ายอื่นๆ" แถวเดียว ห้ามเพิ่มแถว
//     เบี้ยเลี้ยงกับอื่นๆ จึงบวกกันลงแถวเดิม และ "รวมทั้งสิ้น" ต้องเท่าเดิม
//
//   cd public && python -m http.server 8311 --bind 127.0.0.1
//   APP_URL=http://127.0.0.1:8311 node scripts/test-perdiem-split.mjs
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9674, PROFILE = 'C:/Users/teerapat/AppData/Local/Temp/pb-perdiem';
const APP = process.env.APP_URL || 'http://127.0.0.1:8099';

/* ขึ้นบรรทัดใหม่แบบไม่ต้องเขียน escape ในสตริง
   เครื่องมือแก้ไฟล์ของสภาพแวดล้อมนี้เคยทำ \n ในสตริงพังมาหลายครั้ง */
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

/* ── ใบเบิกจำลอง ───────────────────────────────────────────────
   เปลี่ยนเฉพาะก้อน _costs ส่วนอื่นเหมือนกันทุกใบ จะได้เทียบกันตรง ๆ */
const mk = (templates, costs, extra) => ({
  id: 9701, requestedBy: 'ทดสอบ แยกเบี้ยเลี้ยง', amount: 1000,
  category: 'TRAVEL001', date: '2026-11-26',
  inputMetadata: Object.assign({
    _pdfTemplates: templates,
    _activityName: 'ประชุม', _extraActivities: [],
    _position: 'ผู้เยี่ยมสำรวจ', _affiliation: 'สรพ.', _docDate: '2026-11-26',
    _addr: { no: '141/36', soi: 'สุขสวัสดิ์ 55', road: 'สุขสวัสดิ์',
             sub: 'บางปะกอก', dist: 'ราษฎร์บูรณะ', prov: 'กรุงเทพมหานคร', zip: '10140' },
    _travel: { startDate: '2026-11-26', endDate: '2026-11-26',
               from: 'บ้าน', to: 'สรพ.', distOut: '10', distRet: '10' },
    _carType: 'ไป-กลับ', _fuelMethod: 'distance', _costs: costs
  }, extra || {})
});

// ของกลางที่ใบไหนก็ใช้เหมือนกัน — ไม่มีคีย์ perDiemAmount = ใบแบบเก่า
const BASE_OLD = { hotelEntries: { entries: [] }, fuelRate: '5', taxiEntries: [],
                   airAmount: 0, tollAmount: 0, parkingAmount: 0 };

/* อ่านข้อ 3 ของใบรายงาน: คืนเป็น [{ no, label, amount }] ตามที่พิมพ์จริง
   โครงแถวคือ td ว่าง | "3.x  label" | "เป็นเงิน" | ตัวเลข | "บาท" */
const READ_REPORT = [
  "window.renderRouteMapImage = async () => null;",
  "const NB = String.fromCharCode(160);",
  "async function readSec3(rec) {",
  "  const b = await buildDocumentHtml(rec, function(){});",
  "  const d = document.createElement('div'); d.innerHTML = (b && b.html) || '';",
  "  const out = [];",
  "  d.querySelectorAll('tr').forEach(function (tr) {",
  "    const tds = [...tr.querySelectorAll('td')].map(function (x) {",
  "      return (x.textContent || '').split(NB).join(' ').replace(/\\s+/g,' ').trim(); });",
  "    const lab = tds.find(function (t) { return /^3\\.[0-9]/.test(t); });",
  "    if (!lab) return;",
  "    const num = tds.map(function (t) { return t.replace(/,/g,''); })",
  "                   .find(function (t) { return /^[0-9]+(\\.[0-9]+)?$/.test(t); });",
  "    out.push({ no: lab.slice(0,3), label: lab.slice(3).trim(),",
  "               amount: num ? parseFloat(num) : 0 });",
  "  });",
  "  return out;",
  "}"
].join(NEWLINE);

/* อ่านใบรับรองค่าพาหนะ (095-00): แถว "ค่าใช้จ่ายอื่นๆ" กับ "รวมทั้งสิ้น" */
const READ_RC = [
  "window.renderRouteMapImage = async () => null;",
  "async function readRc(rec) {",
  "  const b = await buildDocumentHtml(rec, function(){});",
  "  const d = document.createElement('div'); d.innerHTML = (b && b.html) || '';",
  "  const rows = [...d.querySelectorAll('tr')];",
  "  function amtOf(needle) {",
  "    for (const tr of rows) {",
  "      const t = (tr.textContent || '').replace(/\\s+/g,' ');",
  "      if (t.indexOf(needle) < 0) continue;",
  "      const tds = [...tr.querySelectorAll('td')].map(function (x) {",
  "        return (x.textContent || '').replace(/[\\s,]/g,''); });",
  "      const n = tds.find(function (s) { return /^[0-9]+(\\.[0-9]+)?$/.test(s); });",
  "      return n ? parseFloat(n) : 0;",
  "    }",
  "    return null;",
  "  }",
  "  return { other: amtOf('ค่าใช้จ่ายอื่นๆ (โปรดระบุ)'), total: amtOf('รวมทั้งสิ้น') };",
  "}"
].join(NEWLINE);

/* อ่านแถวตัวอักษรจำนวนเงินของใบ 003-06 */
const READ_GR = [
  "window.renderRouteMapImage = async () => null;",
  "async function readGr(rec) {",
  "  const b = await buildDocumentHtml(rec, function(){});",
  "  const host = document.createElement('div');",
  "  host.style.cssText = 'position:absolute;left:-99999px;top:0;';",
  "  host.innerHTML = (b && b.html) || ''; document.body.appendChild(host);",
  "  let hit = null;",
  "  [...host.querySelectorAll('tr')].forEach(function (tr) {",
  "    const t = (tr.textContent || '').replace(/\\s+/g,' ').trim();",
  "    if (t.indexOf('ตัวอักษร') < 0 || hit) return;",
  "    const tds = [...tr.querySelectorAll('td')];",
  "    hit = { text: t, cells: tds.length,",
  "            colspan: tds.length ? (tds[0].getAttribute('colspan') || '') : '',",
  "            align: tds.length ? getComputedStyle(tds[0]).textAlign : '' };",
  "  });",
  "  const all = (host.textContent || '').replace(/\\s+/g,' ');",
  /* ฟอนต์ของตัวเลขในใบนี้ ต้องเป็นฟอนต์เดียวกับทั้งเอกสาร ไม่ใช่ฟอนต์พิมพ์ดีด
     เทียบกับฟอนต์ของหน้ากระดาษเอง ไม่ฮาร์ดโค้ดชื่อฟอนต์ เพราะชื่ออาจเปลี่ยน */
  "  const page = host.querySelector('.pdf-page');",
  "  const pageFont = page ? getComputedStyle(page).fontFamily : '';",
  "  const nums = [...host.querySelectorAll('td')].filter(function (td) {",
  "    return /^[0-9,]+\\.[0-9]{2}$/.test((td.textContent||'').trim()); });",
  "  const numFonts = [...new Set(nums.map(function (td) {",
  "    return getComputedStyle(td).fontFamily; }))];",
  "  host.remove();",
  "  return { row: hit, hasOldLabel: all.indexOf('จำนวนเงินรวมตัวอักษร') >= 0,",
  "           pageFont: pageFont, numFonts: numFonts, numCount: nums.length };",
  "}"
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
    "const of = window.fetch;",
    "window.fetch = function (u, i) {",
    "  const s = (typeof u === 'string') ? u : (u && u.url) || '';",
    "  if (s.indexOf('/auth/me') >= 0) return Promise.resolve(new Response(",
    "    JSON.stringify({id:1,email:'t@ha.or.th',name:'ทดสอบ',role:'admin'}),",
    "    {status:200, headers:{'Content-Type':'application/json'}}));",
    "  if (s.indexOf('/budget-categories') >= 0) return Promise.resolve(new Response(",
    "    JSON.stringify([{ id:'TRAVEL001', name:'ทดสอบ',",
    "      pdfTemplates:['REPORT','TRANSPORT_RECEIPT','GENERAL_RECEIPT'],",
    "      attachmentRules:{}, attachmentOrder:[] }]),",
    "    {status:200, headers:{'Content-Type':'application/json'}}));",
    "  if (s.indexOf('/expenses') >= 0 || s.indexOf('/profiles') >= 0)",
    "    return Promise.resolve(new Response('[]',{status:200,headers:{'Content-Type':'application/json'}}));",
    "  return of(u, i);",
    "};"
  ].join(NEWLINE) });

  await send('Page.navigate', { url: APP + '/history.html' }); await sleep(6000);

  // ══════════════════════════════════════════════════════════
  console.log('=== 1. ใบรายงาน 001-04 — ใบใหม่ต้องแยกสองบรรทัด ===');
  const newCosts = Object.assign({}, BASE_OLD,
    { perDiemAmount: 200, otherAmount: 150, otherDesc: 'ค่ารถในสนามบิน' });
  const s1 = await ev(READ_REPORT + NEWLINE +
    'return await readSec3(' + JSON.stringify(mk(['REPORT'], newCosts)) + ');');
  const perDiemRow = s1.find(r => r.label === 'ค่าเบี้ยเลี้ยง');
  const otherRow   = s1.find(r => r.label.indexOf('อื่นๆ') === 0);
  ok('มีบรรทัด "ค่าเบี้ยเลี้ยง" แยกออกมา', !!perDiemRow,
     JSON.stringify(s1.map(r => r.no + ' ' + r.label)));
  ok('บรรทัดเบี้ยเลี้ยงได้ยอด 200', perDiemRow && perDiemRow.amount === 200,
     perDiemRow ? String(perDiemRow.amount) : '-');
  ok('มีบรรทัด "อื่นๆ (ค่ารถในสนามบิน)" ตามที่ผู้ใช้พิมพ์',
     !!otherRow && otherRow.label === 'อื่นๆ (ค่ารถในสนามบิน)',
     otherRow ? otherRow.label : '-');
  ok('บรรทัดอื่นๆ ได้ยอด 150', otherRow && otherRow.amount === 150,
     otherRow ? String(otherRow.amount) : '-');
  ok('ไม่มีคำว่า "ค่าเบี้ยเลี้ยง / อื่นๆ" เหลือในใบใหม่',
     !s1.some(r => r.label.indexOf('/') >= 0),
     JSON.stringify(s1.map(r => r.label)));

  console.log('');
  console.log('=== 2. ใบใหม่ที่ไม่ได้ระบุว่าอื่นๆ คืออะไร ต้องไม่มีวงเล็บว่าง ===');
  const noDesc = Object.assign({}, BASE_OLD, { perDiemAmount: 0, otherAmount: 150, otherDesc: '' });
  const s2 = await ev(READ_REPORT + NEWLINE +
    'return await readSec3(' + JSON.stringify(mk(['REPORT'], noDesc)) + ');');
  const o2 = s2.find(r => r.label.indexOf('อื่นๆ') === 0);
  ok('ป้ายเป็น "อื่นๆ" เฉย ๆ', !!o2 && o2.label === 'อื่นๆ', o2 ? o2.label : '-');

  console.log('');
  console.log('=== 3. ใบเก่า (ไม่มีคีย์ perDiemAmount) ต้องเหมือนเดิมทุกตัวอักษร ===');
  const oldCosts = Object.assign({}, BASE_OLD, { otherAmount: 200 });
  const s3 = await ev(READ_REPORT + NEWLINE +
    'return await readSec3(' + JSON.stringify(mk(['REPORT'], oldCosts)) + ');');
  const legacy = s3.find(r => r.amount === 200);
  ok('ใบเก่ายังพิมพ์ "ค่าเบี้ยเลี้ยง / อื่นๆ" เหมือนเดิม',
     !!legacy && legacy.label === 'ค่าเบี้ยเลี้ยง / อื่นๆ', legacy ? legacy.label : '-');
  ok('ใบเก่ายังเป็นบรรทัด 3.1 เหมือนเดิม', !!legacy && legacy.no === '3.1',
     legacy ? legacy.no : '-');
  ok('ใบเก่ายังมีสองบรรทัดเท่าเดิม (บรรทัดที่สองเว้นว่าง)', s3.length === 2, String(s3.length));

  console.log('');
  console.log('=== 4. ใบ 095-00 — ห้ามเพิ่มแถว และยอดรวมต้องเท่าเดิม ===');
  // ระยะ 10+10 กม. อัตรา 5 บาท = 100 | เบี้ยเลี้ยง 200 + อื่นๆ 150 = 350
  const rcNew = await ev(READ_RC + NEWLINE +
    'return await readRc(' + JSON.stringify(mk(['TRANSPORT_RECEIPT'], newCosts)) + ');');
  const rcOld = await ev(READ_RC + NEWLINE +
    'return await readRc(' + JSON.stringify(mk(['TRANSPORT_RECEIPT'],
      Object.assign({}, BASE_OLD, { otherAmount: 350 }))) + ');');
  ok('แถว "ค่าใช้จ่ายอื่นๆ" = เบี้ยเลี้ยง + อื่นๆ = 350', rcNew.other === 350, String(rcNew.other));
  ok('รวมทั้งสิ้นของใบใหม่ เท่ากับใบเก่าที่ยอดก้อนเดียว 350',
     rcNew.total !== null && rcNew.total === rcOld.total,
     'ใหม่ ' + rcNew.total + ' · เก่า ' + rcOld.total);
  ok('รวมทั้งสิ้น = ค่าน้ำมัน 100 + 350 = 450', rcNew.total === 450, String(rcNew.total));

  console.log('');
  console.log('=== 5. ใบ 003-06 — ตัวอักษรจำนวนเงินต้องเป็นแถวเต็มความกว้าง จัดกึ่งกลาง ===');
  const grRec = mk(['GENERAL_RECEIPT'], BASE_OLD,
    { _generalReceiptItems: [{ date: '2026-11-27', description: 'ค่าที่พัก', amount: 600 }] });
  const gr = await ev(READ_GR + NEWLINE + 'return await readGr(' + JSON.stringify(grRec) + ');');
  ok('หาแถวตัวอักษรจำนวนเงินเจอ', !!gr.row, JSON.stringify(gr.row));
  ok('เป็นช่องเดียวกินเต็มแถว (colspan=3)',
     !!gr.row && gr.row.cells === 1 && gr.row.colspan === '3',
     gr.row ? gr.row.cells + ' ช่อง colspan=' + gr.row.colspan : '-');
  ok('จัดกึ่งกลางเหมือนอีกสองใบ', !!gr.row && gr.row.align === 'center',
     gr.row ? gr.row.align : '-');
  ok('ใช้คำว่า "จำนวนเงินตัวอักษร ( ... )" เหมือนใบ 095-00',
     !!gr.row && /จำนวนเงินตัวอักษร \( .+บาทถ้วน \)/.test(gr.row.text),
     gr.row ? gr.row.text : '-');
  ok('ไม่มีคำว่า "จำนวนเงินรวมตัวอักษร" เหลืออยู่', gr.hasOldLabel === false,
     String(gr.hasOldLabel));

  /* 26 พ.ย. 2569 (รอบสอง) — เจ้าของงานสั่งเพิ่มให้ฟอนต์ตัวเลขเหมือนใบอื่นด้วย
     ใบนี้ตั้ง font-family: monospace ไว้สองจุด (แถวรายการ กับ แถวรวมทั้งสิ้น)
     ทำให้ตัวเลขเป็นฟอนต์พิมพ์ดีด ต่างจากใบ 001-04 และ 095-00 ซึ่งไม่ตั้งอะไรเลย */
  console.log('');
  console.log('=== 5ก. ตัวเลขต้องใช้ฟอนต์เดียวกับทั้งเอกสาร ไม่ใช่ฟอนต์พิมพ์ดีด ===');
  ok('หาช่องตัวเลขเจอ (แถวรายการ + รวมทั้งสิ้น)', gr.numCount >= 2, gr.numCount + ' ช่อง');
  ok('ไม่มีช่องไหนเป็น monospace',
     !gr.numFonts.some(f => /mono/i.test(f)), gr.numFonts.join(' | '));
  ok('ตัวเลขใช้ฟอนต์เดียวกับหน้ากระดาษ',
     gr.numFonts.length === 1 && gr.numFonts[0] === gr.pageFont,
     'ตัวเลข ' + gr.numFonts.join(' | ') + '  ·  หน้ากระดาษ ' + gr.pageFont);

  // ══════════════════════════════════════════════════════════
  console.log('');
  console.log('=== 6. หน้ากรอกใบเบิก — ต้องมีสองช่องแยกกัน + ช่องระบุว่าอื่นๆ คืออะไร ===');
  await send('Page.navigate', { url: APP + '/expense.html' }); await sleep(6000);
  const form = await ev([
    "const q = id => document.getElementById(id);",
    "const labOf = id => { const b = q(id) ? q(id).closest('div') : null;",
    "  const l = b ? b.querySelector('label') : null;",
    "  return l ? (l.textContent||'').replace(/\\s+/g,' ').trim() : ''; };",
    "return { perDiem: !!q('perDiemCost'), other: !!q('otherCost'), desc: !!q('otherDesc'),",
    "         labPerDiem: labOf('perDiemCost'), labOther: labOf('otherCost'),",
    "         breakdown: !!q('breakdownPerDiem') };"
  ].join(NEWLINE));
  ok('มีช่องค่าเบี้ยเลี้ยง (perDiemCost)', form.perDiem === true, String(form.perDiem));
  ok('ยังมีช่องอื่นๆ เดิม (otherCost)', form.other === true, String(form.other));
  ok('มีช่องระบุว่าอื่นๆ คืออะไร (otherDesc)', form.desc === true, String(form.desc));
  ok('ป้ายช่องเบี้ยเลี้ยงเป็น "3.3 ค่าเบี้ยเลี้ยง"',
     form.labPerDiem === '3.3 ค่าเบี้ยเลี้ยง', form.labPerDiem || '-');
  ok('ป้ายช่องอื่นๆ เป็น "3.4 อื่นๆ"', form.labOther === '3.4 อื่นๆ', form.labOther || '-');
  ok('แถบสรุปมีบรรทัดค่าเบี้ยเลี้ยง', form.breakdown === true, String(form.breakdown));

  console.log('');
  console.log('=== 7. ยอดรวมต้องบวกเบี้ยเลี้ยงเข้าไปด้วย ===');
  const sums = await ev([
    "window.usesTravel = () => true; window.usesReport = () => false;",
    "window.usesReceipt = () => false;",
    "const set = (id,v) => { const e = document.getElementById(id); if (e) e.value = v; };",
    "set('tollCost',''); set('parkingCost',''); set('otherCost',''); set('perDiemCost','');",
    "calculateTravelTotal();",
    "const zero = parseFloat(document.getElementById('totalAmount').dataset.value || 0);",
    "set('perDiemCost','200'); calculateTravelTotal();",
    "const withPerDiem = parseFloat(document.getElementById('totalAmount').dataset.value || 0);",
    "set('otherCost','150'); calculateTravelTotal();",
    "const withBoth = parseFloat(document.getElementById('totalAmount').dataset.value || 0);",
    "return { zero, withPerDiem, withBoth };"
  ].join(NEWLINE));
  ok('ใส่เบี้ยเลี้ยง 200 แล้วยอดรวมเพิ่ม 200',
     sums.withPerDiem - sums.zero === 200,
     sums.zero + ' -> ' + sums.withPerDiem);
  ok('ใส่อื่นๆ อีก 150 แล้วยอดรวมเพิ่มอีก 150',
     sums.withBoth - sums.withPerDiem === 150,
     sums.withPerDiem + ' -> ' + sums.withBoth);

  console.log('');
  ok('ไม่มี JavaScript error ตลอดการทดสอบ', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '));

  console.log('');
  console.log('══════════════════════════════════════════════════');
  console.log('  ผ่าน ' + results.filter(Boolean).length + ' / ' + results.length);
  console.log('══════════════════════════════════════════════════');
  process.exitCode = results.every(Boolean) ? 0 : 1;
} catch (e) { console.error('ล้มเหลว:', e.message); process.exitCode = 2; }
finally { try { ws.close(); } catch {} chrome.kill(); }
