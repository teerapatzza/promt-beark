// หน้าสร้างแบบประเมิน — สิ่งที่พิมพ์ไว้ต้องไม่หาย และต้องเปิด/ปิดรับได้ด้วยสวิตช์
//
// 15 ต.ค. 2569 เจ้าของงานแจ้งว่า "เคยใส่วันไปแล้วแต่วันหาย"
// ไล่ดูแล้วหายทั้งสี่ช่อง ไม่ใช่แค่วันที่ เพราะ drawBuild() วาดช่องกรอกใหม่
// จากตัวแปร EDIT ซึ่งอัปเดตจากช่องกรอกเฉพาะตอนกดบันทึกเท่านั้น
// กดเพิ่มคำถามเมื่อไหร่ สิ่งที่พิมพ์ค้างไว้จึงถูกทับหายหมด
//
//   cd public && python -m http.server 8099 --bind 127.0.0.1
//   node scripts/test-feedback-builder.mjs
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9568, PROFILE = 'C:/Users/teerapat/AppData/Local/Temp/pb-builder';
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

// ชุดที่มีอยู่แล้วในระบบ ใช้ทดสอบการแก้ไขและสวิตช์
const EXISTING = {
  id: 3, title: 'ความพึงพอใจครั้งที่ 1', intro: 'ประเมินความพึงพอใจหลังใช้งาน',
  status: 'open', opensAt: '2026-11-01', closesAt: '2026-11-30',
  questions: [{ id: 'q1', kind: 'face', title: 'พอใจแค่ไหน', required: true }], responses: 0
};

const STUB = [
  "localStorage.setItem('token','x');",
  "window.__calls = [];",
  "const of = window.fetch;",
  "window.fetch = function (u, i) {",
  "  const s = (typeof u === 'string') ? u : (u && u.url) || '';",
  "  const J = o => Promise.resolve(new Response(JSON.stringify(o), {status:200, headers:{'Content-Type':'application/json'}}));",
  "  if (s.indexOf('/auth/me') >= 0) return J({id:1,email:'t@ha.or.th',role:'admin'});",
  "  if (s.indexOf('/feedback/forms') >= 0 && i && (i.method === 'POST' || i.method === 'PUT')) {",
  "    window.__calls.push({ method: i.method, url: s, body: JSON.parse(i.body) });",
  "    return J({ ok: true, id: 3 });",
  "  }",
  "  if (/\\/feedback\\/forms$/.test(s)) return J([" + JSON.stringify(EXISTING) + "]);",
  "  if (s.indexOf('/summary') >= 0) return J({ form:{id:3,title:'x',status:'open'}, responses:0, people:0, staff:1, rate:0, questions:[] });",
  "  if (s.indexOf('/feedback') >= 0) return J({ form: null });",
  "  return of(u, i);",
  "};"
].join('\n');

const fields = () => ev([
  "return { t: document.getElementById('bTitle').value,",
  "         i: document.getElementById('bIntro').value,",
  "         o: document.getElementById('bOpen').value,",
  "         c: document.getElementById('bClose').value };"
].join('\n'));

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
    if (m.method === 'Page.javascriptDialogOpening') send('Page.handleJavaScriptDialog', { accept: true });
  });
  await send('Page.enable'); await send('Runtime.enable');
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Page.addScriptToEvaluateOnNewDocument', { source: STUB });
  await send('Page.navigate', { url: APP + '/feedback-admin.html' });
  await sleep(2800);

  console.log('═══ 1. สิ่งที่พิมพ์ไว้ต้องไม่หายตอนเพิ่มหรือลบคำถาม ═══');

  await ev("newForm(); return 1;");
  await sleep(400);
  await ev([
    "const set = (id, v) => { const e = document.getElementById(id); e.value = v;",
    "  e.dispatchEvent(new Event('input', { bubbles: true })); };",
    "set('bTitle', 'ความพึงพอใจครั้งที่ 1');",
    "set('bIntro', 'ประเมินความพึงพอใจหลังใช้งาน');",
    "set('bOpen',  '2026-11-01');",
    "set('bClose', '2026-11-30');",
    "return 1;"
  ].join('\n'));
  await sleep(200);

  await ev("addQ('face'); return 1;");
  await sleep(400);
  let f = await fields();
  ok('เพิ่มคำถามแล้ว ชื่อยังอยู่', f.t === 'ความพึงพอใจครั้งที่ 1', f.t || '(ว่าง)');
  ok('เพิ่มคำถามแล้ว คำชี้แจงยังอยู่', f.i === 'ประเมินความพึงพอใจหลังใช้งาน', f.i || '(ว่าง)');
  ok('เพิ่มคำถามแล้ว วันเปิดรับยังอยู่', f.o === '2026-11-01', f.o || '(ว่าง)');
  ok('เพิ่มคำถามแล้ว วันปิดรับยังอยู่', f.c === '2026-11-30', f.c || '(ว่าง)');

  await ev("addQ('text'); addQ('yesno'); return 1;");
  await sleep(400);
  await ev("moveQ(0, 1); return 1;");
  await sleep(300);
  await ev("delQ(2); return 1;");
  await sleep(300);
  f = await fields();
  ok('เลื่อนและลบคำถามแล้ว ทั้งสี่ช่องยังครบ',
     f.t && f.i && f.o === '2026-11-01' && f.c === '2026-11-30',
     JSON.stringify(f));

  console.log('');
  console.log('═══ 2. กดบันทึกแล้วส่งวันที่ไปจริง ═══');

  await ev("window.__calls = []; saveForm(); return 1;");
  await sleep(600);
  const posted = await ev("return window.__calls[0] || null;");
  ok('ส่งคำขอบันทึกออกไป', !!posted);
  ok('ส่งวันเปิดรับไปด้วย', posted && posted.body.opensAt === '2026-11-01', posted && posted.body.opensAt);
  ok('ส่งวันปิดรับไปด้วย', posted && posted.body.closesAt === '2026-11-30', posted && posted.body.closesAt);
  ok('ส่งชื่อไปด้วย', posted && posted.body.title === 'ความพึงพอใจครั้งที่ 1');

  console.log('');
  console.log('═══ 3. เปิดชุดเดิมมาแก้ ต้องเห็นวันที่เดิม ═══');

  await ev("editForm(3); return 1;");
  await sleep(500);
  f = await fields();
  ok('เห็นชื่อเดิม', f.t === EXISTING.title, f.t);
  ok('เห็นวันเปิดรับเดิม', f.o === EXISTING.opensAt, f.o || '(ว่าง)');
  ok('เห็นวันปิดรับเดิม', f.c === EXISTING.closesAt, f.c || '(ว่าง)');

  console.log('');
  console.log('═══ 4. สวิตช์เปิด/ปิดรับคำตอบ ═══');

  const sw = await ev("const e = document.getElementById('bActive'); return e ? { found: true, on: e.checked } : { found: false };");
  ok('มีสวิตช์ในหน้าสร้าง/แก้ไข', sw.found);
  ok('ชุดที่เปิดรับอยู่ สวิตช์ต้องติด', sw.found && sw.on === true, String(sw.on));

  await ev("const e = document.getElementById('bActive'); e.checked = false; e.dispatchEvent(new Event('change',{bubbles:true})); return 1;");
  await sleep(300);
  ok('ปิดสวิตช์แล้วข้อความบอกสถานะเปลี่ยน',
     /ปิดรับ|ชั่วคราว|ไม่เปิดรับ/.test(await ev("return document.getElementById('bActiveNote').textContent;")),
     await ev("return document.getElementById('bActiveNote').textContent;"));

  await ev("window.__calls = []; saveForm(); return 1;");
  await sleep(600);
  const put = await ev("return window.__calls[0] || null;");
  ok('ปิดสวิตช์แล้วบันทึก ส่งสถานะปิดรับไป',
     put && put.body.status === 'closed', put && put.body.status);
  ok('ปิดสวิตช์ไม่ได้ทำวันที่หาย',
     put && put.body.opensAt === EXISTING.opensAt, put && put.body.opensAt);

  await ev("editForm(3); return 1;");
  await sleep(500);
  await ev("const e = document.getElementById('bActive'); e.checked = true; e.dispatchEvent(new Event('change',{bubbles:true})); return 1;");
  await sleep(300);
  await ev("window.__calls = []; saveForm(); return 1;");
  await sleep(600);
  const put2 = await ev("return window.__calls[0] || null;");
  ok('เปิดสวิตช์แล้วบันทึก ส่งสถานะเปิดรับไป',
     put2 && put2.body.status === 'open', put2 && put2.body.status);

  console.log('');
  console.log('═══ 5. สวิตช์ในหน้ารายการ กดแล้วมีผลทันที ═══');

  await ev("go('list'); return 1;");
  await sleep(500);
  const rowSw = await ev("const e = document.querySelector('.sw-row input'); return e ? { found: true, on: e.checked } : { found: false };");
  ok('แต่ละชุดในรายการมีสวิตช์', rowSw.found);
  ok('ชุดที่เปิดรับอยู่ สวิตช์ติด', rowSw.found && rowSw.on === true);

  await ev("window.__calls = []; const e = document.querySelector('.sw-row input'); e.checked = false; e.dispatchEvent(new Event('change',{bubbles:true})); return 1;");
  await sleep(700);
  const quick = await ev("return window.__calls[0] || null;");
  ok('กดสวิตช์ในรายการแล้วบันทึกทันที ไม่ต้องเข้าไปแก้',
     quick && quick.body.status === 'closed', quick && quick.body.status);
  ok('กดสวิตช์ในรายการไม่ได้ทำวันที่หาย',
     quick && quick.body.opensAt === EXISTING.opensAt, quick && quick.body.opensAt);

  console.log('');
  const real = pageErrors.filter(e => !/favicon|ERR_|net::/.test(e));
  ok('ไม่มี JavaScript error ตลอดการทดสอบ', real.length === 0, real.slice(0, 2).join(' | '));

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
