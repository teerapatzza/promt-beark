// กดเช็กลิสต์แล้วต้องเลื่อนไปที่ส่วนนั้นจริง
//
// ที่มา: 12 ต.ค. 2569 ผู้ใช้แจ้งว่า "กดตามจุดแต่มันไม่ไปตามจุดจริง ๆ มันมั่ว"
// เดาไว้สองข้อ ต้องวัดให้เห็นก่อนแก้
//   1. 'ค่าใช้จ่าย' ชี้ไป #totalAmount ซึ่งอยู่ใน "แถบสรุปที่ตรึงไว้" — เลื่อนไปหาไม่มีความหมาย
//   2. 'เอกสารแนบ' ชี้ไป #evidenceBox ซึ่งถูกซ่อนอยู่ — scrollIntoView ไม่ทำอะไรเลย
//
//   cd public && python -m http.server 8099 --bind 127.0.0.1
//   node scripts/test-checklist-jump.mjs
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9599;
const PROFILE = 'C:/Users/teerapat/AppData/Local/Temp/pb-jump';
const APP = process.env.APP_URL || 'http://127.0.0.1:8099';

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

let pass = 0, fail = 0;
const ck = (n, c, d) => {
  if (c) { pass++; console.log('ผ่าน  ' + n); }
  else { fail++; console.log('ตก    ' + n + (d !== undefined ? '  <-- ' + JSON.stringify(d) : '')); }
};

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
  "      attachmentRules:{LOCATION:{show:true,required:true},RECEIPT:{show:true,required:false}},",
  "      attachmentOrder:['LOCATION','RECEIPT'] }]),",
  "    {status:200,headers:{'Content-Type':'application/json'}}));",
  "  if (s.indexOf('/profiles')>=0||s.indexOf('/expenses')>=0)",
  "    return Promise.resolve(new Response('[]',{status:200,headers:{'Content-Type':'application/json'}}));",
  "  return of(u,i); };",
  "window.routeLeg = async () => ({ km: 100, meters: 100000, coords: [] });"
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
  await send('Page.addScriptToEvaluateOnNewDocument', { source: stub });
  await send('Emulation.setDeviceMetricsOverride',
    { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: APP + '/expense.html' });
  await sleep(4200);

  // เลือกหมวดเพื่อให้ส่วนต่าง ๆ ขึ้นมาครบ แล้วกรอกพอให้มียอด
  await ev([
    "const s=document.getElementById('categorySelect'); s.value='DEMO';",
    "s.dispatchEvent(new Event('change',{bubbles:true}));",
    "await new Promise(r=>setTimeout(r,1200));",
    "const set=(id,v)=>{const e=document.getElementById(id); if(e){e.value=v;",
    "  e.dispatchEvent(new Event('input',{bubbles:true})); e.dispatchEvent(new Event('change',{bubbles:true}));}};",
    "set('requestedBy','นายทดสอบ ระบบ'); set('dateStart','2026-10-20'); set('dateEnd','2026-10-22');",
    "set('tollCost','120'); set('parkingCost','200');",
    "await new Promise(r=>setTimeout(r,900)); return 1;"
  ].join('\n'));

  const items = await ev([
    "return [...document.querySelectorAll('#pbChecklist button')].map((b,i) => ({",
    "  i, title: b.textContent.replace(/\\s+/g,' ').trim().slice(0,28),",
    "  target: (b.getAttribute('onclick')||'').replace(/.*'(.*)'.*/,'$1') }));"
  ].join('\n'));
  console.log('รายการในเช็กลิสต์:');
  items.forEach(it => console.log('   ' + it.i + '. ' + it.title + '   -> #' + it.target));
  console.log('');

  for (const it of items) {
    const r = await ev([
      "window.scrollTo(0,0); await new Promise(r=>setTimeout(r,250));",
      "const btns=[...document.querySelectorAll('#pbChecklist button')];",
      "btns[" + it.i + "].click();",
      "await new Promise(r=>setTimeout(r,900));",
      "const ids='" + it.target + "'.split(',').map(s=>s.trim());",
      "let t=null; for(const id of ids){const c=document.getElementById(id);",
      "  if(c && (c.offsetWidth||c.offsetHeight||c.getClientRects().length) && !c.closest('#pbSummary')){t=c;break;}}",
      "const r=t?t.getBoundingClientRect():null;",
      "const inSidebar = t ? !!t.closest('#pbSummary') : false;",
      "const visible = t ? !!(t.offsetWidth||t.offsetHeight||t.getClientRects().length) : false;",
      "return { scrollY: Math.round(window.scrollY), exists: !!t, visible, inSidebar,",
      "         picked: t?t.id:null, topInView: r?Math.round(r.top):null,",
      "         onScreen: r ? (r.top >= 0 && r.top <= window.innerHeight) : false };"
    ].join('\n'));
    const label = it.title + ' (#' + it.target + ')';
    console.log('── ' + label);
    console.log('   ไปที่ #' + r.picked + ' · เลื่อนไป ' + r.scrollY + 'px · สูงจากขอบบน ' +
                r.topInView + 'px · มองเห็น=' + r.visible + ' · อยู่ในแถบสรุป=' + r.inSidebar);
    ck(label + ' เป้าหมายมีอยู่จริง', r.exists, r);
    ck(label + ' เป้าหมายมองเห็นได้ (ไม่ถูกซ่อน)', r.visible, r);
    ck(label + ' เป้าหมายไม่ได้อยู่ในแถบสรุปที่ตรึงไว้', !r.inSidebar, r);
    ck(label + ' หลังกดแล้วเป้าหมายอยู่ในจอ', r.onScreen, r);
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
