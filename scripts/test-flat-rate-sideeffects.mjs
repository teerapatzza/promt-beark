// เหมาจ่ายมาแล้ว กระทบของเดิมตรงไหนบ้าง
//
// ชุดนี้ไม่ได้ตรวจว่าเหมาจ่ายคิดถูกไหม (ชุด test-flat-rate* ทำไปแล้ว)
// แต่ถามว่า "พอเพิ่มของใหม่เข้ามา ของเดิมยังทำงานเหมือนเดิมไหม"
// และ "ถ้าใช้งานแบบที่คนจริงจะทำ มีจุดไหนพังหรือเงินเพี้ยนบ้าง"
//
// จุดที่ตั้งใจไล่
//   1. หมวดเดิมที่ไม่ได้เปิดเหมาจ่าย ต้องไม่มีอะไรเปลี่ยน
//   2. ใบเก่าที่บันทึกไว้ก่อนมีฟีเจอร์นี้ ต้องเปิดดูและออกเอกสารได้เหมือนเดิม
//   3. สลับหมวด สลับวิธี สลับโหมดเดินทาง แล้วค่าต้องไม่ค้างข้ามกัน
//   4. เงินที่บันทึกลงใบ ต้องตรงกับที่ผู้ใช้เห็นบนหน้าจอ
//   5. ค่าทางด่วนต้องไม่รั่วเข้าไปในยอดตอนใช้เหมาจ่าย
//
//   node scripts/test-flat-rate-sideeffects.mjs
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { rmSync } from 'node:fs';

const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9617, PROFILE = 'C:/Users/teerapat/AppData/Local/Temp/pb-side';
const APP = process.env.APP_URL || 'http://127.0.0.1:8099';
try { rmSync(PROFILE, { recursive: true, force: true }); } catch {}

const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=' + PORT,
  '--user-data-dir=' + PROFILE, '--no-first-run', '--disable-gpu',
  '--window-size=1500,1100', 'about:blank'], { stdio: 'ignore' });
let ws, id = 0; const pend = new Map(); const pageErrors = [];
const send = (m, p = {}) => { const i = ++id; ws.send(JSON.stringify({ id: i, method: m, params: p }));
  return new Promise((r, j) => pend.set(i, { r, j })); };
const ev = async e => {
  const r = await send('Runtime.evaluate', { expression: '(async()=>{' + e + '})()', awaitPromise: true, returnByValue: true, timeout: 60000 });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result?.value;
};
const results = [];
const ok = (n, pass, d = '') => { results.push(pass);
  console.log((pass ? '  ผ่าน  ' : '  ตก    ') + n + (d ? '  -> ' + d : '')); };

const FLAT = {
  id: 'FLAT', name: 'เปิดเหมาจ่าย', fuelRate: 5, pdfTemplates: ['TRANSPORT_RECEIPT'],
  flatRate: { enabled: true, maxKm: 200, outsideMetro: 1200,
    bands: [{ upTo: 10.99, amount: 150 }, { upTo: 20.99, amount: 250 },
            { upTo: 30.99, amount: 350 }, { upTo: null, amount: 750 }] }
};
const PLAIN = { id: 'PLAIN', name: 'ไม่เปิดเหมาจ่าย', fuelRate: 5, pdfTemplates: ['TRANSPORT_RECEIPT'] };

const STUB =
  "localStorage.setItem('token','x');" +
  "const of=window.fetch;window.fetch=function(u,i){const s=(typeof u==='string')?u:(u&&u.url)||'';" +
  "if(s.indexOf('/auth/me')>=0)return Promise.resolve(new Response(JSON.stringify({id:1,email:'t@ha.or.th',name:'t',role:'admin'}),{status:200,headers:{'Content-Type':'application/json'}}));" +
  "if(s.indexOf('/expenses')>=0||s.indexOf('/profiles')>=0)" +
  "return Promise.resolve(new Response('[]',{status:200,headers:{'Content-Type':'application/json'}}));" +
  "if(s.indexOf('/budget-categories')>=0)return Promise.resolve(new Response(" +
  JSON.stringify(JSON.stringify([FLAT, PLAIN])) +
  ",{status:200,headers:{'Content-Type':'application/json'}}));return of(u,i);};";

const total = "return parseFloat((document.getElementById('totalAmount').textContent||'').replace(/[^0-9.]/g,''));";

const setup = (cat, out, ret, carType, method, inMetro, toll) => [
  "window.currentPdfTemplates = ['TRANSPORT_RECEIPT'];",
  "applyCategoryFlatRate(" + JSON.stringify(cat) + ");",
  "document.getElementById('fuelRate').value = 5;",
  "document.getElementById('distOutbound').value = " + out + ";",
  "document.getElementById('distReturn').value = " + ret + ";",
  "document.getElementById('carType').value = '" + carType + "';",
  "window.isMetroTripFE = () => ({ inMetro: " + inMetro + ", why: 'ทดสอบ' });",
  // ห่อด้วยบล็อก กันชื่อตัวแปรชนกันเวลาเรียก setup หลายรอบในก้อนเดียว
  method ? "{ const _m = document.querySelector('input[name=\"fuelMethod\"][value=\"" + method + "\"]');" +
           "if (_m) { _m.checked = true; onFuelMethodChange(); } }" : "",
  toll != null ? "document.getElementById('tollCost').value = " + toll + ";" : "",
  "calculateTravelTotal();",
  "await new Promise(r => requestAnimationFrame(r));"
].filter(Boolean).join('\n');

try {
  let u;
  for (let i = 0; i < 80; i++) {
    try { const l = await (await fetch('http://127.0.0.1:' + PORT + '/json/list')).json();
      const p = l.find(t => t.type === 'page'); if (p) { u = p.webSocketDebuggerUrl; break; } } catch {}
    await sleep(250);
  }
  ws = new WebSocket(u); await new Promise(r => ws.addEventListener('open', r));
  ws.addEventListener('message', e => { const m = JSON.parse(e.data);
    if (m.id && pend.has(m.id)) { const { r, j } = pend.get(m.id); pend.delete(m.id);
      m.error ? j(new Error(m.error.message)) : r(m.result); return; }
    if (m.method === 'Runtime.exceptionThrown')
      pageErrors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
    if (m.method === 'Page.javascriptDialogOpening') send('Page.handleJavaScriptDialog', { accept: true }); });
  await send('Page.enable'); await send('Runtime.enable');
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Page.addScriptToEvaluateOnNewDocument', { source: STUB });
  await send('Page.navigate', { url: APP + '/expense.html' }); await sleep(4000);

  console.log('═══ 1. หมวดเดิมที่ไม่ได้เปิดเหมาจ่าย ต้องไม่มีอะไรเปลี่ยน ═══');
  const p1 = await ev(setup(PLAIN, 15, 25, 'ไป-กลับ', null, true, 100) + total);
  ok('ยอดเท่าเดิม (15+25)×5 + ทางด่วน 100 = 300', p1 === 300, p1 + ' บาท');
  const p2 = await ev(setup(PLAIN, 15, 25, 'ไป-กลับ', null, true, 100) + [
    "return { hidden: document.getElementById('fuelMethodBox').classList.contains('hidden'),",
    "         tollEditable: !document.getElementById('tollCost').readOnly,",
    "         noHint: !document.getElementById('tollLockedHint'),",
    "         flatUsed: !!window.__flatRateUsed };"
  ].join('\n'));
  ok('ไม่เห็นตัวเลือกวิธีคิด', p2.hidden === true);
  ok('ช่องค่าทางด่วนยังกรอกได้', p2.tollEditable === true);
  ok('ไม่มีข้อความเตือนค้าง', p2.noHint === true);
  ok('ไม่ถูกมาร์กว่าใช้เหมาจ่าย', p2.flatUsed === false);

  console.log('');
  console.log('═══ 2. สลับหมวดไปมา ค่าต้องไม่ค้างข้ามกัน ═══');
  const sw = await ev([
    setup(FLAT, 15, 25, 'ไป-กลับ', 'flat', true, null),
    "const a = parseFloat((document.getElementById('totalAmount').textContent||'').replace(/[^0-9.]/g,''));",
    // สลับไปหมวดที่ไม่เปิด แล้วกลับมา
    setup(PLAIN, 15, 25, 'ไป-กลับ', null, true, 100),
    "const b = parseFloat((document.getElementById('totalAmount').textContent||'').replace(/[^0-9.]/g,''));",
    "const tollLocked = document.getElementById('tollCost').readOnly;",
    setup(FLAT, 15, 25, 'ไป-กลับ', 'flat', true, null),
    "const c = parseFloat((document.getElementById('totalAmount').textContent||'').replace(/[^0-9.]/g,''));",
    "return { flat1: a, plain: b, flat2: c, tollLockedInPlain: tollLocked };"
  ].join('\n'));
  ok('หมวดเหมาจ่าย → 600', sw.flat1 === 600, sw.flat1 + '');
  ok('สลับไปหมวดปกติ → 300 ไม่ติดยอดเหมามา', sw.plain === 300, sw.plain + '');
  ok('หมวดปกติ ช่องค่าทางด่วนไม่ถูกล็อกค้าง', sw.tollLockedInPlain === false);
  ok('กลับมาหมวดเหมาจ่าย → 600 เหมือนเดิม', sw.flat2 === 600, sw.flat2 + '');

  console.log('');
  console.log('═══ 3. ทุกแบบของการเดินทาง (ปกติ และกรณีพิเศษ) ═══');
  for (const [label, carType, want] of [
    ['ไป-กลับ ปกติ', 'ไป-กลับ', 600],
    ['กรณีพิเศษ ขาไปอย่างเดียว', 'ขาไป', 250],
    ['กรณีพิเศษ ขากลับอย่างเดียว', 'ขากลับ', 350]
  ]) {
    const v = await ev(setup(FLAT, 15, 25, carType, 'flat', true, null) + total);
    ok(label + ' → ' + want, v === want, v + ' บาท');
  }

  console.log('');
  console.log('═══ 4. เงินที่บันทึกลงใบ ต้องตรงกับที่เห็นบนหน้าจอ ═══');
  const saved = await ev([
    setup(FLAT, 15, 25, 'ไป-กลับ', 'flat', true, 100),
    "const seen = parseFloat((document.getElementById('totalAmount').textContent||'').replace(/[^0-9.]/g,''));",
    // จำลองส่วนที่ submitExpense เก็บลง metadata
    "let m = {};",
    "if (flatMethodOn()) { const fr = flatResult();",
    "  if (fr && fr.ok) { m._fuelMethod='flat'; m._flatRate={ total: fr.total,",
    "    legs: fr.legs.map(l=>({dir:l.dir,km:l.km,amount:l.amount,label:l.label})) }; } }",
    "if (!m._fuelMethod) m._fuelMethod='distance';",
    "m._toll = window.__flatRateUsed ? 0 : (parseFloat(document.getElementById('tollCost').value)||0);",
    "return { seen: seen, method: m._fuelMethod, stored: m._flatRate ? m._flatRate.total : null,",
    "         legs: m._flatRate ? m._flatRate.legs.length : 0, toll: m._toll };"
  ].join('\n'));
  ok('บันทึกว่าใช้วิธีเหมาจ่าย', saved.method === 'flat', saved.method);
  ok('ยอดที่บันทึก ตรงกับที่ผู้ใช้เห็น', saved.stored === saved.seen,
     'เห็น ' + saved.seen + ' · บันทึก ' + saved.stored);
  ok('เก็บรายละเอียดครบสองเที่ยว', saved.legs === 2, saved.legs + ' เที่ยว');
  ok('ค่าทางด่วนที่บันทึกเป็น 0 แม้ผู้ใช้เคยพิมพ์ 100 ไว้',
     saved.toll === 0, saved.toll + '');

  console.log('');
  console.log('═══ 5. ใบเก่าที่บันทึกก่อนมีฟีเจอร์นี้ ═══');
  await send('Page.navigate', { url: APP + '/history.html' }); await sleep(4000);
  await ev("window.renderRouteMapImage=async()=>null;window.alert=()=>{};await waitForDocumentFonts();return 1;");
  const OLD = {
    id: 9, requestedBy: 'ธีรภัทร คุ้มวงษ์', amount: 300, date: '2026-09-01',
    createdAt: '2026-09-01T02:00:00Z', description: 'เบิก', attachments: { images: [] },
    inputMetadata: {   // ใบเก่าไม่มี _fuelMethod และไม่มี _flatRate เลย
      _pdfTemplates: ['TRANSPORT_RECEIPT'], _activityName: 'ประชุม', _position: 'นักวิเคราะห์',
      _affiliation: 'สนับสนุนการบริหารองค์กร', _docDate: '2026-09-01',
      _addr: { no: '1', sub: 'บางรัก', dist: 'บางรัก', prov: 'กรุงเทพมหานคร', zip: '10500' },
      _travel: { startDate: '2026-09-01', endDate: '2026-09-01', from: 'บ้าน', to: 'รพ.',
                 distOut: '15', distRet: '25' },
      _carType: 'ไป-กลับ',
      _costs: { hotelEntries: { entries: [] }, fuelRate: '5', taxiEntries: [],
                airAmount: 0, tollAmount: 100, parkingAmount: 0, otherAmount: 0 }
    }
  };
  const oldDoc = await ev([
    "const built = await buildDocumentHtml(" + JSON.stringify(OLD) + ");",
    "document.getElementById('pdf-container').innerHTML =",
    "  '<div id=\"formal-doc\" style=\"background:white;color:black\">' + built.html + '</div>';",
    "await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));",
    "const t = (document.getElementById('formal-doc').textContent||'').replace(/\\s+/g,' ');",
    "return { hasFormula: /เที่ยว x/.test(t), hasFlat: /เหมาจ่าย/.test(t),",
    "         has75: /75\\.00/.test(t), has125: /125\\.00/.test(t),",
    "         hasToll: /100\\.00/.test(t), has300: /300\\.00/.test(t), pages: document.querySelectorAll('.pdf-page').length };"
  ].join('\n'));
  ok('ใบเก่ายังพิมพ์สูตร ระยะ × อัตรา เหมือนเดิม', oldDoc.hasFormula === true);
  ok('ใบเก่าไม่มีคำว่าเหมาจ่ายโผล่มา', oldDoc.hasFlat === false);
  ok('ยอดขาไป 15×5 = 75 ถูกต้อง', oldDoc.has75 === true);
  ok('ยอดขากลับ 25×5 = 125 ถูกต้อง', oldDoc.has125 === true);
  ok('ค่าทางด่วน 100 ยังพิมพ์อยู่', oldDoc.hasToll === true);
  ok('ยอดรวม 300 ถูกต้อง', oldDoc.has300 === true);
  ok('เอกสารออกได้ครบ ไม่พัง', oldDoc.pages > 0, oldDoc.pages + ' หน้า');

  console.log('');
  console.log('═══ 6. ใบเหมาจ่ายที่ข้อมูลไม่ครบ ต้องไม่พัง ═══');
  for (const [label, meta] of [
    ['บอกว่าเหมาจ่าย แต่ไม่มีรายละเอียด', { _fuelMethod: 'flat' }],
    ['มีรายละเอียดแต่ไม่มียอดรวม',        { _fuelMethod: 'flat', _flatRate: { legs: [] } }],
    ['legs เป็นค่าว่าง',                   { _fuelMethod: 'flat', _flatRate: { total: 0, legs: null } }]
  ]) {
    const rec = JSON.parse(JSON.stringify(OLD));
    Object.assign(rec.inputMetadata, meta);
    const r = await ev([
      "try {",
      "  const built = await buildDocumentHtml(" + JSON.stringify(rec) + ");",
      "  document.getElementById('pdf-container').innerHTML =",
      "    '<div id=\"formal-doc\">' + built.html + '</div>';",
      "  await new Promise(r => requestAnimationFrame(r));",
      "  return { ok: true, pages: document.querySelectorAll('.pdf-page').length };",
      "} catch (e) { return { ok: false, err: String(e.message || e) }; }"
    ].join('\n'));
    ok(label + ' — ยังออกเอกสารได้', r.ok === true && r.pages > 0, r.ok ? r.pages + ' หน้า' : r.err);
  }

  ok('ไม่มี JavaScript error ตลอดการทดสอบ', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '));

  console.log('');
  console.log('══════════════════════════════════════════════════');
  console.log('  ผ่าน ' + results.filter(Boolean).length + ' / ' + results.length);
  console.log('══════════════════════════════════════════════════');
  process.exitCode = results.every(Boolean) ? 0 : 1;
} catch (e) { console.error('ล้มเหลว:', e.message); process.exitCode = 2; }
finally { try { ws.close(); } catch {} chrome.kill(); }
