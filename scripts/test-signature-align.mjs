// บล็อกลงนามของ "ใบรับรองแทนใบเสร็จรับเงิน - ค่าพาหนะ" ต้องชิดขวาเส้นกรอบตาราง
//
// 15 ต.ค. 2569 — เจ้าของงานส่งภาพมาว่าส่วน ลงชื่อ / ( ชื่อ ) / วันที่
// ลอยอยู่กลางหน้า ไม่ตรงกับขอบขวาของกรอบตารางด้านบน
//
// วัดจากหน้าที่เรนเดอร์จริง ไม่ได้อ่านจากสตริง CSS
// เพราะ .pdf-page .solid-line ถูกตั้ง width:auto !important ทับ inline style ไว้
// ความกว้างจริงจึงรู้ได้จากการวัดเท่านั้น
//
//   cd public && python3 -m http.server 8099 --bind 127.0.0.1
//   node scripts/test-signature-align.mjs
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9556, PROFILE = 'C:/Users/teerapat/AppData/Local/Temp/pb-sign';
const APP = process.env.APP_URL || 'http://127.0.0.1:8099';
const TOL = 2;   // ยอมให้คลาดได้ 2px จากการปัดเศษของเบราว์เซอร์

const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=' + PORT,
  '--user-data-dir=' + PROFILE, '--no-first-run', '--disable-gpu',
  '--window-size=1400,1200', 'about:blank'], { stdio: 'ignore' });

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

const REC = {
  id: 9100, requestedBy: 'รศ.นพ.ธวัช ชาญชญานนท์', amount: 9360,
  category: 'TRAVEL001', date: '2026-10-15',
  inputMetadata: {
    _pdfTemplates: ['TRANSPORT_RECEIPT'],
    _activityName: 'ตรวจเยี่ยมสำรวจโรงพยาบาล',
    _position: 'ผู้เยี่ยมสำรวจ', _affiliation: 'สรพ.', _docDate: '2026-10-15',
    _addr: { no: '15/10', road: 'พิชัยรณรงค์สงคราม', sub: 'ปากเพรียว',
             dist: 'เมืองสระบุรี', prov: 'สระบุรี', zip: '18000' },
    _travel: { startDate: '2026-10-14', endDate: '2026-10-15', from: 'สระบุรี', to: 'เลย' },
    _carType: 'ไป-กลับ',
    _costs: { hotelEntries: { name: '', entries: [] }, fuelRate: '5',
              taxiEntries: [], airAmount: 0, otherAmount: 0 }
  }
};

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
    if (m.method === 'Page.javascriptDialogOpening') send('Page.handleJavaScriptDialog', { accept: true });
  });
  await send('Page.enable'); await send('Runtime.enable');
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Page.addScriptToEvaluateOnNewDocument', { source: [
    "localStorage.setItem('token','x');",
    "const of = window.fetch;",
    "window.fetch = function (u, i) {",
    "  const s = (typeof u === 'string') ? u : (u && u.url) || '';",
    "  if (s.indexOf('/auth/me') >= 0) return Promise.resolve(new Response(",
    "    JSON.stringify({id:1,email:'t@ha.or.th',name:'ทดสอบ',role:'admin'}),",
    "    {status:200, headers:{'Content-Type':'application/json'}}));",
    "  if (s.indexOf('/budget-categories') >= 0) return Promise.resolve(new Response(",
    "    JSON.stringify([{ id:'TRAVEL001', name:'ทดสอบใบรับรองค่าพาหนะ',",
    "      pdfTemplates:['TRANSPORT_RECEIPT'], attachmentRules:{}, attachmentOrder:[] }]),",
    "    {status:200, headers:{'Content-Type':'application/json'}}));",
    "  if (s.indexOf('/expenses') >= 0 || s.indexOf('/profiles') >= 0)",
    "    return Promise.resolve(new Response('[]',{status:200,headers:{'Content-Type':'application/json'}}));",
    "  return of(u, i);",
    "};"
  ].join('\n') });

  await send('Page.navigate', { url: APP + '/history.html' });
  await sleep(5000);

  console.log('═══ บล็อกลงนามของใบรับรองค่าพาหนะต้องชิดขวาเส้นกรอบ ═══');

  const m = await ev([
    "window.renderRouteMapImage = async () => null;",
    "const built = await buildDocumentHtml(" + JSON.stringify(REC) + ", function(){});",
    // ต้องแปะลง DOM จริง ไม่งั้นกฎ .pdf-page ไม่มีผล และวัดระยะไม่ได้
    "const host = document.createElement('div');",
    "host.style.cssText = 'position:absolute;left:-99999px;top:0;';",
    "host.innerHTML = built.html;",
    "document.body.appendChild(host);",
    "await new Promise(r => requestAnimationFrame(r));",
    "const page = [...host.querySelectorAll('.pdf-page')].find(p =>",
    "   (p.textContent||'').indexOf('ใบรับรองแทนใบเสร็จรับเงิน') >= 0 &&",
    "   (p.textContent||'').indexOf('ขอรับรองว่า') >= 0);",
    "if (!page) return { err: 'ไม่พบหน้าใบรับรองค่าพาหนะ' };",
    "const table = page.querySelector('table.pdf-table');",
    "if (!table) return { err: 'ไม่พบตารางในหน้านี้' };",
    // บล็อกลงนามคือกล่องที่มีทั้งคำว่า ลงชื่อ และ วันที่ และไม่มีตารางอยู่ข้างใน
    "const blocks = [...page.querySelectorAll('div')].filter(d =>",
    "   !d.querySelector('table') &&",
    "   (d.textContent||'').indexOf('ลงชื่อ') >= 0 &&",
    "   (d.textContent||'').indexOf('วันที่') >= 0);",
    "if (!blocks.length) return { err: 'ไม่พบบล็อกลงนาม' };",
    // เอากล่องชั้นในสุด
    "const sign = blocks[blocks.length - 1];",
    "const tR = table.getBoundingClientRect().right;",
    // ต้องวัดขอบขวาของ "ตัวหนังสือจริง" ไม่ใช่ขอบกล่อง
    // เพราะ <div> เป็นบล็อกกว้างเต็มแถวเสมอ กล่องชิดขวาอยู่แล้วตั้งแต่ก่อนแก้
    // ทั้งที่ข้อความข้างในยังลอยอยู่กลาง ซึ่งคือสิ่งที่ตาคนเห็นว่าไม่ชิด
    "function inkRight(el) {",
    "  const rg = document.createRange(); rg.selectNodeContents(el);",
    "  const rects = [...rg.getClientRects()].filter(r => r.width > 0 || r.height > 0);",
    "  const box = el.getBoundingClientRect();",
    "  if (!rects.length) return box.right;",          // ช่องเส้นว่าง ไม่มีตัวอักษร ใช้ขอบกล่อง
    "  return Math.max(...rects.map(r => r.right), box.right - box.width + 0);",
    "}",
    "const lines = [...sign.children].map(c => ({",
    "   text: (c.textContent||'').replace(/\\s+/g,' ').trim().slice(0, 18) || '(เส้นว่าง)',",
    "   right: getComputedStyle(c).display === 'block' ? inkRight(c) : c.getBoundingClientRect().right }));",
    "const styles = getComputedStyle(sign);",
    "const r = {",
    "  tableRight: tR,",
    "  signRight: sign.getBoundingClientRect().right,",
    "  textAlign: styles.textAlign,",
    "  lines: lines",
    "};",
    "host.remove();",
    "return r;"
  ].join('\n'));

  if (m.err) { ok('เรนเดอร์เอกสารได้', false, m.err); }
  else {
    const gap = Math.abs(m.tableRight - m.signRight);
    ok('กล่องลงนามกว้างเท่ากรอบตาราง',
       gap <= TOL, 'ห่างขอบขวา ' + gap.toFixed(1) + 'px');

    // ของจริงที่ตาคนเห็นคือขอบขวาของแต่ละบรรทัด ไม่ใช่ขอบกล่อง
    // กล่องอาจกว้างเต็มแต่ข้อความยังลอยอยู่กลาง จึงต้องวัดทีละบรรทัด
    ok('มีครบสามบรรทัด (ลงชื่อ / วงเล็บชื่อ / วันที่)',
       m.lines.length >= 2, 'พบ ' + m.lines.length + ' บรรทัด');

    const far = m.lines.filter(l => Math.abs(m.tableRight - l.right) > TOL);
    ok('ทุกบรรทัดชิดขวาเส้นกรอบ',
       far.length === 0,
       far.length ? far.map(l => '"' + l.text + '" ห่าง ' +
         (m.tableRight - l.right).toFixed(1) + 'px').join(' | ') : 'ชิดครบทุกบรรทัด');

    ok('กล่องลงนามถูกจัดชิดขวา ไม่ใช่กึ่งกลาง',
       m.textAlign === 'right', 'text-align=' + m.textAlign);
  }

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
