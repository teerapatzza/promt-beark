// ใบรายงานการเดินทาง: เหมาจ่ายต้องลงช่อง 2.1 ไม่ใช่ 2.2 ค่าน้ำมันรถ
//
// 20 ต.ค. 2569 — เจ้าของงานเปิดเอกสารที่พิมพ์ออกมาแล้วทักว่า
//   "ถ้าเขาเลือกเป็นเหมาจ่าย เงินที่ขึ้นจะไม่ใช่ค่าน้ำมันรถ
//    แต่จะเป็น 2.1 แทน ค่าโดยสารพาหนะต่างๆ"
//
// ตัวเอกสาร FM-SAM-001-04 เขียนนิยามไว้เองที่ช่อง 2.1 ว่า
//   "ค่าโดยสารพาหนะต่างๆ (ค่าพาหนะทุกประเภทนอกเหนือจาก 2.2, 2.3)"
// เหมาจ่ายตาม บัญชี ๘ ข้อ ๕ ไม่ผูกชนิดพาหนะ จึงเข้าช่อง 2.1
//
// คนละใบกับใบรับรองค่าพาหนะ (FM-SAM-095-00) ซึ่งมีแค่ช่อง "ค่า Taxi"
// กับ "ค่าน้ำมันเชื้อเพลิง" ไม่มีช่องกลางแบบนี้ เจ้าของงานเลือกให้ใบนั้น
// พิมพ์ลงช่องค่าน้ำมันเหมือนเดิม สองใบจึงลงคนละช่องโดยตั้งใจ
//
//   cd public && python3 -m http.server 8099 --bind 127.0.0.1
//   node scripts/test-report-flat-line.mjs
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9614, PROFILE = 'C:/Users/teerapat/AppData/Local/Temp/pb-rptflat';
const APP = process.env.APP_URL || 'http://127.0.0.1:8099';

const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=' + PORT,
  '--user-data-dir=' + PROFILE, '--no-first-run', '--disable-gpu',
  '--window-size=1400,1000', 'about:blank'], { stdio: 'ignore' });

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

/** ใบเบิกจำลอง — เปลี่ยนเฉพาะวิธีคิดค่าพาหนะ ส่วนอื่นเหมือนกันทุกใบ */
const mkRecord = (costs, extra) => ({
  id: 9101, requestedBy: 'ธีรภัทร คุ้มวงษ์', amount: 1100,
  category: 'TRAVEL001', date: '2026-10-20',
  inputMetadata: Object.assign({
    _pdfTemplates: ['REPORT', 'TRANSPORT_RECEIPT'],
    _activityName: 'ทดสอบช่อง 2.1 กับ 2.2',
    _position: 'นักวิเคราะห์ธุรกิจ', _affiliation: 'สนับสนุนการบริหารองค์กร',
    _docDate: '2026-10-20',
    _addr: { no: '141/36', soi: 'สุขสวัสดิ์ 55', road: 'สุขสวัสดิ์',
             sub: 'บางปะกอก', dist: 'ราษฎร์บูรณะ', prov: 'กรุงเทพมหานคร', zip: '10140' },
    _travel: { startDate: '2026-10-20', endDate: '2026-10-22',
               from: 'บ้าน', to: 'ดอนเมือง', distOut: 110, distRet: 110 },
    _carType: 'ไป-กลับ', _costs: costs
  }, extra || {})
});
const BASE = { fuelRate: '5', taxiEntries: [], airAmount: 0, otherAmount: 0 };

/** อ่านยอดของแถว 2.1 / 2.2 / 2.3 และยอดรวม จากเอกสารที่สร้างจริง */
const READ_ROWS = [
  "window.renderRouteMapImage = async () => null;",
  "async function readDoc(rec) {",
  "  const b = await buildDocumentHtml(rec, function(){});",
  "  const d = document.createElement('div'); d.innerHTML = b.html;",
  "  const out = {};",
  "  d.querySelectorAll('tr').forEach(function (tr) {",
  "    const tds = [...tr.querySelectorAll('td')].map(x => (x.textContent||'').replace(/\\s+/g,' ').trim());",
  "    const label = tds.find(t => /^2\\.[123]/.test(t));",
  "    if (!label) return;",
  "    const key = label.slice(0,3);",
  "    const num = tds.map(t => t.replace(/,/g,'')).find(t => /^\\d+(\\.\\d+)?$/.test(t));",
  "    if (out[key] === undefined) out[key] = num ? parseFloat(num) : 0;",
  "  });",
  "  const txt = d.textContent.replace(/\\s+/g,' ');",
  "  const m = txt.match(/รวมเป็นเงิน\\s*([\\d,]+\\.\\d{2})/);",
  "  out.total = m ? parseFloat(m[1].replace(/,/g,'')) : null;",
  "  return out;",
  "}"
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
    "      pdfTemplates:['REPORT','TRANSPORT_RECEIPT'], attachmentRules:{}, attachmentOrder:[] }]),",
    "    {status:200, headers:{'Content-Type':'application/json'}}));",
    "  if (s.indexOf('/expenses') >= 0 || s.indexOf('/profiles') >= 0)",
    "    return Promise.resolve(new Response('[]',{status:200,headers:{'Content-Type':'application/json'}}));",
    "  return of(u, i);",
    "};"
  ].join('\n') });
  await send('Page.navigate', { url: APP + '/history.html' }); await sleep(5000);

  console.log('═══ 1. ใบที่เลือกเหมาจ่าย — ต้องลงช่อง 2.1 ═══');
  const flatRec = mkRecord(BASE, {
    _fuelMethod: 'flat',
    _flatRate: { total: 1100, legs: [
      { dir: 'ขาไป', km: 110, amount: 550, label: 'ระยะทาง 41.00 - 50.99 กม.' },
      { dir: 'ขากลับ', km: 110, amount: 550, label: 'ระยะทาง 41.00 - 50.99 กม.' } ] }
  });
  const flat = await ev(READ_ROWS + "\nreturn await readDoc(" + JSON.stringify(flatRec) + ");");
  ok('2.1 ค่าโดยสารพาหนะต่างๆ = 1,100', flat['2.1'] === 1100, String(flat['2.1']));
  ok('2.2 ค่าน้ำมันรถ ต้องว่าง', !flat['2.2'], String(flat['2.2'] ?? 'ว่าง'));
  ok('ยอดรวมท้ายใบยังเป็น 1,100 เท่าเดิม', flat.total === 1100, String(flat.total));

  console.log('');
  console.log('═══ 2. ใบที่คิดตามระยะจริง — ต้องลงช่อง 2.2 เหมือนเดิม ═══');
  const distRec = mkRecord(BASE);   // ไม่มี _fuelMethod = คิดตามระยะจริง
  const dist = await ev(READ_ROWS + "\nreturn await readDoc(" + JSON.stringify(distRec) + ");");
  ok('2.2 ค่าน้ำมันรถ = 220 กม. x 5 = 1,100', dist['2.2'] === 1100, String(dist['2.2']));
  ok('2.1 ต้องว่าง เพราะไม่มีค่า Taxi', !dist['2.1'], String(dist['2.1'] ?? 'ว่าง'));
  ok('ยอดรวมท้ายใบ 1,100', dist.total === 1100, String(dist.total));

  console.log('');
  console.log('═══ 3. ใบที่มีค่า Taxi จริง — ยังลง 2.1 เหมือนเดิม ═══');
  const taxiRec = mkRecord(Object.assign({}, BASE, {
    taxiEntries: [{ date: '2026-10-20', direction: 'ขาไป', amount: 300 },
                  { date: '2026-10-22', direction: 'ขากลับ', amount: 450 }]
  }));
  const taxi = await ev(READ_ROWS + "\nreturn await readDoc(" + JSON.stringify(taxiRec) + ");");
  ok('2.1 = ค่า Taxi 750', taxi['2.1'] === 750, String(taxi['2.1']));
  ok('2.2 = ค่าน้ำมัน 1,100 ยังอยู่', taxi['2.2'] === 1100, String(taxi['2.2']));

  console.log('');
  console.log('═══ 4. เหมาจ่าย + มีค่า Taxi ด้วย — 2.1 ต้องรวมทั้งสอง ═══');
  /* เคสนี้เกิดได้กับใบเก่าที่บันทึกไว้ก่อนเปลี่ยนกติกา
     ทั้งสองก้อนเป็น "ค่าพาหนะนอกเหนือจาก 2.2, 2.3" จึงอยู่บรรทัดเดียวกัน */
  const bothRec = mkRecord(Object.assign({}, BASE, {
    taxiEntries: [{ date: '2026-10-20', direction: 'ขาไป', amount: 300 }]
  }), {
    _fuelMethod: 'flat',
    _flatRate: { total: 1100, legs: [{ dir: 'ขาไป', km: 110, amount: 1100 }] }
  });
  const both = await ev(READ_ROWS + "\nreturn await readDoc(" + JSON.stringify(bothRec) + ");");
  ok('2.1 = 300 + 1,100 = 1,400', both['2.1'] === 1400, String(both['2.1']));
  ok('2.2 ยังว่าง', !both['2.2'], String(both['2.2'] ?? 'ว่าง'));

  ok('ไม่มี JavaScript error ตลอดการทดสอบ', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '));

  console.log('');
  console.log('══════════════════════════════════════════════════');
  console.log('  ผ่าน ' + results.filter(Boolean).length + ' / ' + results.length);
  console.log('══════════════════════════════════════════════════');
  process.exitCode = results.every(Boolean) ? 0 : 1;
} catch (e) { console.error('ล้มเหลว:', e.message); process.exitCode = 2; }
finally { try { ws.close(); } catch {} chrome.kill(); }
