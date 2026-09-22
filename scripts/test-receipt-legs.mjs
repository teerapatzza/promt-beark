// ตรวจใบรับรองแทนใบเสร็จรับเงิน - ค่าพาหนะ ให้ล้อตามเอกสารต้นแบบ FM-SAM-095-00
//
//   1. วันที่ต้องอยู่บรรทัดเดียวกับขาเดินทางนั้น ไม่ลอยอยู่บรรทัดบนสุด
//   2. ขาไปใช้วันที่ "ออกเดินทาง" ขากลับใช้ "กลับถึง" ไปกลับวันเดียวก็ขึ้นวันเดียวกัน
//   3. Taxi ใช้วันที่ของรายการนั้นเอง
//   4. รถส่วนตัวมี จาก-ถึง สองบรรทัด แยกระยะทางและแยกยอดเงินรายขา
//   5. ขากลับกรอกจุดเริ่มต้นเองได้ ใบเก่าที่ไม่มีคีย์นี้ยังใช้จุดหมายขาไปเหมือนเดิม
//
// รันกับเซิร์ฟเวอร์ไฟล์สถิตก็พอ ไม่ต้องใช้ backend
//   cd public && python3 -m http.server 8099 --bind 127.0.0.1
//   node scripts/test-receipt-legs.mjs
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9559, PROFILE = 'C:/Users/teerapat/AppData/Local/Temp/pb-legs';
const APP = process.env.APP_URL || 'http://127.0.0.1:8099';

const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=' + PORT,
  '--user-data-dir=' + PROFILE, '--no-first-run', '--disable-gpu',
  '--window-size=1400,1000', 'about:blank'], { stdio: 'ignore' });
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

const mk = over => ({
  id: 9200, requestedBy: 'ทดสอบ ขาเดินทาง', amount: 2628,
  category: 'TRAVEL002', date: '2025-10-20',
  inputMetadata: Object.assign({
    _pdfTemplates: ['TRANSPORT_RECEIPT'],
    _activityName: 'กิจกรรมการเยี่ยมสำรวจ', _extraActivities: [],
    _position: 'ที่ปรึกษา', _affiliation: 'อิสระ', _docDate: '2025-10-20',
    _addr: { no: '414 หมู่ 6', soi: '', road: '', sub: 'ทุ่งใหญ่', dist: 'หาดใหญ่', prov: 'สงขลา', zip: '' },
    _carType: 'ไป-กลับ',
    _travel: { startDate: '2025-10-20', endDate: '2025-10-22',
               from: 'ที่พัก', to: 'โรงแรมออร์คิด', distOut: '331', distRet: '326' },
    _costs: { hotelEntries: { entries: [] }, fuelRate: '4', taxiEntries: [],
              airAmount: 0, tollAmount: 0, parkingAmount: 0, otherAmount: 0 }
  }, over)
});

// อ่านตารางใบค่าพาหนะออกมาเป็นแถวๆ  [วันที่, รายละเอียด, จำนวนเงิน]
const READ = rec => [
  "window.renderRouteMapImage = async () => null;",
  "const b = await buildDocumentHtml(" + JSON.stringify(rec) + ", function(){});",
  "const d = document.createElement('div'); d.innerHTML = b.html;",
  "const heads = [...d.querySelectorAll('th')].filter(h => h.textContent.indexOf('วัน เดือน ปี') >= 0);",
  "if (!heads.length) return { rows: [] };",
  "const table = heads[0].closest('table');",
  // เอาเฉพาะแถวชั้นนอก ช่อง จาก-ถึง มีตารางซ้อนอยู่ข้างใน ซึ่งไม่ใช่แถวของเอกสาร
  "const rows = [...table.tBodies[0].children].map(tr => [...tr.children]",
  "  .map(td => (td.textContent||'').replace(/\\s+/g,' ').trim()));",
  "return { rows: rows };"
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
  await send('Page.addScriptToEvaluateOnNewDocument', { source: [
    "localStorage.setItem('token','x');",
    "const of = window.fetch;",
    "window.fetch = function (u,i) { const s=(typeof u==='string')?u:(u&&u.url)||'';",
    "  if (s.indexOf('/auth/me')>=0) return Promise.resolve(new Response(",
    "    JSON.stringify({id:1,email:'t@ha.or.th',name:'ทดสอบ',role:'admin'}),",
    "    {status:200,headers:{'Content-Type':'application/json'}}));",
    "  if (s.indexOf('/budget-categories')>=0) return Promise.resolve(new Response(",
    "    JSON.stringify([{ id:'TRAVEL002', name:'ทดสอบ ใบค่าพาหนะ',",
    "      pdfTemplates:['TRANSPORT_RECEIPT'], attachmentRules:{}, attachmentOrder:[] }]),",
    "    {status:200,headers:{'Content-Type':'application/json'}}));",
    "  if (s.indexOf('/expenses')>=0||s.indexOf('/profiles')>=0)",
    "    return Promise.resolve(new Response('[]',{status:200,headers:{'Content-Type':'application/json'}}));",
    "  return of(u,i); };"
  ].join('\n') });
  await send('Page.navigate', { url: APP + '/history.html' }); await sleep(5000);

  const find = (rows, needle) => rows.find(r => r[1] && r[1].indexOf(needle) >= 0) || [];
  const rowAfter = (rows, needle) => {
    const i = rows.findIndex(r => r[1] && r[1].indexOf(needle) >= 0);
    return i >= 0 && rows[i + 1] ? rows[i + 1] : [];
  };

  // ═══ 1. ไปกลับคนละวัน ═══
  console.log('═══ 1. เดินทางไปกลับคนละวัน — วันที่ต้องตรงบรรทัดของแต่ละขา ═══');
  const A = await ev(READ(mk({
    _travel: { startDate: '2025-10-20', endDate: '2025-10-22', from: 'ที่พัก', to: 'โรงแรมออร์คิด',
               distOut: '331', distRet: '326', returnDifferent: true,
               returnFrom: 'รพ.กรุงเทพสุราษฎร์', returnTo: 'ที่พัก' } })));
  const aGo   = find(A.rows, 'ที่พัก');
  const aBack = find(A.rows, 'รพ.กรุงเทพสุราษฎร์');
  ok('บรรทัดขาไปขึ้นวันที่ออกเดินทาง', aGo[0] === '20/10/2568', 'ได้ "' + aGo[0] + '"');
  ok('บรรทัดขากลับขึ้นวันที่กลับถึง',  aBack[0] === '22/10/2568', 'ได้ "' + aBack[0] + '"');
  ok('บรรทัดแรกของตาราง (กิจกรรม) ต้องไม่มีวันที่ลอยอยู่',
     A.rows[0] && A.rows[0][0] === '', 'ได้ "' + (A.rows[0] || [])[0] + '"');

  ok('ขากลับออกจากจุดที่กรอกเอง ไม่ใช่จุดหมายขาไป',
     aBack[1] && aBack[1].indexOf('รพ.กรุงเทพสุราษฎร์') >= 0 && aBack[1].indexOf('ที่พัก') >= 0,
     aBack[1]);

  const dGo   = rowAfter(A.rows, 'โรงแรมออร์คิด');
  const dBack = rowAfter(A.rows, 'รพ.กรุงเทพสุราษฎร์');
  ok('ระยะทางและยอดเงินขาไปแยกบรรทัดของตัวเอง',
     dGo[1] && dGo[1].indexOf('331') >= 0 && dGo[2] === '1,324.00', dGo[1] + ' | ' + dGo[2]);
  ok('ระยะทางและยอดเงินขากลับแยกบรรทัดของตัวเอง',
     dBack[1] && dBack[1].indexOf('326') >= 0 && dBack[2] === '1,304.00', dBack[1] + ' | ' + dBack[2]);
  // นับเฉพาะแถวรายการ แถวสรุปท้ายตาราง (รวมทั้งสิ้น / ตัวอักษร) ใช้ colspan โดยตั้งใจ
  const detailRows = A.rows.slice(0, A.rows.findIndex(r => r.some(c => c.indexOf('รวมทั้งสิ้น') >= 0)));
  ok('ทุกแถวรายการมีสามช่อง (วันที่ / รายละเอียด / จำนวนเงิน)',
     detailRows.length === 16 && detailRows.every(r => r.length === 3),
     detailRows.length + ' แถว  ช่องไม่ครบ ' + detailRows.filter(r => r.length !== 3).length);

  // ═══ 2. ไปกลับวันเดียวกัน ═══
  console.log('');
  console.log('═══ 2. ไปกลับวันเดียวกัน — สองบรรทัดขึ้นวันเดียวกัน ═══');
  const B = await ev(READ(mk({
    _travel: { startDate: '2025-10-20', endDate: '2025-10-20', from: 'ที่พัก', to: 'โรงแรมออร์คิด',
               distOut: '331', distRet: '331' } })));
  const bGo   = find(B.rows, 'โรงแรมออร์คิด');
  const bBack = B.rows.filter(r => r[0] === '20/10/2568');
  ok('ขาไปขึ้น 20/10/2568', bGo[0] === '20/10/2568', bGo[0]);
  ok('ขากลับขึ้นวันเดียวกัน ไม่ปล่อยว่าง', bBack.length === 2, 'พบ ' + bBack.length + ' บรรทัดที่ขึ้นวันนี้');

  // ═══ 3. Taxi ═══
  console.log('');
  console.log('═══ 3. Taxi — ใช้วันที่ของรายการนั้นเอง ═══');
  const C = await ev(READ(mk({
    _carType: 'ไม่ระบุ',
    _costs: { hotelEntries: { entries: [] }, fuelRate: 0, airAmount: 0,
              tollAmount: 0, parkingAmount: 0, otherAmount: 0,
              taxiEntries: [
                { date: '2025-10-20', direction: 'ขาไป',   from: 'บ้าน',  to: 'สนามบิน', amount: 300 },
                { date: '2025-10-22', direction: 'ขากลับ', from: 'สนามบิน', to: 'บ้าน',  amount: 320 }
              ] } })));
  const cGo   = find(C.rows, 'สนามบิน');
  const cBack = C.rows.filter(r => r[0] === '22/10/2568');
  ok('บรรทัด Taxi ขาไปขึ้นวันที่ของรายการนั้น', cGo[0] === '20/10/2568', 'ได้ "' + cGo[0] + '"');
  ok('บรรทัด Taxi ขากลับขึ้นวันที่ของตัวเอง', cBack.length >= 1, 'พบ ' + cBack.length + ' บรรทัด');
  ok('ยอดค่า Taxi ลงบรรทัดของตัวเอง', cGo[2] === '300.00', 'ได้ "' + cGo[2] + '"');

  // ═══ 4. ใบเก่าที่ไม่ได้ระบุจุดเริ่มต้นขากลับ ═══
  console.log('');
  console.log('═══ 4. ใบเก่า — ขากลับยังออกจากจุดหมายขาไปเหมือนเดิม ═══');
  const D = await ev(READ(mk({
    _travel: { startDate: '2025-10-20', endDate: '2025-10-22', from: 'ที่พัก', to: 'โรงแรมออร์คิด',
               distOut: '331', distRet: '326' } })));   // ไม่มี returnDifferent เลย
    const dBackRow = D.rows.filter(r => r[0] === '22/10/2568')[0] || [];
  ok('ขากลับของใบเก่าเขียน จาก โรงแรมออร์คิด ถึง ที่พัก',
     dBackRow[1] && dBackRow[1].indexOf('โรงแรมออร์คิด') >= 0 && dBackRow[1].indexOf('ที่พัก') >= 0,
     dBackRow[1]);

  // ═══ 5. หน้าเอกสารต้องไม่ล้น A4 ═══
  console.log('');
  console.log('═══ 5. เอกสารต้องยังพอดีหน้า A4 ═══');
  const fit = await ev([
    "const b = await buildDocumentHtml(" + JSON.stringify(mk({})) + ", function(){});",
    "const host = document.createElement('div');",
    "host.style.cssText='position:fixed;left:-20000px;top:0;width:900px;';",
    "host.innerHTML = b.html; document.body.appendChild(host);",
    "await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));",
    "const ps = [...host.querySelectorAll('.pdf-page')];",
    "const w = ps[0].getBoundingClientRect().width;",
    "const limit = Math.round(287 * (w / 190));",
    "const max = Math.round(Math.max.apply(null, ps.map(p => p.getBoundingClientRect().height)));",
    "host.remove();",
    "return { max: max, limit: limit, pages: ps.length };"
  ].join('\n'));
  ok('หน้าสูงสุดยังไม่เกินหนึ่งหน้า A4',
     fit.max <= fit.limit, fit.max + 'px จากที่รับได้ ' + fit.limit + 'px');

  // ═══ 6. ฟอร์มกรอกจุดเริ่มต้นขากลับได้ ═══
  console.log('');
  console.log('═══ 6. ฟอร์มต้องมีช่อง "จุดเริ่มต้นขากลับ" และใช้งานได้ ═══');
  await send('Page.navigate', { url: APP + '/expense.html' }); await sleep(4500);
  const form = await ev([
    "const s = document.getElementById('categorySelect');",
    "s.value = 'TRAVEL002'; s.dispatchEvent(new Event('change',{bubbles:true}));",
    "await new Promise(r => setTimeout(r, 900));",
    "const inp = document.getElementById('travelReturnFrom');",
    "if (!inp) return { มี: false };",
    "const hiddenBefore = document.getElementById('returnToBox').classList.contains('hidden');",
    "const cb = document.getElementById('returnDiff');",
    "cb.checked = true; cb.dispatchEvent(new Event('change',{bubbles:true}));",
    "await new Promise(r => setTimeout(r, 500));",
    "const shown = !document.getElementById('returnToBox').classList.contains('hidden');",
    "inp.value = 'รพ.กรุงเทพสุราษฎร์'; inp.dispatchEvent(new Event('input',{bubbles:true}));",
    "const r = inp.getBoundingClientRect();",
    "return { มี: true, ซ่อนตอนแรก: hiddenBefore, โผล่เมื่อติ๊ก: shown,",
    "         ปิดอยู่: inp.disabled, กว้าง: Math.round(r.width), สูง: Math.round(r.height),",
    "         ค่าที่พิมพ์: inp.value };"
  ].join('\n'));
  ok('มีช่อง "จุดเริ่มต้นขากลับ" ในฟอร์ม', form['มี'] === true);
  ok('ซ่อนไว้ตอนยังไม่ติ๊ก "ขากลับไปที่อื่น"', form['ซ่อนตอนแรก'] === true);
  ok('ติ๊กแล้วโผล่ขึ้นมาให้กรอก', form['โผล่เมื่อติ๊ก'] === true);
  ok('พิมพ์ได้จริง ไม่ถูกปิด และกดได้',
     form['มี'] && !form['ปิดอยู่'] && form['กว้าง'] > 60 && form['สูง'] > 20
     && form['ค่าที่พิมพ์'] === 'รพ.กรุงเทพสุราษฎร์',
     form['กว้าง'] + 'x' + form['สูง']);

  ok('ไม่มี JavaScript error ตลอดการทดสอบ', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '));

  console.log('');
  console.log('══════════════════════════════════════════════════');
  console.log('  ผ่าน ' + results.filter(Boolean).length + ' / ' + results.length);
  console.log('══════════════════════════════════════════════════');
  process.exitCode = results.every(Boolean) ? 0 : 1;
} catch (e) { console.error('ล้มเหลว:', e.message); process.exitCode = 2; }
finally { try { ws.close(); } catch {} chrome.kill(); }
