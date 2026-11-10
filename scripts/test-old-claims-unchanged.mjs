/* ใบเก่าต้องได้เอกสารเหมือนเดิมทุกตัวอักษร
 *
 * 10 พ.ย. 2569 — เริ่มงานให้ใบเบิกใบเดียวเก็บขาเดินทางได้มากกว่า 2 ขา
 * ตัวสร้างเอกสารต้องเปลี่ยนมาอ่านขาผ่าน TravelLegs.legsOf() แทนการอ่าน
 * distOut/distRet ตรง ๆ  ความเสี่ยงคือใบเก่าทุกใบที่พิมพ์ส่งการเงินไปแล้ว
 * อาจเปลี่ยนหน้าตาหรือเปลี่ยนยอดโดยไม่มีใครรู้
 *
 * ใช้ใบจริง 13 ใบจาก scripts/fixtures-date-regression.json เป็นฐานเทียบ
 * (ครอบ REPORT / TRANSPORT_RECEIPT / GENERAL_RECEIPT ครบทุกแบบ)
 *
 * วิธีใช้ — ต้องเก็บฐานก่อนแก้โค้ดเสมอ
 *   cd public && python -m http.server 8099 --bind 127.0.0.1 &
 *   node scripts/test-old-claims-unchanged.mjs --save      <- รันบนโค้ดเดิม
 *   ...แก้โค้ด...
 *   node scripts/test-old-claims-unchanged.mjs --compare   <- ต้องไม่มีใบไหนเปลี่ยน
 */
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import fs from 'node:fs';
import crypto from 'node:crypto';

const MODE = process.argv.includes('--save') ? 'save'
           : process.argv.includes('--compare') ? 'compare' : null;
if (!MODE) { console.error('ต้องใส่ --save หรือ --compare'); process.exit(2); }

const BASE = 'scripts/old-claims-baseline.json';
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9561, PROFILE = 'C:/Users/teerapat/AppData/Local/Temp/pb-oldclaims';
const APP = process.env.APP_URL || 'http://127.0.0.1:8099';

const fixtures = JSON.parse(fs.readFileSync('scripts/fixtures-date-regression.json', 'utf8'));
const sha = s => crypto.createHash('sha256').update(String(s)).digest('hex').slice(0, 16);

const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=' + PORT,
  '--user-data-dir=' + PROFILE, '--no-first-run', '--disable-gpu',
  '--window-size=1400,1000', 'about:blank'], { stdio: 'ignore' });

let ws, id = 0; const pending = new Map(); const pageErrors = [];
const send = (m, p = {}) => { const i = ++id; ws.send(JSON.stringify({ id: i, method: m, params: p }));
  return new Promise((r, j) => pending.set(i, { r, j })); };
const ev = async e => {
  const r = await send('Runtime.evaluate', { expression: '(async()=>{' + e + '})()', awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result?.value;
};
const results = [];
const ok = (n, pass, d = '') => { results.push(pass);
  console.log((pass ? '  ผ่าน  ' : '  ตก    ') + n + (d ? '  -> ' + d : '')); };

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
  // ปิดแคช ไม่งั้นโปรไฟล์ที่ใช้ซ้ำจะเสิร์ฟไฟล์เก่าจากดิสก์ แล้วเทียบผิดรุ่นโดยไม่รู้ตัว
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Page.addScriptToEvaluateOnNewDocument', { source: [
    "localStorage.setItem('token','x');",
    "const of = window.fetch;",
    "window.fetch = function (u,i) { const s=(typeof u==='string')?u:(u&&u.url)||'';",
    "  if (s.indexOf('/auth/me')>=0) return Promise.resolve(new Response(",
    "    JSON.stringify({id:1,email:'t@ha.or.th',name:'ทดสอบ',role:'admin'}),",
    "    {status:200,headers:{'Content-Type':'application/json'}}));",
    "  if (s.indexOf('/expenses')>=0||s.indexOf('/profiles')>=0)",
    "    return Promise.resolve(new Response('[]',{status:200,headers:{'Content-Type':'application/json'}}));",
    "  return of(u,i); };"
  ].join('\n') });
  await send('Page.navigate', { url: APP + '/history.html' }); await sleep(5000);

  // แผนที่ต้องโหลดภาพจากเน็ต ผลจะไม่เหมือนเดิมทุกครั้ง ปิดไว้ให้การเทียบแน่นอน
  await ev("window.renderRouteMapImage = async () => null; return 1;");

  const now = {};
  for (const f of fixtures) {
    const rec = f.rec;
    const html = await ev(
      'const b = await buildDocumentHtml(' + JSON.stringify(rec) + ', function(){});'
      + ' return (b && b.html) || (typeof b === "string" ? b : "");');
    now[String(f.id)] = { hash: sha(html), len: String(html).length };
  }

  const n = Object.keys(now).length;
  if (n !== fixtures.length) throw new Error('สร้างเอกสารได้ไม่ครบ ' + n + '/' + fixtures.length);

  if (MODE === 'save') {
    fs.writeFileSync(BASE, JSON.stringify(now, null, 2));
    console.log('  เก็บฐานเทียบแล้ว ' + n + ' ใบ -> ' + BASE);
    for (const k of Object.keys(now)) console.log('    ใบ ' + k + '  ' + now[k].hash + '  ' + now[k].len + ' ตัวอักษร');
  } else {
    const old = JSON.parse(fs.readFileSync(BASE, 'utf8'));
    const missing = Object.keys(old).filter(k => !(k in now));
    const changed = Object.keys(old).filter(k => k in now && old[k].hash !== now[k].hash);
    ok('สร้างเอกสารได้ครบ ' + n + ' ใบ', missing.length === 0, missing.join(','));
    ok('ไม่มีใบเก่าใบไหนเปลี่ยนเลย', changed.length === 0,
       changed.map(k => 'ใบ ' + k + ' ' + old[k].hash + '->' + now[k].hash
                      + ' (' + old[k].len + '->' + now[k].len + ' ตัวอักษร)').join(' | '));
  }

  ok('ไม่มี error ในหน้าเว็บ', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '));
} catch (e) {
  console.error('  ตก    ' + e.message);
  results.push(false);
} finally {
  try { ws && ws.close(); } catch {}
  chrome.kill();
}

const fail = results.filter(r => !r).length;
console.log('\nผ่าน ' + results.filter(Boolean).length + '  ตก ' + fail);
process.exit(fail ? 1 : 0);
