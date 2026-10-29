// ตรวจว่าไม่มีข้อความในเอกสารที่ปล่อยให้ตัวแปลง PDF ตัดบรรทัดเอง
//
// ที่มา: 29 ต.ค. 2569 ผู้ใช้ส่งภาพใบรับรองค่าพาหนะแบบเหมาจ่าย (เบิก 2 ขา ๆ ละ 1,200)
// แถว "เหมาจ่ายตามช่วงระยะทาง รวมค่าทางด่วนแล้ว — ขาไป 185.4 ก.ม. (เหมาจ่ายนอกเขต กทม.ปริมณฑล) · ขากลับ ..."
// ยาวเกินหนึ่งบรรทัด บรรทัดที่สองพิมพ์ทับกันจนอ่านไม่ออก
//
// ต้นเหตุเดียวกับที่ช่องกิจกรรมเคยเป็น (test-doc-linebreaks):
// เบราว์เซอร์ตัดบรรทัดไว้แบบหนึ่ง แต่ html2canvas วางคำบนบรรทัดใหม่ผิดตำแหน่ง
// ของเดิมตรึงจุดตัดบรรทัดไว้แค่ .free-text (กิจกรรม/รายละเอียด) แถวอื่นที่ยาวเกินบรรทัดจึงยังโดน
// สแกนแล้วเจออีก: ใบเหมาจ่ายขาเดียว และรายการยาวในใบรับรองแทนใบเสร็จ – ทั่วไป
// ที่เทสต์เดิมจับไม่ได้เพราะข้อมูลทดสอบใช้ป้ายช่วงระยะสั้น ข้อความเลยไม่เคยเกินบรรทัด
//
// เกณฑ์:
//   1. หลังขั้นเตรียมเอกสารจริง ต้องไม่เหลือข้อความก้อนไหนที่กินหลายบรรทัดโดยไม่มีจุดตัดกำกับ
//   2. ตัวอักษรต้องครบเท่าเดิมทุกตัว
//   3. ความสูงของทุกหน้าต้องเท่าเดิม (ตรึงจุดตัดเดิม ไม่ใช่จัดบรรทัดใหม่)
//   4. ใบธรรมดาที่ไม่มีข้อความยาว ต้องไม่ถูกแตะเลยแม้แต่ตัวเดียว
//
//   cd public && python -m http.server 8099 --bind 127.0.0.1
//   node scripts/test-pdf-wrapped-text.mjs
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { rmSync } from 'node:fs';

const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9593, PROFILE = 'C:/Users/teerapat/AppData/Local/Temp/pb-wrapped-text';
const APP = process.env.APP_URL || 'http://127.0.0.1:8099';
try { rmSync(PROFILE, { recursive: true, force: true }); } catch {}

const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=' + PORT,
  '--user-data-dir=' + PROFILE, '--no-first-run', '--disable-gpu',
  '--window-size=1400,1000', 'about:blank'], { stdio: 'ignore' });
let ws, id = 0; const pending = new Map(); const pageErrors = [];
const send = (m, p = {}) => { const i = ++id; ws.send(JSON.stringify({ id: i, method: m, params: p }));
  return new Promise((r, j) => pending.set(i, { r, j })); };
const ev = async e => {
  const r = await send('Runtime.evaluate', { expression: '(async()=>{' + e + '})()', awaitPromise: true, returnByValue: true, timeout: 120000 });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result?.value;
};
const results = [];
const ok = (n, pass, d = '') => { results.push(pass);
  console.log((pass ? '  ผ่าน  ' : '  ตก    ') + n + (d ? '  -> ' + d : '')); };

const LONG = 'การอบรมเชิงปฏิบัติการเพื่อพัฒนาระบบการดูแลผู้ป่วยด้วยมิติจิตวิญญาณ ในสถานพยาบาลเพื่อความปลอดภัย โรงพยาบาลสมเด็จพระยุพราชด่านซ้าย จ.เลย';
const PLACE = 'โรงพยาบาลสมเด็จพระยุพราชด่านซ้าย อำเภอด่านซ้าย จังหวัดเลย';
// ป้ายช่วงระยะของจริงจากใบที่ผู้ใช้ส่งมา
const LABEL = 'เหมาจ่ายนอกเขต กทม.ปริมณฑล';

const mk = meta => ({ id: 1, requestedBy: 'ทดสอบ ตัดบรรทัด', amount: 2400, date: '2026-10-29',
  createdAt: '2026-10-29T02:00:00Z', description: 'เบิกค่าเดินทางไปปฏิบัติงาน', attachments: { images: [] },
  inputMetadata: Object.assign({
    _pdfTemplates: ['TRANSPORT_RECEIPT'], _activityName: 'กิจกรรมเยี่ยมสำรวจ',
    _position: 'ผู้เยี่ยมสำรวจ', _affiliation: 'อิสระ', _docDate: '2026-10-29',
    _addr: { no: '84/30 หมู่บ้านสราณรมย์', soi: 'วัดเวฬุวนาราม 21', road: 'วัดเวฬุวนาราม',
             sub: 'คลองหนึ่ง', dist: 'คลองหลวง', prov: 'ปทุมธานี', zip: '12120' },
    _travel: { startDate: '2026-10-07', endDate: '2026-10-09',
               from: '84/30 หมู่บ้านสราณรมย์ ซอยวัดเวฬุวนาราม 21', to: 'Kantary Hotel Ban Chang',
               distOut: '185.4', distRet: '185.4' },
    _carType: 'ไป-กลับ',
    _costs: { hotelEntries: { entries: [] }, fuelRate: '5', taxiEntries: [],
              airAmount: 0, tollAmount: 0, parkingAmount: 0, otherAmount: 0 }
  }, meta) });
const flat = dirs => ({ _fuelMethod: 'flat', _flatRate: { total: dirs.length * 1200,
  legs: dirs.map(d => ({ dir: d, km: 185.4, amount: 1200, label: LABEL })) } });

const CASES = [
  ['เหมาจ่าย 2 ขา ป้ายช่วงระยะยาว (ใบที่ผู้ใช้ส่งภาพมา)', mk(flat(['ขาไป', 'ขากลับ']))],
  ['เหมาจ่ายขาไปขาเดียว ชื่อกิจกรรมยาว', mk(Object.assign(flat(['ขาไป']), { _carType: 'ขาไป', _activityName: LONG }))],
  ['คิดตามระยะจริง ชื่อสถานที่ยาว ชื่อกิจกรรมยาว', mk({ _fuelMethod: 'distance', _activityName: LONG,
      _travel: { startDate: '2026-10-07', endDate: '2026-10-09', from: PLACE, to: PLACE, distOut: '185.4', distRet: '185.4' } })],
  ['ใบรายงาน + ใบรับรอง กิจกรรมเพิ่มเติม', mk({ _pdfTemplates: ['REPORT', 'TRANSPORT_RECEIPT'],
      _activityName: LONG, _extraActivities: [LONG], _affiliation: 'สำนักพัฒนาระบบคุณภาพและความปลอดภัยสถานพยาบาล' })],
  ['ใบรับรองแทนใบเสร็จ – ทั่วไป รายการยาว', mk({ _pdfTemplates: ['GENERAL_RECEIPT'], _activityName: LONG,
      _generalReceiptItems: [{ date: '2026-10-07', description: LONG + ' ค่าถ่ายเอกสารประกอบการประชุมและค่าเข้าเล่มรายงาน', amount: 350 }] })],
  ['Taxi 5 เที่ยว ชื่อสถานที่ยาว', mk({ _carType: 'ไม่ระบุ', _costs: { hotelEntries: { entries: [] }, fuelRate: '5',
      taxiEntries: [1, 2, 3, 4, 5].map(i => ({ date: '2026-10-0' + i, direction: 'ขาไป', from: PLACE,
        to: 'ท่าอากาศยานสุวรรณภูมิ อาคารผู้โดยสารขาออก ชั้น 4', amount: 300 })),
      airAmount: 0, tollAmount: 0, parkingAmount: 0, otherAmount: 0 } })]
];
// ใบธรรมดาที่สุด — ข้อความทุกก้อนอยู่บรรทัดเดียว ต้องไม่โดนแตะเลย
const PLAIN = mk({ _fuelMethod: 'distance',
  _travel: { startDate: '2026-10-07', endDate: '2026-10-07', from: 'บ้าน', to: 'สรพ.', distOut: '12', distRet: '12' } });

// ขั้นเตรียมเอกสารเหมือนปุ่มดาวน์โหลดจริงทุกขั้น แล้ววัดก่อน-หลังตรึงจุดตัดบรรทัด
const PREP = rec => [
  "window.renderRouteMapImage = async () => null; window.alert = () => {};",
  "const built = await buildDocumentHtml(" + JSON.stringify(rec) + ");",
  "const c = document.getElementById('pdf-container');",
  "c.innerHTML = '<div id=\"formal-doc\" style=\"background:white;color:black;margin:0;padding:0;\">' + built.html + '</div>';",
  "const el = document.getElementById('formal-doc');",
  "await waitForDocumentFonts();",
  "fitCertificatePages(el);",
  "await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));",
  "const heights = () => [...el.querySelectorAll('.pdf-page')].map(p => p.getBoundingClientRect().height);",
  "const chars = () => (el.textContent || '').replace(/\\s+/g, '');",
  // ข้อความที่กินหลายบรรทัดโดยไม่มีจุดตัดกำกับ = ปล่อยให้ html2canvas ตัดเอง
  "const loose = () => { const out = []; const rg = document.createRange();",
  "  const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);",
  "  for (let n = w.nextNode(); n; n = w.nextNode()) {",
  "    if (!n.nodeValue.trim()) continue; rg.selectNodeContents(n);",
  "    const tops = new Set([...rg.getClientRects()].filter(r => r.height > 0 && r.width > 0).map(r => Math.round(r.top)));",
  "    if (tops.size > 1) out.push(n.nodeValue.replace(/\\s+/g, ' ').trim().slice(0, 50));",
  "  } return out; };",
  "const h0 = heights(), c0 = chars(), html0 = el.innerHTML, loose0 = loose();",
  "freezeLineBreaks(el);",
  "await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));",
  "const h1 = heights(), c1 = chars(), html1 = el.innerHTML, loose1 = loose();",
  "c.innerHTML = '';",
  "return { loose0: loose0, loose1: loose1, sameChars: c0 === c1, nChars: c0.length,",
  "  h0: h0.map(Math.round), h1: h1.map(Math.round),",
  "  maxDiff: Math.max(0, ...h0.map((h, i) => Math.abs(h - (h1[i] || 0)))), samePages: h0.length === h1.length,",
  "  sameHtml: html0 === html1 };"
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
  });
  await send('Page.enable'); await send('Runtime.enable');
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Page.addScriptToEvaluateOnNewDocument', { source: [
    "localStorage.setItem('token','x');",
    "const of=window.fetch;",
    "window.fetch=function(u,i){const s=(typeof u==='string')?u:(u&&u.url)||'';",
    "  const J=(o)=>Promise.resolve(new Response(JSON.stringify(o),{status:200,headers:{'Content-Type':'application/json'}}));",
    "  if(s.indexOf('/auth/me')>=0) return J({id:1,email:'t@example.invalid',name:'t',role:'admin'});",
    "  if(s.indexOf('/settings')>=0) return J({fuelRate:5,taxiMaxPerTrip:750});",
    "  if(s.indexOf('/budget-categories')>=0) return J([]);",
    "  if(s.indexOf('/expenses')>=0||s.indexOf('/profiles')>=0||s.indexOf('/feedback')>=0) return J([]);",
    "  return of(u,i);};"
  ].join('\n') });
  await send('Page.navigate', { url: APP + '/history.html' }); await sleep(4000);

  for (const [label, rec] of CASES) {
    const r = await ev(PREP(rec));
    console.log('\n═══ ' + label + ' ═══');
    ok('ไม่เหลือข้อความที่ปล่อยให้ตัวแปลงตัดบรรทัดเอง', r.loose1.length === 0,
       'ก่อน ' + r.loose0.length + ' ก้อน -> หลัง ' + r.loose1.length + ' ก้อน'
       + (r.loose1.length ? ' เช่น "' + r.loose1[0] + '"' : ''));
    ok('ตัวอักษรครบเท่าเดิมทุกตัว', r.sameChars === true, r.nChars + ' ตัว');
    ok('ความสูงทุกหน้าเท่าเดิม', r.samePages && r.maxDiff < 0.5,
       'ก่อน ' + r.h0.join('/') + ' หลัง ' + r.h1.join('/') + ' ต่างสุด ' + r.maxDiff.toFixed(2) + 'px');
  }

  console.log('\n═══ ใบธรรมดา ข้อความสั้นทุกช่อง ═══');
  const p = await ev(PREP(PLAIN));
  ok('ไม่มีข้อความเกินบรรทัดตั้งแต่ต้น', p.loose0.length === 0, p.loose0.length + ' ก้อน');
  ok('เอกสารไม่ถูกแตะเลยแม้แต่ตัวเดียว', p.sameHtml === true);

  ok('ไม่มี JavaScript error', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '));
} catch (e) {
  console.log('  ตก    เทสต์ล้ม: ' + e.message); results.push(false);
} finally {
  try { ws?.close(); } catch {} chrome.kill();
}
const fail = results.filter(x => !x).length;
console.log('\nผ่าน ' + (results.length - fail) + '/' + results.length);
process.exit(fail ? 1 : 0);
