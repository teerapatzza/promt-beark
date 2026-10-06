// ตรวจความคมชัดของช่องกรอก และความถูกต้องของโหมดมืด
//
// ที่มา: 6 ต.ค. 2569 ผู้ใช้แจ้งว่าหน้าจอ "ขาวสว่างจ้าไปหมด ต้องเพ่งถึงจะกรอกต่อ"
// วัดได้ว่าช่องกรอกไม่มีสีพื้น เป็นขาวบนขาว เหลือแต่ขอบ #E2E8F0 ที่ต่างกันแค่ 1.23:1
// WCAG 2.1 ข้อ 1.4.11 กำหนดขอบของตัวควบคุมไว้ที่อย่างน้อย 3:1
//
// ชุดนี้วัดค่าจริงจากหน้าเว็บที่เรนเดอร์แล้ว ไม่ได้อ่านจากไฟล์ CSS
//
//   cd public && python -m http.server 8099 --bind 127.0.0.1
//   node scripts/test-theme-contrast.mjs
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { rmSync } from 'node:fs';

const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9591, PROFILE = 'C:/Users/teerapat/AppData/Local/Temp/pb-theme';
const APP = process.env.APP_URL || 'http://127.0.0.1:8099';
try { rmSync(PROFILE, { recursive: true, force: true }); } catch {}

const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=' + PORT,
  '--user-data-dir=' + PROFILE, '--no-first-run', '--disable-gpu',
  '--window-size=1440,1000', 'about:blank'], { stdio: 'ignore' });
let ws, id = 0; const pending = new Map(); const pageErrors = [];
const send = (m, p = {}) => { const i = ++id; ws.send(JSON.stringify({ id: i, method: m, params: p }));
  return new Promise((r, j) => pending.set(i, { r, j })); };
const ev = async e => {
  const r = await send('Runtime.evaluate', { expression: '(async()=>{' + e + '})()', awaitPromise: true, returnByValue: true, timeout: 60000 });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result?.value;
};
const results = [];
const ok = (n, pass, d = '') => { results.push(pass);
  console.log((pass ? '  ผ่าน  ' : '  ตก    ') + n + (d ? '  -> ' + d : '')); };

// สูตรความสว่างสัมพัทธ์ตาม WCAG 2.1 — คำนวณในสคริปต์นี้ ไม่พึ่งไลบรารีภายนอก
const lum = ([r, g, b]) => {
  const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05); };
const parseRaw = s => (String(s).match(/\d+(\.\d+)?/g) || [0, 0, 0]).map(Number);
// สีโปร่งแสงต้องผสมทับพื้นหลังก่อน ไม่งั้นค่าที่วัดได้จะไม่ใช่สีที่ตาเห็นจริง
const parseOn = (s, under) => {
  const v = parseRaw(s);
  const rgb = v.slice(0, 3), a = v.length > 3 ? v[3] : 1;
  if (a >= 1) return rgb;
  return rgb.map((c, i) => Math.round(c * a + under[i] * (1 - a)));
};
const parse = s => parseOn(s, [255, 255, 255]);

const PAGE_SETUP =
  "localStorage.setItem('token','x');" +
  "const of=window.fetch;window.fetch=function(u,i){const s=(typeof u==='string')?u:(u&&u.url)||'';" +
  "if(s.indexOf('/auth/me')>=0)return Promise.resolve(new Response(JSON.stringify({id:1,email:'t@ha.or.th',name:'t',role:'admin'})," +
  "{status:200,headers:{'Content-Type':'application/json'}}));" +
  "if(s.indexOf('/expenses')>=0||s.indexOf('/budget-categories')>=0||s.indexOf('/profiles')>=0||s.indexOf('/settings')>=0)" +
  "return Promise.resolve(new Response('[]',{status:200,headers:{'Content-Type':'application/json'}}));return of(u,i);};";

/** อ่านสีพื้น/ขอบของช่องกรอก และสีพื้นของกล่องที่ช่องนั้นวางอยู่ */
const PROBE = [
  "const inp = [...document.querySelectorAll('input')].filter(function (e) {",
  "  const t = (e.type||'text').toLowerCase();",
  "  if (['checkbox','radio','file','submit','button','hidden'].indexOf(t) >= 0) return false;",
  "  const r = e.getBoundingClientRect(); return r.width > 40 && r.height > 10;",
  "});",
  "if (!inp.length) return { n: 0 };",
  "const el = inp[0];",
  // หาพื้นหลังที่มองเห็นจริง ไต่ขึ้นไปจนเจอตัวที่ไม่โปร่งใส
  "const solidBg = function (node) {",
  "  let p = node.parentElement;",
  "  while (p) { const c = getComputedStyle(p).backgroundColor;",
  "    if (c && c !== 'rgba(0, 0, 0, 0)' && c !== 'transparent') return c; p = p.parentElement; }",
  "  return getComputedStyle(document.body).backgroundColor;",
  "};",
  "const cs = getComputedStyle(el);",
  "return { n: inp.length, field: cs.backgroundColor, border: cs.borderTopColor,",
  "         text: cs.color, card: solidBg(el),",
  "         bodyBg: getComputedStyle(document.body).backgroundColor,",
  "         theme: document.documentElement.getAttribute('data-theme') };"
].join('\n');

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
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Page.addScriptToEvaluateOnNewDocument', { source: PAGE_SETUP });

  const PAGES = ['expense', 'history', 'admin', 'profile', 'login', 'index'];

  for (const mode of ['light', 'dark']) {
    console.log('');
    console.log('═══ โหมด' + (mode === 'light' ? 'สว่าง' : 'มืด') + ' ═══');
    for (const page of PAGES) {
      await send('Page.navigate', { url: APP + '/' + page + '.html' });
      await sleep(2200);
      await ev("localStorage.setItem('pb-theme','" + mode + "');");
      await send('Page.reload'); await sleep(2200);
      const r = await ev(PROBE);
      if (!r || !r.n) { console.log('  ข้าม    ' + page + ' (ไม่มีช่องกรอกให้วัด)'); continue; }

      ok(page.padEnd(8) + ' ธีมถูกตั้งเป็น "' + mode + '" จริง', r.theme === mode, r.theme);

      const pageBg  = parse(r.bodyBg);
      const card    = parseOn(r.card, pageBg);    // การ์ดอาจโปร่งแสง ผสมทับพื้นหน้าก่อน
      const field   = parseOn(r.field, card);
      const cBorder = ratio(parseOn(r.border, card), card);
      const cText   = ratio(parseOn(r.text, field), field);
      const differs = r.field !== r.card;

      ok(page.padEnd(8) + ' ขอบช่องกรอกต่างจากพื้นรอบข้าง >= 3:1 (WCAG 1.4.11)',
         cBorder >= 3, cBorder.toFixed(2) + ':1  ขอบ ' + r.border + ' บนพื้น ' + r.card);
      ok(page.padEnd(8) + ' พื้นช่องกรอกไม่ใช่สีเดียวกับกล่องที่รองอยู่',
         differs, 'ช่อง ' + r.field + ' / กล่อง ' + r.card);
      ok(page.padEnd(8) + ' ตัวอักษรในช่องอ่านออก >= 4.5:1 (WCAG 1.4.3)',
         cText >= 4.5, cText.toFixed(2) + ':1');
      if (mode === 'dark')
        ok(page.padEnd(8) + ' พื้นหลังหน้าเป็นโทนมืดจริง',
           lum(parse(r.bodyBg)) < 0.15, r.bodyBg);
    }
  }

  // เอกสารต้องเป็นกระดาษขาวหมึกดำเสมอ แม้ผู้ใช้ตั้งโหมดมืดไว้
  console.log('');
  console.log('═══ เอกสารต้องไม่โดนโหมดมืด ═══');
  await send('Page.navigate', { url: APP + '/history.html' }); await sleep(2200);
  await ev("localStorage.setItem('pb-theme','dark');");
  await send('Page.reload'); await sleep(2500);
  const doc = await ev([
    "document.getElementById('pdf-container').innerHTML =",
    "  '<div class=\"pdf-page\"><span class=\"text-slate-800\">ทดสอบ</span></div>';",
    "await new Promise(r => requestAnimationFrame(r));",
    "const p = document.querySelector('.pdf-page');",
    "const s = p.querySelector('span');",
    "return { bg: getComputedStyle(p).backgroundColor, ink: getComputedStyle(s).color,",
    "         theme: document.documentElement.getAttribute('data-theme') };"
  ].join('\n'));
  ok('หน้าเว็บอยู่ในโหมดมืดจริงตอนทดสอบ', doc.theme === 'dark', doc.theme);
  ok('กระดาษเอกสารยังขาว', ratio(parse(doc.bg), [255, 255, 255]) < 1.05, doc.bg);
  ok('หมึกในเอกสารยังดำ', ratio(parse(doc.ink), [0, 0, 0]) < 1.05, doc.ink);

  // ปุ่มสลับโหมดต้องมีจริงและกดได้
  console.log('');
  console.log('═══ ปุ่มสลับโหมด ═══');
  const btn = await ev([
    "const b = document.getElementById('pb-theme-toggle');",
    "if (!b) return { found: false };",
    "const r = b.getBoundingClientRect();",
    "const before = document.documentElement.getAttribute('data-theme');",
    "b.click(); await new Promise(r => requestAnimationFrame(r));",
    "const after = document.documentElement.getAttribute('data-theme');",
    "const mode = document.documentElement.getAttribute('data-theme-mode');",
    "return { found: true, w: Math.round(r.width), h: Math.round(r.height),",
    "         visible: r.width > 0 && r.height > 0, before: before, after: after, mode: mode,",
    "         saved: localStorage.getItem('pb-theme') };"
  ].join('\n'));
  ok('มีปุ่มสลับโหมดในหน้า', btn.found === true);
  ok('ปุ่มมีขนาดกดได้จริง', btn.visible === true, btn.w + 'x' + btn.h);
  ok('กดแล้วสลับโหมดได้', btn.before !== btn.after || btn.mode === 'auto',
     btn.before + ' -> ' + btn.after + ' (โหมด ' + btn.mode + ')');
  ok('จำค่าที่เลือกไว้', !!btn.saved, 'บันทึกเป็น "' + btn.saved + '"');

  ok('ไม่มี JavaScript error ตลอดการทดสอบ', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '));

  console.log('');
  console.log('══════════════════════════════════════════════════');
  console.log('  ผ่าน ' + results.filter(Boolean).length + ' / ' + results.length);
  console.log('══════════════════════════════════════════════════');
  process.exitCode = results.every(Boolean) ? 0 : 1;
} catch (e) { console.error('ล้มเหลว:', e.message); process.exitCode = 2; }
finally { try { ws.close(); } catch {} chrome.kill(); }
