// แถว Taxi ขากลับต้องตามวันกลับ ไม่ใช่วันไป
//
// ที่มา: 12 ต.ค. 2569 ผู้ใช้เจอกล่องเตือน "วันที่ Taxi ไม่อยู่ในช่วงการเดินทาง"
// ไล่โค้ดเจอว่า syncTaxiDatesFromLegs() ยัดวันของ "ขาไป" ให้ทุกแถวใน taxiEntriesList
// โดยไม่ดูช่องทิศทางของแต่ละแถวเลย
//
//     apply('taxiEntriesList', 'ขาไป');        <- ยัดให้ทุกแถวในรายการนี้
//     apply('taxiEntriesListBack', 'ขากลับ');
//
// เคส "ไป-กลับตามปกติ" แถวขาไปกับขากลับอยู่รายการเดียวกัน แถวขากลับจึงได้วันไปเสมอ
// พอช่วงเดินทางเปลี่ยน วันในแถวขากลับค้าง แล้วไปโดนด่านตรวจตอนกดบันทึก
// วันที่นี้ถูกพิมพ์ลงใบรับรองค่าพาหนะที่ส่งการเงิน
//
//   cd public && python -m http.server 8099 --bind 127.0.0.1
//   node scripts/test-taxi-date-sync.mjs
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9611;
const PROFILE = 'C:/Users/teerapat/AppData/Local/Temp/pb-taxidate';
const APP = process.env.APP_URL || 'http://127.0.0.1:8099';

const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=' + PORT,
  '--user-data-dir=' + PROFILE, '--no-first-run', '--disable-gpu', 'about:blank'], { stdio: 'ignore' });

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

const GO = '2026-10-20', BACK = '2026-10-22';

const stub = [
  "localStorage.setItem('token','x');",
  "const of = window.fetch;",
  "window.fetch = function (u,i) { const s=(typeof u==='string')?u:(u&&u.url)||'';",
  "  if (s.indexOf('/auth/me')>=0) return Promise.resolve(new Response(",
  "    JSON.stringify({id:1,email:'t@ha.or.th',name:'ทดสอบ',role:'admin'}),",
  "    {status:200,headers:{'Content-Type':'application/json'}}));",
  "  if (s.indexOf('/budget-categories')>=0) return Promise.resolve(new Response(",
  "    JSON.stringify([{ id:'D', name:'เงินสด', fuelRate: 5,",
  "      pdfTemplates:['REPORT','TRANSPORT_RECEIPT'],",
  "      attachmentRules:{LOCATION:{show:true}}, attachmentOrder:['LOCATION'] }]),",
  "    {status:200,headers:{'Content-Type':'application/json'}}));",
  "  if (s.indexOf('/profiles')>=0||s.indexOf('/expenses')>=0)",
  "    return Promise.resolve(new Response('[]',{status:200,headers:{'Content-Type':'application/json'}}));",
  "  return of(u,i); };",
  "window.routeLeg = async () => ({ km: 20, meters: 20000, coords: [] });"
].join('\n');

const snap = [
  "const rows=[...document.querySelectorAll('.taxi-entry')];",
  "return { dateStart: document.getElementById('dateStart').value,",
  "         dateEnd: document.getElementById('dateEnd').value,",
  "         rows: rows.map(r=>({ dir: r.querySelector('.taxi-dir').value,",
  "            date: r.querySelector('.taxi-date').value,",
  "            touched: r.querySelector('.taxi-date').dataset.touched||'0' })) };"
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
  await send('Page.navigate', { url: APP + '/expense.html' }); await sleep(4200);

  await ev([
    "const s=document.getElementById('categorySelect'); s.value='D';",
    "s.dispatchEvent(new Event('change',{bubbles:true}));",
    "await new Promise(r=>setTimeout(r,1200));",
    "const set=(id,v)=>{const e=document.getElementById(id); if(e){e.value=v;",
    "  e.dispatchEvent(new Event('input',{bubbles:true})); e.dispatchEvent(new Event('change',{bubbles:true}));}};",
    "set('dateStart','" + GO + "'); set('dateEnd','" + BACK + "');",
    "const cb=document.getElementById('legOutTaxi');",
    "if(cb && !cb.checked){cb.checked=true; cb.dispatchEvent(new Event('change',{bubbles:true}));}",
    "await new Promise(r=>setTimeout(r,900)); return 1;"
  ].join('\n'));

  const a = await ev(snap);
  console.log('ตั้งช่วงเดินทาง ' + a.dateStart + ' ถึง ' + a.dateEnd);
  a.rows.forEach((r, i) => console.log('   แถว ' + (i + 1) + ' ' + r.dir + ' -> ' + r.date));
  console.log('');

  ck('มีแถว Taxi ทั้งขาไปและขากลับ',
     a.rows.length >= 2 && a.rows.some(r => r.dir === 'ขาไป') && a.rows.some(r => r.dir === 'ขากลับ'),
     a.rows);

  const out1 = a.rows.find(r => r.dir === 'ขาไป');
  const ret1 = a.rows.find(r => r.dir === 'ขากลับ');
  ck('แถวขาไปได้วันออกเดินทาง ' + GO, out1 && out1.date === GO, out1);
  ck('แถวขากลับได้วันกลับ ' + BACK + ' (ไม่ใช่วันไป)', ret1 && ret1.date === BACK, ret1);

  // ── เปลี่ยนช่วงเดินทางทีหลัง แถวที่ยังไม่เคยแก้เองต้องตามไปด้วย ──
  console.log('');
  console.log('── เลื่อนช่วงเดินทางไปอีกวัน แถวที่ยังไม่เคยแก้เองต้องตาม ──');
  const NEW_GO = '2026-10-21', NEW_BACK = '2026-10-24';
  const b = await ev([
    "const set=(id,v)=>{const e=document.getElementById(id); if(e){e.value=v;",
    "  e.dispatchEvent(new Event('change',{bubbles:true}));}};",
    "set('dateStart','" + NEW_GO + "'); set('dateEnd','" + NEW_BACK + "');",
    "await new Promise(r=>setTimeout(r,700)); " + snap
  ].join('\n'));
  b.rows.forEach((r, i) => console.log('   แถว ' + (i + 1) + ' ' + r.dir + ' -> ' + r.date));
  const out2 = b.rows.find(r => r.dir === 'ขาไป');
  const ret2 = b.rows.find(r => r.dir === 'ขากลับ');
  ck('ขาไปตามไปเป็น ' + NEW_GO, out2 && out2.date === NEW_GO, out2);
  ck('ขากลับตามไปเป็น ' + NEW_BACK, ret2 && ret2.date === NEW_BACK, ret2);

  // ── แถวที่ผู้ใช้แก้วันเองไว้ ห้ามเขียนทับ ──
  console.log('');
  console.log('── แถวที่ผู้ใช้ตั้งวันเองไว้ ต้องไม่ถูกเขียนทับ ──');
  const c = await ev([
    "const _rws=[...document.querySelectorAll('.taxi-entry')];",
    "const _row=_rws.find(x=>x.querySelector('.taxi-dir').value==='ขากลับ');",
    "const dt=_row.querySelector('.taxi-date');",
    "dt.value='2026-10-23'; dt.dispatchEvent(new Event('change',{bubbles:true}));",
    "await new Promise(x=>setTimeout(x,300));",
    "const set=(id,v)=>{const e=document.getElementById(id); if(e){e.value=v;",
    "  e.dispatchEvent(new Event('change',{bubbles:true}));}};",
    "set('dateEnd','2026-10-25');",
    "await new Promise(x=>setTimeout(x,700)); " + snap
  ].join('\n'));
  const ret3 = c.rows.find(r => r.dir === 'ขากลับ');
  console.log('   ขากลับหลังเปลี่ยนวันกลับเป็น 2026-10-25 -> ' + (ret3 && ret3.date));
  ck('วันที่ผู้ใช้ตั้งเองไว้ (2026-10-23) ไม่ถูกเขียนทับ',
     ret3 && ret3.date === '2026-10-23' && ret3.touched === '1', ret3);

  // ── เปิดใบเก่ามาแก้ แล้วเปลี่ยนช่วงเดินทาง ──
  console.log('');
  console.log('── เปิดใบเก่ามาแก้ (วันที่คืนจากฐานข้อมูล) ──');
  const EDIT = await ev([
    "// จำลองการคืนค่าแบบเดียวกับ prefillForm: ตั้งวันเดินทางตรง ๆ ไม่ยิง event",
    "document.getElementById('dateStart').value='2026-11-03';",
    "document.getElementById('dateEnd').value='2026-11-05';",
    "document.querySelectorAll('.taxi-entry').forEach(r=>r.remove());",
    "addTaxiEntry('ขาไป'); addTaxiEntry('ขากลับ');",
    "const rs=[...document.querySelectorAll('.taxi-entry')];",
    "const setRow=(r,d)=>{const c=r.querySelector('.taxi-date'); c.value=d;",
    "  const dir=r.querySelector('.taxi-dir').value;",
    "  const auto=legDateFor(dir==='ขากลับ'?'ขากลับ':'ขาไป');",
    "  delete c.dataset.touched;",
    "  if (d && d!==auto) c.dataset.touched='1';};",
    "setRow(rs[0],'2026-11-03');",   // ตรงกับวันของขา = ระบบเติมให้
    "setRow(rs[1],'2026-11-09');",   // ต่างจากวันของขา = ผู้ใช้ตั้งเอง
    "await new Promise(x=>setTimeout(x,200));",
    "const set=(id,v)=>{const e=document.getElementById(id); if(e){e.value=v;",
    "  e.dispatchEvent(new Event('change',{bubbles:true}));}};",
    "set('dateStart','2026-11-04'); set('dateEnd','2026-11-06');",
    "await new Promise(x=>setTimeout(x,700)); " + snap
  ].join('\n'));
  EDIT.rows.forEach((r,i)=>console.log('   แถว '+(i+1)+' '+r.dir+' -> '+r.date+' (touched='+r.touched+')'));
  const eOut = EDIT.rows.find(r=>r.dir==='ขาไป');
  const eRet = EDIT.rows.find(r=>r.dir==='ขากลับ');
  ck('แถวที่ระบบเติมให้ ตามช่วงใหม่ไปด้วย (2026-11-04)', eOut && eOut.date==='2026-11-04', eOut);
  ck('แถวที่ผู้ใช้ตั้งเอง ยังคงวันเดิม (2026-11-09)', eRet && eRet.date==='2026-11-09', eRet);

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
