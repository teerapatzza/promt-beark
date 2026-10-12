// เหมาจ่ายต้องใช้กับการเดินทางด้วย Taxi ได้ และต้องไม่เบิกซ้ำสองวิธี
//
// ที่มา: 12 ต.ค. 2569 ผู้ใช้เลือกเหมาจ่ายแล้วยอดไม่ขึ้น เพราะเดินทางด้วย Taxi
// ไล่โค้ดเจอว่า currentTrip() อ่าน #carType ซึ่งคิดจากติ๊ก "รถส่วนตัว" อย่างเดียว
// ติ๊กแต่ Taxi -> carType = "ไม่ระบุ" -> tripTotal ไม่สร้างเที่ยวเลย -> ok=false, why=''
// หน้าจอจึงขึ้นข้อความสำรอง "ยังคิดเหมาจ่ายไม่ได้" ที่ไม่บอกเหตุผลอะไรเลย
//
// ประกาศ บัญชี ๘ ข้อ ๕ เขียนว่า "ค่าพาหนะเดินทางเหมาจ่าย ... ระยะทางเฉลี่ยตามการ
// คำนวณของสถาบัน" ไม่ได้ระบุชนิดพาหนะ และหมายเหตุท้ายบัญชีระบุว่า
// "ห้ามเบิกทั้งสองวิธีสำหรับการเดินทางช่วงเดียวกัน"
// เหมาจ่ายจึงเป็นทางเลือกของเที่ยวเดินทาง และต้องไม่บวกค่าโดยสารจริงซ้ำ
//
//   cd public && python -m http.server 8099 --bind 127.0.0.1
//   node scripts/test-flat-rate-taxi.mjs
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9605;
const PROFILE = 'C:/Users/teerapat/AppData/Local/Temp/pb-flattaxi';
const APP = process.env.APP_URL || 'http://127.0.0.1:8099';

const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=' + PORT,
  '--user-data-dir=' + PROFILE, '--no-first-run', '--disable-gpu',
  '--window-size=1440,1200', 'about:blank'], { stdio: 'ignore' });

let ws, id = 0;
const pending = new Map();
const pageErrors = [];
const send = (m, p = {}) => {
  const i = ++id;
  ws.send(JSON.stringify({ id: i, method: m, params: p }));
  return new Promise((r, j) => pending.set(i, { r, j }));
};
const ev = async (e) => {
  const r = await send('Runtime.evaluate', {
    expression: '(async()=>{' + e + '})()', awaitPromise: true, returnByValue: true
  });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result?.value;
};

let pass = 0, fail = 0;
const ck = (n, c, d) => {
  if (c) { pass++; console.log('ผ่าน  ' + n); }
  else { fail++; console.log('ตก    ' + n + (d !== undefined ? '  <-- ' + JSON.stringify(d) : '')); }
};

// ช่วงระยะทางตามบัญชี ๘ ข้อ ๕ — 46.5 กม. ตกช่วง ๔๑-๕๐.๙๙ = ๕๕๐ บาท/เที่ยว
const KM = 46.5, BAND = 550, LEGS = 2, EXPECT_FLAT = BAND * LEGS;   // ไป-กลับ = 1,100

const FLAT_CFG = {
  enabled: true, maxKm: 200, outsideMetro: 1200,
  bands: [
    { upTo: 10.99, amount: 150 }, { upTo: 20.99, amount: 250 },
    { upTo: 30.99, amount: 350 }, { upTo: 40.99, amount: 450 },
    { upTo: 50.99, amount: 550 }, { upTo: 60.99, amount: 650 },
    { upTo: null,  amount: 750 }
  ]
};

const stub = [
  "localStorage.setItem('token','x');",
  "const of = window.fetch;",
  "window.fetch = function (u,i) { const s=(typeof u==='string')?u:(u&&u.url)||'';",
  "  if (s.indexOf('/auth/me')>=0) return Promise.resolve(new Response(",
  "    JSON.stringify({id:1,email:'t@ha.or.th',name:'ทดสอบ',role:'admin'}),",
  "    {status:200,headers:{'Content-Type':'application/json'}}));",
  "  if (s.indexOf('/budget-categories')>=0) return Promise.resolve(new Response(",
  "    JSON.stringify([{ id:'FLAT', name:'ค่าใช้จ่ายที่เป็นเงินสด', fuelRate: 5,",
  "      pdfTemplates:['REPORT','TRANSPORT_RECEIPT'],",
  "      flatRate:" + JSON.stringify(FLAT_CFG) + ",",
  "      attachmentRules:{LOCATION:{show:true,required:false}}, attachmentOrder:['LOCATION'] }]),",
  "    {status:200,headers:{'Content-Type':'application/json'}}));",
  "  if (s.indexOf('/profiles')>=0||s.indexOf('/expenses')>=0)",
  "    return Promise.resolve(new Response('[]',{status:200,headers:{'Content-Type':'application/json'}}));",
  "  return of(u,i); };",
  "window.routeLeg = async () => ({ km: " + KM + ", meters: " + (KM * 1000) + ", coords: [] });",
  // เคสที่ผู้ใช้เจอจริงอยู่ในเขต กทม.ปริมณฑล แต่เทสต์ไม่ได้ปักหมุด
  // ระบบจะเดาว่านอกเขตแล้วข้ามตารางช่วงระยะทางไป จึงบังคับให้เป็นในเขต
  "window.addEventListener('load', function(){ window.isMetroTripFE = function(){",
  "  return { inMetro: true, why: 'บังคับในเทสต์' }; }; });"
].join('\n');

/** เตรียมใบ: เลือกหมวด ใส่วันที่ ใส่ระยะทาง แล้วติ๊กพาหนะตามที่ส่งมา */
const setup = (opts) => [
  "const s=document.getElementById('categorySelect'); s.value='FLAT';",
  "s.dispatchEvent(new Event('change',{bubbles:true}));",
  "await new Promise(r=>setTimeout(r,1200));",
  "const set=(id,v)=>{const e=document.getElementById(id); if(e){e.value=v;",
  "  e.dispatchEvent(new Event('input',{bubbles:true})); e.dispatchEvent(new Event('change',{bubbles:true}));}};",
  "const tick=(id,on)=>{const e=document.getElementById(id); if(e && e.checked!==on){e.checked=on;",
  "  e.dispatchEvent(new Event('change',{bubbles:true}));}};",
  "set('dateStart','2026-10-20'); set('dateEnd','2026-10-22');",
  "tick('legOutCar'," + (opts.car ? 'true' : 'false') + ");",
  "tick('legOutTaxi'," + (opts.taxi ? 'true' : 'false') + ");",
  "await new Promise(r=>setTimeout(r,700));",
  // ระยะทางเป็นช่องอ่านอย่างเดียว ระบบเติมจากแผนที่ — ป้อนตรงแล้วสั่งคิดใหม่
  "const dO=document.getElementById('distOutbound'), dR=document.getElementById('distReturn');",
  "if(dO) dO.value=" + KM + "; if(dR) dR.value=" + KM + ";",
  "const flat=[...document.querySelectorAll('input[name=\"fuelMethod\"]')].find(r=>r.value==='flat');",
  "if(flat){ flat.checked=true; flat.dispatchEvent(new Event('change',{bubbles:true})); }",
  "await new Promise(r=>setTimeout(r,500));",
  "if(typeof calculateTravelTotal==='function') calculateTravelTotal();",
  "await new Promise(r=>setTimeout(r,500));",
  "return 1;"
].join('\n');

const readState = [
  "const note=document.getElementById('flatRateNote');",
  "const fr=(typeof flatResult==='function')?flatResult():null;",
  "const taxiAmts=[...document.querySelectorAll('.taxi-amt-out,.taxi-amt-ret')];",
  "return { total: parseFloat(document.getElementById('totalAmount')?.dataset.value||'0'),",
  "         flatOk: fr?fr.ok:null, flatTotal: fr?fr.total:null, flatWhy: fr?fr.why:null,",
  "         legs: fr?fr.legs.length:null,",
  "         noteText: note?note.textContent.replace(/\\s+/g,' ').trim():'',",
  "         noteHidden: note?note.className.indexOf('hidden')>=0:null,",
  "         taxiBoxes: taxiAmts.length,",
  "         taxiLocked: taxiAmts.length? taxiAmts.every(i=>i.readOnly||i.disabled) : null };"
].join('\n');

try {
  let u;
  for (let i = 0; i < 80 && !u; i++) {
    try {
      const l = await (await fetch('http://127.0.0.1:' + PORT + '/json/list')).json();
      const p = l.find(t => t.type === 'page');
      if (p) u = p.webSocketDebuggerUrl;
    } catch { /* ยังไม่พร้อม */ }
    await sleep(250);
  }
  ws = new WebSocket(u);
  await new Promise(r => ws.addEventListener('open', r));
  ws.addEventListener('message', e => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) {
      const { r, j } = pending.get(m.id); pending.delete(m.id);
      m.error ? j(new Error(m.error.message)) : r(m.result); return;
    }
    if (m.method === 'Runtime.exceptionThrown')
      pageErrors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
    if (m.method === 'Page.javascriptDialogOpening') send('Page.handleJavaScriptDialog', { accept: true });
  });
  await send('Page.enable'); await send('Runtime.enable');
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Page.addScriptToEvaluateOnNewDocument', { source: stub });

  // ═══ 1. เดินทางด้วย Taxi อย่างเดียว + เลือกเหมาจ่าย ═══
  console.log('═══ 1. ไป-กลับด้วย Taxi อย่างเดียว เลือกเหมาจ่าย ' + KM + ' กม. ═══');
  await send('Page.navigate', { url: APP + '/expense.html' }); await sleep(4200);
  await ev(setup({ car: false, taxi: true }));
  const taxiOnly = await ev(readState);
  console.log('   ' + JSON.stringify(taxiOnly));
  ck('เหมาจ่ายคิดได้ (ok)', taxiOnly.flatOk === true, taxiOnly);
  ck('สร้างเที่ยวครบ 2 เที่ยว', taxiOnly.legs === LEGS, taxiOnly.legs);
  ck('ยอดเหมาจ่าย = ' + EXPECT_FLAT + ' บาท (' + BAND + ' × ' + LEGS + ')',
     taxiOnly.flatTotal === EXPECT_FLAT, taxiOnly.flatTotal);
  ck('ยอดรวมในใบ = ' + EXPECT_FLAT, taxiOnly.total === EXPECT_FLAT, taxiOnly.total);
  ck('ไม่ขึ้นข้อความว่าคิดไม่ได้',
     taxiOnly.noteText.indexOf('ยังคิดเหมาจ่ายไม่ได้') < 0, taxiOnly.noteText.slice(0, 90));

  // ═══ 2. ห้ามเบิกซ้ำ — กรอกค่าโดยสารแล้วยอดต้องไม่บวกเพิ่ม ═══
  console.log('');
  console.log('═══ 2. ประกาศห้ามเบิกสองวิธีในเที่ยวเดียวกัน ═══');
  const dbl = await ev([
    "const boxes=[...document.querySelectorAll('.taxi-amt-out,.taxi-amt-ret')];",
    "boxes.forEach(i=>{ i.value='700'; i.dispatchEvent(new Event('input',{bubbles:true})); });",
    "await new Promise(r=>setTimeout(r,600));",
    "if(typeof calculateTravelTotal==='function') calculateTravelTotal();",
    "await new Promise(r=>setTimeout(r,400));",
    "return { total: parseFloat(document.getElementById('totalAmount')?.dataset.value||'0'),",
    "         locked: boxes.length? boxes.every(i=>i.readOnly||i.disabled):null, n: boxes.length };"
  ].join('\n'));
  console.log('   ' + JSON.stringify(dbl));
  ck('ช่องค่าโดยสาร Taxi ถูกล็อกเมื่อเลือกเหมาจ่าย', dbl.locked === true, dbl);
  ck('ยอดรวมไม่ถูกบวกค่าโดยสารซ้ำ (ยังเป็น ' + EXPECT_FLAT + ')', dbl.total === EXPECT_FLAT, dbl.total);

  // ═══ 3. รถส่วนตัว + เหมาจ่าย ต้องทำงานเหมือนเดิม ═══
  console.log('');
  console.log('═══ 3. ของเดิมต้องไม่พัง — รถส่วนตัว + เหมาจ่าย ═══');
  await send('Page.navigate', { url: APP + '/expense.html' }); await sleep(4200);
  await ev(setup({ car: true, taxi: false }));
  const carOnly = await ev(readState);
  console.log('   ' + JSON.stringify(carOnly));
  ck('รถส่วนตัว + เหมาจ่าย ยังคิดได้เหมือนเดิม', carOnly.flatOk === true, carOnly);
  ck('ยอดยังเป็น ' + EXPECT_FLAT, carOnly.flatTotal === EXPECT_FLAT, carOnly.flatTotal);

  // ═══ 4. ไม่ได้ติ๊กพาหนะเลย — ต้องบอกเหตุผลจริง ไม่ใช่ข้อความลอย ═══
  console.log('');
  console.log('═══ 4. ยังไม่ได้เลือกพาหนะ ข้อความต้องบอกเหตุผล ═══');
  await send('Page.navigate', { url: APP + '/expense.html' }); await sleep(4200);
  await ev(setup({ car: false, taxi: false }));
  const none = await ev(readState);
  console.log('   ' + JSON.stringify(none));
  ck('ต้องไม่ใช้ข้อความสำรองที่ไม่บอกเหตุผล',
     none.noteHidden === true || none.noteText.indexOf('ยังคิดเหมาจ่ายไม่ได้') < 0,
     none.noteText.slice(0, 110));

  ck('ไม่มี JavaScript error ตลอดการทดสอบ', pageErrors.length === 0, pageErrors.slice(0, 2));
} catch (e) {
  fail++;
  console.log('ล้มเหลว: ' + e.message);
} finally {
  try { ws && ws.close(); } catch { /* ปิดไปแล้ว */ }
  chrome.kill();
}

console.log('');
console.log('สรุป: ผ่าน ' + pass + '  ตก ' + fail);
process.exit(fail ? 1 : 0);
