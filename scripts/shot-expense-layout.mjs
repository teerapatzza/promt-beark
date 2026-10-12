// ถ่ายภาพหน้ากรอกเบิกที่ความกว้างต่าง ๆ เพื่อดูแถบสรุปยอดด้านขวา
//
//   cd public && python -m http.server 8099 --bind 127.0.0.1
//   node scripts/shot-expense-layout.mjs
//
// ใช้ตัวจำลอง API ชุดเดียวกับ test-attachments.mjs จึงไม่ต้องมี backend
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import fs from 'node:fs';

const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9591;
const PROFILE = 'C:/Users/teerapat/AppData/Local/Temp/pb-shot';
const APP = process.env.APP_URL || 'http://127.0.0.1:8099';
const OUT = process.env.OUT_DIR ||
  'C:/Users/teerapat/AppData/Local/Temp/claude/d--Manny-promt-beark/c416bb2d-d063-4714-9500-1292c22c0e58/scratchpad';

const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=' + PORT,
  '--user-data-dir=' + PROFILE, '--no-first-run', '--disable-gpu',
  '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });

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

const RULES = {
  LOCATION:    { show: true, required: true },
  RECEIPT:     { show: true, required: false },
  TAX_INVOICE: { show: true, required: false },
  PHOTO:       { show: true, required: false }
};

const stub = [
  "localStorage.setItem('token','x');",
  "const of = window.fetch;",
  "window.fetch = function (u,i) { const s=(typeof u==='string')?u:(u&&u.url)||'';",
  "  if (s.indexOf('/auth/me')>=0) return Promise.resolve(new Response(",
  "    JSON.stringify({id:1,email:'t@ha.or.th',name:'ธีรภัทร ใจดี',role:'admin'}),",
  "    {status:200,headers:{'Content-Type':'application/json'}}));",
  "  if (s.indexOf('/budget-categories')>=0) return Promise.resolve(new Response(",
  "    JSON.stringify([{ id:'DEMO', name:'ค่าใช้จ่ายที่เป็นเงินสด', fuelRate: 4,",
  "      pdfTemplates:['REPORT','TRANSPORT_RECEIPT'],",
  "      attachmentRules:" + JSON.stringify(RULES) + ",",
  "      attachmentOrder:['LOCATION','RECEIPT','TAX_INVOICE','PHOTO'] }]),",
  "    {status:200,headers:{'Content-Type':'application/json'}}));",
  "  if (s.indexOf('/profiles')>=0) return Promise.resolve(new Response(",
  "    JSON.stringify([{id:1,profileName:'ธีรภัทร (ไอที)',fullName:'นายธีรภัทร ใจดี',",
  "      position:'นักวิเคราะห์ธุรกิจ',affiliation:'ฝ่ายเทคโนโลยีสารสนเทศ'}]),",
  "    {status:200,headers:{'Content-Type':'application/json'}}));",
  "  if (s.indexOf('/expenses')>=0)",
  "    return Promise.resolve(new Response('[]',{status:200,headers:{'Content-Type':'application/json'}}));",
  "  return of(u,i); };",
  "window.routeLeg = async () => ({ km: 100, meters: 100000, coords: [] });"
].join('\n');

const FILL = [
  "const s = document.getElementById('categorySelect');",
  "s.value='DEMO'; s.dispatchEvent(new Event('change',{bubbles:true}));",
  "await new Promise(r=>setTimeout(r,1000));",
  "const set=(id,v)=>{const e=document.getElementById(id); if(e){e.value=v;",
  "  e.dispatchEvent(new Event('input',{bubbles:true})); e.dispatchEvent(new Event('change',{bubbles:true}));}};",
  "openProfileDropdown(); await new Promise(r=>setTimeout(r,300));",
  "const rows=[...document.querySelectorAll('#profileDropdown > div')];",
  "const t=rows.find(d=>d.textContent.includes('ธีรภัทร (ไอที)')); if(t) t.click();",
  "await new Promise(r=>setTimeout(r,600));",
  "set('activityName','ประชุมเชิงปฏิบัติการ HA Data Hub ภาคเหนือ'); set('docDate','2026-10-12');",
  "set('dateStart','2026-10-20'); set('dateEnd','2026-10-22');",
  "set('targetProv','เชียงใหม่');",
  "set('tollCost','120'); set('parkingCost','200');",
  "await new Promise(r=>setTimeout(r,700));",
  "return document.getElementById('totalAmount')?.textContent.trim();"
].join('\n');

const probe = [
  "const el = document.getElementById('pbSummary');",
  "const cs = getComputedStyle(el);",
  "const r = el.getBoundingClientRect();",
  "return { position: cs.position, top: cs.top, gridColumn: cs.gridColumn,",
  "         left: Math.round(r.left), width: Math.round(r.width),",
  "         viewport: window.innerWidth,",
  "         idCount: document.querySelectorAll('[id]').length };"
].join('\n');

try {
  let u;
  for (let i = 0; i < 80; i++) {
    try {
      const l = await (await fetch('http://127.0.0.1:' + PORT + '/json/list')).json();
      const p = l.find(t => t.type === 'page');
      if (p) { u = p.webSocketDebuggerUrl; break; }
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
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Network.enable');
  await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Page.addScriptToEvaluateOnNewDocument', { source: stub });

  for (const [name, w, h] of [['wide', 1440, 1500], ['narrow', 900, 1400]]) {
    await send('Emulation.setDeviceMetricsOverride',
      { width: w, height: h, deviceScaleFactor: 1, mobile: false });
    await send('Page.navigate', { url: APP + '/expense.html' });
    await sleep(4500);
    const total = await ev(FILL);
    const info = await ev(probe);
    console.log('[' + name + ' ' + w + 'px] ยอดรวม=' + total);
    console.log('   กล่องสรุป: position=' + info.position + ' top=' + info.top +
                ' ซ้ายที่ ' + info.left + 'px กว้าง ' + info.width + 'px' +
                ' · id ในหน้า ' + info.idCount + ' ตัว');

    const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    fs.writeFileSync(OUT + '/expense-' + name + '.png', Buffer.from(shot.data, 'base64'));

    // เลื่อนลงไปกลางหน้า เพื่อดูว่ากล่องสรุปยังติดอยู่จริงไหม
    await ev("window.scrollTo(0, 1400); await new Promise(r=>setTimeout(r,500)); return 1;");
    const after = await ev("const r=document.getElementById('pbSummary').getBoundingClientRect(); return Math.round(r.top);");
    console.log('   หลังเลื่อนลง 1400px กล่องสรุปอยู่สูงจากขอบบนจอ ' + after + 'px');
    const shot2 = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    fs.writeFileSync(OUT + '/expense-' + name + '-scrolled.png', Buffer.from(shot2.data, 'base64'));
  }
  console.log('บันทึกภาพแล้วที่ ' + OUT);
} catch (e) {
  console.log('ล้มเหลว: ' + e.message);
} finally {
  try { ws && ws.close(); } catch { /* ปิดไปแล้ว */ }
  chrome.kill();
}
