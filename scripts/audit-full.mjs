// ตรวจทั้งระบบ: การคำนวณ · การปักหมุด · การค้นหาสถานที่ · และทุกเคสที่คุยกันไว้
// เดินจากฟอร์มจนถึงเอกสารที่ออกมา ไม่ใช่ตรวจทีละชิ้นแยกกัน
//
//   cd public && python3 -m http.server 8099 --bind 127.0.0.1
//   node scripts/audit-full.mjs
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9581, PROFILE = 'C:/Users/teerapat/AppData/Local/Temp/pb-audit';
const APP = process.env.APP_URL || 'http://127.0.0.1:8099';

const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=' + PORT,
  '--user-data-dir=' + PROFILE, '--no-first-run', '--disable-gpu',
  '--window-size=1440,1200', 'about:blank'], { stdio: 'ignore' });
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

// กรุงเทพ อยู่ในกรอบ กทม.ปริมณฑล / เชียงใหม่ อยู่นอกกรอบ
const BKK_A = [13.70, 100.50], BKK_B = [13.80, 100.55], CNX = [18.79, 98.99];

const STUB = [
  "localStorage.setItem('token','x');",
  "window.__saved = null;",
  "const of = window.fetch;",
  "window.fetch = function (u,i) { const s=(typeof u==='string')?u:(u&&u.url)||'';",
  "  if (s.indexOf('/auth/me')>=0) return Promise.resolve(new Response(",
  "    JSON.stringify({id:1,email:'t@ha.or.th',name:'ทดสอบ',role:'admin'}),",
  "    {status:200,headers:{'Content-Type':'application/json'}}));",
  "  if (s.indexOf('/budget-categories')>=0) return Promise.resolve(new Response(",
  "    JSON.stringify([{ id:'ALL', name:'ทดสอบ ใบรายงาน+ใบพาหนะ', fuelRate: 5, taxiMaxPerTrip: 600,",
  "      pdfTemplates:['REPORT','TRANSPORT_RECEIPT'],",
  "      attachmentRules:{}, attachmentOrder:[] }]),",
  "    {status:200,headers:{'Content-Type':'application/json'}}));",
  "  if (i && (i.method==='POST'||i.method==='PUT') && s.indexOf('/expenses')>=0) {",
  "    window.__saved = i.body; return new Promise(() => {}); }",
  "  if (s.indexOf('/expenses')>=0||s.indexOf('/profiles')>=0)",
  "    return Promise.resolve(new Response('[]',{status:200,headers:{'Content-Type':'application/json'}}));",
  "  return of(u,i); };",
  "window.routeLeg = async (a,b) => ({ km: 100, meters: 100000, coords: [] });"
].join('\n');

const BASE = [
  "const s = document.getElementById('categorySelect');",
  "s.value='ALL'; s.dispatchEvent(new Event('change',{bubbles:true}));",
  "await new Promise(r=>setTimeout(r,900));",
  "const set = (id,v) => { const e=document.getElementById(id); if(e){ e.value=v;",
  "  e.dispatchEvent(new Event('input',{bubbles:true})); e.dispatchEvent(new Event('change',{bubbles:true})); } };",
  "set('requestedBy','ทดสอบ ตรวจระบบ'); set('position','ที่ปรึกษา'); set('affiliation','อิสระ');",
  "set('activityName','ประชุมตรวจระบบ'); set('docDate','2025-10-20');",
  "set('addrNo','1'); set('addrSub','บางรัก'); set('addrDist','บางรัก');",
  "set('addrProv','กรุงเทพมหานคร'); set('addrZip','10500');",
  "set('dateStart','2025-10-20'); set('dateEnd','2025-10-22');",
  "set('targetProv','กรุงเทพมหานคร');"
].join('\n');

const tick = (i, on) => "{ const c=document.getElementById('" + i + "'); c.checked=" + (on ? 'true' : 'false') +
  "; c.dispatchEvent(new Event('change',{bubbles:true})); await new Promise(r=>setTimeout(r,250)); }";
const mode = sp => "{ const r=document.getElementById('" + (sp ? 'tripModeSpecial' : 'tripModeNormal') +
  "'); r.checked=true; r.dispatchEvent(new Event('change',{bubbles:true})); await new Promise(r2=>setTimeout(r2,350)); }";
const TOTAL = "parseFloat(document.getElementById('totalAmount').dataset.value||0)";
const RESET = [
  mode(false), tick('legOutCar', false), tick('legOutTaxi', false),
  "['tollCost','parkingCost','otherCost','airfareCost'].forEach(id=>{const e=document.getElementById(id); if(e){e.value=''; e.dispatchEvent(new Event('input',{bubbles:true}));}});",
  "document.getElementById('accommodationEntriesContainer').innerHTML='';",
  "document.getElementById('distOutbound').value=100; document.getElementById('distReturn').value=100;",
  // จุดเริ่มต้น/จุดหมาย เป็นช่องบังคับของใบพาหนะ ต้องมีทั้งข้อความและหมุด
  "document.getElementById('travelFrom').value='บ้าน';",
  "document.getElementById('travelTo').value='ที่ทำงาน';",
  "setPoint('from',13.70,100.50,'บ้าน','exact','user');",
  "setPoint('to',13.80,100.55,'ที่ทำงาน','exact','user');",
  "await new Promise(r=>setTimeout(r,350));",
  "calculateTravelTotal();"
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
  // ปิดแคชของเบราว์เซอร์ ไม่งั้นโปรไฟล์ที่ใช้ซ้ำจะเสิร์ฟไฟล์เก่าจากดิสก์
  // แล้วผลทดสอบจะเป็นของโค้ดรุ่นก่อนโดยไม่มีใครรู้
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Page.addScriptToEvaluateOnNewDocument', { source: STUB });
  await send('Page.navigate', { url: APP + '/expense.html' }); await sleep(4500);
  await ev(BASE);

  // ══════════════════ ก. การคำนวณ ══════════════════
  console.log('══════════ ก. การคำนวณ ══════════');
  console.log('อัตราค่าน้ำมัน 5 บาท/กม. · ระยะทาง 100 กม. ต่อขา');

  await ev(RESET);
  const c1 = await ev([tick('legOutCar', true), "return " + TOTAL + ";"].join('\n'));
  ok('เคสปกติ ติ๊กรถส่วนตัว = (100+100)×5 = 1,000', c1 === 1000, c1 + ' บาท');

  const c2 = await ev([
    "const rows=[...document.querySelectorAll('.accommodation-entry')];",
    "addAccommodationEntry(); const r=document.querySelector('.accommodation-entry');",
    "r.querySelector('.accommodation-rate').value=1200;",
    "r.querySelector('.accommodation-nights').value=2;",
    "r.querySelector('.accommodation-rate').dispatchEvent(new Event('input',{bubbles:true}));",
    "calculateTravelTotal(); return " + TOTAL + ";"
  ].join('\n'));
  ok('บวกที่พัก 1,200×2 = 2,400 → รวม 3,400', c2 === 3400, c2 + ' บาท');

  const c3 = await ev([
    tick('legOutTaxi', true),
    "const rs=[...document.querySelectorAll('#taxiEntriesList .taxi-entry')];",
    "rs[0].querySelector('.taxi-amt-out').value=300;",
    "rs[0].querySelector('.taxi-amt-out').dispatchEvent(new Event('input',{bubbles:true}));",
    "rs[1].querySelector('.taxi-amt-ret').value=320;",
    "rs[1].querySelector('.taxi-amt-ret').dispatchEvent(new Event('input',{bubbles:true}));",
    "calculateTravelTotal(); return { t: " + TOTAL + ", n: rs.length };"
  ].join('\n'));
  ok('บวก Taxi 300+320 = 620 → รวม 4,020', c3.t === 4020, c3.t + ' บาท');

  const c4 = await ev([
    "const set=(id,v)=>{const e=document.getElementById(id); e.value=v; e.dispatchEvent(new Event('input',{bubbles:true}));};",
    "set('airfareCost',3000); set('tollCost',120); set('parkingCost',80); set('otherCost',50);",
    "calculateTravelTotal(); return " + TOTAL + ";"
  ].join('\n'));
  ok('บวกเครื่องบิน 3,000 + ทางด่วน 120 + จอดรถ 80 + อื่นๆ 50 → รวม 7,270',
     c4 === 7270, c4 + ' บาท');

  const c5 = await ev([
    mode(true), tick('legOutCar', true), tick('legBackCar', false),
    "calculateTravelTotal(); return { t: " + TOTAL + ", car: document.getElementById('carType').value };"
  ].join('\n'));
  ok('เบิกรถขาเดียว คิดน้ำมันขาเดียว 500 → รวม 6,770',
     c5.t === 6770 && c5.car === 'ขาไป', c5.t + ' บาท (' + c5.car + ')');

  // เงินจากกล่องที่ซ่อนอยู่ต้องไม่ถูกนับ — เป็นบั๊กที่เคยเจอมาแล้ว
  const c6 = await ev([
    "const s=document.getElementById('categorySelect');",
    "return { hasTravelBox: !document.getElementById('travelDetailsBox').classList.contains('hidden') };"
  ].join('\n'));
  ok('กล่องค่าเดินทางแสดงอยู่จริงในหมวดนี้', c6.hasTravelBox === true);

  await ev(RESET);
  const c7 = await ev("return " + TOTAL + ";");
  ok('ล้างทุกอย่างแล้วยอดกลับเป็น 0 ไม่มีเงินค้างจากช่องที่ซ่อน', c7 === 0, c7 + ' บาท');

  // ══════════════════ ข. การปักหมุด ══════════════════
  console.log('');
  console.log('══════════ ข. การปักหมุด ══════════');

  const p1 = await ev([
    mode(true), tick('legOutCar', true), tick('legBackCar', true),
    "setPoint('from'," + BKK_A[0] + "," + BKK_A[1] + ",'จุดเริ่ม','exact','user');",
    "setPoint('to'," + BKK_B[0] + "," + BKK_B[1] + ",'จุดหมาย','exact','user');",
    "await new Promise(r=>setTimeout(r,400));",
    "return { from: !!geoFrom, to: !!geoTo, fromLbl: geoFrom.label, toLbl: geoTo.label };"
  ].join('\n'));
  ok('ปักหมุดจุดเริ่มต้นและจุดหมายได้', p1.from && p1.to, p1.fromLbl + ' → ' + p1.toLbl);

  const p2 = await ev([
    "const rf=document.getElementById('travelReturnFrom');",
    "rf.value='จุดกลับ'; rf.dispatchEvent(new Event('input',{bubbles:true}));",
    "setPoint('retfrom',13.72,100.52,'จุดกลับ','exact','user');",
    "await new Promise(r=>setTimeout(r,400));",
    "return { set: !!geoRetFrom, lbl: geoRetFrom && geoRetFrom.label };"
  ].join('\n'));
  ok('ปักหมุดจุดเริ่มต้นขากลับได้', p2.set === true, p2.lbl);

  const p3 = await ev([
    "const rf=document.getElementById('travelReturnFrom');",
    "rf.value=''; rf.dispatchEvent(new Event('input',{bubbles:true}));",
    "await new Promise(r=>setTimeout(r,600));",
    "return { cleared: !geoRetFrom };"
  ].join('\n'));
  ok('ลบข้อความแล้วหมุดถูกเอาออกด้วย ไม่ค้างคิดจากจุดเก่า', p3.cleared === true);

  // วงเงินค่า Taxi ผูกกับหมุด — จุดที่เคยพังตอนแยกการ์ด
  const p4 = await ev([
    mode(false),
    "recomputeTaxiCap();",
    "return { shown: !document.getElementById('taxiCapNote').classList.contains('hidden'),",
    "         text: document.getElementById('taxiCapNote').textContent.replace(/\\s+/g,' ').trim() };"
  ].join('\n'));
  ok('หมุดอยู่ใน กทม. → วงเงินค่า Taxi 600 บาทถูกบังคับ',
     p4.shown === true && /600/.test(p4.text), p4.text.slice(0, 80));

  const p5 = await ev([
    "setPoint('to'," + CNX[0] + "," + CNX[1] + ",'เชียงใหม่','exact','user');",
    "await new Promise(r=>setTimeout(r,400));",
    "recomputeTaxiCap();",
    "return !document.getElementById('taxiCapNote').classList.contains('hidden');"
  ].join('\n'));
  ok('ย้ายหมุดออกนอก กทม. → วงเงินไม่บังคับแล้ว', p5 === false);

  const p6 = await ev([
    "setPoint('to'," + BKK_B[0] + "," + BKK_B[1] + ",'จุดหมาย','exact','user');",
    "await new Promise(r=>setTimeout(r,300));",
    tick('legOutCar', false), tick('legOutTaxi', true),
    "return { routeShown: !document.getElementById('legOutRouteBox').classList.contains('hidden'),",
    "         fromUsable: document.getElementById('travelFrom').getBoundingClientRect().height > 10 };"
  ].join('\n'));
  ok('ติ๊กแค่ Taxi ก็ยังปักหมุดได้ (วงเงินต้องใช้หมุด)',
     p6.routeShown === true && p6.fromUsable === true);

  // ══════════════════ ค. การค้นหาสถานที่ ══════════════════
  console.log('');
  console.log('══════════ ค. การค้นหาสถานที่ ══════════');
  const sch = await ev([
    mode(true), tick('legOutCar', true), tick('legBackCar', true), tick('legOutTaxi', true),
    "const has = id => !!document.getElementById(id);",
    "const rows = document.querySelectorAll('.taxi-entry');",
    "const taxiHasSuggest = [...rows].some(r => r.querySelector('[id$=Suggest]'));",
    "return { from: has('fromSuggest'), to: has('toSuggest'),",
    "         retFrom: has('returnFromSuggest'), retTo: has('returnToSuggest'),",
    "         taxiRows: rows.length, taxiHasSuggest: taxiHasSuggest };"
  ].join('\n'));
  ok('จุดเริ่มต้น มีตัวช่วยค้นหา', sch.from === true);
  ok('จุดหมาย มีตัวช่วยค้นหา', sch.to === true);
  ok('จุดเริ่มต้นขากลับ มีตัวช่วยค้นหา', sch.retFrom === true);
  ok('ปลายทางขากลับ มีตัวช่วยค้นหา', sch.retTo === true);
  console.log('  หมายเหตุ  ช่อง จาก/ถึง ในแถว Taxi ' +
    (sch.taxiHasSuggest ? 'มีตัวช่วยค้นหา' : 'ยังไม่มีตัวช่วยค้นหา (เป็นข้อความที่พิมพ์ลงเอกสาร ไม่ได้ใช้คำนวณ)'));

  // ══════════════════ ง. ทุกเคส จนถึงเอกสาร ══════════════════
  console.log('');
  console.log('══════════ ง. ทุกเคสที่คุยกันไว้ — ฟอร์มถึงเอกสาร ══════════');

  const CASES = [
    ['ไป-กลับปกติ รถส่วนตัวล้วน', false, ['legOutCar'], [], 1000],
    ['ไป-กลับปกติ Taxi ล้วน',     false, ['legOutTaxi'], [[0, 'out', 300], [1, 'ret', 320]], 620],
    ['ไป-กลับปกติ รถ + Taxi',     false, ['legOutCar', 'legOutTaxi'], [[0, 'out', 300], [1, 'ret', 320]], 1620],
    ['กรณีพิเศษ เบิกขาไปอย่างเดียว', true, ['legOutCar'], [], 500]
  ];
  const payloads = {};
  for (const [name, special, ticks, amts, want] of CASES) {
    const r = await ev([
      RESET,
      special ? mode(true) : mode(false),
      ...ticks.map(t => tick(t, true)),
      "const rs=[...document.querySelectorAll('.taxi-entry')];",
      ...amts.map(([i, kind, v]) =>
        "if(rs[" + i + "]){const e=rs[" + i + "].querySelector('.taxi-amt-" + kind + "');" +
        " if(e){e.value=" + v + "; e.dispatchEvent(new Event('input',{bubbles:true}));}}"),
      "calculateTravelTotal();",
      "window.__saved=null; window.__a=[]; window.alert=m=>window.__a.push(String(m));",
      "const sb=document.getElementById('submitBtn'); sb.disabled=false; sb.click();",
      "await new Promise(r=>setTimeout(r,1300));",
      "return { t: " + TOTAL + ", body: window.__saved, alerts: window.__a.slice(0,2) };"
    ].join('\n'));
    let obj = null; try { obj = JSON.parse(r.body || 'null'); } catch (e) {}
    payloads[name] = obj;
    ok(name + ' — ยอดถูก ' + want.toLocaleString(), r.t === want, r.t + ' บาท');
    ok(name + ' — บันทึกผ่าน ส่งข้อมูลออกไปได้', !!obj, (r.alerts||[]).join(' | ').slice(0,150));
  }

  // เอกสารที่ออกมาจากข้อมูลแต่ละเคส
  await send('Page.navigate', { url: APP + '/history.html' }); await sleep(4500);
  await ev("window.renderRouteMapImage = async () => null; return 1;");
  console.log('');
  for (const [name, obj] of Object.entries(payloads)) {
    if (!obj) { ok(name + ' — เอกสาร (ข้ามเพราะไม่มีข้อมูล)', false); continue; }
    const doc = await ev([
      "const b = await buildDocumentHtml(" + JSON.stringify(obj) + ", function(){});",
      "const d = document.createElement('div'); d.innerHTML = b.html;",
      "const txt = (d.textContent||'').replace(/\\s+/g,' ');",
      "const m = txt.match(/รวมทั้งสิ้น ([0-9,\\.]+)/);",
      "return { pages: d.querySelectorAll('.pdf-page').length, total: m ? m[1] : '(ไม่พบ)',",
      "         len: (b.html||'').length };"
    ].join('\n')).catch(e => ({ err: e.message }));
    ok(name + ' — เอกสารสร้างได้ ยอดในเอกสาร ' + (doc.total || '?'),
       !doc.err && doc.pages > 0, doc.err ? doc.err.slice(0, 90) : doc.pages + ' หน้า');
  }

  ok('ไม่มี JavaScript error ตลอดการตรวจ', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '));

  console.log('');
  console.log('══════════════════════════════════════════════════');
  console.log('  ผ่าน ' + results.filter(Boolean).length + ' / ' + results.length);
  console.log('══════════════════════════════════════════════════');
  process.exitCode = results.every(Boolean) ? 0 : 1;
} catch (e) { console.error('ล้มเหลว:', e.message); process.exitCode = 2; }
finally { try { ws.close(); } catch {} chrome.kill(); }
