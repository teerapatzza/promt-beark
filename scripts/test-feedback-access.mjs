// สิทธิ์การเข้าหน้าแบบประเมิน — คนที่ไม่ใช่ผู้ดูแลต้องเข้าหน้าสร้างฟอร์มไม่ได้
//
// 15 ต.ค. 2569 — เจ้าของงานถามเรื่องสิทธิ์การเห็น ไล่ดูแล้วเจอว่า
// สามหน้าใหม่ไม่ได้เรียก initAuthGuard() เลย ต่างจากหน้าอื่นทุกหน้าในระบบ
// หลังบ้านยังกั้นอยู่ (ทุกเส้นทางผู้ดูแลเป็น requireAdmin) จึงทำอะไรไม่ได้จริง
// แต่คนที่ไม่ใช่ผู้ดูแลยังเปิดหน้าขึ้นมาเห็นหน้าตาได้ และคนที่ยังไม่ล็อกอิน
// ก็ไม่ถูกส่งไปหน้าเข้าสู่ระบบ ซึ่งต่างจากพฤติกรรมของหน้าอื่นในระบบเดียวกัน
//
//   cd public && python -m http.server 8099 --bind 127.0.0.1
//   node scripts/test-feedback-access.mjs
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9569, PROFILE = 'C:/Users/teerapat/AppData/Local/Temp/pb-access';
const APP = process.env.APP_URL || 'http://127.0.0.1:8099';

const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=' + PORT,
  '--user-data-dir=' + PROFILE, '--no-first-run', '--disable-gpu',
  '--window-size=1280,900', 'about:blank'], { stdio: 'ignore' });

let ws, id = 0; const pending = new Map();
const send = (m, p = {}) => { const i = ++id; ws.send(JSON.stringify({ id: i, method: m, params: p }));
  return new Promise((r, j) => pending.set(i, { r, j })); };
const ev = async e => {
  const r = await send('Runtime.evaluate', { expression: '(async()=>{' + e + '})()', awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result?.value;
};
const results = [];
const ok = (name, pass, detail = '') => { results.push(pass);
  console.log((pass ? '  ผ่าน  ' : '  ตก    ') + name + (detail ? '  -> ' + detail : '')); };

const stub = (role) => [
  role ? "localStorage.setItem('token','x');" : "localStorage.removeItem('token');",
  "const of = window.fetch;",
  "window.fetch = function (u, i) {",
  "  const s = (typeof u === 'string') ? u : (u && u.url) || '';",
  "  const J = (o, st) => Promise.resolve(new Response(JSON.stringify(o), {status: st || 200, headers:{'Content-Type':'application/json'}}));",
  role
    ? "  if (s.indexOf('/auth/me') >= 0) return J({id:1,email:'t@ha.or.th',name:'ทดสอบ',role:'" + role + "'});"
    : "  if (s.indexOf('/auth/me') >= 0) return J({error:'Unauthorized'}, 401);",
  "  if (s.indexOf('/feedback/forms') >= 0) return J({error:'Forbidden'}, 403);",
  "  if (s.indexOf('/feedback') >= 0) return J({ form: null });",
  "  if (s.indexOf('/expenses') >= 0 || s.indexOf('/profiles') >= 0 || s.indexOf('/stats') >= 0) return J([]);",
  "  return of(u, i);",
  "};"
].join('\n');

let scriptId = null;
async function open(role, page) {
  if (scriptId) await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: scriptId });
  const r = await send('Page.addScriptToEvaluateOnNewDocument', { source: stub(role) });
  scriptId = r.identifier;
  await send('Page.navigate', { url: APP + '/' + page });
  await sleep(3200);
  return ev("return location.pathname.split('/').pop();");
}

try {
  let u;
  for (let i = 0; i < 80; i++) {
    try { const l = await (await fetch('http://127.0.0.1:' + PORT + '/json/list')).json();
      const p = l.find(t => t.type === 'page'); if (p) { u = p.webSocketDebuggerUrl; break; } } catch {}
    await sleep(250);
  }
  ws = new WebSocket(u); await new Promise(r => ws.addEventListener('open', r));
  ws.addEventListener('message', e => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { const { r, j } = pending.get(m.id); pending.delete(m.id);
      m.error ? j(new Error(m.error.message)) : r(m.result); return; }
  });
  await send('Page.enable'); await send('Runtime.enable');
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });

  console.log('═══ 1. หน้าสร้างฟอร์ม — ผู้ดูแลเท่านั้น ═══');

  ok('ผู้ใช้ทั่วไปพิมพ์ url เข้าตรง ๆ ต้องถูกส่งกลับหน้าแรก',
     (await open('user', 'feedback-admin.html')) === 'index.html',
     await ev("return location.pathname.split('/').pop();"));

  ok('ผู้ดูแลเข้าได้ตามปกติ',
     (await open('admin', 'feedback-admin.html')) === 'feedback-admin.html');

  ok('ยังไม่ล็อกอิน ถูกส่งไปหน้าเข้าสู่ระบบ',
     (await open(null, 'feedback-admin.html')) === 'login.html',
     await ev("return location.pathname.split('/').pop();"));

  console.log('');
  console.log('═══ 2. หน้าให้คะแนน — ผู้ใช้ที่ล็อกอินแล้วทุกคน ═══');

  ok('ผู้ใช้ทั่วไปเข้าได้',
     (await open('user', 'feedback.html')) === 'feedback.html');

  ok('ยังไม่ล็อกอิน ถูกส่งไปหน้าเข้าสู่ระบบ',
     (await open(null, 'feedback.html')) === 'login.html',
     await ev("return location.pathname.split('/').pop();"));

  console.log('');
  console.log('═══ 3. หน้าขอบคุณ — ต้องล็อกอินเช่นกัน ═══');

  ok('ผู้ใช้ทั่วไปเข้าได้',
     (await open('user', 'feedback-done.html')) === 'feedback-done.html');

  ok('ยังไม่ล็อกอิน ถูกส่งไปหน้าเข้าสู่ระบบ',
     (await open(null, 'feedback-done.html')) === 'login.html',
     await ev("return location.pathname.split('/').pop();"));

  console.log('');
  console.log('═══ 4. แถบด้านบนของระบบต้องขึ้นเหมือนหน้าอื่น ═══');

  await open('admin', 'feedback.html');
  ok('หน้าให้คะแนนมีแถบด้านบนของระบบ',
     await ev("return !!document.querySelector('#authGuardBar, .auth-guard-bar, [data-auth-guard]')"
            + " || /ออกจากระบบ|t@ha/.test(document.body.innerText);"));

  console.log('');
  const pass = results.filter(Boolean).length;
  console.log('สรุป ' + pass + '/' + results.length + (pass === results.length ? '  ผ่านทั้งหมด' : '  ยังไม่ผ่าน'));
  process.exitCode = pass === results.length ? 0 : 1;
} catch (e) {
  console.error('ทดสอบล้มเหลว:', e.message);
  process.exitCode = 1;
} finally {
  try { ws && ws.close(); } catch {}
  chrome.kill();
}
