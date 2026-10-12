// แถว Taxi ต้องดึงเส้นทางหลักมาเติมได้ แม้สร้างแถวไปก่อนแล้ว
//
// ที่มา: 12 ต.ค. 2569 ผู้ใช้ทักว่าช่อง จาก/ถึง ของ Taxi ไม่มีตัวช่วยค้นหาสถานที่
// ไล่โค้ดแล้วพบต้นตอจริงกว่านั้น — แถว Taxi คัดลอกเส้นทางหลัก "ตอนสร้างแถว" ครั้งเดียว
// (expense.html บรรทัดที่อ่าน travelFrom/travelTo มาเป็น fromVal/toVal)
// ถ้าติ๊ก Taxi ก่อนแล้วค่อยเลือกจุดหมาย ช่อง "ถึง" จะว่างค้างตลอดไป
// และข้อความนี้ถูกพิมพ์ลงใบรับรองค่าพาหนะที่ส่งการเงิน
//
// ช่อง Taxi ไม่ได้ใช้คำนวณอะไร (ค่าโดยสารกรอกเอง) จึงไม่ต้องมีพิกัด
// แค่ต้องเติมข้อความให้ถูกได้ง่าย ๆ
//
//   cd public && python -m http.server 8099 --bind 127.0.0.1
//   node scripts/test-taxi-route-copy.mjs
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9601;
const PROFILE = 'C:/Users/teerapat/AppData/Local/Temp/pb-taxi';
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

const HOME = '141/36 ซอยสุขสวัสดิ์ 55 ถนนสุขสวัสดิ์';
const DEST = 'โรงพยาบาลเปาโลพระประแดง';

const stub = [
  "localStorage.setItem('token','x');",
  "const of = window.fetch;",
  "window.fetch = function (u,i) { const s=(typeof u==='string')?u:(u&&u.url)||'';",
  "  if (s.indexOf('/auth/me')>=0) return Promise.resolve(new Response(",
  "    JSON.stringify({id:1,email:'t@ha.or.th',name:'ทดสอบ',role:'admin'}),",
  "    {status:200,headers:{'Content-Type':'application/json'}}));",
  "  if (s.indexOf('/budget-categories')>=0) return Promise.resolve(new Response(",
  "    JSON.stringify([{ id:'DEMO', name:'ค่าใช้จ่ายที่เป็นเงินสด', fuelRate: 4,",
  "      pdfTemplates:['REPORT','TRANSPORT_RECEIPT'],",
  "      attachmentRules:{LOCATION:{show:true,required:false}}, attachmentOrder:['LOCATION'] }]),",
  "    {status:200,headers:{'Content-Type':'application/json'}}));",
  "  if (s.indexOf('/profiles')>=0||s.indexOf('/expenses')>=0)",
  "    return Promise.resolve(new Response('[]',{status:200,headers:{'Content-Type':'application/json'}}));",
  "  return of(u,i); };",
  "window.routeLeg = async () => ({ km: 20, meters: 20000, coords: [] });"
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
  await send('Page.navigate', { url: APP + '/expense.html' });
  await sleep(4200);

  // จำลองลำดับที่ผู้ใช้ทำจริง: ตั้งต้นทาง -> ติ๊ก Taxi -> ค่อยเลือกปลายทางทีหลัง
  const before = await ev([
    "const s=document.getElementById('categorySelect'); s.value='DEMO';",
    "s.dispatchEvent(new Event('change',{bubbles:true}));",
    "await new Promise(r=>setTimeout(r,1200));",
    "const set=(id,v)=>{const e=document.getElementById(id); if(e){e.value=v;",
    "  e.dispatchEvent(new Event('input',{bubbles:true})); e.dispatchEvent(new Event('change',{bubbles:true}));}};",
    "set('dateStart','2026-10-20'); set('dateEnd','2026-10-22');",
    "set('travelFrom','" + HOME + "');",
    "const cb=[...document.querySelectorAll('input[type=checkbox]')]",
    "  .find(c=>/Taxi/i.test(c.closest('label')?.textContent||''));",
    "if(cb && !cb.checked){ cb.checked=true; cb.dispatchEvent(new Event('change',{bubbles:true})); }",
    "await new Promise(r=>setTimeout(r,900));",
    "set('travelTo','" + DEST + "');",      // เลือกปลายทาง "หลัง" สร้างแถว Taxi แล้ว
    "await new Promise(r=>setTimeout(r,600));",
    "const rows=[...document.querySelectorAll('.taxi-entry')];",
    "return { rows: rows.length,",
    "         from: rows[0]?rows[0].querySelector('.taxi-from').value:null,",
    "         to:   rows[0]?rows[0].querySelector('.taxi-to').value:null,",
    "         travelTo: document.getElementById('travelTo').value };"
  ].join('\n'));

  console.log('สถานะก่อนกดปุ่ม:');
  console.log('   แถว Taxi ' + before.rows + ' แถว · จาก="' + before.from + '" · ถึง="' + before.to + '"');
  console.log('   ปลายทางของเส้นทางหลัก = "' + before.travelTo + '"');
  console.log('');

  ck('มีแถว Taxi ให้ทดสอบ', before.rows > 0, before);
  ck('อาการที่ผู้ใช้เจอเกิดขึ้นจริง — ช่อง "ถึง" ว่างทั้งที่เส้นทางหลักมีปลายทางแล้v'
       .replace('แล้v', 'แล้ว'),
     (before.to || '') === '' && before.travelTo === DEST, before);

  // ── ปุ่มที่ต้องมี ──
  const btn = await ev([
    "const row=document.querySelector('.taxi-entry');",
    "const b=row?row.querySelector('.taxi-use-route'):null;",
    "return { exists: !!b, label: b?b.textContent.trim():null,",
    "         hasFn: typeof window.fillTaxiFromRoute === 'function' };"
  ].join('\n'));
  ck('แถว Taxi มีปุ่มดึงเส้นทางหลัก (.taxi-use-route)', btn.exists, btn);
  ck('มีฟังก์ชัน fillTaxiFromRoute', btn.hasFn, btn);

  if (btn.exists && btn.hasFn) {
    const after = await ev([
      "const row=document.querySelector('.taxi-entry');",
      "row.querySelector('.taxi-use-route').click();",
      "await new Promise(r=>setTimeout(r,250));",
      "return { from: row.querySelector('.taxi-from').value,",
      "         to:   row.querySelector('.taxi-to').value };"
    ].join('\n'));
    console.log('หลังกดปุ่ม: จาก="' + after.from + '" · ถึง="' + after.to + '"');
    ck('กดแล้ว "ถึง" กลายเป็นปลายทางของเส้นทางหลัก', after.to === DEST, after);
    ck('"จาก" เป็นต้นทางของเส้นทางหลัก', after.from === HOME, after);

    // ขากลับในเคสไป-กลับตามปกติ ต้องสลับทิศ
    const ret = await ev([
      "const rows=[...document.querySelectorAll('.taxi-entry')];",
      "const row=rows[rows.length-1];",
      "const sel=row.querySelector('.taxi-dir'); sel.value='ขากลับ';",
      "sel.dispatchEvent(new Event('change',{bubbles:true}));",
      "await new Promise(r=>setTimeout(r,250));",
      "row.querySelector('.taxi-use-route').click();",
      "await new Promise(r=>setTimeout(r,250));",
      "return { from: row.querySelector('.taxi-from').value,",
      "         to:   row.querySelector('.taxi-to').value };"
    ].join('\n'));
    console.log('ขากลับหลังกดปุ่ม: จาก="' + ret.from + '" · ถึง="' + ret.to + '"');
    ck('ขากลับ "จาก" เป็นจุดหมายขาไป', ret.from === DEST, ret);
    ck('ขากลับ "ถึง" เป็นจุดเริ่มต้น', ret.to === HOME, ret);
  }

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
