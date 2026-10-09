// ค่าพาหนะเหมาจ่าย — ตรวจตั้งแต่ฟอร์มจนถึงเอกสาร
//
// ระเบียบบัญชี ๘ ให้เลือกคิดค่ารถส่วนตัวได้สองวิธี และห้ามใช้ทั้งสองวิธีในช่วงเดียวกัน
//   ข้อ ๔ คิดตามระยะทางจริง × อัตราต่อกิโลเมตร
//   ข้อ ๕ เหมาจ่ายตามช่วงระยะทาง รวมค่าทางด่วนแล้ว
//
// กติกาที่เจ้าของระบบยืนยัน 9 ต.ค. 2569
//   - คิดทีละเที่ยว ไป 15 กม. ได้ 250 · กลับ 25 กม. ได้ 350 → รวม 600
//   - เลือกเหมาจ่ายแล้วต้องล็อกช่องค่าทางด่วน และห้ามนับยอดค่าทางด่วนซ้ำ
//   - เกินเพดานใช้เหมาจ่ายไม่ได้ ต้องกลับไปคิดตามระยะจริง
//   - เอกสารต้องพิมพ์ยอดเหมา ไม่ใช่สูตร ระยะ × อัตรา
//
//   cd public && python -m http.server 8099 --bind 127.0.0.1
//   node scripts/test-flat-rate-e2e.mjs
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { rmSync } from 'node:fs';

const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9615, PROFILE = 'C:/Users/teerapat/AppData/Local/Temp/pb-flat';
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

// หมวดที่แอดมินเปิดเหมาจ่ายไว้ ใช้ตารางตามระเบียบ
const CAT = {
  id: 'FLAT', name: 'ทดสอบเหมาจ่าย', fuelRate: 5,
  pdfTemplates: ['TRANSPORT_RECEIPT'],
  flatRate: {
    enabled: true, maxKm: 200, outsideMetro: 1200,
    bands: [{ upTo: 10.99, amount: 150 }, { upTo: 20.99, amount: 250 },
            { upTo: 30.99, amount: 350 }, { upTo: 40.99, amount: 450 },
            { upTo: 50.99, amount: 550 }, { upTo: 60.99, amount: 650 },
            { upTo: null,  amount: 750 }]
  }
};
const CAT_OFF = { id: 'PLAIN', name: 'ไม่เปิดเหมาจ่าย', fuelRate: 5, pdfTemplates: ['TRANSPORT_RECEIPT'] };

const STUB =
  "localStorage.setItem('token','x');" +
  "const of=window.fetch;window.fetch=function(u,i){const s=(typeof u==='string')?u:(u&&u.url)||'';" +
  "if(s.indexOf('/auth/me')>=0)return Promise.resolve(new Response(JSON.stringify({id:1,email:'t@ha.or.th',name:'t',role:'admin'}),{status:200,headers:{'Content-Type':'application/json'}}));" +
  "if(s.indexOf('/expenses')>=0||s.indexOf('/profiles')>=0)" +
  "return Promise.resolve(new Response('[]',{status:200,headers:{'Content-Type':'application/json'}}));" +
  "if(s.indexOf('/budget-categories')>=0)return Promise.resolve(new Response(" +
  JSON.stringify(JSON.stringify([CAT, CAT_OFF])) +
  ",{status:200,headers:{'Content-Type':'application/json'}}));return of(u,i);};";

/** ตั้งค่าในฟอร์มแล้วอ่านผลที่คิดได้ */
const setTrip = (out, ret, method, inMetro) => [
  "window.currentPdfTemplates = ['TRANSPORT_RECEIPT'];",
  "applyCategoryFlatRate(" + JSON.stringify(CAT) + ");",
  "document.getElementById('distOutbound').value = " + out + ";",
  "document.getElementById('distReturn').value = " + ret + ";",
  "document.getElementById('carType').value = 'ไป-กลับ';",
  "document.getElementById('fuelRate').value = 5;",
  // บังคับผลการเช็กเขตให้แน่นอน ไม่ต้องพึ่งหมุดจริง
  "window.isMetroTripFE = () => ({ inMetro: " + inMetro + ", why: 'ทดสอบ' });",
  "document.querySelector('input[name=\"fuelMethod\"][value=\"" + method + "\"]').checked = true;",
  "onFuelMethodChange();",
  "await new Promise(r => requestAnimationFrame(r));"
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
    if (m.id && pend.has(m.id)) { const { r, j } = pend.get(m.id); pend.delete(m.id);
      m.error ? j(new Error(m.error.message)) : r(m.result); return; }
    if (m.method === 'Runtime.exceptionThrown')
      pageErrors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
    if (m.method === 'Page.javascriptDialogOpening') send('Page.handleJavaScriptDialog', { accept: true }); });
  await send('Page.enable'); await send('Runtime.enable');
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Page.addScriptToEvaluateOnNewDocument', { source: STUB });
  await send('Page.navigate', { url: APP + '/expense.html' }); await sleep(4000);

  console.log('═══ 1. ตัวเลือกโผล่เฉพาะหมวดที่แอดมินเปิดไว้ ═══');
  const vis = await ev([
    "applyCategoryFlatRate(" + JSON.stringify(CAT) + ");",
    "const a = !document.getElementById('fuelMethodBox').classList.contains('hidden');",
    "applyCategoryFlatRate(" + JSON.stringify(CAT_OFF) + ");",
    "const b = !document.getElementById('fuelMethodBox').classList.contains('hidden');",
    "const back = document.querySelector('input[name=\"fuelMethod\"][value=\"distance\"]').checked;",
    "return { on: a, off: b, resetToDistance: back };"
  ].join('\n'));
  ok('หมวดที่เปิดไว้ — เห็นตัวเลือก', vis.on === true);
  ok('หมวดที่ไม่ได้เปิด — ไม่เห็นตัวเลือก', vis.off === false);
  ok('สลับไปหมวดที่ไม่เปิด เด้งกลับเป็นคิดตามระยะจริง', vis.resetToDistance === true);

  console.log('');
  console.log('═══ 2. ตัวอย่างที่เจ้าของระบบยกมา — ไป 15 กลับ 25 ═══');
  const r1 = await ev(setTrip(15, 25, 'flat', true) + [
    "const note = document.getElementById('flatRateNote');",
    "return { total: flatResult().total, used: flatMethodOn(),",
    "         noteShown: !note.classList.contains('hidden'),",
    "         note: (note.textContent||'').replace(/\\s+/g,' ').trim() };"
  ].join('\n'));
  ok('คิดได้ 600 บาท', r1.total === 600, r1.total + ' บาท');
  ok('บอกที่มาของเงินทีละเที่ยว', r1.noteShown && /250/.test(r1.note) && /350/.test(r1.note), r1.note.slice(0, 95));

  console.log('');
  console.log('═══ 3. ค่าทางด่วนต้องถูกล็อกและไม่ถูกนับซ้ำ ═══');
  const r2 = await ev(setTrip(15, 25, 'flat', true) + [
    "const toll = document.getElementById('tollCost');",
    "toll.value = 100;",
    "calculateTravelTotal();",
    "await new Promise(r => requestAnimationFrame(r));",
    "const txt = (document.getElementById('totalAmount').textContent||'').replace(/[^0-9.]/g,'');",
    "return { readOnly: toll.readOnly, title: toll.title,",
    "         hint: !!document.getElementById('tollLockedHint'), total: parseFloat(txt) };"
  ].join('\n'));
  ok('ช่องค่าทางด่วนถูกล็อก', r2.readOnly === true);
  ok('บอกเหตุผลที่ล็อก', /รวมค่าทางด่วน/.test(r2.title || ''), r2.title);
  ok('มีข้อความเตือนใต้ช่อง', r2.hint === true);
  ok('ยอดรวมไม่บวกค่าทางด่วนซ้ำ (ต้องเป็น 600 ไม่ใช่ 700)',
     r2.total === 600, r2.total + ' บาท');

  console.log('');
  console.log('═══ 4. สลับกลับไปคิดตามระยะจริง ═══');
  const r3 = await ev(setTrip(15, 25, 'distance', true) + [
    "document.getElementById('tollCost').value = 100;",
    "calculateTravelTotal();",
    "await new Promise(r => requestAnimationFrame(r));",
    "const txt = (document.getElementById('totalAmount').textContent||'').replace(/[^0-9.]/g,'');",
    "return { readOnly: document.getElementById('tollCost').readOnly,",
    "         hint: !!document.getElementById('tollLockedHint'), total: parseFloat(txt) };"
  ].join('\n'));
  ok('ช่องค่าทางด่วนกลับมากรอกได้', r3.readOnly === false);
  ok('ข้อความเตือนหายไป', r3.hint === false);
  ok('ยอด = (15+25)×5 + ทางด่วน 100 = 300', r3.total === 300, r3.total + ' บาท');

  console.log('');
  console.log('═══ 5. นอกเขต กทม.ปริมณฑล และเกินเพดาน ═══');
  const r4 = await ev(setTrip(50, 50, 'flat', false) + "return flatResult().total;");
  ok('นอกเขต ไป-กลับ ได้ 1,200 × 2 = 2,400', r4 === 2400, r4 + ' บาท');
  const r5 = await ev(setTrip(250, 10, 'flat', true) + [
    "const fr = flatResult();",
    "calculateTravelTotal();",
    "await new Promise(r => requestAnimationFrame(r));",
    "const txt = (document.getElementById('totalAmount').textContent||'').replace(/[^0-9.]/g,'');",
    "return { ok: fr.ok, why: fr.why, total: parseFloat(txt),",
    "         note: (document.getElementById('flatRateNote').textContent||'').replace(/\\s+/g,' ').trim() };"
  ].join('\n'));
  ok('ขาหนึ่งเกิน 200 กม. — เหมาจ่ายใช้ไม่ได้', r5.ok === false, r5.why);
  ok('บอกผู้ใช้ว่าจะกลับไปคิดตามระยะจริง', /ระยะทางจริง/.test(r5.note), r5.note.slice(0, 85));
  ok('ยอดตกกลับไปคิดตามระยะจริง (260×5 = 1,300)', r5.total === 1300, r5.total + ' บาท');

  console.log('');
  console.log('═══ 6. เอกสารต้องพิมพ์ยอดเหมา ไม่ใช่สูตร กม. × อัตรา ═══');
  await send('Page.navigate', { url: APP + '/history.html' }); await sleep(4000);
  await ev("window.renderRouteMapImage=async()=>null;window.alert=()=>{};await waitForDocumentFonts();return 1;");
  const REC = {
    id: 1, requestedBy: 'ธีรภัทร คุ้มวงษ์', amount: 600, date: '2026-10-09',
    createdAt: '2026-10-09T02:00:00Z', description: 'เบิก', attachments: { images: [] },
    inputMetadata: {
      _pdfTemplates: ['TRANSPORT_RECEIPT'], _activityName: 'ประชุมคณะกรรมการ',
      _position: 'นักวิเคราะห์', _affiliation: 'สนับสนุนการบริหารองค์กร', _docDate: '2026-10-09',
      _addr: { no: '141/36', sub: 'ปากคลองบางปลากด', dist: 'พระสมุทรเจดีย์', prov: 'สมุทรปราการ', zip: '10290' },
      _travel: { startDate: '2026-10-09', endDate: '2026-10-09', from: 'บ้าน', to: 'รพ.',
                 distOut: '15', distRet: '25' },
      _carType: 'ไป-กลับ', _fuelMethod: 'flat',
      _flatRate: { total: 600, legs: [
        { dir: 'ขาไป',  km: 15, amount: 250, label: 'ระยะทาง 11.00 - 20.99 กม.' },
        { dir: 'ขากลับ', km: 25, amount: 350, label: 'ระยะทาง 21.00 - 30.99 กม.' }] },
      _costs: { hotelEntries: { entries: [] }, fuelRate: '5', taxiEntries: [],
                airAmount: 0, tollAmount: 0, parkingAmount: 0, otherAmount: 0 }
    }
  };
  const doc = await ev([
    "const built = await buildDocumentHtml(" + JSON.stringify(REC) + ");",
    "document.getElementById('pdf-container').innerHTML =",
    "  '<div id=\"formal-doc\" style=\"background:white;color:black\">' + built.html + '</div>';",
    "await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));",
    "const t = (document.getElementById('formal-doc').textContent||'').replace(/\\s+/g,' ');",
    "return { has250: /250\\.00/.test(t), has350: /350\\.00/.test(t), has600: /600\\.00/.test(t),",
    "         hasFlatWord: /เหมาจ่าย/.test(t), hasFormula: /เที่ยว x/.test(t),",
    "         hasBand: /11\\.00 - 20\\.99/.test(t) };"
  ].join('\n'));
  ok('พิมพ์ยอดขาไป 250', doc.has250 === true);
  ok('พิมพ์ยอดขากลับ 350', doc.has350 === true);
  ok('ยอดรวม 600', doc.has600 === true);
  ok('เขียนว่า "เหมาจ่าย" ให้คนตรวจรู้วิธีคิด', doc.hasFlatWord === true);
  ok('บอกช่วงระยะที่เข้าเงื่อนไข', doc.hasBand === true);
  ok('ไม่พิมพ์สูตร "x เที่ยว x" ซึ่งใช้กับวิธีคิดตามระยะจริง', doc.hasFormula === false);

  // ใบที่คิดตามระยะจริงต้องไม่เปลี่ยนไปจากเดิม
  const REC2 = JSON.parse(JSON.stringify(REC));
  delete REC2.inputMetadata._flatRate;
  REC2.inputMetadata._fuelMethod = 'distance';
  const doc2 = await ev([
    "const built = await buildDocumentHtml(" + JSON.stringify(REC2) + ");",
    "document.getElementById('pdf-container').innerHTML =",
    "  '<div id=\"formal-doc\" style=\"background:white;color:black\">' + built.html + '</div>';",
    "await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));",
    "const t = (document.getElementById('formal-doc').textContent||'').replace(/\\s+/g,' ');",
    "return { hasFormula: /เที่ยว x/.test(t), has75: /75\\.00/.test(t), hasFlat: /เหมาจ่าย/.test(t) };"
  ].join('\n'));
  ok('ใบที่คิดตามระยะจริง ยังพิมพ์สูตรเดิม', doc2.hasFormula === true);
  ok('ใบที่คิดตามระยะจริง ยอดขาไป 15×5 = 75', doc2.has75 === true);
  ok('ใบที่คิดตามระยะจริง ไม่มีคำว่าเหมาจ่าย', doc2.hasFlat === false);

  ok('ไม่มี JavaScript error ตลอดการทดสอบ', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '));

  console.log('');
  console.log('══════════════════════════════════════════════════');
  console.log('  ผ่าน ' + results.filter(Boolean).length + ' / ' + results.length);
  console.log('══════════════════════════════════════════════════');
  process.exitCode = results.every(Boolean) ? 0 : 1;
} catch (e) { console.error('ล้มเหลว:', e.message); process.exitCode = 2; }
finally { try { ws.close(); } catch {} chrome.kill(); }
