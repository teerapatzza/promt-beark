// ใบรับรองค่าพาหนะ: เนื้อหาต้องไม่กว้างเกินหน้ากระดาษ
//
// 26 พ.ย. 2569 — พี่ดิว (สรพ.) แจ้งว่า PDF ของ พญ.เอกจิตรา สุขกุล "หน้ามันตัดไป"
// เปิดไฟล์จริงดูแล้วคอลัมน์ "จำนวนเงิน" ทั้งคอลัมน์หายไปจากขอบขวา
//
// วัดบน production ตอนนั้นได้ว่า หน้ากระดาษกว้าง 718 px แต่ตารางกว้าง 833 px
// = ล้นออกนอกหน้า 115 px (16%) html2canvas เลยตัดทิ้ง
//
// ต้นเหตุคือที่อยู่ในใบนั้นยาวผิดปกติ เพราะผู้ใช้พิมพ์ที่อยู่ทั้งก้อน
// รวมคำบอกทาง ("ขวามือจากปากซอย...") ลงช่อง "เลขที่" ช่องเดียว
// และบรรทัดที่อยู่ตั้ง white-space:nowrap ไว้ (กันบั๊กตัวหนังสือซ้อนของ 2.30.3)
// จึงตัดบรรทัดไม่ได้ ดันความกว้างตารางทะลุขอบ
//
// วิธีแก้: ไม่แตะ nowrap เลย แต่ให้ fitCertificatePages() ซึ่งย่อฟอนต์
// ให้พอดีหน้าอยู่แล้ว ดู "ความกว้าง" ด้วย ไม่ใช่ดูแต่ความสูงอย่างเดียว
//
//   cd public && python -m http.server 8211 --bind 127.0.0.1
//   APP_URL=http://127.0.0.1:8211 node scripts/test-receipt-page-width.mjs
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9672, PROFILE = 'C:/Users/teerapat/AppData/Local/Temp/pb-rcwidth';
const APP = process.env.APP_URL || 'http://127.0.0.1:8099';

/* ขึ้นบรรทัดใหม่แบบไม่ต้องเขียน escape ในสตริง
   เครื่องมือแก้ไฟล์ของสภาพแวดล้อมนี้เคยทำ \n ในสตริงพังมาหลายครั้ง */
const NEWLINE = String.fromCharCode(10);

const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=' + PORT,
  '--user-data-dir=' + PROFILE, '--no-first-run', '--disable-gpu',
  '--window-size=1400,1200', 'about:blank'], { stdio: 'ignore' });

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
const ok = (n, pass, d) => { results.push(pass);
  console.log((pass ? '  ผ่าน  ' : '  ตก    ') + n + (d ? '  -> ' + d : '')); };

/** ใบเบิกจำลอง — เปลี่ยนเฉพาะที่อยู่ ส่วนอื่นเหมือนกันทุกใบ */
const mk = addr => ({
  id: 9509, requestedBy: 'ทดสอบ ความกว้าง', amount: 148, date: '2026-11-26',
  inputMetadata: {
    _pdfTemplates: ['TRANSPORT_RECEIPT'], _activityName: 'สัมมนา', _extraActivities: [],
    _position: 'รองผู้อำนวยการสถาบัน', _affiliation: 'สรพ.', _docDate: '2026-11-25',
    _addr: addr, _carType: 'ไป-กลับ', _fuelMethod: 'distance',
    _travel: { startDate: '2026-11-26', endDate: '2026-11-26', from: 'ที่พัก',
      to: 'โรงแรมมิราเคล แกรนด์ คอนเวนชั่น', distOut: '14.8', distRet: '14.8' },
    _costs: { hotelEntries: [], fuelRate: '5', taxiEntries: [],
      airAmount: 0, tollAmount: 0, parkingAmount: 0, otherAmount: 0 }
  }
});

// ที่อยู่ของใบจริงที่พี่ดิวแจ้ง (ยาวผิดปกติ)
const LONG = { no: 'เลขที่ 64/129 Allis Condo อาคาร A ขวามือจากปากซอยติวานนท์Y 14/2 ต.ตลาดขวัญ อ.เมืองนนทบุรี จ.นนทบุรี 11000',
               soi: '', road: '', sub: 'ตลาดขวัญ', dist: 'เมืองนนทบุรี', prov: 'นนทบุรี', zip: '11000' };
// ที่อยู่ความยาวปกติ — ใบแบบนี้ห้ามถูกย่อ ต้องคงขนาดเดิมเป๊ะ
const SHORT = { no: '141/36', soi: 'สุขสวัสดิ์ 55', road: 'สุขสวัสดิ์',
                sub: 'บางปะกอก', dist: 'ราษฎร์บูรณะ', prov: 'กรุงเทพมหานคร', zip: '10140' };

/* วางเอกสารลงหน้าจริง แล้วเรียก fitCertificatePages ตามลำดับเดียวกับตอนสร้าง PDF จริง
   จากนั้นวัดว่าตารางยังล้นขอบหน้าไหม */
const MEAS = [
  "window.renderRouteMapImage = async () => null;",
  "async function meas(rec){",
  "  const b = await buildDocumentHtml(rec, function(){});",
  "  const host=document.createElement('div');",
  "  host.id='__wtest'; host.style.cssText='position:absolute;left:-99999px;top:0;background:#fff;';",
  "  host.innerHTML=(b&&b.html)||''; document.body.appendChild(host);",
  "  let fit={shrunk:0,overflow:[]};",
  "  try { fit = fitCertificatePages(host); } catch(e) { fit={shrunk:-1,overflow:[],err:String(e&&e.message)}; }",
  "  const pg=host.querySelector('.pdf-page');",
  "  const tb=pg?pg.querySelector('.rc-table'):null;",
  "  const cs=pg?getComputedStyle(pg):null;",
  "  const inner = pg ? (pg.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)) : 0;",
  "  const tw = tb?tb.getBoundingClientRect().width:0;",
  "  const o={ shrunk:fit.shrunk, err:fit.err||'',",
  "            inner:Math.round(inner), tableW:Math.round(tw),",
  "            over:Math.round(tw-inner),",
  "            fontSize: tb?getComputedStyle(tb).fontSize:'',",
  "            overflowReport: JSON.stringify(fit.overflow||[]) };",
  "  host.remove(); return o;",
  "}"
].join(NEWLINE);

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
  await send('Page.addScriptToEvaluateOnNewDocument', { source: [
    "localStorage.setItem('token','x');",
    "const of = window.fetch;",
    "window.fetch = function (u, i) {",
    "  const s = (typeof u === 'string') ? u : (u && u.url) || '';",
    "  if (s.indexOf('/auth/me') >= 0) return Promise.resolve(new Response(",
    "    JSON.stringify({id:1,email:'t@ha.or.th',name:'ทดสอบ',role:'admin'}),",
    "    {status:200, headers:{'Content-Type':'application/json'}}));",
    "  if (s.indexOf('/budget-categories') >= 0) return Promise.resolve(new Response(",
    "    JSON.stringify([{ id:'TRAVEL001', name:'ทดสอบ',",
    "      pdfTemplates:['TRANSPORT_RECEIPT'], attachmentRules:{}, attachmentOrder:[] }]),",
    "    {status:200, headers:{'Content-Type':'application/json'}}));",
    "  if (s.indexOf('/expenses') >= 0 || s.indexOf('/profiles') >= 0)",
    "    return Promise.resolve(new Response('[]',{status:200,headers:{'Content-Type':'application/json'}}));",
    "  return of(u, i);",
    "};"
  ].join(NEWLINE) });
  await send('Page.navigate', { url: APP + '/history.html' }); await sleep(6000);

  console.log('=== 1. ที่อยู่ยาวผิดปกติ (ใบจริง พญ.เอกจิตรา) ต้องไม่ล้นขอบหน้า ===');
  const L = await ev(MEAS + NEWLINE + 'return await meas(' + JSON.stringify(mk(LONG)) + ');');
  if (L.err) console.log('    (fitCertificatePages โยน error: ' + L.err + ')');
  ok('ตารางไม่กว้างเกินพื้นที่ในหน้า', L.over <= 1,
     'พื้นที่ ' + L.inner + ' px · ตาราง ' + L.tableW + ' px · ล้น ' + L.over + ' px');
  ok('ระบบย่อฟอนต์ให้เองอย่างน้อย 1 ขั้น', L.shrunk >= 1, 'ย่อ ' + L.shrunk + ' ขั้น เหลือ ' + L.fontSize);
  ok('ยังอ่านออก ไม่ย่อจนต่ำกว่า 9px', parseFloat(L.fontSize) >= 9, L.fontSize);

  console.log('');
  console.log('=== 2. ที่อยู่ความยาวปกติ ต้องไม่ถูกแตะเลย ===');
  const S = await ev(MEAS + NEWLINE + 'return await meas(' + JSON.stringify(mk(SHORT)) + ');');
  ok('ไม่ล้นอยู่แล้ว', S.over <= 1,
     'พื้นที่ ' + S.inner + ' px · ตาราง ' + S.tableW + ' px');
  ok('ไม่ถูกย่อแม้แต่ขั้นเดียว', S.shrunk === 0, 'ย่อ ' + S.shrunk + ' ขั้น');
  ok('ฟอนต์ยังเป็นขนาดเดิม 13.5px', parseFloat(S.fontSize) >= 13.5, S.fontSize);

  console.log('');
  ok('ไม่มี JavaScript error ตลอดการทดสอบ', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '));

  console.log('');
  console.log('══════════════════════════════════════════════════');
  console.log('  ผ่าน ' + results.filter(Boolean).length + ' / ' + results.length);
  console.log('══════════════════════════════════════════════════');
  process.exitCode = results.every(Boolean) ? 0 : 1;
} catch (e) { console.error('ล้มเหลว:', e.message); process.exitCode = 2; }
finally { try { ws.close(); } catch {} chrome.kill(); }
