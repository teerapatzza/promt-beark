// ตรวจการตรึงจุดตัดบรรทัดก่อนแปลงเป็น PDF
//
// ที่มา: 8 ต.ค. 2569 ผู้ใช้ส่ง PDF ที่ชื่อกิจกรรมบรรทัดสองพิมพ์ทับกันจนอ่านไม่ออก
// วัดแล้วพบว่าใน DOM ถูกต้องทุกความยาว (74 ตัวอักษร = 2 บรรทัด, 200 = 4 บรรทัด
// เซลล์ยืดตามจาก 53 เป็น 99px ไม่ล้น ไม่ถูกตัด)
// ความเสียหายเกิดตอน html2canvas วาดภาพ ซึ่งวัดข้อความเองแล้ววาดเอง
// ถ้าค่าที่วัดกับตอนวาดไม่ตรงกัน ข้อความชุดเดียวจะถูกวาดซ้อนกัน
//
// freezeLineBreaks() ตัดบรรทัดไว้ก่อนแล้วเปลี่ยนเป็น <div> ละบรรทัด
// html2canvas จึงไม่เหลือการตัดบรรทัดให้ตัดสินใจอีก
//
// ชุดนี้ตรวจสองอย่างที่สำคัญกว่าความสวย คือ
//   1. ตัวอักษรต้องไม่หายแม้แต่ตัวเดียว
//   2. ตำแหน่งบรรทัดต้องอยู่ที่เดิม เอกสารจะได้ไม่ยาวขึ้นจนล้นหน้า
//
//   cd public && python -m http.server 8099 --bind 127.0.0.1
//   node scripts/test-doc-linebreaks.mjs
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { rmSync } from 'node:fs';

const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9609, PROFILE = 'C:/Users/teerapat/AppData/Local/Temp/pb-lb';
const APP = process.env.APP_URL || 'http://127.0.0.1:8099';
try { rmSync(PROFILE, { recursive: true, force: true }); } catch {}

const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=' + PORT,
  '--user-data-dir=' + PROFILE, '--no-first-run', '--disable-gpu',
  '--window-size=1400,1000', 'about:blank'], { stdio: 'ignore' });
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

const CASES = [
  ['สั้น บรรทัดเดียว',  'ประชุมคณะกรรมการ'],
  ['ใบที่ผู้ใช้เจอปัญหา', 'เยี่ยมสำรวจต่ออายุรับรองกระบวนการคุณภาพ โรงพยาบาลทันตกรรม 23-24 กันยายน 69'],
  ['ยาว หลายบรรทัด',   'การอบรมเชิงปฏิบัติการเพื่อพัฒนาระบบการดูแลผู้ป่วยด้วยมิติจิตวิญญาณ ในสถานพยาบาลเพื่อความปลอดภัย โรงพยาบาลสมเด็จพระยุพราชด่านซ้าย จังหวัดเลย'],
  ['เต็มเพดาน 200',     'เยี่ยมสำรวจ'.repeat(18).slice(0, 200)],
  ['ไทยปนอังกฤษ',      'Workshop SHA 3P ศูนย์การแพทย์ปัญญานันทภิกขุ ชลประทาน มหาวิทยาลัยศรีนครินทรวิโรฒ 14-15 ต.ค. 69']
];

const mk = act => ({
  id: 1, requestedBy: 'ธีรภัทร คุ้มวงษ์', amount: 134, date: '2026-10-08',
  createdAt: '2026-10-08T02:00:00Z', description: 'เบิกค่าเดินทางไปปฏิบัติงาน',
  attachments: { images: [] },
  inputMetadata: {
    _pdfTemplates: ['TRANSPORT_RECEIPT'], _activityName: act, _position: 'นักวิเคราะห์ธุรกิจ',
    _affiliation: 'สนับสนุนการบริหารองค์กร', _docDate: '2026-10-08',
    _addr: { no: '141/36', soi: 'สุขสวัสดิ์ 55', road: 'สุขสวัสดิ์', sub: 'ปากคลองบางปลากด',
             dist: 'พระสมุทรเจดีย์', prov: 'สมุทรปราการ', zip: '10290' },
    _travel: { startDate: '2026-09-23', endDate: '2026-09-24',
               from: '141/36 ซอยสุขสวัสดิ์ 55', to: 'โรงพยาบาล เปาโลพระประแดง',
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
  await send('Page.addScriptToEvaluateOnNewDocument', { source:
    "localStorage.setItem('token','x');" +
    "const of=window.fetch;window.fetch=function(u,i){const s=(typeof u==='string')?u:(u&&u.url)||'';" +
    "if(s.indexOf('/auth/me')>=0)return Promise.resolve(new Response(JSON.stringify({id:1,email:'t@ha.or.th',name:'t',role:'admin'}),{status:200,headers:{'Content-Type':'application/json'}}));" +
    "if(s.indexOf('/expenses')>=0||s.indexOf('/budget-categories')>=0||s.indexOf('/profiles')>=0)" +
    "return Promise.resolve(new Response('[]',{status:200,headers:{'Content-Type':'application/json'}}));return of(u,i);};" });
  await send('Page.navigate', { url: APP + '/history.html' }); await sleep(4000);
  await ev("window.renderRouteMapImage=async()=>null;window.alert=()=>{};await waitForDocumentFonts();return 1;");

  ok('มีฟังก์ชันตรึงจุดตัดบรรทัดในหน้า',
     await ev("return typeof freezeLineBreaks === 'function';"));

  console.log('');
  for (const [label, act] of CASES) {
    const r = await ev([
      "const built = await buildDocumentHtml(" + JSON.stringify(mk(act)) + ");",
      "const c = document.getElementById('pdf-container');",
      "c.innerHTML = '<div id=\"formal-doc\" style=\"background:white;color:black\">' + built.html + '</div>';",
      "const el = document.getElementById('formal-doc');",
      "await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));",
      // วัดก่อนตรึง
      "const cellOf = () => [...el.querySelectorAll('td')]",
      "  .find(td => /กิจกรรม/.test(td.textContent||'') && td.querySelector('.free-text'));",
      "const before = cellOf();",
      "const bFree = before.querySelector('.free-text');",
      "const bText = bFree.textContent || '';",
      "const bRng = document.createRange(); bRng.selectNodeContents(bFree);",
      "const bRects = [...bRng.getClientRects()].filter(b => b.width>2 && b.height>2);",
      "const bCellH = before.getBoundingClientRect().height;",
      "const bPageH = el.querySelector('.pdf-page').getBoundingClientRect().height;",
      "const bTops = bRects.map(b => Math.round(b.top));",
      // ตรึง
      "const n = freezeLineBreaks(el);",
      "await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));",
      // วัดหลังตรึง
      "const after = cellOf();",
      "const aFree = after.querySelector('.free-text');",
      "const aText = aFree.textContent || '';",
      // ตอนนี้ตรึงด้วย <br> ไม่ใช่ <div> จึงนับจุดตัดจาก <br> และวัดบรรทัดจาก Range เหมือนเดิม
      "const brs = aFree.querySelectorAll('br').length;",
      "const aRng = document.createRange(); aRng.selectNodeContents(aFree);",
      "const aRects = [...aRng.getClientRects()].filter(b => b.width>2 && b.height>2);",
      "const aCellH = after.getBoundingClientRect().height;",
      "const aPageH = el.querySelector('.pdf-page').getBoundingClientRect().height;",
      "const aTops = aRects.map(b => Math.round(b.top));",
      "const strip = s => s.replace(/\\s+/g,'');",
      "return { frozen: n, domLines: bRects.length, newLines: aRects.length, brs: brs,",
      "  textSame: strip(aText) === strip(bText), lenB: bText.length, lenA: aText.length,",
      "  cellShift: Math.round(aCellH - bCellH), pageShift: Math.round(aPageH - bPageH),",
      "  topShift: aTops.length === bTops.length",
      "    ? Math.max(...aTops.map((t,i) => Math.abs(t - bTops[i]))) : -1 };"
    ].join('\n'));

    console.log('── ' + label + ' (' + act.length + ' ตัวอักษร · ' + r.domLines + ' บรรทัด) ──');
    ok('ตัวอักษรครบเท่าเดิม ไม่หายแม้แต่ตัวเดียว',
       r.textSame === true, r.lenB + ' -> ' + r.lenA + ' ตัวอักษร');
    if (r.domLines > 1) {
      ok('ใส่จุดตัดบรรทัดครบ ไม่เหลือให้ html2canvas ตัดเอง',
         r.brs === r.domLines - 1, r.brs + ' จุดตัด / ' + r.domLines + ' บรรทัด');
      ok('จำนวนบรรทัดเท่าเดิม ไม่งอกไม่หาย',
         r.newLines === r.domLines, r.newLines + ' -> ' + r.domLines);
      ok('บรรทัดอยู่ตำแหน่งเดิม ไม่ขยับ',
         r.topShift >= 0 && r.topShift <= 1, 'ขยับมากสุด ' + r.topShift + 'px');
    } else {
      ok('บรรทัดเดียวไม่ต้องแตะ ปล่อยไว้อย่างเดิม', r.brs === 0, r.brs + ' จุดตัด');
    }
    ok('ความสูงเซลล์ไม่เปลี่ยน', Math.abs(r.cellShift) <= 1, r.cellShift + 'px');
    ok('ความสูงทั้งหน้าไม่เปลี่ยน เอกสารไม่ยาวขึ้นจนล้น',
       Math.abs(r.pageShift) <= 1, r.pageShift + 'px');
    console.log('');
  }

  ok('ไม่มี JavaScript error ตลอดการทดสอบ', pageErrors.length === 0, pageErrors.slice(0,2).join(' | '));

  console.log('');
  console.log('══════════════════════════════════════════════════');
  console.log('  ผ่าน ' + results.filter(Boolean).length + ' / ' + results.length);
  console.log('══════════════════════════════════════════════════');
  process.exitCode = results.every(Boolean) ? 0 : 1;
} catch (e) { console.error('ล้มเหลว:', e.message); process.exitCode = 2; }
finally { try { ws.close(); } catch {} chrome.kill(); }
