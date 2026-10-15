// อัตราค่าน้ำมันของหมวดต้องชนะค่าระบบเสมอ
//
// ที่มา: 12 ต.ค. 2569 ผู้ใช้ทักว่า "เบิกค่าน้ำมันเหมือนจะไม่เท่ากัน"
// อ่านฐานข้อมูลจริงพบว่า ค่าระดับระบบ = 4 แต่ทั้ง 4 หมวดตั้งทับไว้ = 5
// แต่หน้าจอขึ้น 4
//
// ไล่โค้ดเจอว่ามีสองเส้นทางเขียนลงช่องเดียวกันโดยไม่รอกัน
//   init()         -> applyCategory...() ตั้ง #fuelRate = ค่าของหมวด (5)
//   loadSettings() -> ตั้ง #fuelRate = ค่าระบบ (4)
// ใครตอบช้ากว่าเขียนทับคนนั้นชนะ และการคิดเงินอ่านจาก #fuelRate ตรง ๆ
// ถ้า /settings ตอบช้า ค่าน้ำมันจะกลายเป็น 4 ทั้งที่หมวดกำหนด 5
// = เบิกขาดไปกิโลเมตรละ 1 บาท โดยไม่มีใครรู้
//
//   cd public && python -m http.server 8099 --bind 127.0.0.1
//   node scripts/test-fuel-rate-race.mjs
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9613;
const PROFILE = 'C:/Users/teerapat/AppData/Local/Temp/pb-fuelrace';
const APP = process.env.APP_URL || 'http://127.0.0.1:8099';

const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=' + PORT,
  '--user-data-dir=' + PROFILE, '--no-first-run', '--disable-gpu', 'about:blank'], { stdio: 'ignore' });

let ws, id = 0;
const pending = new Map();
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

const SYS_RATE = 4;    // ค่าระดับระบบ (ของจริงบน production ตอนนี้)
const CAT_RATE = 5;    // หมวดตั้งทับไว้ ตามบัญชี ๘ ข้อ ๔
const KM = 100;

/** settingsDelay = หน่วงให้ /settings ตอบช้ากว่าหมวด เพื่อจำลองเน็ตช้า */
const stub = (settingsDelay) => [
  "localStorage.setItem('token','x');",
  "const of = window.fetch;",
  "const wait = ms => new Promise(r=>setTimeout(r,ms));",
  "window.fetch = async function (u,i) { const s=(typeof u==='string')?u:(u&&u.url)||'';",
  "  if (s.indexOf('/auth/me')>=0) return new Response(",
  "    JSON.stringify({id:1,email:'t@ha.or.th',name:'ทดสอบ',role:'admin'}),",
  "    {status:200,headers:{'Content-Type':'application/json'}});",
  "  if (s.indexOf('/settings')>=0) { await wait(" + settingsDelay + ");",
  "    return new Response(JSON.stringify({ fuelRate: " + SYS_RATE + ", taxiMaxPerTrip: 600,",
  "      hotelRateSingle: 1500, hotelRateDouble: 1000, positionList: [], affiliationList: [] }),",
  "      {status:200,headers:{'Content-Type':'application/json'}}); }",
  "  if (s.indexOf('/budget-categories')>=0) return new Response(",
  "    JSON.stringify([{ id:'C', name:'เบิกค่าเดินทาง+ที่พัก', fuelRate: " + CAT_RATE + ",",
  "      pdfTemplates:['REPORT','TRANSPORT_RECEIPT'],",
  "      attachmentRules:{LOCATION:{show:true}}, attachmentOrder:['LOCATION'] }]),",
  "    {status:200,headers:{'Content-Type':'application/json'}});",
  "  if (s.indexOf('/profiles')>=0||s.indexOf('/expenses')>=0)",
  "    return new Response('[]',{status:200,headers:{'Content-Type':'application/json'}});",
  "  return of(u,i); };",
  "window.routeLeg = async () => ({ km: " + KM + ", meters: " + KM * 1000 + ", coords: [] });"
].join('\n');

const fill = [
  "const s=document.getElementById('categorySelect'); s.value='C';",
  "s.dispatchEvent(new Event('change',{bubbles:true}));",
  "await new Promise(r=>setTimeout(r,1400));",
  "const set=(id,v)=>{const e=document.getElementById(id); if(e){e.value=v;",
  "  e.dispatchEvent(new Event('input',{bubbles:true})); e.dispatchEvent(new Event('change',{bubbles:true}));}};",
  "const tick=(id,on)=>{const e=document.getElementById(id); if(e&&e.checked!==on){e.checked=on;",
  "  e.dispatchEvent(new Event('change',{bubbles:true}));}};",
  "set('dateStart','2026-10-20'); set('dateEnd','2026-10-22');",
  "tick('legOutCar', true);",
  "await new Promise(r=>setTimeout(r,700));",
  "const dO=document.getElementById('distOutbound'), dR=document.getElementById('distReturn');",
  "if(dO) dO.value=" + KM + "; if(dR) dR.value=" + KM + ";",
  "if (typeof calculateTravelTotal==='function') calculateTravelTotal();",
  "await new Promise(r=>setTimeout(r,500));",
  "return { rateField: document.getElementById('fuelRate').value,",
  "         rateLabel: (document.getElementById('fuelRateLabel')||{}).textContent,",
  "         total: parseFloat(document.getElementById('totalAmount').dataset.value||'0') };"
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
      m.error ? j(new Error(m.error.message)) : r(m.result);
    }
    if (m.method === 'Page.javascriptDialogOpening') send('Page.handleJavaScriptDialog', { accept: true });
  });
  await send('Page.enable'); await send('Runtime.enable');
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });

  const EXPECT = CAT_RATE * KM * 2;   // ไป-กลับ 100 กม. × 2 × 5 บาท = 1,000

  // หน่วง 9 วินาที เพื่อให้ /settings มาถึง "หลัง" ตอนเลือกหมวดจริง ๆ
  // รอบแรกหน่วง 1.8 วิ ไม่พอ เพราะเลือกหมวดตอน ~4.5 วิ settings จึงเสร็จก่อน
  for (const [name, delay] of [['/settings ตอบเร็ว', 0], ['/settings ตอบช้ากว่าหมวด', 9000]]) {
    let stubId = (await send('Page.addScriptToEvaluateOnNewDocument', { source: stub(delay) })).identifier;
    await send('Page.navigate', { url: APP + '/expense.html' }); await sleep(4500);
    const r0 = await ev(fill);
    // รอให้ /settings ที่หน่วงไว้มาถึงและทำงานให้เสร็จก่อนค่อยอ่านค่า
    await sleep(delay ? 7000 : 300);
    const r = await ev([
      "if (typeof calculateTravelTotal==='function') calculateTravelTotal();",
      "await new Promise(x=>setTimeout(x,400));",
      "return { rateField: document.getElementById('fuelRate').value,",
      "         rateLabel: (document.getElementById('fuelRateLabel')||{}).textContent,",
      "         total: parseFloat(document.getElementById('totalAmount').dataset.value||'0') };"
    ].join('\n'));
    void r0;
    console.log('── ' + name + ' ──');
    console.log('   ช่องอัตรา=' + r.rateField + ' · ป้ายบนจอ=' + r.rateLabel + ' · ยอดรวม=' + r.total);
    ck(name + ' : อัตราที่ใช้คิดเงินต้องเป็นของหมวด (' + CAT_RATE + ')',
       String(r.rateField) === String(CAT_RATE), r.rateField);
    ck(name + ' : ป้ายบนจอต้องตรงกับอัตราที่ใช้คิด',
       String(r.rateLabel).trim() === String(CAT_RATE), r.rateLabel);
    ck(name + ' : ยอดค่าน้ำมัน = ' + EXPECT + ' บาท (' + KM + '×2×' + CAT_RATE + ')',
       r.total === EXPECT, r.total);
    await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: stubId });
  }
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
