// แถบแบบประเมินบนหน้าแรก — ต้องเป็นแนวนอน ขึ้นถูกคน และไม่ไปแตะการ์ดเดิม
//
// 15 ต.ค. 2569 เจ้าของงานขอให้การ์ดผู้ดูแลเป็นแถบแนวนอนใต้ตาราง
// ข้อที่ต้องไม่พลาดคือ การ์ดเดิมทั้งสี่ใบต้องเรียงเหมือนเดิม
// และถ้ายังไม่มีรอบเปิดรับ หน้าแรกต้องหน้าตาเท่าเดิมทุกประการ
//
//   cd public && python -m http.server 8099 --bind 127.0.0.1
//   node scripts/test-home-feedback-bar.mjs
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9565, PROFILE = 'C:/Users/teerapat/AppData/Local/Temp/pb-homebar';
const APP = process.env.APP_URL || 'http://127.0.0.1:8099';

const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=' + PORT,
  '--user-data-dir=' + PROFILE, '--no-first-run', '--disable-gpu',
  '--window-size=1280,1000', 'about:blank'], { stdio: 'ignore' });

let ws, id = 0; const pending = new Map(); const pageErrors = [];
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

const FORM = { id: 7, title: 'ความพึงพอใจพร้อมเบิก รอบที่ 1/2570', intro: '', questions: [] };

const stub = (role, hasForm) => [
  "localStorage.setItem('token','x');",
  "const of = window.fetch;",
  "window.fetch = function (u, i) {",
  "  const s = (typeof u === 'string') ? u : (u && u.url) || '';",
  "  const J = o => Promise.resolve(new Response(JSON.stringify(o), {status:200, headers:{'Content-Type':'application/json'}}));",
  "  if (s.indexOf('/auth/me') >= 0) return J({id:1,email:'t@ha.or.th',name:'ทดสอบ',role:'" + role + "'});",
  "  if (s.indexOf('/feedback/active') >= 0) return J(" + (hasForm ? "{ form: " + JSON.stringify(FORM) + " }" : "{ form: null }") + ");",
  "  if (s.indexOf('/stats') >= 0) return J({});",
  "  if (s.indexOf('/expenses') >= 0 || s.indexOf('/profiles') >= 0) return J([]);",
  "  return of(u, i);",
  "};"
].join('\n');

let scriptId = null;
async function open(role, hasForm) {
  if (scriptId) await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: scriptId });
  const r = await send('Page.addScriptToEvaluateOnNewDocument', { source: stub(role, hasForm) });
  scriptId = r.identifier;
  await send('Page.navigate', { url: APP + '/index.html' });
  await sleep(3000);
}

const box = sel => ev("const e = document.querySelector('" + sel + "');"
  + "if (!e) return null;"
  + "const s = getComputedStyle(e), r = e.getBoundingClientRect();"
  + "return { shown: s.display !== 'none', display: s.display, w: Math.round(r.width), h: Math.round(r.height) };");

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
    if (m.method === 'Runtime.exceptionThrown')
      pageErrors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
  });
  await send('Page.enable'); await send('Runtime.enable');
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });

  console.log('═══ 1. ผู้ดูแล และมีรอบเปิดรับอยู่ ═══');
  await open('admin', true);

  const admin = await box('#feedbackAdminMenu');
  ok('แถบผู้ดูแลขึ้น', admin && admin.shown, admin && admin.display);
  ok('เป็นแถบแนวนอน ไม่ใช่การ์ดแนวตั้ง',
     admin && admin.w > admin.h * 2, admin && (admin.w + '×' + admin.h + 'px'));
  ok('กว้างเต็มแถว ไม่ได้เป็นช่องหนึ่งในตาราง',
     admin && admin.w > 900, admin && admin.w + 'px');

  const promo = await box('#feedbackPromo');
  ok('แถบชวนให้คะแนนขึ้นด้วย', promo && promo.shown);
  ok('แถบชวนให้คะแนนก็เป็นแนวนอน', promo && promo.w > promo.h * 2, promo && (promo.w + '×' + promo.h + 'px'));

  ok('แถบทั้งสองอยู่นอกตารางการ์ด',
     await ev("return !document.querySelector('.menu-grid #feedbackAdminMenu')"
            + " && !document.querySelector('.menu-grid #feedbackPromo');"));
  ok('การ์ดเดิมในตารางยังครบ 4 ใบ',
     await ev("return document.querySelectorAll('.menu-grid .menu-card').length;") === 4);
  ok('แถบผู้ดูแลอยู่ใต้ตาราง ไม่ได้ไปแทรกข้างบน',
     await ev("const g = document.querySelector('.menu-grid').getBoundingClientRect();"
            + "const b = document.querySelector('#feedbackAdminMenu').getBoundingClientRect();"
            + "return b.top >= g.bottom - 1;"));
  ok('แถบทองอยู่ใต้แถบผู้ดูแลอีกที',
     await ev("const a = document.querySelector('#feedbackAdminMenu').getBoundingClientRect();"
            + "const p = document.querySelector('#feedbackPromo').getBoundingClientRect();"
            + "return p.top >= a.bottom - 1;"));
  ok('หัวเรื่องแถบทองใช้ชื่อชุดจริง',
     (await ev("return document.getElementById('feedbackTitle').textContent;")) === FORM.title);

  console.log('');
  console.log('═══ 2. ผู้ใช้ทั่วไป ═══');
  await open('user', true);

  ok('ไม่เห็นแถบผู้ดูแล', !(await box('#feedbackAdminMenu')).shown);
  ok('ยังเห็นแถบชวนให้คะแนน', (await box('#feedbackPromo')).shown);
  ok('การ์ดในตารางเหลือ 3 ใบ (ไม่มีการ์ดจัดการระบบ)',
     await ev("return [...document.querySelectorAll('.menu-grid .menu-card')]"
            + ".filter(c => getComputedStyle(c).display !== 'none').length;") === 3);

  console.log('');
  console.log('═══ 3. ยังไม่มีรอบเปิดรับ — หน้าแรกต้องเหมือนเดิม ═══');
  await open('user', false);

  ok('ไม่มีแถบชวนให้คะแนน', !(await box('#feedbackPromo')).shown);
  ok('ไม่มีแถบผู้ดูแล', !(await box('#feedbackAdminMenu')).shown);
  ok('การ์ดเดิมยังอยู่ครบ',
     await ev("return [...document.querySelectorAll('.menu-grid .menu-card')]"
            + ".filter(c => getComputedStyle(c).display !== 'none').length;") === 3);

  console.log('');
  console.log('═══ 4. เรียกแบบประเมินล้มเหลว ต้องไม่ทำหน้าแรกพัง ═══');
  if (scriptId) await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: scriptId });
  const r2 = await send('Page.addScriptToEvaluateOnNewDocument', { source: [
    "localStorage.setItem('token','x');",
    "const of = window.fetch;",
    "window.fetch = function (u, i) {",
    "  const s = (typeof u === 'string') ? u : (u && u.url) || '';",
    "  const J = o => Promise.resolve(new Response(JSON.stringify(o), {status:200, headers:{'Content-Type':'application/json'}}));",
    "  if (s.indexOf('/auth/me') >= 0) return J({id:1,email:'t@ha.or.th',name:'ทดสอบ',role:'user'});",
    "  if (s.indexOf('/feedback') >= 0) return Promise.reject(new Error('เน็ตล่ม'));",
    "  if (s.indexOf('/stats') >= 0) return J({});",
    "  if (s.indexOf('/expenses') >= 0 || s.indexOf('/profiles') >= 0) return J([]);",
    "  return of(u, i);",
    "};"
  ].join('\n') });
  scriptId = r2.identifier;
  await send('Page.navigate', { url: APP + '/index.html' });
  await sleep(3000);

  ok('ชื่อผู้ใช้ยังขึ้นปกติ',
     /ทดสอบ|t@ha/.test(await ev("return document.body.innerText;")));
  ok('การ์ดเดิมยังใช้งานได้ครบ',
     await ev("return [...document.querySelectorAll('.menu-grid .menu-card')]"
            + ".filter(c => getComputedStyle(c).display !== 'none').length;") === 3);
  ok('ไม่มีแถบโผล่มาค้าง', !(await box('#feedbackPromo')).shown);

  console.log('');
  const real = pageErrors.filter(e => !/favicon|ERR_|net::|เน็ตล่ม/.test(e));
  ok('ไม่มี JavaScript error ที่ไม่ได้ตั้งใจ', real.length === 0, real.slice(0, 2).join(' | '));

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
