// ถ่ายเฉพาะแถบหัว เพื่อดูตรา สรพ. คู่กับโลโก้แอปแบบใกล้ ๆ
//
//   cd public && python -m http.server 8099 --bind 127.0.0.1
//   node scripts/shot-header.mjs
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import fs from 'node:fs';

const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9595;
const PROFILE = 'C:/Users/teerapat/AppData/Local/Temp/pb-head';
const APP = process.env.APP_URL || 'http://127.0.0.1:8099';
const OUT = 'C:/Users/teerapat/AppData/Local/Temp/claude/d--Manny-promt-beark/c416bb2d-d063-4714-9500-1292c22c0e58/scratchpad';

const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=' + PORT,
  '--user-data-dir=' + PROFILE, '--no-first-run', '--disable-gpu',
  '--hide-scrollbars', '--force-device-scale-factor=3', 'about:blank'], { stdio: 'ignore' });

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

const stub = [
  "localStorage.setItem('token','x');",
  "const of = window.fetch;",
  "window.fetch = function (u,i) { const s=(typeof u==='string')?u:(u&&u.url)||'';",
  "  if (s.indexOf('/auth/me')>=0) return Promise.resolve(new Response(",
  "    JSON.stringify({id:1,email:'teerapat@ha.or.th',name:'ทดสอบ',role:'admin'}),",
  "    {status:200,headers:{'Content-Type':'application/json'}}));",
  "  if (s.indexOf('/budget-categories')>=0||s.indexOf('/profiles')>=0||s.indexOf('/expenses')>=0)",
  "    return Promise.resolve(new Response('[]',{status:200,headers:{'Content-Type':'application/json'}}));",
  "  return of(u,i); };"
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
  });
  await send('Page.enable'); await send('Runtime.enable');
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Page.addScriptToEvaluateOnNewDocument', { source: stub });
  await send('Emulation.setDeviceMetricsOverride',
    { width: 900, height: 300, deviceScaleFactor: 3, mobile: false });
  await send('Page.navigate', { url: APP + '/expense.html' });
  await sleep(4000);

  const info = await ev([
    "const bar = document.querySelector('div[style*=\"z-index: 9999\"], div[style*=\"z-index:9999\"]');",
    "const imgs = [...document.images].filter(i => /ha-logo|app-logo/.test(i.src));",
    "return { barFound: !!bar, barHeight: bar ? Math.round(bar.getBoundingClientRect().height) : 0,",
    "         logos: imgs.map(i => ({ src: i.src.split('/').pop(), ok: i.complete && i.naturalWidth > 0,",
    "            w: Math.round(i.getBoundingClientRect().width), h: Math.round(i.getBoundingClientRect().height) })) };"
  ].join('\n'));
  console.log('แถบหัวสูง ' + info.barHeight + 'px');
  info.logos.forEach(l => console.log('  ' + l.src + '  โหลด=' + (l.ok ? 'สำเร็จ' : 'ล้มเหลว') +
                                      '  ขนาดบนจอ ' + l.w + 'x' + l.h + 'px'));

  const shot = await send('Page.captureScreenshot', {
    format: 'png',
    clip: { x: 0, y: 0, width: 520, height: info.barHeight || 40, scale: 3 }
  });
  fs.writeFileSync(OUT + '/header-zoom.png', Buffer.from(shot.data, 'base64'));
  console.log('บันทึกภาพแถบหัวแล้ว');
} catch (e) {
  console.log('ล้มเหลว: ' + e.message);
} finally {
  try { ws && ws.close(); } catch { /* ปิดไปแล้ว */ }
  chrome.kill();
}
