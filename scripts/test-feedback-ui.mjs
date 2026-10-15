// แบบประเมิน — ตรวจหน้าจอจริงด้วยเบราว์เซอร์
// จำลองคำตอบจากหลังบ้าน แล้วดูว่าหน้าเว็บวาดถูก กดได้ และส่งค่าถูกต้อง
//
//   cd public && python -m http.server 8099 --bind 127.0.0.1
//   node scripts/test-feedback-ui.mjs
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9562, PROFILE = 'C:/Users/teerapat/AppData/Local/Temp/pb-fbui';
const APP = process.env.APP_URL || 'http://127.0.0.1:8099';

const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=' + PORT,
  '--user-data-dir=' + PROFILE, '--no-first-run', '--disable-gpu',
  '--window-size=1400,1100', 'about:blank'], { stdio: 'ignore' });

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

// ชุดคำถามปลอมที่มีครบทุกชนิด เพื่อดูว่าหน้าเว็บวาดได้ทุกแบบ
const FORM = {
  id: 7, title: 'ความพึงพอใจพร้อมเบิก รอบทดสอบ',
  intro: 'ทดสอบการวาดคำถามทุกชนิด',
  questions: [
    { id: 'a', kind: 'face',    title: 'พอใจแค่ไหน', required: true },
    { id: 'b', kind: 'section', title: 'ความง่ายในการใช้งาน' },
    { id: 'c', kind: 'star',    title: 'กรอกง่ายไหม', max: 5, required: true },
    { id: 'd', kind: 'scale',   title: 'ให้คะแนน 1-10', max: 10, minLabel: 'น้อย', maxLabel: 'มาก' },
    { id: 'e', kind: 'choice',  title: 'ตรงไหนติดขัด', options: ['ค่า Taxi', 'แผนที่'] },
    { id: 'f', kind: 'multi',   title: 'ใช้อะไรบ้าง', options: ['เบิก', 'ประวัติ'] },
    { id: 'g', kind: 'yesno',   title: 'จะแนะนำไหม', required: true },
    { id: 'h', kind: 'text',    title: 'ข้อเสนอแนะ' }
  ]
};

const STUB = [
  "localStorage.setItem('token','x');",
  // เก็บลง sessionStorage เพราะพอกดส่งแล้วหน้าจะเด้งไปหน้าขอบคุณ
  // ตัวแปรบน window จะหายไปพร้อมหน้าเดิม แล้วอ่านกลับมาไม่ได้
  "if (!sessionStorage.getItem('__sent')) sessionStorage.removeItem('__sent');",
  "const of = window.fetch;",
  "window.fetch = function (u, i) {",
  "  const s = (typeof u === 'string') ? u : (u && u.url) || '';",
  "  const J = (o, st) => Promise.resolve(new Response(JSON.stringify(o),",
  "    {status: st || 200, headers:{'Content-Type':'application/json'}}));",
  "  if (s.indexOf('/auth/me') >= 0) return J({id:1,email:'t@ha.or.th',name:'ทดสอบ',role:'admin'});",
  "  if (s.indexOf('/feedback/active') >= 0) {",
  "    if (s.indexOf('token=') >= 0) return J({ form: " + JSON.stringify(FORM) + ", mine: null });",
  "    return J({ form: " + JSON.stringify(FORM) + ", mine: null });",
  "  }",
  "  if (s.indexOf('/feedback/respond') >= 0) {",
  "    sessionStorage.setItem('__sent', i.body);",
  "    return J({ ok: true, token: 'tok123', updated: false });",
  "  }",
  "  if (s.indexOf('/feedback') >= 0) return J([]);",
  "  if (s.indexOf('/expenses') >= 0 || s.indexOf('/profiles') >= 0 || s.indexOf('/stats') >= 0) return J([]);",
  "  return of(u, i);",
  "};"
].join('\n');

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

  await send('Page.navigate', { url: APP + '/feedback.html' });
  await sleep(3000);

  console.log('═══ 1. วาดคำถามได้ครบทุกชนิด ═══');

  ok('หัวเรื่องมาจากชุดคำถามจริง',
     (await ev("return document.getElementById('fTitle').textContent;")) === FORM.title);
  ok('มีการ์ดคำถาม 7 ข้อ (ไม่นับหัวข้อคั่น)',
     await ev("return document.querySelectorAll('#questions section.card').length;") === 7);
  ok('หัวข้อคั่นหมวดวาดเป็นเส้นคั่น ไม่ใช่การ์ด',
     await ev("return document.querySelectorAll('#questions .sect').length;") === 1);
  ok('หน้ายิ้มมีครบ 5 ระดับ',
     await ev("return document.querySelectorAll('.face').length;") === 5);
  ok('ดาวมีครบ 5 ดวง',
     await ev("return document.querySelectorAll('.star').length;") === 5);
  ok('สเกล 1-10 มีครบ 10 ปุ่ม',
     await ev("return [...document.querySelectorAll('#questions button')].filter(b=>/^(10|[1-9])$/.test(b.textContent.trim())).length;") === 10);
  // ดูเฉพาะกล่องคำถาม ไม่รวมแถบระบบด้านบนที่ auth-guard วาดให้
  // แถบนั้นมีอิโมจิกุญแจของปุ่มเปลี่ยนรหัสผ่านอยู่ ซึ่งไม่ใช่ของหน้านี้
  ok('หน้ายิ้มวาดด้วย SVG ไม่ใช่อิโมจิ',
     await ev("const q = document.getElementById('questions');"
            + "return document.querySelector('.face svg') !== null"
            + " && !/[\\u{1F300}-\\u{1FAFF}]/u.test(q.innerText);"));

  console.log('');
  console.log('═══ 2. แถบความคืบหน้าและปุ่มส่ง ═══');

  ok('ข้อบังคับตอบมี 3 ข้อ',
     (await ev("return document.getElementById('barTotal').textContent;")) === '3');
  ok('ยังไม่ตอบอะไร ปุ่มส่งถูกปิดไว้',
     await ev("return document.getElementById('sendBtn').disabled === true;"));
  ok('บอกว่าเหลืออีกกี่ข้อ',
     /เหลืออีก 3/.test(await ev("return document.getElementById('barLeft').textContent;")));

  await ev("document.querySelectorAll('.face')[3].click(); return 1;");
  await sleep(150);
  ok('กดหน้ายิ้มแล้วติดสถานะเลือก',
     await ev("return document.querySelectorAll('.face')[3].classList.contains('on');"));
  ok('เลขข้อเปลี่ยนเป็นเครื่องหมายถูก',
     await ev("return document.getElementById('badge-a').classList.contains('done');"));
  ok('ความคืบหน้าขยับเป็น 1',
     (await ev("return document.getElementById('barDone').textContent;")) === '1');

  await ev("document.querySelectorAll('.star')[4].click(); return 1;");
  await sleep(150);
  await ev("[...document.querySelectorAll('.yn .btn')][0].click(); return 1;");
  await sleep(150);
  ok('ตอบครบแล้ว ปุ่มส่งเปิดใช้งาน',
     await ev("return document.getElementById('sendBtn').disabled === false;"));
  ok('ข้อความเปลี่ยนเป็นครบแล้ว',
     /ครบแล้ว/.test(await ev("return document.getElementById('barLeft').textContent;")));

  console.log('');
  console.log('═══ 3. เลือกหลายข้อ และกดซ้ำเพื่อยกเลิก ═══');

  await ev("const c=[...document.querySelectorAll('.chip')]; c[2].click(); return 1;");
  await sleep(150);
  await ev("const c=[...document.querySelectorAll('.chip')]; c[3].click(); return 1;");
  await sleep(150);
  ok('ข้อเลือกหลายข้อ ติ๊กได้พร้อมกันสองตัว',
     await ev("return [...document.querySelectorAll('.chip')].filter(c=>c.classList.contains('on')).length;") === 2);

  await ev("const c=[...document.querySelectorAll('.chip')]; c[0].click(); return 1;");
  await sleep(150);
  await ev("const c=[...document.querySelectorAll('.chip')]; c[0].click(); return 1;");
  await sleep(150);
  ok('ข้อไม่บังคับ กดซ้ำที่เดิม = ยกเลิกคำตอบ',
     await ev("return [...document.querySelectorAll('.chip')].slice(0,2).filter(c=>c.classList.contains('on')).length;") === 0);

  console.log('');
  console.log('═══ 4. ช่องข้อความไม่ทำเคอร์เซอร์เด้ง ═══');

  await ev("const t=document.getElementById('ta-h'); t.value='ใช้ง่ายดี'; t.dispatchEvent(new Event('input',{bubbles:true})); return 1;");
  await sleep(150);
  ok('ตัวนับตัวอักษรขยับตาม',
     (await ev("return document.getElementById('len-h').textContent;")) === '9');
  ok('ช่องข้อความยังอยู่ ไม่ถูกวาดใหม่ทิ้ง',
     await ev("return document.getElementById('ta-h').value;") === 'ใช้ง่ายดี');

  console.log('');
  console.log('═══ 5. ส่งคำตอบ ═══');

  await ev("document.getElementById('sendBtn').click(); return 1;");
  await sleep(700);
  const sent = await ev("const s = sessionStorage.getItem('__sent'); return s ? JSON.parse(s) : null;");
  ok('ส่งคำตอบออกไปจริง', !!sent);
  ok('ส่งคำตอบหน้ายิ้มเป็นเลขระดับ', sent && sent.answers.a === 4, sent && JSON.stringify(sent.answers.a));
  ok('ส่งคำตอบดาวเป็นเลขดวง', sent && sent.answers.c === 5);
  ok('ส่งคำตอบใช่/ไม่ใช่เป็น yes', sent && sent.answers.g === 'yes');
  ok('ส่งข้อความที่พิมพ์ไป', sent && sent.answers.h === 'ใช้ง่ายดี');
  ok('ข้อที่ยกเลิกไปแล้ว ไม่ถูกส่ง', sent && sent.answers.e === undefined);

  console.log('');
  console.log('═══ 6. หน้าผู้ดูแล ═══');

  await send('Page.navigate', { url: APP + '/feedback-admin.html' });
  await sleep(2500);
  ok('หน้าผู้ดูแลเปิดได้ ไม่ค้าง',
     /แบบประเมินการใช้งาน/.test(await ev("return document.body.innerText;")));
  ok('ยังไม่มีชุดคำถาม จึงชวนให้สร้างชุดแรก',
     /ยังไม่มีแบบประเมิน/.test(await ev("return document.body.innerText;")));

  await ev("newForm(); return 1;");
  await sleep(400);
  await ev("addQ('face'); addQ('choice'); addQ('text'); return 1;");
  await sleep(400);
  ok('เพิ่มคำถามได้ครบ 3 ข้อ',
     await ev("return document.querySelectorAll('#viewBuild .qcard').length;") === 3);
  await ev("delQ(1); return 1;");
  await sleep(300);
  ok('ลบคำถามได้', await ev("return document.querySelectorAll('#viewBuild .qcard').length;") === 2);

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
