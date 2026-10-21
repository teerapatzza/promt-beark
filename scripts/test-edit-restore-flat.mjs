// เปิดใบที่เลือก "เหมาจ่าย" มาแก้ วิธีคิดต้องกลับมาเป็นเหมาจ่ายเหมือนเดิม
//
// 21 ต.ค. 2569 — เจ้าของงานแจ้งใบจริงของ รศ.นพ.ปิยะ เนตรวิเชียร (ใบที่ 91)
//   "พอพี่กด edit รายการมันไม่ได้เซฟในอันที่พี่อัปเดตล่าสุด
//    มันจะบั๊กกลับไปที่ยังไม่เหมาจ่าย"
//
// ต้นเหตุ: ตอนบันทึกเก็บ _fuelMethod ลงไปจริง แต่ตอนเปิดมาแก้ไม่มีใครอ่านกลับ
// ฟอร์มจึงกลับไปติ๊ก "ตามระยะจริง" เสมอ ยอดเปลี่ยนจาก 500 เป็น 155
// แล้วถ้าผู้ใช้กดบันทึกทับ ใบจริงจะถูกเขียนทับด้วยวิธีคิดที่ผิด
//
//   cd public && python3 -m http.server 8099 --bind 127.0.0.1
//   node scripts/test-edit-restore-flat.mjs
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9621, PROFILE = 'C:/Users/teerapat/AppData/Local/Temp/pb-editflat';
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

/* ขึ้นบรรทัดใหม่แบบไม่ต้องเขียน escape ในสตริง */
const NEWLINE = String.fromCharCode(10);

/* อัตราเหมาจ่ายชุดเดียวกับที่ตั้งไว้ในระบบจริง (บัญชี ๘ ข้อ ๕) */
const FLAT_CFG = { enabled: true, maxKm: 200, outsideMetro: 1200, bands: [
  { upTo: 10.99, amount: 150 }, { upTo: 20.99, amount: 250 }, { upTo: 30.99, amount: 350 },
  { upTo: 40.99, amount: 450 }, { upTo: 50.99, amount: 550 }, { upTo: 60.99, amount: 650 },
  { upTo: null, amount: 750 } ] };

/* ย่อจากใบจริงใบที่ 91 เหลือเฉพาะที่เกี่ยวกับบั๊กนี้
   ขับรถเอง (ไป-กลับ) + เหมาจ่าย 250 + 250 = 500 ไม่มีรายการ Taxi */
const SAVED = {
  id: 9501, requestedBy: 'ทดสอบ เหมาจ่าย', position: 'ผู้ทรงคุณวุฒิ', amount: 500,
  category: 'TRAVEL002', date: '2026-10-06', description: 'เบิกค่าเดินทางไปปฏิบัติงาน',
  attachments: { images: [] },
  inputMetadata: {
    _pdfTemplates: ['REPORT', 'TRANSPORT_RECEIPT'],
    _budgetCategoryId: 'TRAVEL002',
    _activityName: 'ประชุม', _extraActivities: ['ประชุม'],
    _position: 'ผู้ทรงคุณวุฒิ', _affiliation: 'อิสระ', _docDate: '2026-10-06',
    _addr: { no: '1', road: 'โชคชัย 4', sub: 'ลาดพร้าว', dist: 'ลาดพร้าว',
             prov: 'กรุงเทพมหานคร', zip: '10230' },
    _travel: { startDate: '2026-10-06', endDate: '2026-10-06',
               from: 'โชคชัย 4 ซอย 32', to: 'สถาบันรับรองคุณภาพสถานพยาบาล',
               distOut: '15.5', distRet: '15.5',
               fromGeo: { lat: 13.8, lng: 100.6, precision: 'exact', label: 'โชคชัย 4 ซอย 32' },
               toGeo:   { lat: 13.85, lng: 100.52, precision: 'exact', label: 'สรพ.' } },
    _carType: 'ไป-กลับ',
    _fuelMethod: 'flat',
    /* 21 ต.ค. 2569 — ใบตั้งแต่ 2.23.0 บอกเองว่าเดินทางด้วยอะไร
       ใบนี้ขับรถไปเอง เปิดมาแก้ต้องกลับมาเป็น "รถส่วนตัว"
       ถ้าถูกเดาทับแล้วกดบันทึก ช่องที่กาในใบจะเปลี่ยนเองเงียบ ๆ */
    _flatVehicle: 'car',
    _flatRate: { total: 500, legs: [
      { dir: 'ขาไป',   km: 15.5, amount: 250, label: 'ระยะทาง 11.00 - 20.99 กม.' },
      { dir: 'ขากลับ', km: 15.5, amount: 250, label: 'ระยะทาง 11.00 - 20.99 กม.' } ] },
    _costs: { fuelRate: '5', taxiEntries: [], airAmount: 0,
              tollAmount: 0, parkingAmount: 0, otherAmount: 0,
              hotelEntries: { entries: [] } }
  }
};

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
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Page.addScriptToEvaluateOnNewDocument', { source: [
    "localStorage.setItem('token','x');",
    "window.__saved = null;",
    "const of = window.fetch;",
    "window.fetch = function (u,i) { const s=(typeof u==='string')?u:(u&&u.url)||'';",
    "  if (s.indexOf('/auth/me')>=0) return Promise.resolve(new Response(",
    "    JSON.stringify({id:1,email:'t@ha.or.th',name:'ทดสอบ',role:'admin'}),",
    "    {status:200,headers:{'Content-Type':'application/json'}}));",
    "  if (s.indexOf('/budget-categories')>=0) return Promise.resolve(new Response(",
    "    JSON.stringify([{ id:'TRAVEL002', name:'เบิกค่าเดินทาง', fuelRate: 5, taxiMaxPerTrip: 750,",
    "      flatRate: " + JSON.stringify(FLAT_CFG) + ",",
    "      pdfTemplates:['REPORT','TRANSPORT_RECEIPT'], attachmentRules:{}, attachmentOrder:[] }]),",
    "    {status:200,headers:{'Content-Type':'application/json'}}));",
    "  if (/\\/expenses\\/9501(\\?|$)/.test(s) && (!i || !i.method || i.method === 'GET'))",
    "    return Promise.resolve(new Response(JSON.stringify(" + JSON.stringify(SAVED) + "),",
    "      {status:200,headers:{'Content-Type':'application/json'}}));",
    "  if (i && (i.method === 'PUT' || i.method === 'POST') && s.indexOf('/expenses') >= 0) {",
    "    window.__saved = i.body; return new Promise(() => {}); }",
    "  if (s.indexOf('/expenses')>=0) return Promise.resolve(new Response(",
    "    JSON.stringify([" + JSON.stringify(SAVED) + "]),{status:200,headers:{'Content-Type':'application/json'}}));",
    "  if (s.indexOf('/profiles')>=0) return Promise.resolve(new Response('[]',",
    "    {status:200,headers:{'Content-Type':'application/json'}}));",
    "  return of(u,i); };",
    "window.routeLeg = async (a,b) => ({ km: 15.5, meters: 15500, coords: [] });"
  ].join(NEWLINE) });

  await send('Page.navigate', { url: APP + '/expense.html?edit=9501' });
  await sleep(6000);

  console.log('═══ 1. เปิดใบเหมาจ่ายมาแก้ วิธีคิดต้องกลับมาเหมือนเดิม ═══');
  const st = await ev([
    "const r = document.querySelector('input[name=\"fuelMethod\"]:checked');",
    "return {",
    "  method: r ? r.value : null,",
    "  flatOn: (typeof flatMethodOn === 'function') ? flatMethodOn() : null,",
    "  vehicle: (document.querySelector('input[name=\"flatVehicle\"]:checked')||{}).value || null,",
    "  vehicleBoxShown: !document.getElementById('flatVehicleBox').classList.contains('hidden'),",
    "  carType: (document.getElementById('carType')||{}).value,",
    "  from: (document.getElementById('travelFrom')||{}).value,",
    "  to: (document.getElementById('travelTo')||{}).value,",
    "  total: parseFloat((document.getElementById('totalAmount')||{}).dataset.value || 0)",
    "};"
  ].join(NEWLINE));

  ok('ติ๊กกลับมาที่ "เหมาจ่าย" ไม่ใช่ "ตามระยะจริง"', st.method === 'flat', String(st.method));
  ok('ระบบรู้ว่าอยู่โหมดเหมาจ่าย', st.flatOn === true, String(st.flatOn));
  ok('ยอดบนหน้าจอยังเป็น 500 เท่าใบจริง', st.total === 500, st.total + ' บาท');
  ok('คำถาม "เดินทางด้วยอะไร" โผล่ขึ้นมา', st.vehicleBoxShown === true);
  ok('คำตอบเดิมกลับมาเป็น "รถส่วนตัว" ไม่ถูกเดาทับ', st.vehicle === 'car', String(st.vehicle));
  ok('จุดเริ่มต้น-จุดหมายกลับมาครบ',
     st.from === 'โชคชัย 4 ซอย 32' && st.to === 'สถาบันรับรองคุณภาพสถานพยาบาล',
     st.from + ' → ' + st.to);

  console.log('');
  console.log('═══ 2. กดบันทึกทับ ต้องไม่เปลี่ยนวิธีคิดของใบจริง ═══');
  const sent = await ev([
    "window.alert = m => { (window.__a = window.__a || []).push(String(m)); };",
    "window.__a = [];",
    "const b = document.getElementById('submitBtn'); if (b) b.disabled = false;",
    "if (b) b.click();",
    "await new Promise(r => setTimeout(r, 1800));",
    "return { body: window.__saved, alerts: window.__a.slice(0,3) };"
  ].join(NEWLINE));
  let sentObj = null;
  try { sentObj = JSON.parse(sent.body || 'null'); } catch (e) {}
  ok('บันทึกผ่านการตรวจ ไม่มีอะไรมาขวาง',
     !!sentObj, sentObj ? 'ส่งออกไปแล้ว'
       : ((sent.alerts || []).join(' | ').slice(0, 160) || 'ไม่ได้ส่งข้อมูลออกไป'));
  if (sentObj) {
    const m = sentObj.inputMetadata || {};
    ok('ส่ง _fuelMethod = flat ออกไป ไม่ใช่ distance', m._fuelMethod === 'flat', String(m._fuelMethod));
    ok('ยังมีรายละเอียดเหมาจ่ายติดไปด้วย',
       !!(m._flatRate && Number(m._flatRate.total) === 500), JSON.stringify(m._flatRate || null).slice(0, 90));
    ok('ยอดที่ส่งออกไปยังเป็น 500', Number(sentObj.amount) === 500, String(sentObj.amount));
    ok('รูปแบบรถยังเป็นไป-กลับเหมือนเดิม', m._carType === 'ไป-กลับ', String(m._carType));
    ok('ส่งคำตอบพาหนะเดิมกลับไป ไม่กลายเป็น taxi',
       m._flatVehicle === 'car', String(m._flatVehicle));
  }

  ok('ไม่มี JavaScript error ตลอดการทดสอบ', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '));

  console.log('');
  console.log('══════════════════════════════════════════════════');
  console.log('  ผ่าน ' + results.filter(Boolean).length + ' / ' + results.length);
  console.log('══════════════════════════════════════════════════');
  process.exitCode = results.every(Boolean) ? 0 : 1;
} catch (e) { console.error('ล้มเหลว:', e.message); process.exitCode = 2; }
finally { try { ws.close(); } catch {} chrome.kill(); }
