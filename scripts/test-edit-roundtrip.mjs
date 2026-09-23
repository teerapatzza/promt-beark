// เปิดใบเดิมมาแก้ไข ต้องได้ค่าเดิมกลับมาครบ แล้วบันทึกออกไปเหมือนเดิม
//
// เส้นทางนี้เสี่ยงที่สุดหลังเปลี่ยนเป็นการ์ดต่อขา เพราะการ์ดต้องอ่านค่าที่บันทึกไว้
// (carType, taxiEntries, returnFrom/returnTo) มาติ๊กให้ตรง
// ถ้าพลาด ผู้ใช้กดแก้ไขแล้วบันทึก ยอดจะเปลี่ยนไปเงียบๆ
//
//   cd public && python3 -m http.server 8099 --bind 127.0.0.1
//   node scripts/test-edit-roundtrip.mjs
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9577, PROFILE = 'C:/Users/teerapat/AppData/Local/Temp/pb-edit';
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

// ใบเดิมที่บันทึกไว้: ขาไปรถส่วนตัว ขากลับ Taxi และขากลับออกจากคนละที่
const SAVED = {
  id: 9500, requestedBy: 'ทดสอบ แก้ไข', position: 'ที่ปรึกษา', amount: 850,
  category: 'TRAVEL001', date: '2025-10-20', description: 'เบิกค่าเดินทางไปปฏิบัติงาน',
  attachments: { images: [] },
  inputMetadata: {
    _pdfTemplates: ['REPORT', 'TRANSPORT_RECEIPT'],
    _budgetCategoryId: 'TRAVEL001',
    _activityName: 'ประชุมวิชาการประจำปี', _extraActivities: ['ประชุมวิชาการประจำปี'],
    _position: 'ที่ปรึกษา', _affiliation: 'อิสระ', _docDate: '2025-10-20',
    _addr: { no: '1', soi: '', road: '', sub: 'บางรัก', dist: 'บางรัก', prov: 'กรุงเทพมหานคร', zip: '10500' },
    _extraAddr: '', _carType: 'ขาไป',
    _travel: {
      startDate: '2025-10-20', endDate: '2025-10-22',
      from: 'บ้าน', to: 'โรงแรมดุสิต',
      fromGeo: { lat: 13.65, lng: 100.49, label: 'บ้าน', precision: 'exact', source: 'user' },
      toGeo:   { lat: 13.75, lng: 100.53, label: 'โรงแรมดุสิต', precision: 'exact', source: 'user' },
      distOut: '100', distRet: '0', targetProv: 'กรุงเทพมหานคร'
    },
    _costs: {
      hotelEntries: { name: 'โรงแรมดุสิต', entries: [{ type: 'พักเดี่ยว', rate: '1200', nights: '2' }] },
      fuelRate: '5', airAmount: 0, tollAmount: '120', parkingAmount: '80', otherAmount: 0,
      taxiEntries: [{ date: '2025-10-22', direction: 'ขากลับ', from: 'โรงแรมดุสิต', to: 'บ้าน', amount: 450 }]
    }
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
  await send('Page.addScriptToEvaluateOnNewDocument', { source: [
    "localStorage.setItem('token','x');",
    "window.__saved = null;",
    "const of = window.fetch;",
    "window.fetch = function (u,i) { const s=(typeof u==='string')?u:(u&&u.url)||'';",
    "  if (s.indexOf('/auth/me')>=0) return Promise.resolve(new Response(",
    "    JSON.stringify({id:1,email:'t@ha.or.th',name:'ทดสอบ',role:'admin'}),",
    "    {status:200,headers:{'Content-Type':'application/json'}}));",
    "  if (s.indexOf('/budget-categories')>=0) return Promise.resolve(new Response(",
    "    JSON.stringify([{ id:'TRAVEL001', name:'เบิกค่าเดินทาง+ที่พัก', fuelRate: 5,",
    "      pdfTemplates:['REPORT','TRANSPORT_RECEIPT'], attachmentRules:{}, attachmentOrder:[] }]),",
    "    {status:200,headers:{'Content-Type':'application/json'}}));",
    "  if (/\\/expenses\\/9500$/.test(s) && (!i || !i.method || i.method === 'GET'))",
    "    return Promise.resolve(new Response(JSON.stringify(" + JSON.stringify(SAVED) + "),",
    "      {status:200,headers:{'Content-Type':'application/json'}}));",
    "  if (i && (i.method === 'PUT' || i.method === 'POST') && s.indexOf('/expenses') >= 0) {",
    "    window.__saved = i.body; return new Promise(() => {}); }",
    "  if (s.indexOf('/expenses')>=0) return Promise.resolve(new Response(",
    "    JSON.stringify([" + JSON.stringify(SAVED) + "]),{status:200,headers:{'Content-Type':'application/json'}}));",
    "  if (s.indexOf('/profiles')>=0) return Promise.resolve(new Response('[]',",
    "    {status:200,headers:{'Content-Type':'application/json'}}));",
    "  return of(u,i); };",
    "window.routeLeg = async (a,b) => ({ km: 100, meters: 100000, coords: [] });"
  ].join('\n') });

  await send('Page.navigate', { url: APP + '/expense.html?edit=9500' });
  await sleep(6000);

  console.log('═══ 1. เปิดใบเดิมมาแก้ ค่าต้องกลับมาครบ ═══');
  const st = await ev([
    "return {",
    "  cat: document.getElementById('categorySelect').value,",
    "  requestedBy: document.getElementById('requestedBy').value,",
    "  activity: document.getElementById('activityName').value,",
    "  dateStart: document.getElementById('dateStart').value,",
    "  dateEnd: document.getElementById('dateEnd').value,",
    "  carType: document.getElementById('carType').value,",
    "  fuelRate: document.getElementById('fuelRate').value,",
    "  fuelShown: (document.getElementById('fuelRateLabel')||{}).textContent,",
    "  legOutCar: document.getElementById('legOutCar').checked,",
    "  legBackCar: document.getElementById('legBackCar').checked,",
    "  legOutTaxi: document.getElementById('legOutTaxi').checked,",
    "  legBackTaxi: document.getElementById('legBackTaxi').checked,",
    "  routeBoxShown: !document.getElementById('legOutRouteBox').classList.contains('hidden'),",
    "  backTaxiBoxShown: !document.getElementById('legBackTaxiBox').classList.contains('hidden'),",
    "  from: document.getElementById('travelFrom').value,",
    "  to: document.getElementById('travelTo').value,",
    "  rowsOut: document.querySelectorAll('#taxiEntriesList .taxi-entry').length,",
    "  rowsBack: document.querySelectorAll('#taxiEntriesListBack .taxi-entry').length,",
    "  taxiDate: (document.querySelector('#taxiEntriesListBack .taxi-date')||{}).value,",
    "  taxiAmt: (document.querySelector('#taxiEntriesListBack .taxi-amt-ret')||{}).value,",
    "  toll: document.getElementById('tollCost').value,",
    "  parking: document.getElementById('parkingCost').value,",
    "  hotelRows: document.querySelectorAll('.accommodation-entry').length,",
    "  total: parseFloat(document.getElementById('totalAmount').dataset.value||0)",
    "};"
  ].join('\n'));

  ok('หมวดหมู่กลับมาถูก', st.cat === 'TRAVEL001', st.cat);
  ok('ชื่อผู้ขอเบิกกลับมา', st.requestedBy === 'ทดสอบ แก้ไข', st.requestedBy);
  ok('ชื่อกิจกรรมกลับมา', st.activity === 'ประชุมวิชาการประจำปี', st.activity);
  ok('วันเดินทางกลับมาครบ', st.dateStart === '2025-10-20' && st.dateEnd === '2025-10-22',
     st.dateStart + ' ถึง ' + st.dateEnd);
  ok('อัตราค่าน้ำมันของหมวดกลับมา และที่ผู้ใช้เห็นตรงกัน',
     String(st.fuelRate) === '5' && String(st.fuelShown).trim() === '5',
     'ใช้คิด ' + st.fuelRate + ' · เห็น ' + String(st.fuelShown).trim());

  console.log('');
  console.log('═══ 2. การ์ดต่อขาต้องติ๊กตรงกับที่บันทึกไว้ ═══');
  ok('รูปแบบรถกลับมาเป็น "ขาไป"', st.carType === 'ขาไป', st.carType);
  ok('ติ๊กรถส่วนตัวเฉพาะขาไป', st.legOutCar === true && st.legBackCar === false,
     'ขาไป=' + st.legOutCar + ' ขากลับ=' + st.legBackCar);
  ok('ติ๊ก Taxi เฉพาะขากลับ', st.legOutTaxi === false && st.legBackTaxi === true,
     'ขาไป=' + st.legOutTaxi + ' ขากลับ=' + st.legBackTaxi);
  ok('ช่องเส้นทางขาไปเปิดให้เห็น', st.routeBoxShown === true);
  ok('กล่อง Taxi ขากลับเปิดให้เห็น', st.backTaxiBoxShown === true);
  ok('จุดเริ่มต้น-จุดหมายกลับมา', st.from === 'บ้าน' && st.to === 'โรงแรมดุสิต',
     st.from + ' → ' + st.to);
  ok('แถว Taxi ไปอยู่การ์ดขากลับ ไม่ใช่ขาไป',
     st.rowsBack === 1 && st.rowsOut === 0, 'ขาไป ' + st.rowsOut + ' · ขากลับ ' + st.rowsBack);
  ok('วันที่และยอดของแถว Taxi กลับมาครบ',
     st.taxiDate === '2025-10-22' && String(st.taxiAmt) === '450',
     st.taxiDate + ' · ' + st.taxiAmt + ' บาท');

  console.log('');
  console.log('═══ 3. ค่าอื่นและยอดรวมต้องไม่เพี้ยน ═══');
  ok('ค่าทางด่วนกลับมา', String(st.toll) === '120', st.toll);
  ok('ค่าที่จอดรถกลับมา', String(st.parking) === '80', st.parking);
  ok('รายการที่พักกลับมา', st.hotelRows === 1, st.hotelRows + ' รายการ');
  // ที่พัก 1200x2=2400 + น้ำมัน 100x5=500 + Taxi 450 + ทางด่วน 120 + จอดรถ 80 = 3550
  ok('ยอดรวมคิดใหม่ได้ถูกต้อง 3,550', st.total === 3550, st.total + ' บาท');

  console.log('');
  console.log('═══ 4. กดบันทึกแล้วส่งข้อมูลออกไปครบเหมือนเดิม ═══');
  const sent = await ev([
    "window.alert = m => { (window.__a = window.__a || []).push(String(m)); };",
    "window.__a = [];",
    "document.getElementById('submitBtn').disabled = false;",
    "document.getElementById('submitBtn').click();",
    "await new Promise(r=>setTimeout(r,1500));",
    "return { body: window.__saved, alerts: window.__a.slice(0,3) };"
  ].join('\n'));
  let sentObj = null;
  try { sentObj = JSON.parse(sent.body || 'null'); } catch (e) {}
  ok('บันทึกผ่านการตรวจ ไม่มีอะไรมาขวาง',
     !!sentObj, (sent.alerts || []).join(' | ').slice(0, 160) || 'ไม่ได้ส่งข้อมูลออกไป');
  if (sentObj) {
    const m = sentObj.inputMetadata || {}, c = m._costs || {}, tr = m._travel || {};
    ok('ส่งรูปแบบรถออกไปเหมือนเดิม', m._carType === 'ขาไป', m._carType);
    ok('ส่งรายการ Taxi ออกไปครบ',
       Array.isArray(c.taxiEntries) && c.taxiEntries.length === 1
       && c.taxiEntries[0].direction === 'ขากลับ' && Number(c.taxiEntries[0].amount) === 450,
       JSON.stringify(c.taxiEntries));
    ok('ส่งค่าทางด่วนและค่าที่จอดรถแยกกันถูก',
       String(c.tollAmount) === '120' && String(c.parkingAmount) === '80',
       'ทางด่วน ' + c.tollAmount + ' · จอดรถ ' + c.parkingAmount);
    ok('ส่งจุดเริ่มต้น-จุดหมายออกไปครบ',
       tr.from === 'บ้าน' && tr.to === 'โรงแรมดุสิต', tr.from + ' → ' + tr.to);
    ok('ยอดที่ส่งออกไปตรงกับที่แสดง', Number(sentObj.amount) === 3550, sentObj.amount);
  }

  ok('ไม่มี JavaScript error ตลอดการทดสอบ', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '));

  console.log('');
  console.log('══════════════════════════════════════════════════');
  console.log('  ผ่าน ' + results.filter(Boolean).length + ' / ' + results.length);
  console.log('══════════════════════════════════════════════════');
  process.exitCode = results.every(Boolean) ? 0 : 1;
} catch (e) { console.error('ล้มเหลว:', e.message); process.exitCode = 2; }
finally { try { ws.close(); } catch {} chrome.kill(); }
