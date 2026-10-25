// บรรทัดสุดท้ายของเอกสารต้องมีที่ว่างใต้ตัวอักษรพอ ไม่งั้นโดนเฉือนตอนทำ PDF
//
// 25 ต.ค. 2569 — ผู้ใช้จริง (ใบ id=211) โหลด PDF แล้วชื่อกับวันที่ใต้ลายเซ็นหายไป
// เหลือแค่ "ลงชื่อ ______ ผู้เดินทาง" แล้วถูกตัดกลางบรรทัดถัดไป
//
// วัดจากใบจริง: บรรทัดวันที่จบที่ y=882 กล่องหน้าสูง 888 -> เหลือที่ว่างแค่ 6 px
// ซึ่งคือ padding ล่างของ .pdf-page พอดี บรรทัดสุดท้ายจึงแนบติดขอบ
// ภาพใน PDF ที่ได้สูง 1770 px = 885 CSS px ขาดจากเนื้อหาที่ต้องการ 3 px
// html2canvas ปัดเศษลง บวกกับเมตริกฟอนต์ต่างเครื่องนิดเดียว ตัวอักษรก็หายทันที
//
// ชุดนี้ไม่ได้ตรวจว่า "เฉือนหรือยัง" เพราะนั่นขึ้นกับเครื่องผู้ใช้
// แต่ตรวจว่า "มีที่เผื่อพอไหม" ซึ่งเป็นสิ่งที่เราคุมได้จริง
//
//   cd public && python3 -m http.server 8099 --bind 127.0.0.1
//   node scripts/test-pdf-bottom-room.mjs
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = JSON.parse(fs.readFileSync(path.join(HERE, 'fixtures-date-regression.json'), 'utf8'));

/** ที่ว่างใต้บรรทัดสุดท้ายอย่างน้อยกี่พิกเซลจึงจะปลอดภัย
    6 px คือค่าที่ทำให้ผู้ใช้เจอปัญหาจริง ตั้งไว้ 15 px = เผื่อไว้สองเท่าครึ่ง */
const MIN_ROOM = 15;

const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9677, PROFILE = 'C:/Users/teerapat/AppData/Local/Temp/pb-bottomroom';
const APP = process.env.APP_URL || 'http://127.0.0.1:8099';
const NL = String.fromCharCode(10);

const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=' + PORT,
  '--user-data-dir=' + PROFILE, '--no-first-run', '--disable-gpu',
  '--window-size=1400,1600', 'about:blank'], { stdio: 'ignore' });

let ws, id = 0; const pending = new Map(); const pageErrors = [];
const send = (m, p = {}) => { const i = ++id; ws.send(JSON.stringify({ id: i, method: m, params: p }));
  return new Promise((r, j) => pending.set(i, { r, j })); };
const ev = async e => {
  const r = await send('Runtime.evaluate',
    { expression: '(async()=>{' + e + '})()', awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result?.value;
};
const results = [];
const ok = (n, pass, d = '') => { results.push(pass);
  console.log((pass ? '  ผ่าน  ' : '  ตก    ') + n + (d ? '  -> ' + d : '')); };

const FLAT = { enabled: true, maxKm: 200, outsideMetro: 1200, bands: [
  { upTo: 10.99, amount: 150 }, { upTo: 20.99, amount: 250 }, { upTo: null, amount: 750 } ] };
const CATS = [
  { id: 'TRAVEL001', name: 'เบิกค่าเดินทาง+ที่พัก', pdfTemplates: ['REPORT', 'TRANSPORT_RECEIPT'],
    fuelRate: 5, taxiMaxPerTrip: 750, flatRate: FLAT },
  { id: 'TRAVEL002', name: 'เบิกค่าเดินทาง+ค่าที่พัก (กรณีบิลเงินสด)',
    pdfTemplates: ['REPORT', 'TRANSPORT_RECEIPT', 'GENERAL_RECEIPT'], fuelRate: 5, taxiMaxPerTrip: 750, flatRate: FLAT },
  { id: 'TRAVEL003', name: 'เบิกค่าที่พัก', pdfTemplates: ['NORMAL', 'REPORT'],
    fuelRate: 5, taxiMaxPerTrip: 750, flatRate: FLAT },
  { id: 'TRAVEL004', name: 'เบิกค่าพาหนะ', pdfTemplates: ['TRANSPORT_RECEIPT'],
    fuelRate: 5, taxiMaxPerTrip: 750, flatRate: FLAT },
  { id: 'TRAVEL005', name: 'เบิกค่าที่พัก (กรณีบิลเงินสด)', pdfTemplates: ['REPORT', 'GENERAL_RECEIPT'],
    fuelRate: 5, taxiMaxPerTrip: 750, flatRate: FLAT }
];

/* วัดเหมือนที่ exportPDF ทำจริง: ใส่ลง #pdf-container ห่อ #formal-doc
   รอฟอนต์ ย่อให้พอดี ตรึงบรรทัด แล้วค่อยวัด
   จากนั้นหาว่า "ตัวอักษรตัวล่างสุดของแต่ละหน้า" อยู่ห่างขอบล่างกี่พิกเซล */
const MEASURE = [
  "const container = document.getElementById('pdf-container');",
  "container.innerHTML = '<div id=\"formal-doc\" style=\"background:white;color:black;margin:0;padding:0;\">'",
  "  + window.__html + '</div>';",
  "const element = document.getElementById('formal-doc');",
  "if (typeof waitForDocumentFonts === 'function') await waitForDocumentFonts();",
  "try { fitCertificatePages(element); } catch (e) {}",
  "try { freezeLineBreaks(element); } catch (e) {}",
  "await new Promise(r=>setTimeout(r,700));",
  "const out = [];",
  "const pages = element.querySelectorAll('.pdf-page');",
  "for (let i = 0; i < pages.length; i++) {",
  "  const p = pages[i];",
  "  const pr = p.getBoundingClientRect();",
  /* หาขอบล่างสุดของ "เนื้อหาที่มองเห็น" โดยไล่จาก text node ทุกตัว
     ใช้ Range เพื่อให้ได้กรอบของตัวอักษรจริง ไม่ใช่กรอบของกล่องที่อาจใหญ่เกิน */
  "  let low = pr.top;",
  "  const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);",
  "  let n;",
  "  while ((n = walker.nextNode())) {",
  "    if (!String(n.nodeValue || '').trim()) continue;",
  "    const rg = document.createRange(); rg.selectNodeContents(n);",
  "    const rr = rg.getBoundingClientRect();",
  "    if (rr.height > 0 && rr.bottom > low) low = rr.bottom;",
  "  }",
  "  out.push({ page: i + 1, room: Math.round(pr.bottom - low),",
  "             h: Math.round(pr.height) });",
  "}",
  "return out;"
].join(NL);

try {
  let u;
  for (let i = 0; i < 100; i++) {
    try { const l = await (await fetch('http://127.0.0.1:' + PORT + '/json/list')).json();
      const p = l.find(t => t.type === 'page'); if (p) { u = p.webSocketDebuggerUrl; break; } } catch {}
    await sleep(250);
  }
  if (!u) throw new Error('Chrome ไม่ขึ้น');
  ws = new WebSocket(u); await new Promise(r => ws.addEventListener('open', r));
  ws.addEventListener('message', e => { const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { const { r, j } = pending.get(m.id); pending.delete(m.id);
      m.error ? j(new Error(m.error.message)) : r(m.result); return; }
    if (m.method === 'Runtime.exceptionThrown')
      pageErrors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text); });
  await send('Page.enable'); await send('Runtime.enable');
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Page.addScriptToEvaluateOnNewDocument', { source: [
    "localStorage.setItem('token','x');",
    "const CATS=" + JSON.stringify(CATS) + ";",
    "const of=window.fetch;",
    "window.fetch=function(u,i){const s=(typeof u==='string')?u:(u&&u.url)||'';",
    "  if(s.indexOf('/auth/me')>=0) return Promise.resolve(new Response(",
    "    JSON.stringify({id:1,email:'t@x.invalid',name:'t',role:'admin'}),",
    "    {status:200,headers:{'Content-Type':'application/json'}}));",
    "  if(s.indexOf('/settings')>=0) return Promise.resolve(new Response(",
    "    JSON.stringify({fuelRate:5,taxiMaxPerTrip:750}),",
    "    {status:200,headers:{'Content-Type':'application/json'}}));",
    "  if(s.indexOf('/budget-categories')>=0) return Promise.resolve(new Response(",
    "    JSON.stringify(CATS),{status:200,headers:{'Content-Type':'application/json'}}));",
    "  if(s.indexOf('/expenses')>=0) return Promise.resolve(new Response('[]',",
    "    {status:200,headers:{'Content-Type':'application/json'}}));",
    "  if(s.indexOf('/profiles')>=0) return Promise.resolve(new Response('[]',",
    "    {status:200,headers:{'Content-Type':'application/json'}}));",
    "  return of(u,i);};"
  ].join(NL) });

  await send('Page.navigate', { url: APP + '/history.html' });
  await sleep(5000);

  console.log('ต้องมีที่ว่างใต้ตัวอักษรล่างสุดอย่างน้อย ' + MIN_ROOM + ' px');
  console.log('');
  let worst = { room: 9999, id: '-', page: 0 };

  for (const fx of FIXTURES) {
    const rows = await ev([
      "const REC=" + JSON.stringify(fx.rec) + ";",
      "const built = await buildDocumentHtml(REC, function(){});",
      "window.__html = built.html;",
      MEASURE
    ].join(NL));

    const tight = rows.filter(r => r.room < MIN_ROOM);
    rows.forEach(r => { if (r.room < worst.room) worst = { room: r.room, id: fx.id, page: r.page }; });
    ok('ใบ ' + String(fx.id).padEnd(4) + ' ทุกหน้ามีที่ว่างใต้บรรทัดสุดท้ายพอ',
       tight.length === 0,
       rows.map(r => 'น.' + r.page + ' เหลือ ' + r.room + 'px').join(' · '));
  }

  console.log('');
  console.log('หน้าที่คับที่สุด: ใบ ' + worst.id + ' หน้า ' + worst.page + ' เหลือ ' + worst.room + ' px');
  ok('หน้าที่คับที่สุดยังผ่านเกณฑ์', worst.room >= MIN_ROOM, worst.room + ' px');

  console.log('');
  ok('ไม่มี JavaScript error ตลอดการทดสอบ', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '));

  console.log('');
  console.log('══════════════════════════════════════════════════');
  console.log('  ผ่าน ' + results.filter(Boolean).length + ' / ' + results.length);
  console.log('══════════════════════════════════════════════════');
  process.exitCode = results.every(Boolean) ? 0 : 1;
} catch (e) { console.error('ล้มเหลว:', e.message); process.exitCode = 2; }
finally { try { ws.close(); } catch {} chrome.kill(); }
