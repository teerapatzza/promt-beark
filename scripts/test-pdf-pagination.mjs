// ตรวจการแบ่งหน้าของ PDF — ต้องไม่มีหน้าเปล่า และเนื้อหาต้องไม่ถูกผ่าครึ่ง
//
// ที่มา: 25 ก.ย. 2569 ผู้ใช้โหลด PDF มาแล้วได้หน้าเปล่า 1 หน้านำหน้า
// เนื้อหาไปกองอยู่ท่อนล่างของหน้า 2 แล้วถูกหั่นครึ่งต่อไปหน้า 3
// โหลดใหม่อีกรอบกลับปกติ จึงเป็นบั๊กที่เกิดบางครั้ง
//
// ต้นเหตุ: #pdf-wrapper ตั้ง top: 200% ก้อนเอกสารจึงถูกส่งให้ html2pdf
// ที่ตำแหน่ง y ~1,600-1,900px แทนที่จะเป็น 0
// html2pdf ใช้ y นี้คำนวณจุดขึ้นหน้าใหม่ตามกฎ page-break-inside: avoid ของ .pdf-page
// ปกติมันหักล้างให้ แต่บางจังหวะหักไม่หมด ค่าเลยรั่วออกมาเป็นหน้าเปล่า
//
//   cd public && python -m http.server 8099 --bind 127.0.0.1
//   node scripts/test-pdf-pagination.mjs
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { rmSync } from 'node:fs';

const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9589, PROFILE = 'C:/Users/teerapat/AppData/Local/Temp/pb-pdfpage';
const APP = process.env.APP_URL || 'http://127.0.0.1:8099';
try { rmSync(PROFILE, { recursive: true, force: true }); } catch {}

const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=' + PORT,
  '--user-data-dir=' + PROFILE, '--no-first-run', '--disable-gpu',
  '--window-size=1400,900', 'about:blank'], { stdio: 'ignore' });
let ws, id = 0; const pending = new Map(); const pageErrors = [];
const send = (m, p = {}) => { const i = ++id; ws.send(JSON.stringify({ id: i, method: m, params: p }));
  return new Promise((r, j) => pending.set(i, { r, j })); };
const ev = async e => {
  const r = await send('Runtime.evaluate', { expression: '(async()=>{' + e + '})()', awaitPromise: true, returnByValue: true, timeout: 180000 });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result?.value;
};
const results = [];
const ok = (n, pass, d = '') => { results.push(pass);
  console.log((pass ? '  ผ่าน  ' : '  ตก    ') + n + (d ? '  -> ' + d : '')); };

// ใบจริงที่ผู้ใช้เจอปัญหา: ตั๋ว 1,500 · น้ำมัน 300 · ทางด่วน 133 · ที่จอดรถ 1,211 · อื่นๆ 3,331
const mk = over => Object.assign({
  id: 1, requestedBy: 'ธีรภัทร คุ้มวงษ์', amount: 6475, date: '2026-09-25',
  createdAt: '2026-09-25T02:00:00Z', description: 'เบิกค่าเดินทางไปปฏิบัติงาน',
  attachments: { images: [] },
  inputMetadata: Object.assign({
    _pdfTemplates: ['REPORT'], _activityName: 'asdasdas', _position: 'ที่ปรึกษา',
    _affiliation: 'สนับสนุนการบริหารองค์กรณ์', _docDate: '2026-09-25',
    _addr: { no: '141/36', soi: 'สุขสวัสดิ์ 55', road: 'สุขสวัสดิ์',
             sub: 'ปากคลองบางปลากด', dist: 'พระสมุทรเจดีย์', prov: 'สมุทรปราการ', zip: '10290' },
    _travel: { startDate: '2026-09-25', endDate: '2026-09-25', from: 'บ้าน', to: 'กรุงเทพมหานคร' },
    _carType: 'ไป-กลับ',
    _costs: { hotelEntries: { name: 'โรงแรมเลิศนิมิตร/fffaa', entries: [] }, fuelRate: '5',
              taxiEntries: [], airAmount: 1500, tollAmount: 133, parkingAmount: 1211, otherAmount: 3331 }
  }, (over && over.meta) || {})
}, (over && over.top) || {});

const CASES = [
  ['ใบรายงานอย่างเดียว (ใบที่ผู้ใช้เจอปัญหา)', mk()],
  ['ใบรายงาน + ใบรับรองค่าพาหนะ',
   mk({ meta: { _pdfTemplates: ['REPORT', 'TRANSPORT_RECEIPT'] } })],
  ['ใบรายงาน + รูปแนบ 2 รูป',
   mk({ top: { attachments: { images: [
        'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
        'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='] } } })]
];

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
  await send('Page.addScriptToEvaluateOnNewDocument', { source:
    "localStorage.setItem('token','x');" +
    "const of=window.fetch;window.fetch=function(u,i){const s=(typeof u==='string')?u:(u&&u.url)||'';" +
    "if(s.indexOf('/auth/me')>=0)return Promise.resolve(new Response(JSON.stringify({id:1,email:'t@ha.or.th',name:'t',role:'admin'})," +
    "{status:200,headers:{'Content-Type':'application/json'}}));" +
    "if(s.indexOf('/expenses')>=0||s.indexOf('/budget-categories')>=0||s.indexOf('/profiles')>=0)" +
    "return Promise.resolve(new Response('[]',{status:200,headers:{'Content-Type':'application/json'}}));return of(u,i);};" });
  await send('Page.navigate', { url: APP + '/history.html' });
  await sleep(4000);
  await ev("window.renderRouteMapImage = async () => null; window.alert = () => {}; await waitForDocumentFonts(); return 1;");

  // ── ด่านที่ 1: กล่องซ่อนเอกสารต้องไม่ถูกดันลงแนวตั้ง ──
  console.log('═══ กล่องซ่อนเอกสารก่อนแปลง PDF ═══');
  const wrap = await ev([
    "const w = document.getElementById('pdf-wrapper');",
    "const cs = getComputedStyle(w); const r = w.getBoundingClientRect();",
    "return { top: cs.top, y: Math.round(r.top + window.scrollY), winH: window.innerHeight,",
    "         hidden: cs.overflow === 'hidden' && parseFloat(cs.left) <= -1000 };"
  ].join('\n'));
  ok('ตำแหน่งแนวตั้งเป็นศูนย์ ไม่ดันก้อนเอกสารลงไปกวนการแบ่งหน้า',
     wrap.y === 0, 'top=' + wrap.top + ' อยู่ที่ y=' + wrap.y + 'px (จอสูง ' + wrap.winH + ')');
  ok('ยังซ่อนพ้นจอด้วยการเลื่อนแนวนอน ไม่ใช่แนวตั้ง', wrap.hidden === true);

  // ── ด่านที่ 2: จำนวนหน้า PDF ต้องตรงกับความสูงเนื้อหาจริง ──
  const px = await ev([
    "document.getElementById('pdf-container').innerHTML = '<div class=\"pdf-page\" id=\"_m\">x</div>';",
    "const w = document.getElementById('_m').getBoundingClientRect().width;",
    "document.getElementById('pdf-container').innerHTML = ''; return w;"
  ].join('\n'));
  const A4px = 297 / 190 * px;   // ความสูงเต็มหน้า A4 ในหน่วยพิกเซลเดียวกับ .pdf-page
  console.log('');
  console.log('═══ จำนวนหน้าที่ออกมา (หนึ่งหน้า A4 = ' + Math.round(A4px) + 'px) ═══');

  for (const [label, rec] of CASES) {
    const r = await ev([
      "const built = await buildDocumentHtml(" + JSON.stringify(rec) + ");",
      "const c = document.getElementById('pdf-container');",
      "c.innerHTML = '<div id=\"formal-doc\" style=\"background:white;color:black;margin:0;padding:0;\">' + built.html + '</div>';",
      "const el = document.getElementById('formal-doc');",
      "await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));",
      "const rect = el.getBoundingClientRect();",
      "const breaks = el.querySelectorAll('.html2pdf__page-break').length;",
      "const opt = { margin: [5,5,5,5], filename: 'x.pdf', image: { type: 'jpeg', quality: 0.98 },",
      "  html2canvas: { scale: 2, useCORS: true, logging: false },",
      "  jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }, pagebreak: { mode: ['css'] } };",
      "const pdf = await html2pdf().set(opt).from(el).toPdf().get('pdf');",
      "c.innerHTML = '';",
      "return { y: Math.round(rect.top + window.scrollY), h: Math.round(rect.height),",
      "         breaks: breaks, pages: pdf.internal.getNumberOfPages() };"
    ].join('\n'));

    // ตัวคั่นหน้าแต่ละอันบังคับขึ้นหน้าใหม่ 1 หน้า ที่เหลือคิดจากความสูง
    const expect = r.breaks + Math.max(1, Math.ceil((r.h - r.breaks * A4px) / A4px));
    ok(label, r.pages <= expect && r.y === 0,
       'ส่งที่ y=' + r.y + ' สูง ' + r.h + 'px ตัวคั่น ' + r.breaks
       + ' -> ได้ ' + r.pages + ' หน้า (ไม่ควรเกิน ' + expect + ')');
  }

  ok('ไม่มี JavaScript error', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '));

  console.log('');
  console.log('══════════════════════════════════════════════════');
  console.log('  ผ่าน ' + results.filter(Boolean).length + ' / ' + results.length);
  console.log('══════════════════════════════════════════════════');
  process.exitCode = results.every(Boolean) ? 0 : 1;
} catch (e) { console.error('ล้มเหลว:', e.message); process.exitCode = 2; }
finally { try { ws.close(); } catch {} chrome.kill(); }
