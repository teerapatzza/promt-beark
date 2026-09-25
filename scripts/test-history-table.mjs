// ตรวจตารางหน้าประวัติ: ชื่อกิจกรรมยาวต้องไม่ดันปุ่มออกนอกจอ
//
// ที่มา: ผู้ใช้แจ้งว่าพอชื่อกิจกรรมยาว ต้องเลื่อนไปทางขวาไกลมากกว่าจะเจอปุ่ม PDF
// เพราะตารางตั้ง whitespace-nowrap ไว้ ความกว้างจึงยืดตามข้อความที่ยาวที่สุด
//
//   cd public && python3 -m http.server 8099 --bind 127.0.0.1
//   node scripts/test-history-table.mjs
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9571, PROFILE = 'C:/Users/teerapat/AppData/Local/Temp/pb-hist';
const APP = process.env.APP_URL || 'http://127.0.0.1:8099';

const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=' + PORT,
  '--user-data-dir=' + PROFILE, '--no-first-run', '--disable-gpu',
  '--window-size=1440,1000', 'about:blank'], { stdio: 'ignore' });
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

const LONG = 'การอบรมเชิงปฏิบัติการเพื่อพัฒนาระบบการดูแลผู้ป่วยด้วยมิติจิตวิญญาณ '
           + 'ในสถานพยาบาลเพื่อความปลอดภัย โรงพยาบาลสมเด็จพระยุพราชด่านซ้าย จ.เลย วันที่ 11 กันยายน 2569';
const REC = n => ({
  id: 9400 + n, requestedBy: 'ทดสอบ ตารางยาว', amount: 1234.5,
  date: '2026-09-11', description: 'เบิกค่าเดินทางไปปฏิบัติงาน',
  inputMetadata: { _activityName: n === 0 ? LONG : 'ประชุมสั้น ๆ', _pdfTemplates: ['REPORT'] }
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
    if (m.id && pending.has(m.id)) { const { r, j } = pending.get(m.id); pending.delete(m.id);
      m.error ? j(new Error(m.error.message)) : r(m.result); return; }
    if (m.method === 'Runtime.exceptionThrown')
      pageErrors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
    if (m.method === 'Page.javascriptDialogOpening') send('Page.handleJavaScriptDialog', { accept: true }); });
  await send('Page.enable'); await send('Runtime.enable');
  // ปิดแคชของเบราว์เซอร์ ไม่งั้นโปรไฟล์ที่ใช้ซ้ำจะเสิร์ฟไฟล์เก่าจากดิสก์
  // แล้วผลทดสอบจะเป็นของโค้ดรุ่นก่อนโดยไม่มีใครรู้
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Page.addScriptToEvaluateOnNewDocument', { source: [
    "localStorage.setItem('token','x');",
    "const of = window.fetch;",
    "window.fetch = function (u,i) { const s=(typeof u==='string')?u:(u&&u.url)||'';",
    "  if (s.indexOf('/auth/me')>=0) return Promise.resolve(new Response(",
    "    JSON.stringify({id:1,email:'t@ha.or.th',name:'ทดสอบ',role:'admin'}),",
    "    {status:200,headers:{'Content-Type':'application/json'}}));",
    "  if (s.indexOf('/expenses')>=0||s.indexOf('/budget-categories')>=0||s.indexOf('/profiles')>=0)",
    "    return Promise.resolve(new Response('[]',{status:200,headers:{'Content-Type':'application/json'}}));",
    "  return of(u,i); };"
  ].join('\n') });
  await send('Page.navigate', { url: APP + '/history.html' }); await sleep(4500);

  const r = await ev([
    "raw = [" + [0, 1, 2].map(n => JSON.stringify(REC(n))).join(',') + "];",
    "draw();",
    "await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));",
    "const scroller = document.querySelector('.overflow-x-auto');",
    "const table = scroller.querySelector('table');",
    "const rows = [...table.querySelectorAll('tbody tr')];",
    "const firstRow = rows[0];",
    "const actCell = firstRow.children[3].querySelector('div');",
    "const pdfBtn = [...firstRow.querySelectorAll('button')].find(b => /PDF/.test(b.textContent));",
    "const actionTd = firstRow.children[6];",
    "const sr = scroller.getBoundingClientRect(), br = pdfBtn.getBoundingClientRect();",
    "return {",
    "  rows: rows.length,",
    "  scrollW: Math.round(scroller.scrollWidth), clientW: Math.round(scroller.clientWidth),",
    "  needScroll: scroller.scrollWidth - scroller.clientWidth,",
    "  btnRight: Math.round(br.right), boxRight: Math.round(sr.right),",
    "  btnVisible: br.right <= sr.right + 1 && br.left >= sr.left - 1,",
    "  actTruncated: actCell.scrollWidth > actCell.clientWidth,",
    "  actTitle: (firstRow.children[3].querySelector('[title]')||{}).title || '',",
    "  sticky: getComputedStyle(actionTd).position",
    "};"
  ].join('\n'));

  console.log('═══ ชื่อกิจกรรมยาว ' + LONG.length + ' ตัวอักษร บนจอกว้าง 1440 ═══');
  ok('วาดตารางได้ครบทุกแถว', r.rows === 3, r.rows + ' แถว');
  ok('ตารางไม่กว้างเกินจอจนต้องเลื่อน',
     r.needScroll <= 1, 'ต้องเลื่อน ' + r.needScroll + 'px (กว้าง ' + r.scrollW + ' จอ ' + r.clientW + ')');
  ok('ปุ่ม PDF อยู่ในจอ กดได้เลยโดยไม่ต้องเลื่อน',
     r.btnVisible === true, 'ขอบปุ่ม ' + r.btnRight + ' ขอบตาราง ' + r.boxRight);
  ok('ชื่อกิจกรรมยาวถูกตัดด้วย ... ไม่ดันตาราง', r.actTruncated === true);
  ok('ข้อความเต็มยังอ่านได้จากการชี้เมาส์', r.actTitle.length > 100, r.actTitle.length + ' ตัวอักษร');
  ok('คอลัมน์ปุ่มถูกตรึงไว้ขอบขวา เผื่อจอแคบ', r.sticky === 'sticky', r.sticky);

  // จอแคบ ต้องยังกดปุ่มได้เพราะคอลัมน์ถูกตรึง
  await send('Emulation.setDeviceMetricsOverride', { width: 760, height: 900, deviceScaleFactor: 1, mobile: false });
  await sleep(600);
  const narrow = await ev([
    "const scroller = document.querySelector('.overflow-x-auto');",
    "scroller.scrollLeft = 0;",
    "await new Promise(r => requestAnimationFrame(r));",
    "const firstRow = scroller.querySelectorAll('tbody tr')[0];",
    "const pdfBtn = [...firstRow.querySelectorAll('button')].find(b => /PDF/.test(b.textContent));",
    "const sr = scroller.getBoundingClientRect(), br = pdfBtn.getBoundingClientRect();",
    "return { visible: br.right <= sr.right + 1, btnRight: Math.round(br.right), boxRight: Math.round(sr.right) };"
  ].join('\n'));
  console.log('');
  console.log('═══ จอแคบ 760px (ยังไม่เลื่อนแนวนอน) ═══');
  ok('ปุ่ม PDF ยังเห็นและกดได้ เพราะคอลัมน์ถูกตรึงขอบขวา',
     narrow.visible === true, 'ขอบปุ่ม ' + narrow.btnRight + ' ขอบตาราง ' + narrow.boxRight);

  ok('ไม่มี JavaScript error', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '));

  console.log('');
  console.log('══════════════════════════════════════════════════');
  console.log('  ผ่าน ' + results.filter(Boolean).length + ' / ' + results.length);
  console.log('══════════════════════════════════════════════════');
  process.exitCode = results.every(Boolean) ? 0 : 1;
} catch (e) { console.error('ล้มเหลว:', e.message); process.exitCode = 2; }
finally { try { ws.close(); } catch {} chrome.kill(); }
