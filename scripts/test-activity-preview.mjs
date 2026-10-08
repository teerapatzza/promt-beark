// ตรวจพรีวิวชื่อกิจกรรม และช่องวันที่ของใบรับรองค่าพาหนะ
//
// ที่มา: 8 ต.ค. 2569 ผู้ใช้แจ้งสองเรื่องพร้อมกัน
//   1. เลือกใบรับรองค่าพาหนะอย่างเดียว แล้วไม่มีช่องกรอกวันที่เดินทาง
//      ทำให้คอลัมน์ "วัน เดือน ปี" บนใบที่พิมพ์ออกมาว่างทั้งคอลัมน์
//   2. ชื่อกิจกรรมยาวแล้วตัวหนังสือทับกัน และขอให้เห็นพรีวิวตอนพิมพ์
//      ว่าจะขึ้นกี่บรรทัด (ของเดิมมีแต่ตัวนับตัวอักษร ซึ่งบอกอะไรไม่ได้ —
//      ชื่อที่มีปัญหายาวแค่ 74 ตัว ต่ำกว่าเพดาน 200 มาก)
//
// ด่านสำคัญที่สุดคือ "พรีวิวต้องไม่โกหก" — จำนวนบรรทัดที่บอกผู้ใช้ตอนพิมพ์
// ต้องเท่ากับที่ออกมาบนเอกสารจริงเป๊ะ ไม่งั้นมีพรีวิวยังแย่กว่าไม่มี
//
//   cd public && python -m http.server 8099 --bind 127.0.0.1
//   node scripts/test-activity-preview.mjs
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { rmSync } from 'node:fs';

const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9611, PROFILE = 'C:/Users/teerapat/AppData/Local/Temp/pb-prev';
const APP = process.env.APP_URL || 'http://127.0.0.1:8099';
try { rmSync(PROFILE, { recursive: true, force: true }); } catch {}

const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=' + PORT,
  '--user-data-dir=' + PROFILE, '--no-first-run', '--disable-gpu',
  '--window-size=1500,1100', 'about:blank'], { stdio: 'ignore' });
let ws, id = 0; const pend = new Map(); const pageErrors = [];
const send = (m, p = {}) => { const i = ++id; ws.send(JSON.stringify({ id: i, method: m, params: p }));
  return new Promise((r, j) => pend.set(i, { r, j })); };
const ev = async e => {
  const r = await send('Runtime.evaluate', { expression: '(async()=>{' + e + '})()', awaitPromise: true, returnByValue: true, timeout: 120000 });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result?.value;
};
const results = [];
const ok = (n, pass, d = '') => { results.push(pass);
  console.log((pass ? '  ผ่าน  ' : '  ตก    ') + n + (d ? '  -> ' + d : '')); };

const STUB =
  "localStorage.setItem('token','x');" +
  "const of=window.fetch;window.fetch=function(u,i){const s=(typeof u==='string')?u:(u&&u.url)||'';" +
  "if(s.indexOf('/auth/me')>=0)return Promise.resolve(new Response(JSON.stringify({id:1,email:'t@ha.or.th',name:'t',role:'admin'}),{status:200,headers:{'Content-Type':'application/json'}}));" +
  "if(s.indexOf('/expenses')>=0||s.indexOf('/profiles')>=0)" +
  "return Promise.resolve(new Response('[]',{status:200,headers:{'Content-Type':'application/json'}}));" +
  "if(s.indexOf('/budget-categories')>=0)return Promise.resolve(new Response(JSON.stringify([" +
  "{id:'RC',name:'ใบรับรองค่าพาหนะ',fuelRate:5,pdfTemplates:['TRANSPORT_RECEIPT']}," +
  "{id:'BOTH',name:'ทั้งสองใบ',fuelRate:5,pdfTemplates:['REPORT','TRANSPORT_RECEIPT']}" +
  "]),{status:200,headers:{'Content-Type':'application/json'}}));return of(u,i);};";

const CASES = [
  'ประชุมคณะกรรมการ',
  'เยี่ยมสำรวจต่ออายุรับรองกระบวนการคุณภาพ โรงพยาบาลทันตกรรม 23-24 กันยายน 69',
  'การอบรมเชิงปฏิบัติการเพื่อพัฒนาระบบการดูแลผู้ป่วยด้วยมิติจิตวิญญาณ ในสถานพยาบาลเพื่อความปลอดภัย โรงพยาบาลสมเด็จพระยุพราชด่านซ้าย จังหวัดเลย',
  'Workshop SHA 3P ศูนย์การแพทย์ปัญญานันทภิกขุ ชลประทาน มหาวิทยาลัยศรีนครินทรวิโรฒ 14-15 ต.ค. 69'
];

const mk = act => ({
  id: 1, requestedBy: 'ธีรภัทร คุ้มวงษ์', amount: 134, date: '2026-10-08',
  createdAt: '2026-10-08T02:00:00Z', description: 'เบิก', attachments: { images: [] },
  inputMetadata: {
    _pdfTemplates: ['TRANSPORT_RECEIPT'], _activityName: act, _position: 'นักวิเคราะห์',
    _affiliation: 'สนับสนุนการบริหารองค์กร', _docDate: '2026-10-08',
    _addr: { no: '141/36', soi: 'สุขสวัสดิ์ 55', road: 'สุขสวัสดิ์', sub: 'ปากคลองบางปลากด',
             dist: 'พระสมุทรเจดีย์', prov: 'สมุทรปราการ', zip: '10290' },
    _travel: { startDate: '2026-09-23', endDate: '2026-09-24', from: '141/36', to: 'รพ.เปาโล',
               distOut: '3.4', distRet: '3.4' },
    _carType: 'ไป-กลับ',
    _costs: { hotelEntries: { entries: [] }, fuelRate: '5', taxiEntries: [],
              airAmount: 0, tollAmount: 100, parkingAmount: 0, otherAmount: 0 }
  }
});

try {
  let u;
  for (let i = 0; i < 80; i++) {
    try { const l = await (await fetch('http://127.0.0.1:' + PORT + '/json/list')).json();
      const p = l.find(t => t.type === 'page'); if (p) { u = p.webSocketDebuggerUrl; break; } } catch {}
    await sleep(250);
  }
  ws = new WebSocket(u); await new Promise(r => ws.addEventListener('open', r));
  ws.addEventListener('message', e => { const m = JSON.parse(e.data);
    if (m.id && pend.has(m.id)) { const { r, j } = pend.get(m.id); pend.delete(m.id);
      m.error ? j(new Error(m.error.message)) : r(m.result); return; }
    if (m.method === 'Runtime.exceptionThrown')
      pageErrors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
    if (m.method === 'Page.javascriptDialogOpening') send('Page.handleJavaScriptDialog', { accept: true }); });
  await send('Page.enable'); await send('Runtime.enable');
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Page.addScriptToEvaluateOnNewDocument', { source: STUB });

  // ══ 1. ช่องวันที่ต้องโผล่เมื่อเลือกใบรับรองค่าพาหนะ ══
  console.log('═══ 1. ใบรับรองค่าพาหนะต้องมีช่องกรอกวันที่ ═══');
  await send('Page.navigate', { url: APP + '/expense.html' }); await sleep(4000);
  const dates = await ev([
    "window.currentPdfTemplates = ['TRANSPORT_RECEIPT'];",
    "updateFormUI();",
    "await new Promise(r => requestAnimationFrame(r));",
    "const box = document.getElementById('travelTimeBox');",
    "const ds = document.getElementById('dateStart'), de = document.getElementById('dateEnd');",
    "const vis = el => { if (!el) return false; const r = el.getBoundingClientRect();",
    "  return r.width > 0 && r.height > 0; };",
    "return { boxShown: box ? !box.classList.contains('hidden') : false,",
    "         startVisible: vis(ds), endVisible: vis(de) };"
  ].join('\n'));
  ok('กล่องกำหนดการเดินทางแสดงอยู่', dates.boxShown === true);
  ok('ช่อง "ออกเดินทาง" กดกรอกได้จริง', dates.startVisible === true);
  ok('ช่อง "กลับถึง" กดกรอกได้จริง', dates.endVisible === true);

  // ══ 2. พรีวิวต้องบอกจำนวนบรรทัดตรงกับเอกสารจริง ══
  console.log('');
  console.log('═══ 2. พรีวิวต้องไม่โกหก — เทียบกับเอกสารจริงทีละเคส ═══');
  await ev("await document.fonts.load('400 13.5px Sarabun','ก'); await document.fonts.ready; return 1;");

  const formLines = [];
  for (const act of CASES) {
    const r = await ev([
      "window.currentPdfTemplates = ['TRANSPORT_RECEIPT'];",
      "const inp = document.getElementById('activityName');",
      "inp.value = " + JSON.stringify(act) + ";",
      "updateActivityCounter();",
      "await new Promise(r => requestAnimationFrame(r));",
      "const box = document.getElementById('activityPreview');",
      "return { lines: activityLines(inp.value).length,",
      "         shown: box ? !box.classList.contains('hidden') : false,",
      "         rendered: box ? box.querySelectorAll('.act-line').length : 0,",
      "         warns: box ? /ยาวกว่าช่องที่เตรียมไว้/.test(box.textContent||'') : false };"
    ].join('\n'));
    formLines.push(r);
  }

  await send('Page.navigate', { url: APP + '/history.html' }); await sleep(4000);
  await ev("window.renderRouteMapImage=async()=>null;window.alert=()=>{};await waitForDocumentFonts();return 1;");

  for (let i = 0; i < CASES.length; i++) {
    const act = CASES[i];
    const doc = await ev([
      "const built = await buildDocumentHtml(" + JSON.stringify(mk(act)) + ");",
      "document.getElementById('pdf-container').innerHTML =",
      "  '<div id=\"formal-doc\" style=\"background:white;color:black\">' + built.html + '</div>';",
      "await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));",
      "const cell = [...document.querySelectorAll('#formal-doc td')]",
      "  .find(td => /กิจกรรม/.test(td.textContent||'') && td.querySelector('.free-text'));",
      "const free = cell.querySelector('.free-text');",
      "const rng = document.createRange(); rng.selectNodeContents(free);",
      "return [...rng.getClientRects()].filter(b=>b.width>2&&b.height>2).length;"
    ].join('\n'));

    const f = formLines[i];
    const short = act.length > 34 ? act.slice(0, 34) + '…' : act;
    ok('"' + short + '" (' + act.length + ' ตัว) พรีวิวบอกตรงกับเอกสาร',
       f.lines === doc, 'พรีวิว ' + f.lines + ' บรรทัด · เอกสารจริง ' + doc + ' บรรทัด');
    if (doc > 1) {
      ok('   แสดงพรีวิวให้เห็นตอนพิมพ์', f.shown === true);
      ok('   วาดครบทุกบรรทัด', f.rendered === doc, f.rendered + '/' + doc);
    } else {
      ok('   บรรทัดเดียวไม่ต้องรบกวน ไม่ขึ้นพรีวิว', f.shown === false);
    }
    if (doc > 2) ok('   เตือนว่าจะยืดเกินช่องที่เตรียมไว้', f.warns === true);
  }

  ok('ไม่มี JavaScript error ตลอดการทดสอบ', pageErrors.length === 0, pageErrors.slice(0,2).join(' | '));

  console.log('');
  console.log('══════════════════════════════════════════════════');
  console.log('  ผ่าน ' + results.filter(Boolean).length + ' / ' + results.length);
  console.log('══════════════════════════════════════════════════');
  process.exitCode = results.every(Boolean) ? 0 : 1;
} catch (e) { console.error('ล้มเหลว:', e.message); process.exitCode = 2; }
finally { try { ws.close(); } catch {} chrome.kill(); }
