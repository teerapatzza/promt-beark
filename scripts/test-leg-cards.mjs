// ตรวจการ์ดเลือกการเดินทางทีละขา
//
// ที่มา: เดิมถามแยกกันคนละที่ — "รายการ Taxi" กล่องหนึ่ง "รูปแบบรถส่วนตัว" อีกกล่อง
// และช่องรถส่วนตัวตั้งค่าเริ่มต้นไว้ที่ "ไป-กลับ" คนที่นั่ง Taxi ล้วนแต่ไม่ได้ไปแตะช่องนั้น
// จึงถูกคิดค่าน้ำมันที่ไม่ได้จ่าย (วัดได้จริง 800 บาท)
//
//   cd public && python3 -m http.server 8099 --bind 127.0.0.1
//   node scripts/test-leg-cards.mjs
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9567, PROFILE = 'C:/Users/teerapat/AppData/Local/Temp/pb-legcards';
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

// ตั้งค่าเริ่มต้นของแบบทดสอบ: เลือกหมวด ใส่วันเดินทาง และแกล้งว่าแผนที่คำนวณระยะทางมาแล้ว
const SETUP = [
  "const s = document.getElementById('categorySelect');",
  "s.value='TRAVEL002'; s.dispatchEvent(new Event('change',{bubbles:true}));",
  "await new Promise(r=>setTimeout(r,900));",
  "const ds = document.getElementById('dateStart'), de = document.getElementById('dateEnd');",
  "ds.value='2025-10-20'; ds.dispatchEvent(new Event('change',{bubbles:true}));",
  "de.value='2025-10-22'; de.dispatchEvent(new Event('change',{bubbles:true}));",
  "await new Promise(r=>setTimeout(r,300));",
  "document.getElementById('distOutbound').value = 100;",
  "document.getElementById('distReturn').value   = 100;",
  // ดักที่ routeLeg ไม่ใช่ recalcRoute เพื่อให้ตรรกะจริงของ recalcRoute ยังทำงาน
  // (ทับ recalcRoute แล้วลบคืนไม่ได้ เพราะเป็น function declaration เทสต์จะกลายเป็นวัดลม)
  "window.__legs = [];",
  "window.routeLeg = async (a, b) => { window.__legs.push([a && a.label, b && b.label]);",
  "  return { km: 42, meters: 42000, coords: [] }; };",
  "calculateTravelTotal();"
].join('\n');

const tick = (idName, on) =>
  "{ const c = document.getElementById('" + idName + "'); c.checked = " + (on ? 'true' : 'false') +
  "; c.dispatchEvent(new Event('change',{bubbles:true})); await new Promise(r=>setTimeout(r,250)); }";
const total = "parseFloat(document.getElementById('totalAmount').dataset.value||0)";

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
  await send('Page.addScriptToEvaluateOnNewDocument', { source: [
    "localStorage.setItem('token','x');",
    "const of = window.fetch;",
    "window.fetch = function (u,i) { const s=(typeof u==='string')?u:(u&&u.url)||'';",
    "  if (s.indexOf('/auth/me')>=0) return Promise.resolve(new Response(",
    "    JSON.stringify({id:1,email:'t@ha.or.th',name:'ทดสอบ',role:'admin'}),",
    "    {status:200,headers:{'Content-Type':'application/json'}}));",
    "  if (s.indexOf('/budget-categories')>=0) return Promise.resolve(new Response(",
    "    JSON.stringify([{ id:'TRAVEL002', name:'ทดสอบ', pdfTemplates:['REPORT','TRANSPORT_RECEIPT'],",
    "      attachmentRules:{}, attachmentOrder:[] }]),",
    "    {status:200,headers:{'Content-Type':'application/json'}}));",
    "  if (s.indexOf('/expenses')>=0||s.indexOf('/profiles')>=0)",
    "    return Promise.resolve(new Response('[]',{status:200,headers:{'Content-Type':'application/json'}}));",
    "  return of(u,i); };"
  ].join('\n') });
  await send('Page.navigate', { url: APP + '/expense.html' }); await sleep(4500);

  // ═══ 1. ค่าเริ่มต้นต้องปลอดภัย ═══
  console.log('═══ 1. ยังไม่ติ๊กอะไร ต้องไม่คิดเงินให้เอง ═══');
  const d = await ev(SETUP + "\nreturn { total: " + total + ", car: document.getElementById('carType').value,"
    + " outCar: document.getElementById('legOutCar').checked,"
    + " backCar: document.getElementById('legBackCar').checked };");
  ok('ไม่มีติ๊กไหนถูกเลือกไว้ล่วงหน้า', d.outCar === false && d.backCar === false);
  ok('ค่าเริ่มต้นของรูปแบบรถคือ "ไม่ระบุ" ไม่ใช่ "ไป-กลับ"', d.car === 'ไม่ระบุ', d.car);
  ok('ยอดรวมเป็นศูนย์ ทั้งที่แผนที่คำนวณระยะทาง 100+100 กม. ไว้แล้ว',
     d.total === 0, d.total + ' บาท');

  // ═══ 2. ติ๊กทีละขา ═══
  console.log('');
  console.log('═══ 2. ติ๊กรถส่วนตัวทีละขา ยอดต้องขยับตามจริง ═══');
  const a = await ev(tick('legOutCar', true) + "\nreturn { t: " + total + ", car: document.getElementById('carType').value,"
    + " box: !document.getElementById('legOutCarBox').classList.contains('hidden') };");
  ok('ติ๊กขาไป: ช่องจุดเริ่มต้น-จุดหมายโผล่ขึ้นมา', a.box === true);
  ok('ติ๊กขาไป: รูปแบบรถกลายเป็น "ขาไป"', a.car === 'ขาไป', a.car);
  ok('ติ๊กขาไป: คิดค่าน้ำมันเฉพาะขาไป 400 บาท', a.t === 400, a.t + ' บาท');

  const b = await ev(tick('legBackCar', true) + "\nreturn { t: " + total + ", car: document.getElementById('carType').value };");
  ok('ติ๊กขากลับด้วย: รูปแบบรถกลายเป็น "ไป-กลับ"', b.car === 'ไป-กลับ', b.car);
  ok('ติ๊กขากลับด้วย: คิดค่าน้ำมันสองขา 800 บาท', b.t === 800, b.t + ' บาท');

  const c = await ev(tick('legOutCar', false) + "\nreturn { t: " + total + ", car: document.getElementById('carType').value,"
    + " box: !document.getElementById('legOutCarBox').classList.contains('hidden') };");
  ok('เอาติ๊กขาไปออก: เหลือ "ขากลับ" อย่างเดียว', c.car === 'ขากลับ', c.car);
  ok('เอาติ๊กขาไปออก: ช่องของขาไปหายไปด้วย', c.box === false);
  ok('เอาติ๊กขาไปออก: เหลือ 400 บาท', c.t === 400, c.t + ' บาท');

  // ═══ 3. เคสผสม ขาไปรถส่วนตัว ขากลับ Taxi ═══
  console.log('');
  console.log('═══ 3. เคสผสม — ขาไปรถส่วนตัว ขากลับ Taxi ═══');
  const mix = await ev([
    tick('legBackCar', false),
    tick('legOutCar', true),
    tick('legBackTaxi', true),
    "const row = document.querySelector('#taxiEntriesListBack .taxi-entry');",
    "if (!row) return { err: 'ไม่มีแถว Taxi ขากลับ' };",
    "const dir = row.querySelector('.taxi-dir');",
    "const amt = row.querySelector('.taxi-amt-ret');",
    "if (amt) { amt.value = 450; amt.dispatchEvent(new Event('input',{bubbles:true})); }",
    "calculateTravelTotal();",
    "return { t: " + total + ", car: document.getElementById('carType').value, dir: dir.value,",
    "         dirHidden: dir.closest('div').classList.contains('hidden'),",
    "         rowsOut: document.querySelectorAll('#taxiEntriesList .taxi-entry').length,",
    "         rowsBack: document.querySelectorAll('#taxiEntriesListBack .taxi-entry').length };"
  ].join('\n'));
  ok('ติ๊ก Taxi แล้วมีแถวให้กรอกทันที ไม่ต้องกดเพิ่มเอง', mix.rowsBack === 1, 'ขากลับ ' + mix.rowsBack + ' แถว');
  ok('แถวนั้นถูกล็อกทิศทางเป็น "ขากลับ" ให้แล้ว', mix.dir === 'ขากลับ', mix.dir);
  ok('ช่องเลือกทิศทางถูกซ่อน เพราะการ์ดบอกอยู่แล้ว', mix.dirHidden === true);
  ok('ไม่มีแถว Taxi หลงไปอยู่การ์ดขาไป', mix.rowsOut === 0, mix.rowsOut + ' แถว');
  ok('รูปแบบรถยังเป็น "ขาไป" อย่างเดียว', mix.car === 'ขาไป', mix.car);
  ok('ยอดรวม = น้ำมันขาไป 400 + Taxi ขากลับ 450 = 850', mix.t === 850, mix.t + ' บาท');

  // ═══ 4. เอาติ๊ก Taxi ออกต้องไม่เหลือยอดค้าง ═══
  console.log('');
  console.log('═══ 4. เอาติ๊กออกแล้วต้องไม่มียอดค้าง ═══');
  const off = await ev(tick('legBackTaxi', false) + "\ncalculateTravelTotal();"
    + "\nreturn { t: " + total + ", rows: document.querySelectorAll('#taxiEntriesListBack .taxi-entry').length };");
  ok('แถว Taxi ถูกล้างออก', off.rows === 0, off.rows + ' แถว');
  ok('ยอดกลับไปเหลือแค่ค่าน้ำมันขาไป 400', off.t === 400, off.t + ' บาท');

  // ═══ 5. ขากลับไปคนละที่ คิดให้เองจากช่องที่กรอก ═══
  console.log('');
  console.log('═══ 5. ขากลับไปคนละที่ — ไม่ต้องให้ผู้ใช้ติ๊กเอง ═══');
  const rd = await ev([
    tick('legBackCar', true),
    "const before = document.getElementById('returnDiff').checked;",
    "const rf = document.getElementById('travelReturnFrom');",
    "rf.value = 'รพ.กรุงเทพ'; rf.dispatchEvent(new Event('input',{bubbles:true}));",
    "await new Promise(r=>setTimeout(r,200));",
    "const after = document.getElementById('returnDiff').checked;",
    "rf.value = ''; rf.dispatchEvent(new Event('input',{bubbles:true}));",
    "await new Promise(r=>setTimeout(r,200));",
    "return { before: before, after: after, cleared: document.getElementById('returnDiff').checked };"
  ].join('\n'));
  ok('เว้นว่างไว้ = กลับทางเดิม', rd.before === false);
  ok('กรอกจุดเริ่มต้นขากลับ = ระบบรู้เองว่าไปคนละที่', rd.after === true);
  ok('ลบออก = กลับไปเป็นกลับทางเดิม', rd.cleared === false);

  // ═══ 6. หัวการ์ดบอกวันที่ของขานั้น ═══
  console.log('');
  console.log('═══ 6. หัวการ์ดต้องบอกวันที่ให้เห็นโดยไม่ต้องเลื่อนขึ้นไปดู ═══');
  const dates = await ev("return { out: document.getElementById('legOutDate').textContent.trim(),"
    + " back: document.getElementById('legBackDate').textContent.trim() };");
  ok('การ์ดขาไปขึ้นวันออกเดินทาง', /20/.test(dates.out), dates.out);
  ok('การ์ดขากลับขึ้นวันกลับถึง', /22/.test(dates.back), dates.back);

  // ═══ 7. บ้านที่แผนที่หาไม่เจอ ต้องไม่ทำให้เบิกขากลับไม่ได้ ═══
  console.log('');
  console.log('═══ 7. บ้านที่แผนที่หาไม่เจอ — เว้นช่องว่างต้องยังคิดระยะทางได้ ═══');
  const home = await ev([
    // แกล้งว่ามีพิกัดจุดเริ่มต้น (บ้าน จากโปรไฟล์) และจุดหมายแล้ว แต่ระบบค้นชื่อบ้านไม่เจอ
    "window.geoFrom = { lat: 13.65, lng: 100.49, label: 'บ้าน' };",
    "window.geoTo   = { lat: 13.75, lng: 100.53, label: 'โรงแรมดุสิต' };",
    "document.getElementById('travelFrom').value = '141/36 ซอยสุขสวัสดิ์ 55';",
    "document.getElementById('travelTo').value   = 'โรงแรมดุสิต';",
    "updateReturnPlaceholders();",
    "const rt = document.getElementById('travelReturnTo');",
    "const rf = document.getElementById('travelReturnFrom');",
    "return { phTo: rt.placeholder, phFrom: rf.placeholder,",
    "         hasOwnHint: !!document.getElementById('returnFromHint') };"
  ].join('\n'));
  ok('ช่องปลายทางขากลับบอกชื่อบ้านจริงให้เห็น ไม่ใช่ข้อความลอยๆ',
     /141\/36/.test(home.phTo), home.phTo);
  ok('ช่องจุดเริ่มต้นขากลับบอกชื่อจุดหมายจริง', /ดุสิต/.test(home.phFrom), home.phFrom);
  ok('ช่องจุดเริ่มต้นขากลับมีที่แสดงคำเตือนของตัวเอง ไม่ไปปนกับช่องอื่น',
     home.hasOwnHint === true);

  // ═══ 8. หัวใจของเรื่อง — เว้นช่องปลายทางขากลับว่าง ต้องได้ระยะทางจริง ═══
  console.log('');
  console.log('═══ 8. เว้นช่องปลายทางขากลับว่าง = กลับบ้าน ต้องคิดระยะทางได้ ไม่ใช่ 0 ═══');
  const dist = await ev([
    "window.__legs = [];",
    "setPoint('from', 13.65, 100.49, 'บ้าน', 'exact', 'user');",
    "setPoint('to',   13.75, 100.53, 'โรงแรมดุสิต', 'exact', 'user');",
    "await new Promise(r=>setTimeout(r,400));",
    // ขากลับด้วยรถส่วนตัว ออกจากโรงพยาบาล แล้วเว้นช่องปลายทางว่างเพราะจะกลับบ้าน
    "{ const c=document.getElementById('legBackCar'); c.checked=true; c.dispatchEvent(new Event('change',{bubbles:true})); }",
    "const rf = document.getElementById('travelReturnFrom');",
    "rf.value = 'รพ.กรุงเทพ'; rf.dispatchEvent(new Event('input',{bubbles:true}));",
    "setPoint('retfrom', 13.72, 100.55, 'รพ.กรุงเทพ', 'exact', 'user');",
    "document.getElementById('travelReturnTo').value = '';",
    "await new Promise(r=>setTimeout(r,900));",
    "return { ret: parseFloat(document.getElementById('distReturn').value || 0),",
    "         diff: document.getElementById('returnDiff').checked,",
    "         legs: window.__legs.map(l => l.join(' -> ')) };"
  ].join('\n'));
  ok('ระบบรู้ว่าขากลับไปคนละทาง', dist.diff === true);
  ok('ระยะทางขากลับไม่เป็นศูนย์ ทั้งที่ไม่ได้พิมพ์ปลายทาง',
     dist.ret > 0, dist.ret + ' กม.');
  ok('คำนวณจาก รพ.กรุงเทพ กลับไปที่บ้าน โดยใช้พิกัดบ้านที่มีอยู่แล้ว',
     dist.legs.some(l => /รพ.กรุงเทพ -> บ้าน/.test(l)), dist.legs.join(' | '));

  ok('ไม่มี JavaScript error ตลอดการทดสอบ', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '));

  console.log('');
  console.log('══════════════════════════════════════════════════');
  console.log('  ผ่าน ' + results.filter(Boolean).length + ' / ' + results.length);
  console.log('══════════════════════════════════════════════════');
  process.exitCode = results.every(Boolean) ? 0 : 1;
} catch (e) { console.error('ล้มเหลว:', e.message); process.exitCode = 2; }
finally { try { ws.close(); } catch {} chrome.kill(); }
