// แถบขวาต้องบอกว่ายอดนี้คิดมาจากเกณฑ์ข้อไหนของ บัญชี ๘
//
// 16 ต.ค. 2569 — เจ้าของงานขอ หลังเปลี่ยนมาคิดพื้นที่แยกรายขา
// เพราะสองขาอาจได้คนละเรท คนอ่านแล้วจะสงสัยว่าทำไมระยะเท่ากันแต่เงินไม่เท่ากัน
// ป้ายนี้อ้างข้อของบัญชี ๘ ตรง ๆ เพื่อให้ผู้ตรวจเอกสารตามรอยได้
//   ข้อ ๑ Taxi เบิกตามจริง · ข้อ ๔ ค่าชดเชยเชื้อเพลิง ๕ บาท/กม. · ข้อ ๕ เหมาจ่าย
//
//   cd public && python3 -m http.server 8099 --bind 127.0.0.1
//   node scripts/test-case-note.mjs
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9599, PROFILE = 'C:/Users/teerapat/AppData/Local/Temp/pb-casenote';
const APP = process.env.APP_URL || 'http://127.0.0.1:8099';

const FLAT = {
  enabled: true, maxKm: 200, outsideMetro: 1200,
  bands: [
    { upTo: 10.99, amount: 150 }, { upTo: 20.99, amount: 250 },
    { upTo: 30.99, amount: 350 }, { upTo: 40.99, amount: 450 },
    { upTo: 50.99, amount: 550 }, { upTo: 60.99, amount: 650 },
    { upTo: null, amount: 750 }
  ]
};

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

const note = "(() => { const b=document.getElementById('caseNote');"
  + " return { hidden: b.className.indexOf('hidden')>=0,"
  + "          text: (b.textContent||'').replace(/\\s+/g,' ').trim() }; })()";

const PREP = [
  "const s=document.getElementById('categorySelect');",
  "s.value='TRAVEL002'; s.dispatchEvent(new Event('change',{bubbles:true}));",
  "await new Promise(r=>setTimeout(r,1000));",
  "const ds=document.getElementById('dateStart'), de=document.getElementById('dateEnd');",
  "ds.value='2026-10-16'; ds.dispatchEvent(new Event('change',{bubbles:true}));",
  "de.value='2026-10-17'; de.dispatchEvent(new Event('change',{bubbles:true}));",
  "await new Promise(r=>setTimeout(r,400));",
  "window.routeLeg = async () => ({ km: 28.6, meters: 28600, coords: [] });",
  "document.getElementById('requestedBy').value='ผู้ทดสอบ';"
].join('\n');

const tick = (n, on) => "{const c=document.getElementById('" + n + "');c.checked=" + on +
  ";c.dispatchEvent(new Event('change',{bubbles:true}));await new Promise(r=>setTimeout(r,400));}";

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
  await send('Page.navigate', { url: APP + '/expense.html' }); await sleep(4500);

  console.log('═══ 1. ยังไม่เลือกพาหนะ = ยังไม่มีเกณฑ์ให้บอก ═══');
  const a = await ev(PREP + "\nreturn " + note + ";");
  ok('ป้ายยังซ่อนอยู่ ไม่ขึ้นมารกเปล่า ๆ', a.hidden === true, a.text.slice(0, 60));

  console.log('');
  console.log('═══ 2. รถส่วนตัว คิดตามระยะจริง = บัญชี ๘ ข้อ ๔ ═══');
  const b = await ev([
    "geoFrom={lat:13.8591,lng:100.5217,precision:'exact',label:'นนทบุรี'};",
    "geoTo={lat:13.6591,lng:100.5330,precision:'exact',label:'พระประแดง'};",
    "document.getElementById('travelFrom').value='นนทบุรี';",
    "document.getElementById('travelTo').value='พระประแดง';",
    tick('legOutCar', true),
    "await recalcRoute(true); await new Promise(r=>setTimeout(r,900));",
    "return " + note + ";"
  ].join('\n'));
  ok('ป้ายโผล่ขึ้นมา', b.hidden === false);
  ok('อ้างข้อ ๔ ค่าชดเชยเชื้อเพลิง', /บัญชี ๘ ข้อ ๔/.test(b.text), b.text.slice(0, 120));
  ok('บอกสูตร กม. × อัตรา', /28\.6|57\.2/.test(b.text) && /× 5/.test(b.text), b.text.slice(0, 150));

  console.log('');
  console.log('═══ 3. เลือกเหมาจ่าย = บัญชี ๘ ข้อ ๕ บอกช่วงและพื้นที่รายขา ═══');
  const c = await ev([
    "const f=document.querySelector('input[name=\"fuelMethod\"][value=\"flat\"]');",
    "if(f){f.checked=true; f.dispatchEvent(new Event('change',{bubbles:true}));}",
    "await new Promise(r=>setTimeout(r,900));",
    "return " + note + ";"
  ].join('\n'));
  ok('อ้างข้อ ๕ เหมาจ่าย', /บัญชี ๘ ข้อ ๕/.test(c.text), c.text.slice(0, 120));
  ok('บอกว่าอยู่ในเขต กทม.ปริมณฑล', /ในเขต กทม\.ปริมณฑล/.test(c.text));
  ok('บอกช่วงระยะทางที่ใช้', /21\.00 - 30\.99/.test(c.text), c.text.slice(0, 180));
  ok('แยกบรรทัดขาไปกับขากลับ', /ขาไป/.test(c.text) && /ขากลับ/.test(c.text));
  ok('บอกยอดรายขา 350', /350 บาท/.test(c.text));

  console.log('');
  console.log('═══ 4. ขากลับออกนอกเขต = สองขาต้องขึ้นคนละเรท ═══');
  const d = await ev([
    "const sp=document.getElementById('tripModeSpecial');",
    "sp.checked=true; sp.dispatchEvent(new Event('change',{bubbles:true}));",
    "await new Promise(r=>setTimeout(r,600));",
    tick('legBackCar', true),
    // ขากลับไปเชียงใหม่ = นอกเขต
    "geoRetFrom={lat:13.6591,lng:100.5330,precision:'exact',label:'พระประแดง'};",
    "geoRet={lat:18.7883,lng:98.9853,precision:'exact',label:'เชียงใหม่'};",
    "document.getElementById('travelReturnFrom').value='พระประแดง';",
    "document.getElementById('travelReturnTo').value='เชียงใหม่';",
    "syncReturnDiff(); await new Promise(r=>setTimeout(r,400));",
    "window.routeLeg = async (a,b) => ({ km: (b&&b.label==='เชียงใหม่') ? 180 : 28.6,",
    "                                    meters: 1000, coords: [] });",
    "await recalcRoute(true); await new Promise(r=>setTimeout(r,1200));",
    "return Object.assign(" + note + ", { total: parseFloat(document.getElementById('totalAmount').dataset.value||0) });"
  ].join('\n'));
  /* ตัดข้อความที่คำว่า "ขากลับ" แล้วเช็กสองฝั่งแยกกัน
     เลี่ยง regex แบบ [^ก]* เพราะไปชนคำว่า "กม." ที่อยู่ในบรรทัดเดียวกัน
     (ตัววัดตัวแรกผิดแบบนี้ ทั้งที่ข้อความบนจอถูกอยู่แล้ว) */
  const cut = d.text.indexOf('ขากลับ');
  const outPart = cut > 0 ? d.text.slice(0, cut) : d.text;
  const retPart = cut > 0 ? d.text.slice(cut) : '';
  ok('ท่อนขาไปบอกว่าอยู่ในเขต และไม่มีคำว่านอกเขตปน',
     /ในเขต กทม\.ปริมณฑล/.test(outPart) && !/นอกเขต/.test(outPart),
     outPart.slice(-90));
  ok('ท่อนขากลับบอกว่าอยู่นอกเขต',
     /นอกเขต กทม\.ปริมณฑล/.test(retPart), retPart.slice(0, 110));
  ok('ขากลับได้เหมาจ่ายนอกเขต 1,200', /1,200 บาท/.test(d.text));
  ok('ยอดรวม 1,550 ไม่ใช่ 1,100', d.total === 1550, d.total + ' บาท');

  console.log('');
  console.log('═══ 5. Taxi เบิกตามจริง = บัญชี ๘ ข้อ ๑ ═══');
  const e2 = await ev([
    "const dist=document.querySelector('input[name=\"fuelMethod\"][value=\"distance\"]');",
    "if(dist){dist.checked=true; dist.dispatchEvent(new Event('change',{bubbles:true}));}",
    "await new Promise(r=>setTimeout(r,500));",
    tick('legOutTaxi', true),
    "await new Promise(r=>setTimeout(r,700));",
    "return " + note + ";"
  ].join('\n'));
  ok('อ้างข้อ ๑ Taxi เบิกตามจริง', /บัญชี ๘ ข้อ ๑/.test(e2.text), e2.text.slice(0, 200));
  ok('บอกวงเงินต่อเที่ยว', /ไม่เกิน 750 บาท\/เที่ยว/.test(e2.text), e2.text.slice(0, 220));

  ok('ไม่มี JavaScript error ตลอดการทดสอบ', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '));

  console.log('');
  console.log('══════════════════════════════════════════════════');
  console.log('  ผ่าน ' + results.filter(Boolean).length + ' / ' + results.length);
  console.log('══════════════════════════════════════════════════');
  process.exitCode = results.every(Boolean) ? 0 : 1;
} catch (e) { console.error('ล้มเหลว:', e.message); process.exitCode = 2; }
finally { try { ws.close(); } catch {} chrome.kill(); }
