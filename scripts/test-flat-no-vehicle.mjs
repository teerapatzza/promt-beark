// เลือกเหมาจ่าย = ไม่ต้องถามว่านั่งรถอะไร
//
// 19 ต.ค. 2569 — เจ้าของงานสั่ง:
//   "ถ้าเลือกติ๊กเหมาจ่าย เราจะไม่ต้องให้เขาเลือกละว่าเป็นรถยนต์หรือ taxi
//    เพราะเหมาจ่ายเราไม่สนว่าเดินทางอะไร แค่ต้องมีหมุดมีระยะทางและคิดเงินให้ได้ก็พอ
//    การมี 2 ช่องเดี๋ยว user จะงงว่าต้องเป็น taxi หรือว่าค่าน้ำมัน
//    แต่ flow ก็เหมือนเดิมนะ ถ้าเขาไม่ได้เลือกเหมาจ่ายก็มีรถยนต์กับ taxi ปกติเหมือนเดิม"
//
// ตรงกับ บัญชี ๘ ข้อ ๕ ที่เขียนว่า "ระยะทางเฉลี่ยตามการคำนวณของสถาบัน"
// โดยไม่ระบุชนิดพาหนะ
//
// เบื้องหลังยังตั้ง legOutCar/legBackCar ให้ เพราะใบรับรองค่าพาหนะ (FM-SAM-095-00)
// มีแค่ช่อง "ค่า Taxi" กับ "ค่าน้ำมันเชื้อเพลิง" ไม่มีช่องเหมาจ่าย
// เจ้าของงานเลือกให้พิมพ์ลงช่องค่าน้ำมันเหมือนเดิม เอกสารจึงไม่เปลี่ยนเลย
//
//   cd public && python3 -m http.server 8099 --bind 127.0.0.1
//   node scripts/test-flat-no-vehicle.mjs
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9609, PROFILE = 'C:/Users/teerapat/AppData/Local/Temp/pb-flatnoveh';
const APP = process.env.APP_URL || 'http://127.0.0.1:8099';
const FLAT = { enabled: true, maxKm: 200, outsideMetro: 1200, bands: [
  { upTo: 10.99, amount: 150 }, { upTo: 20.99, amount: 250 }, { upTo: 30.99, amount: 350 },
  { upTo: 40.99, amount: 450 }, { upTo: 50.99, amount: 550 }, { upTo: 60.99, amount: 650 },
  { upTo: null, amount: 750 } ] };

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

const vis = id => "(() => { const e=document.getElementById('" + id + "');"
  + " return e ? !e.classList.contains('hidden') : null; })()";
const snap = "({ carLbl: " + vis('legOutCarLabel') + ", taxiLbl: " + vis('legOutTaxiLabel')
  + ", backCarLbl: " + vis('legBackCarLabel') + ", backTaxiLbl: " + vis('legBackTaxiLabel')
  + ", flatLbl: " + vis('legOutFlatLabel') + ", backFlatLbl: " + vis('legBackFlatLabel')
  + ", taxiBox: " + vis('legOutTaxiBox') + ", legNote: " + vis('flatLegNote')
  + ", capNote: " + vis('taxiCapNote')
  + ", noteTxt: (document.getElementById('flatLegNote')||{}).textContent||''"
  + ", car: currentTrip().carType"
  + ", total: parseFloat(document.getElementById('totalAmount').dataset.value||0) })";

const setFlat = on => "{ const r=document.querySelector('input[name=\"fuelMethod\"][value=\""
  + (on ? 'flat' : 'distance') + "\"]'); r.checked=true;"
  + " r.dispatchEvent(new Event('change',{bubbles:true}));"
  + " await new Promise(x=>setTimeout(x,900)); }";
const setMode = normal => "{ const r=document.getElementById('"
  + (normal ? 'tripModeNormal' : 'tripModeSpecial') + "'); r.checked=true;"
  + " r.dispatchEvent(new Event('change',{bubbles:true}));"
  + " await new Promise(x=>setTimeout(x,700)); }";

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
    "const FLAT=" + JSON.stringify(FLAT) + ";",
    "const of=window.fetch;",
    "window.fetch=function(u,i){const s=(typeof u==='string')?u:(u&&u.url)||'';",
    "  if(s.indexOf('/auth/me')>=0) return Promise.resolve(new Response(",
    "    JSON.stringify({id:1,email:'t@ha.or.th',name:'test',role:'admin'}),",
    "    {status:200,headers:{'Content-Type':'application/json'}}));",
    "  if(s.indexOf('/budget-categories')>=0) return Promise.resolve(new Response(",
    "    JSON.stringify([{id:'TRAVEL002',name:'test',pdfTemplates:['REPORT','TRANSPORT_RECEIPT'],",
    "      attachmentRules:{},attachmentOrder:[],flatRate:FLAT,taxiMaxPerTrip:750,fuelRate:5}]),",
    "    {status:200,headers:{'Content-Type':'application/json'}}));",
    "  if(s.indexOf('/expenses')>=0||s.indexOf('/profiles')>=0)",
    "    return Promise.resolve(new Response('[]',{status:200,headers:{'Content-Type':'application/json'}}));",
    "  return of(u,i);};"
  ].join('\n') });
  await send('Page.navigate', { url: APP + '/expense.html' }); await sleep(5000);

  await ev([
    "const s=document.getElementById('categorySelect');",
    "s.value='TRAVEL002'; s.dispatchEvent(new Event('change',{bubbles:true}));",
    "await new Promise(r=>setTimeout(r,1200));",
    "const ds=document.getElementById('dateStart'), de=document.getElementById('dateEnd');",
    "ds.value='2026-10-19'; ds.dispatchEvent(new Event('change',{bubbles:true}));",
    "de.value='2026-10-20'; de.dispatchEvent(new Event('change',{bubbles:true}));",
    "await new Promise(r=>setTimeout(r,400));",
    "window.routeLeg = async () => ({ km: 45, meters: 45000, coords: [] });",
    "geoFrom={lat:13.6591,lng:100.5330,precision:'exact',label:'บ้าน'};",
    "geoTo={lat:13.9126,lng:100.6068,precision:'exact',label:'ดอนเมือง'};",
    "document.getElementById('travelFrom').value='บ้าน';",
    "document.getElementById('travelTo').value='ดอนเมือง';"
  ].join('\n'));

  console.log('═══ 1. ค่าเริ่มต้น (ยังไม่เลือกเหมาจ่าย) ต้องเหมือนเดิมทุกอย่าง ═══');
  const a = await ev("return " + snap + ";");
  ok('เห็นติ๊ก "รถส่วนตัว" และ "Taxi" ตามปกติ', a.carLbl === true && a.taxiLbl === true);
  ok('ยังไม่มีติ๊ก "เบิกขานี้" ให้เกะกะ', a.flatLbl === false);
  ok('ยังไม่มีป้ายบอกจำนวนขา', a.legNote === false);

  console.log('');
  console.log('═══ 2. เลือกเหมาจ่าย + เคสปกติ = ไม่ถามอะไรเลย ═══');
  const b = await ev(setFlat(true)
    + "\nawait recalcRoute(true); await new Promise(r=>setTimeout(r,1000));\nreturn " + snap + ";");
  ok('ติ๊ก "รถส่วนตัว" ถูกซ่อน', b.carLbl === false);
  ok('ติ๊ก "Taxi" ถูกซ่อน', b.taxiLbl === false);
  ok('กล่องกรอกค่า Taxi ถูกซ่อน', b.taxiBox === false);
  ok('เคสปกติไม่ถามว่าเบิกขาไหน (มีคำตอบเดียวอยู่แล้ว)', b.flatLbl === false);
  ok('ป้ายวงเงินค่า Taxi ถูกซ่อน เพราะเบิก Taxi ไม่ได้ในโหมดนี้', b.capNote === false);
  ok('มีป้ายบอกว่าคิดให้ทั้งสองขา',
     b.legNote === true && /ทั้งขาไปและขากลับ/.test(b.noteTxt), b.noteTxt.trim().slice(0, 80));
  ok('คิดเงินได้ทั้งสองขา 550 x 2 = 1,100', b.car === 'ไป-กลับ' && b.total === 1100,
     b.car + ' · ' + b.total + ' บาท');

  console.log('');
  console.log('═══ 3. เหมาจ่าย + กรณีพิเศษ = ถามแค่ว่าเบิกขาไหน ═══');
  const c = await ev(setMode(false) + "\nreturn " + snap + ";");
  ok('โผล่ติ๊ก "เบิกขานี้" ทั้งสองการ์ด',
     c.flatLbl === true && c.backFlatLbl === true);
  ok('ยังไม่ถามว่านั่งรถอะไร', c.carLbl === false && c.taxiLbl === false
     && c.backCarLbl === false && c.backTaxiLbl === false);

  console.log('');
  console.log('═══ 4. ติ๊กเบิกเฉพาะขาไป = คิดขาเดียว ═══');
  const d = await ev([
    "{const f=document.getElementById('legOutFlat'); f.checked=true;",
    " f.dispatchEvent(new Event('change',{bubbles:true})); await new Promise(x=>setTimeout(x,400));}",
    "{const b=document.getElementById('legBackFlat'); b.checked=false;",
    " b.dispatchEvent(new Event('change',{bubbles:true})); await new Promise(x=>setTimeout(x,400));}",
    "await recalcRoute(true); await new Promise(r=>setTimeout(r,1000));",
    "return Object.assign(" + snap + ", { flat: flatResult() });"
  ].join('\n'));
  ok('currentTrip เป็น "ขาไป" ไม่ใช่ "ไป-กลับ"', d.car === 'ขาไป', d.car);
  ok('คิดเงินขาเดียว 550 บาท', d.total === 550 && d.flat.legs.length === 1,
     d.total + ' บาท · ' + d.flat.legs.length + ' ขา');

  console.log('');
  console.log('═══ 5. กลับไปคิดตามระยะจริง = flow เดิมทุกประการ ═══');
  const e2 = await ev(setMode(true) + setFlat(false) + "\nreturn " + snap + ";");
  ok('ติ๊ก "รถส่วนตัว" และ "Taxi" กลับมา', e2.carLbl === true && e2.taxiLbl === true);
  ok('ติ๊ก "เบิกขานี้" หายไป', e2.flatLbl === false && e2.backFlatLbl === false);
  ok('ป้ายบอกจำนวนขาหายไป', e2.legNote === false);

  console.log('');
  console.log('═══ 6. ป้ายวันที่บนเอกสาร ═══');
  const f = await ev("const l=document.querySelector('label[for=\"docDate\"]');"
    + " return { txt: l ? l.textContent.trim() : '' };");
  ok('เปลี่ยนเป็น "วันที่เบิก / วันที่สิ้นสุดกิจกรรม"',
     /วันที่เบิก/.test(f.txt) && /สิ้นสุดกิจกรรม/.test(f.txt), f.txt);

  ok('ไม่มี JavaScript error ตลอดการทดสอบ', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '));

  console.log('');
  console.log('══════════════════════════════════════════════════');
  console.log('  ผ่าน ' + results.filter(Boolean).length + ' / ' + results.length);
  console.log('══════════════════════════════════════════════════');
  process.exitCode = results.every(Boolean) ? 0 : 1;
} catch (e) { console.error('ล้มเหลว:', e.message); process.exitCode = 2; }
finally { try { ws.close(); } catch {} chrome.kill(); }
