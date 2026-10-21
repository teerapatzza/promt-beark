// เปิดใบที่มี Taxi หลายเที่ยวมาแก้ ต้องได้ครบทุกเที่ยว ไม่ใช่เหลือเที่ยวเดียว
//
// 21 ต.ค. 2569 — เจ้าของงานส่งหลักฐานมา: ใบมี Taxi 5 เที่ยว ยอดรวม 258 บาท
// ใบ PDF พิมพ์ครบ 5 บรรทัด หน้าประวัติก็ขึ้น 258 บาท
// แต่พอกด "แก้ไข" ฟอร์มขึ้นมาเหลือเที่ยวเดียว ยอด 61 บาท
//   "เห็นไหมว่ามันมี 5 เที่ยวใช่ไหม แต่พอผมกดเข้าไปแก้ไขมันกลายเป็นเที่ยวเดียว
//    เหตุการณ์ที่ผมบอกไงว่ามันไม่เหมือนครั้งก่อน"
//
// ต้นเหตุ: ตอนคืนค่า โค้ดเดาเองว่าแถวที่เพิ่งสร้างไปอยู่รายการไหน โดยดูจากทิศทาง
//   const row = (dir === 'ขากลับ' ? taxiListBack : taxiList).lastElementChild;
// แต่เคส "ไป-กลับตามปกติ" ทุกแถวอยู่รายการขาไปรายการเดียว (ดู addTaxiEntry)
// พอเจอเที่ยวขากลับเที่ยวแรก มันหยิบจากรายการว่าง ได้ null แล้วพังทั้งลูป
// และ catch ชั้นนอกกลืนข้อผิดพลาดทิ้งเงียบ ๆ ฟอร์มจึงโผล่มาแบบกรอกครึ่งเดียว
//
// ถ้าผู้ใช้กดบันทึกทับตอนนั้น ข้อมูลจริงจะหายไป 4 เที่ยว
//
//   cd public && python3 -m http.server 8099 --bind 127.0.0.1
//   node scripts/test-edit-many-taxi.mjs
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9657, PROFILE = 'C:/Users/teerapat/AppData/Local/Temp/pb-manytaxi';
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

/* ใบจริงที่เจ้าของงานส่งมา: 5 เที่ยว ขาไป 1 ขากลับ 4 รวม 258 บาท
   เป็นทริป "ไป-กลับตามปกติ" ซึ่งทุกแถวอยู่รายการเดียวกัน */
const ENTRIES = [
  { date: '2026-10-21', direction: 'ขาไป',   amount: 61,
    from: '141/36 ซอยสุขสวัสดิ์ 55 ถนนสุขสวัสดิ์', to: 'สนามบินดอนเมือง',
    fromGeo: { lat: 13.6591, lng: 100.5330 }, toGeo: { lat: 13.9126, lng: 100.6068 } },
  { date: '2026-10-22', direction: 'ขากลับ', amount: 44,
    from: 'โรงพยาบาลตากสิน', to: 'เขตบางนา กรุงเทพมหานคร',
    fromGeo: { lat: 13.7293, lng: 100.5021 }, toGeo: { lat: 13.6680, lng: 100.6050 } },
  { date: '2026-10-22', direction: 'ขากลับ', amount: 43,
    from: 'เซ็นทรัลพลาซา พระราม 2', to: 'อ.บ้านแพ้ว จ.สมุทรสาคร',
    fromGeo: { lat: 13.6650, lng: 100.4300 }, toGeo: { lat: 13.5500, lng: 100.1000 } },
  { date: '2026-10-22', direction: 'ขากลับ', amount: 55,
    from: 'สนามบินดอนเมือง', to: 'แยกสนามบินสุวรรณภูมิ',
    fromGeo: { lat: 13.9126, lng: 100.6068 }, toGeo: { lat: 13.6900, lng: 100.7501 } },
  { date: '2026-10-22', direction: 'ขากลับ', amount: 55,
    from: 'ต.บางปูใหม่ อ.เมืองสมุทรปราการ จ.สมุทรปราการ', to: 'เมกะบางนา',
    fromGeo: { lat: 13.5300, lng: 100.6400 }, toGeo: { lat: 13.6460, lng: 100.6830 } }
];
const TOTAL = ENTRIES.reduce((s, e) => s + e.amount, 0);   // 258

const SAVED = {
  id: 9951, requestedBy: 'ธีรภัทร คุ้มวงษ์', position: 'นักวิเคราะห์ธุรกิจ',
  amount: TOTAL, category: 'TRAVEL002', date: '2026-10-21',
  description: 'เบิกค่าเดินทางไปปฏิบัติงาน',
  attachments: { images: [] },
  inputMetadata: {
    _pdfTemplates: ['TRANSPORT_RECEIPT'],
    _budgetCategoryId: 'TRAVEL002',
    _activityName: 'กิจกรรมเยี่ยมสำรวจ', _extraActivities: [],
    _position: 'นักวิเคราะห์ธุรกิจ', _affiliation: 'อิสระ', _docDate: '2026-10-21',
    _addr: { no: '141/36', soi: 'สุขสวัสดิ์ 55', road: 'สุขสวัสดิ์',
             sub: 'ปากคลองบางปลากด', dist: 'พระสมุทรเจดีย์',
             prov: 'สมุทรปราการ', zip: '10290' },
    _travel: {
      startDate: '2026-10-21', endDate: '2026-10-22',
      from: '141/36 ซอยสุขสวัสดิ์ 55', to: 'สนามบินดอนเมือง',
      fromGeo: { lat: 13.6591, lng: 100.5330, precision: 'exact' },
      toGeo:   { lat: 13.9126, lng: 100.6068, precision: 'exact' },
      distOut: 46.4, distRet: 46.4,
      returnDifferent: false          // ไป-กลับตามปกติ = ทุกแถวอยู่รายการเดียว
    },
    _carType: 'ไม่ระบุ',
    _costs: { fuelRate: '5', airAmount: 0, tollAmount: 0, parkingAmount: 0, otherAmount: 0,
              taxiEntries: ENTRIES, hotelEntries: { entries: [] } }
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
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Page.addScriptToEvaluateOnNewDocument', { source: [
    "localStorage.setItem('token','x');",
    "window.__saved = null;",
    "const REC=" + JSON.stringify(SAVED) + ";",
    "const of=window.fetch;",
    "window.fetch=function(u,i){const s=(typeof u==='string')?u:(u&&u.url)||'';",
    "  if(s.indexOf('/auth/me')>=0) return Promise.resolve(new Response(",
    "    JSON.stringify({id:1,email:'t@ha.or.th',name:'test',role:'admin'}),",
    "    {status:200,headers:{'Content-Type':'application/json'}}));",
    "  if(s.indexOf('/settings')>=0&&s.indexOf('list-append')<0) return Promise.resolve(new Response(",
    "    JSON.stringify({fuelRate:5,taxiMaxPerTrip:750,positionList:[],affiliationList:[],activityList:[]}),",
    "    {status:200,headers:{'Content-Type':'application/json'}}));",
    "  if(s.indexOf('/budget-categories')>=0) return Promise.resolve(new Response(",
    "    JSON.stringify([{id:'TRAVEL002',name:'test',fuelRate:5,taxiMaxPerTrip:750,",
    "      pdfTemplates:['TRANSPORT_RECEIPT'],attachmentRules:{},attachmentOrder:[]}]),",
    "    {status:200,headers:{'Content-Type':'application/json'}}));",
    "  if(i && (i.method==='PUT'||i.method==='POST') && s.indexOf('/expenses')>=0){",
    "    window.__saved = i.body; return new Promise(()=>{}); }",
    "  if(s.indexOf('/expenses')>=0) return Promise.resolve(new Response(",
    "    JSON.stringify([REC]), {status:200,headers:{'Content-Type':'application/json'}}));",
    "  if(s.indexOf('/profiles')>=0) return Promise.resolve(new Response('[]',",
    "    {status:200,headers:{'Content-Type':'application/json'}}));",
    "  return of(u,i);};",
    "window.routeLeg = async () => ({ km: 46.4, meters: 46400, coords: [] });"
  ].join(NL) });

  await send('Page.navigate', { url: APP + '/expense.html?edit=9951' });
  await sleep(7000);

  console.log('═══ 1. เปิดใบ 5 เที่ยวมาแก้ ต้องได้ครบ 5 เที่ยว ═══');
  const st = await ev([
    "const rows=[...document.querySelectorAll('.taxi-entry')];",
    "const amtOf = r => {",
    "  const d=r.querySelector('.taxi-dir').value;",
    "  const el = d==='ขากลับ' ? r.querySelector('.taxi-amt-ret') : r.querySelector('.taxi-amt-out');",
    "  return parseFloat(el.value)||0; };",
    "return { n: rows.length,",
    "         dirs: rows.map(r=>r.querySelector('.taxi-dir').value),",
    "         amts: rows.map(amtOf),",
    "         froms: rows.map(r=>r.querySelector('.taxi-from').value),",
    "         total: parseFloat(document.getElementById('totalAmount').dataset.value||0),",
    "         taxiTicked: !!document.getElementById('legOutTaxi').checked,",
    "         saveDisabled: !!document.getElementById('submitBtn').disabled };"
  ].join(NL));
  ok('ขึ้นครบทั้ง 5 เที่ยว ไม่ใช่เหลือเที่ยวเดียว', st.n === 5, st.n + ' เที่ยว');
  ok('ทิศทางของแต่ละเที่ยวถูกต้อง',
     st.dirs.join(',') === 'ขาไป,ขากลับ,ขากลับ,ขากลับ,ขากลับ', st.dirs.join(','));
  ok('ยอดของแต่ละเที่ยวครบ',
     st.amts.join(',') === '61,44,43,55,55', st.amts.join(','));
  ok('ชื่อสถานที่ของแต่ละเที่ยวไม่สลับกัน',
     /สุขสวัสดิ์/.test(st.froms[0]) && /ตากสิน/.test(st.froms[1]) && /บางปูใหม่/.test(st.froms[4]),
     st.froms.map(f => f.slice(0, 14)).join(' | '));
  ok('ยอดรวมบนหน้าจอยังเป็น ' + TOTAL, st.total === TOTAL, st.total + ' บาท');
  ok('ติ๊ก Taxi ถูกเปิดให้ตรงกับที่ใบมี', st.taxiTicked === true);
  ok('ปุ่มบันทึกไม่ถูกปิด (แปลว่าคืนค่าสำเร็จ ไม่ได้พังกลางทาง)',
     st.saveDisabled === false);

  console.log('');
  console.log('═══ 2. กดบันทึกทับ ต้องส่งครบ 5 เที่ยว ไม่ใช่เที่ยวเดียว ═══');
  const sent = await ev([
    "window.alert = m => { (window.__a = window.__a || []).push(String(m)); };",
    "window.__a = [];",
    "const b=document.getElementById('submitBtn'); if(b){ b.disabled=false; b.click(); }",
    "await new Promise(r=>setTimeout(r,2200));",
    "return { body: window.__saved, alerts:(window.__a||[]).slice(0,2) };"
  ].join(NL));
  let out = null;
  try { out = JSON.parse(sent.body || 'null'); } catch (e) {}
  ok('บันทึกออกไปได้', !!out,
     out ? 'ส่งออกแล้ว' : ((sent.alerts || []).join(' | ').slice(0, 150) || 'ไม่ได้ส่ง'));
  if (out) {
    const ents = ((out.inputMetadata || {})._costs || {}).taxiEntries || [];
    ok('ส่งออกไปครบ 5 เที่ยว ข้อมูลจริงไม่ถูกตัดทิ้ง', ents.length === 5, ents.length + ' เที่ยว');
    ok('ยอดรวมที่ส่งออกยังเป็น ' + TOTAL, Number(out.amount) === TOTAL, String(out.amount));
    ok('ผลบวกรายเที่ยวเท่ากับยอดรวม',
       ents.reduce((s, e) => s + (Number(e.amount) || 0), 0) === TOTAL,
       String(ents.reduce((s, e) => s + (Number(e.amount) || 0), 0)));
  }

  console.log('');
  ok('ไม่มี JavaScript error ตลอดการทดสอบ', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '));

  console.log('');
  console.log('══════════════════════════════════════════════════');
  console.log('  ผ่าน ' + results.filter(Boolean).length + ' / ' + results.length);
  console.log('══════════════════════════════════════════════════');
  process.exitCode = results.every(Boolean) ? 0 : 1;
} catch (e) { console.error('ล้มเหลว:', e.message); process.exitCode = 2; }
finally { try { ws.close(); } catch {} chrome.kill(); }
