// เปิดใบ Taxi มาแก้ หมุดของทุกเที่ยวต้องยังอยู่ และบันทึกทับได้
//
// 22 ต.ค. 2569 — เจ้าของงานส่งภาพหน้าจอมา: กรอกครบ ปักหมุดครบ บันทึกผ่าน
// แต่พอกด "แก้ไข" จากหน้าประวัติ หมุดหายหมด แล้วโดนด่าน
//   "❌ ยังปักหมุดไม่ครบ ระบบจึงวาดแผนที่ให้ไม่ได้"
//   "ทำไรได้ไหม ตอนแรกมันปกตินะ แต่พอผมกดแก้ไขในประวัติกลายเป็นว่าหมุดหายหมดเลย"
//
// ต้นเหตุมีสองชั้น ต้องแก้ทั้งคู่ ไม่งั้นยังพังอยู่ดี
//   ชั้นที่ 1 — ตอนคืนค่า โค้ดใส่แต่ "ข้อความ" ลงช่อง จาก/ถึง
//              entry.fromGeo / entry.toGeo ที่บันทึกไว้ไม่เคยถูกเขียนกลับเป็น
//              dataset.lat / dataset.lng ของช่อง หมุดจึงหายตั้งแต่วินาทีแรกที่เปิด
//   ชั้นที่ 2 — ต่อให้ใส่กลับ onTaxiDirChange() เรียก syncTaxiRoutes() ทันทีหลังจากนั้น
//              แถวที่ยังไม่ติดธง dataset.touched จะโดน setTaxiField() เขียนทับ
//              ซึ่ง "ลบ dataset.lat/lng ทิ้งก่อนเสมอ" แล้วค่อยใส่หมุดเส้นทางหลัก
//              ใบที่เบิกเฉพาะ Taxi ไม่มีหมุดเส้นทางหลัก = ลบทิ้งแล้วไม่ใส่อะไรคืน
//
// เคสในภาพหน้าจอตกหลุมทั้งสองชั้นพอดี เพราะเที่ยวที่ 1-2 ปลายทางคือบ้าน
// ซึ่งตรงกับเส้นทางหลักแบบกลับหัว ข้อความจึงตรงกับที่ระบบเติมให้
// ธง touched เลยไม่ถูกติด แล้วหมุดโดนล้างซ้ำอีกรอบ
//
//   cd public && python3 -m http.server 8099 --bind 127.0.0.1
//   node scripts/test-edit-taxi-pins.mjs
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9661, PROFILE = 'C:/Users/teerapat/AppData/Local/Temp/pb-taxipins';
const APP = process.env.APP_URL || 'http://127.0.0.1:8099';
const NL = String.fromCharCode(10);

const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=' + PORT,
  '--user-data-dir=' + PROFILE, '--no-first-run', '--disable-gpu',
  '--window-size=1400,1400', 'about:blank'], { stdio: 'ignore' });

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

const HOME = '99/1 ซอยทดสอบ 7 ถนนทดสอบ';
const DMK  = 'สนามบินดอนเมือง';

/* สามเที่ยวตามภาพหน้าจอจริง ทั้งหมดเป็นขากลับ ปักหมุดครบทุกช่อง
   เที่ยวที่ 1-2 ปลายทางคือบ้าน = ตรงกับเส้นทางหลักแบบกลับหัว (ชนกับดักชั้นที่ 2)
   เที่ยวที่ 3 เป็นเส้นทางของตัวเอง ไม่ตรงกับเส้นทางหลัก (รอดกับดักชั้นที่ 2) */
const ENTRIES = [
  { date: '2026-10-22', direction: 'ขากลับ', amount: 480, from: DMK, to: HOME,
    fromGeo: { lat: 13.9126, lng: 100.6068 }, toGeo: { lat: 13.6591, lng: 100.5330 } },
  { date: '2026-10-22', direction: 'ขากลับ', amount: 444,
    from: 'สตาร์บัคส์ (Starbucks) สาขา อิมแพค อารีน่า', to: HOME,
    fromGeo: { lat: 13.9125, lng: 100.5480 }, toGeo: { lat: 13.6591, lng: 100.5330 } },
  { date: '2026-10-23', direction: 'ขากลับ', amount: 150,
    from: 'โรงพยาบาลตากสิน', to: 'เซ็นทรัลพลาซา พระราม 2',
    fromGeo: { lat: 13.7293, lng: 100.5021 }, toGeo: { lat: 13.6650, lng: 100.4300 } }
];
const TOTAL = ENTRIES.reduce((s, e) => s + e.amount, 0);   // 1074

/* หัวใจของเคสนี้: เส้นทางหลัก "ไม่มีหมุด" เพราะใบนี้เบิกเฉพาะค่า Taxi
   ถ้าใส่ fromGeo/toGeo ให้เส้นทางหลักด้วย บั๊กจะถูกกลบจนมองไม่เห็น */
const SAVED = {
  id: 9971, requestedBy: 'สมชาย ทดสอบ', position: 'นักวิเคราะห์ธุรกิจ',
  amount: TOTAL, category: 'TRAVEL001', date: '2026-10-22',
  description: 'กิจกรรมเยี่ยมสำรวจ',
  attachments: { images: [] },
  inputMetadata: {
    _pdfTemplates: ['REPORT', 'TRANSPORT_RECEIPT'],
    _budgetCategoryId: 'TRAVEL001',
    _activityName: 'กิจกรรมเยี่ยมสำรวจ', _extraActivities: [],
    _position: 'นักวิเคราะห์ธุรกิจ', _affiliation: 'สนับสนุนการบริหารองค์กร',
    _docDate: '2026-10-22',
    _addr: { no: '99/1', soi: 'ทดสอบ 7', road: 'ทดสอบ',
             sub: 'ปากคลองบางปลากด', dist: 'พระสมุทรเจดีย์',
             prov: 'สมุทรปราการ', zip: '10290' },
    _travel: {
      startDate: '2026-10-22', endDate: '2026-10-23',
      from: HOME, to: DMK,
      distOut: 0, distRet: 0,
      returnDifferent: false, useAppMap: true
    },
    _carType: 'ไม่ระบุ',
    _costs: { fuelRate: '5', airAmount: 0, tollAmount: 0, parkingAmount: 0, otherAmount: 0,
              taxiEntries: ENTRIES, hotelEntries: { entries: [] } }
  }
};

/* ใบเก่าก่อน 2.26.0 ไม่มี fromGeo/toGeo ในเที่ยว Taxi เลย
   ต้องเปิดได้ตามปกติ ห้ามพัง และห้ามแกล้งใส่หมุดมั่วให้ */
const LEGACY = JSON.parse(JSON.stringify(SAVED));
LEGACY.id = 9972;
LEGACY.inputMetadata._costs.taxiEntries =
  ENTRIES.map(e => ({ date: e.date, direction: e.direction, amount: e.amount,
                      from: e.from, to: e.to }));

const CAT = {
  id: 'TRAVEL001', name: 'เบิกค่าเดินทาง+ที่พัก',
  pdfTemplates: ['REPORT', 'TRANSPORT_RECEIPT'], fuelRate: 5, taxiMaxPerTrip: 750,
  flatRate: { enabled: true, maxKm: 200, outsideMetro: 1200, bands: [
    { upTo: 10.99, amount: 150 }, { upTo: 20.99, amount: 250 }, { upTo: null, amount: 750 } ] },
  attachmentRules: { LOCATION: { show: true, required: true,  label: 'แผนที่' },
                     RECEIPT:  { show: true, required: false, label: 'ใบเสร็จ' } },
  attachmentOrder: ['LOCATION', 'RECEIPT']
};

const stub = recs => [
  "localStorage.setItem('token','x');",
  "window.__saved = null;",
  "const RECS=" + JSON.stringify(recs) + ";",
  "const CAT=" + JSON.stringify([CAT]) + ";",
  "const of=window.fetch;",
  "window.fetch=function(u,i){const s=(typeof u==='string')?u:(u&&u.url)||'';",
  "  if(s.indexOf('/auth/me')>=0) return Promise.resolve(new Response(",
  "    JSON.stringify({id:1,email:'t@ha.or.th',name:'test',role:'admin'}),",
  "    {status:200,headers:{'Content-Type':'application/json'}}));",
  "  if(s.indexOf('/settings')>=0&&s.indexOf('list-append')<0) return Promise.resolve(new Response(",
  "    JSON.stringify({fuelRate:5,taxiMaxPerTrip:750,positionList:[],affiliationList:[],activityList:[]}),",
  "    {status:200,headers:{'Content-Type':'application/json'}}));",
  "  if(s.indexOf('/budget-categories')>=0) return Promise.resolve(new Response(",
  "    JSON.stringify(CAT),{status:200,headers:{'Content-Type':'application/json'}}));",
  "  if(i && (i.method==='PUT'||i.method==='POST') && s.indexOf('/expenses')>=0){",
  "    window.__saved = i.body; return new Promise(()=>{}); }",
  "  if(s.indexOf('/expenses')>=0) return Promise.resolve(new Response(",
  "    JSON.stringify(RECS), {status:200,headers:{'Content-Type':'application/json'}}));",
  "  if(s.indexOf('/profiles')>=0) return Promise.resolve(new Response('[]',",
  "    {status:200,headers:{'Content-Type':'application/json'}}));",
  /* routeLeg() เป็นฟังก์ชันในสโคปของหน้า ไม่ใช่ของ window ทับจากข้างนอกไม่ได้
     ต้องปลอมที่ปลายทางจริงคือ /map-route เพื่อให้โค้ดเส้นทางถูกเดินจริงทั้งเส้น */
  "  if(s.indexOf('/map-route')>=0){",
  "    const q=new URLSearchParams(s.split('?')[1]||'');",
  "    const a=[parseFloat(q.get('flon')),parseFloat(q.get('flat'))];",
  "    const b=[parseFloat(q.get('tlon')),parseFloat(q.get('tlat'))];",
  "    return Promise.resolve(new Response(JSON.stringify({features:[{",
  "      properties:{distance:12300},",
  "      geometry:{type:'LineString',coordinates:[a,b]}}]}),",
  "      {status:200,headers:{'Content-Type':'application/json'}}));}",
  "  return of(u,i);};"
].join(NL);

/* อ่านหมุดของทุกแถวออกมาจากหน้าจอจริง ไม่ได้อ่านจากตัวแปรภายใน
   เพราะด่านตอนบันทึกก็อ่านจากที่เดียวกันนี้ */
const READ_ROWS = [
  "const rows=[...document.querySelectorAll('.taxi-entry')];",
  "const pin = el => (el && el.dataset.lat && el.dataset.lng)",
  "  ? (Math.round(parseFloat(el.dataset.lat)*10000)/10000) + ',' +",
  "    (Math.round(parseFloat(el.dataset.lng)*10000)/10000) : null;",
  "return rows.map(r=>({",
  "  from: r.querySelector('.taxi-from').value,",
  "  to:   r.querySelector('.taxi-to').value,",
  "  fromPin: pin(r.querySelector('.taxi-from')),",
  "  toPin:   pin(r.querySelector('.taxi-to')),",
  "  amt: parseFloat(r.querySelector('.taxi-amt-ret').value)||0 }));"
].join(NL);

const pinStr = g => (Math.round(g.lat * 10000) / 10000) + ',' + (Math.round(g.lng * 10000) / 10000);

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
  await send('Page.addScriptToEvaluateOnNewDocument', { source: stub([SAVED, LEGACY]) });

  await send('Page.navigate', { url: APP + '/expense.html?edit=9971' });
  await sleep(7000);

  console.log('═══ 1. เปิดใบมาแก้ หมุดของทุกเที่ยวต้องยังอยู่ครบ ═══');
  const rows = await ev(READ_ROWS);
  ok('ขึ้นครบทั้ง 3 เที่ยว', rows.length === 3, rows.length + ' เที่ยว');
  ENTRIES.forEach((e, i) => {
    const r = rows[i] || {};
    ok('เที่ยวที่ ' + (i + 1) + ' หมุดต้นทางยังอยู่ ตรงกับที่บันทึกไว้',
       r.fromPin === pinStr(e.fromGeo), String(r.fromPin) + ' (ควรเป็น ' + pinStr(e.fromGeo) + ')');
    ok('เที่ยวที่ ' + (i + 1) + ' หมุดปลายทางยังอยู่ ตรงกับที่บันทึกไว้',
       r.toPin === pinStr(e.toGeo), String(r.toPin) + ' (ควรเป็น ' + pinStr(e.toGeo) + ')');
  });
  ok('ชื่อสถานที่ไม่ถูกเส้นทางหลักเขียนทับ',
     (rows[1] || {}).from === ENTRIES[1].from, (rows[1] || {}).from);
  ok('ยอดของแต่ละเที่ยวครบ',
     rows.map(r => r.amt).join(',') === '480,444,150', rows.map(r => r.amt).join(','));

  console.log('');
  console.log('═══ 2. แผนที่ต้องลากเส้นครบทุกเที่ยวตั้งแต่เปิดขึ้นมา ═══');
  const map = await ev([
    "if (typeof drawTaxiLegLines === 'function') await drawTaxiLegLines();",
    "return { lines: (typeof taxiLegLines!=='undefined') ? taxiLegLines.length : -1,",
    "         marks: (typeof taxiLegMarkers!=='undefined') ? taxiLegMarkers.length : -1 };"
  ].join(NL));
  ok('ลากเส้นครบ 3 เที่ยว', map.lines === 3, String(map.lines));
  ok('ปักหมุดบนแผนที่ครบ (อย่างน้อย 4 จุด เพราะบ้านซ้ำกันถูกยุบรวม)',
     map.marks >= 4, String(map.marks));

  console.log('');
  console.log('═══ 3. กดบันทึกทับ ต้องผ่าน ไม่โดนด่าน "ยังปักหมุดไม่ครบ" ═══');
  const sent = await ev([
    "window.alert = m => { (window.__a = window.__a || []).push(String(m)); };",
    "window.__a = [];",
    "const b=document.getElementById('submitBtn'); if(b){ b.disabled=false; b.click(); }",
    "await new Promise(r=>setTimeout(r,2500));",
    "return { body: window.__saved, alerts:(window.__a||[]).slice(0,2) };"
  ].join(NL));
  let out = null;
  try { out = JSON.parse(sent.body || 'null'); } catch (e) {}
  ok('บันทึกออกไปได้ ไม่มีด่านขวาง', !!out,
     out ? 'ส่งออกแล้ว' : ((sent.alerts || []).join(' | ').slice(0, 170) || 'ไม่ได้ส่ง'));
  ok('ไม่มีข้อความ "ยังปักหมุดไม่ครบ" โผล่ขึ้นมา',
     !(sent.alerts || []).some(a => a.indexOf('ยังปักหมุดไม่ครบ') >= 0),
     (sent.alerts || []).join(' | ').slice(0, 120));
  if (out) {
    const ents = ((out.inputMetadata || {})._costs || {}).taxiEntries || [];
    ok('ส่งออกครบ 3 เที่ยว', ents.length === 3, ents.length + ' เที่ยว');
    ok('หมุดที่ส่งออกตรงกับที่บันทึกไว้เดิมทุกจุด',
       ents.length === 3 && ENTRIES.every((e, i) =>
         ents[i].fromGeo && ents[i].toGeo &&
         pinStr(ents[i].fromGeo) === pinStr(e.fromGeo) &&
         pinStr(ents[i].toGeo)   === pinStr(e.toGeo)),
       ents.map(e => e.fromGeo ? pinStr(e.fromGeo) : 'ไม่มีหมุด').join(' | '));
    ok('ยอดรวมที่ส่งออกยังเป็น ' + TOTAL, Number(out.amount) === TOTAL, String(out.amount));
  }

  console.log('');
  console.log('═══ 4. ใบเก่าที่ไม่เคยเก็บหมุด ต้องเปิดได้ ไม่พัง ไม่แกล้งใส่หมุดมั่ว ═══');
  await send('Page.navigate', { url: APP + '/expense.html?edit=9972' });
  await sleep(7000);
  const old = await ev(READ_ROWS);
  ok('ใบเก่าขึ้นครบ 3 เที่ยว', old.length === 3, old.length + ' เที่ยว');
  ok('ยอดของใบเก่าไม่เพี้ยน',
     old.map(r => r.amt).join(',') === '480,444,150', old.map(r => r.amt).join(','));
  ok('ชื่อสถานที่ของใบเก่ายังอยู่',
     (old[2] || {}).from === ENTRIES[2].from, (old[2] || {}).from);

  console.log('');
  ok('ไม่มี JavaScript error ตลอดการทดสอบ', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '));

  console.log('');
  console.log('══════════════════════════════════════════════════');
  console.log('  ผ่าน ' + results.filter(Boolean).length + ' / ' + results.length);
  console.log('══════════════════════════════════════════════════');
  process.exitCode = results.every(Boolean) ? 0 : 1;
} catch (e) { console.error('ล้มเหลว:', e.message); process.exitCode = 2; }
finally { try { ws.close(); } catch {} chrome.kill(); }
