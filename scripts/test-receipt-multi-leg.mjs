/* ใบรับรองค่าพาหนะต้องกางแถวตามจำนวนขาที่เบิกจริง
 *
 * 10 พ.ย. 2569 — เจ้าของงานต้องการเบิกในใบเดียวว่า
 *   9 พ.ย.  บ้าน -> รพ. -> บ้าน
 *   10 พ.ย. บ้าน -> รพ. -> บ้าน      รวม 4 ขา
 * และสั่งให้ออกเป็นใบรับรองใบเดียวกางแถว ไม่แยกเป็นหลายใบ
 *
 * สองเรื่องที่ต้องจับ
 *   1. ต้องมีครบ 4 บรรทัดเส้นทางบนใบ ไม่ใช่แค่ 2
 *   2. ต้องไม่ตกหน้า A4 — rcTableSize เดิมนับเฉพาะแถว Taxi
 *      ค่าน้ำมัน 1 ขากิน 2 แถว 4 ขาจึงเพิ่มมา 4 แถวที่ตัวนับมองไม่เห็นเลย
 *      ถ้าไม่แก้ตัวนับ ใบจะล้นเงียบ ๆ โดยไม่มีใครรู้
 *
 * ความสูงวัดจาก .pdf-page ในหน้า history.html จริง (มี CSS ครบ) ไม่ใช่ div ลอย
 *
 * รัน: cd public && python -m http.server 8099 --bind 127.0.0.1 &
 *      node scripts/test-receipt-multi-leg.mjs
 */
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9562, PROFILE = 'C:/Users/teerapat/AppData/Local/Temp/pb-multileg';
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

const RP = 'โรงพยาบาลสงขลานครินทร์';

const mk = travel => ({
  id: 9300, requestedBy: 'ทดสอบ หลายขา', amount: 240,
  category: 'TRAVEL002', date: '2026-11-10',
  inputMetadata: {
    _pdfTemplates: ['TRANSPORT_RECEIPT'],
    _activityName: 'กิจกรรมการเยี่ยมสำรวจ', _extraActivities: [],
    _position: 'ที่ปรึกษา', _affiliation: 'อิสระ', _docDate: '2026-11-10',
    _addr: { no: '141/36', soi: '', road: '', sub: 'บางปะกอก', dist: 'ราษฎร์บูรณะ', prov: 'กรุงเทพมหานคร', zip: '' },
    _carType: 'ไป-กลับ',
    _travel: travel,
    _costs: { hotelEntries: { entries: [] }, fuelRate: '5', taxiEntries: [],
              airAmount: 0, tollAmount: 0, parkingAmount: 0, otherAmount: 0 }
  }
});

/* ใบเก่า 2 ขา — ตัวตั้งต้น ต้องหน้าตาเท่าเดิมเสมอ */
const TWO = mk({
  startDate: '2026-11-09', endDate: '2026-11-09',
  from: 'บ้าน', to: RP, distOut: '12', distRet: '12'
});

/* ใบใหม่ 4 ขา ข้าม 2 วัน */
const FOUR = mk({
  startDate: '2026-11-09', endDate: '2026-11-10',
  from: 'บ้าน', to: RP,
  legs: [
    { dir: 'ขาไป',   date: '2026-11-09', from: 'บ้าน', to: RP, km: 12 },
    { dir: 'ขากลับ', date: '2026-11-09', from: RP, to: 'บ้าน', km: 12 },
    { dir: 'ขาไป',   date: '2026-11-10', from: 'บ้าน', to: RP, km: 12 },
    { dir: 'ขากลับ', date: '2026-11-10', from: RP, to: 'บ้าน', km: 12 }
  ]
});

/* ใบหนัก ๆ — 8 ขา + Taxi 3 เที่ยว เอาไว้หาเพดานจริง ไม่ใช่เดา */
const HEAVY = mk({
  startDate: '2026-11-09', endDate: '2026-11-12',
  from: 'บ้าน', to: RP,
  legs: Array.from({ length: 8 }, (_, i) => ({
    dir: i % 2 ? 'ขากลับ' : 'ขาไป',
    date: '2026-11-0' + (9 + Math.floor(i / 2)),
    from: i % 2 ? RP : 'บ้าน', to: i % 2 ? 'บ้าน' : RP, km: 12
  }))
});

const buildAndMeasure = rec => [
  'const b = await buildDocumentHtml(' + JSON.stringify(rec) + ', function(){});',
  'const html = (b && b.html) || (typeof b === "string" ? b : "");',
  /* ต้องต่อเข้าหน้าจริงเพื่อให้ CSS ของ .pdf-page มีผล วัดจาก div ลอยจะได้เลขมั่ว */
  'const box = document.createElement("div");',
  'box.style.cssText = "position:absolute;left:-99999px;top:0;width:900px;";',
  'box.innerHTML = html; document.body.appendChild(box);',
  'const pg = box.querySelector(".pdf-page");',
  'const h = pg ? pg.getBoundingClientRect().height : 0;',
  'const w = pg ? pg.getBoundingClientRect().width : 0;',
  'const fs = pg ? (pg.querySelector("table") ? getComputedStyle(pg.querySelector("table")).fontSize : "") : "";',
  'box.remove();',
  'return { html: html, h: Math.round(h), w: Math.round(w), fs: fs };'
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
  await send('Page.addScriptToEvaluateOnNewDocument', { source: [
    "localStorage.setItem('token','x');",
    "const of = window.fetch;",
    "window.fetch = function (u,i) { const s=(typeof u==='string')?u:(u&&u.url)||'';",
    "  if (s.indexOf('/auth/me')>=0) return Promise.resolve(new Response(",
    "    JSON.stringify({id:1,email:'t@ha.or.th',name:'ทดสอบ',role:'admin'}),",
    "    {status:200,headers:{'Content-Type':'application/json'}}));",
    "  if (s.indexOf('/expenses')>=0||s.indexOf('/profiles')>=0)",
    "    return Promise.resolve(new Response('[]',{status:200,headers:{'Content-Type':'application/json'}}));",
    "  return of(u,i); };"
  ].join('\n') });
  await send('Page.navigate', { url: APP + '/history.html' }); await sleep(5000);
  await ev("window.renderRouteMapImage = async () => null; return 1;");

  const two  = await ev(buildAndMeasure(TWO));
  const four = await ev(buildAndMeasure(FOUR));
  const heavy = await ev(buildAndMeasure(HEAVY));

  console.log('\n  ── วัดความสูงจริงของ .pdf-page ──');
  console.log('    2 ขา (ใบปัจจุบัน)  สูง ' + two.h + 'px   กว้าง ' + two.w + 'px   ฟอนต์ตาราง ' + two.fs);
  console.log('    4 ขา               สูง ' + four.h + 'px   ฟอนต์ตาราง ' + four.fs);
  console.log('    8 ขา               สูง ' + heavy.h + 'px   ฟอนต์ตาราง ' + heavy.fs);
  console.log('');

  /* ── หาเพดานจริง ไม่ใช่เดา ──
     ตัวเลขนี้ใช้ตั้งด่านเตือนในฟอร์มตอนทำชั้นที่ 2
     ถ้าใครแก้ขั้นย่อฟอนต์หรือเลย์เอาต์ตาราง เทสต์นี้จะบอกทันทีว่าเพดานขยับ */
  const CAP = 1085;
  let ceiling = 0;
  console.log('  ── หาเพดานจำนวนขาที่ใส่หน้าเดียวได้ ──');
  for (const n of [2, 4, 6, 8, 10, 12, 14, 16, 18]) {
    const rec = mk({
      startDate: '2026-11-09', endDate: '2026-11-20', from: 'บ้าน', to: RP,
      legs: Array.from({ length: n }, (_, i) => ({
        dir: i % 2 ? 'ขากลับ' : 'ขาไป',
        date: '2026-11-' + String(9 + Math.floor(i / 2)).padStart(2, '0'),
        from: i % 2 ? RP : 'บ้าน', to: i % 2 ? 'บ้าน' : RP, km: 12
      }))
    });
    const m = await ev(buildAndMeasure(rec));
    const fit = m.h > 0 && m.h <= CAP;
    if (fit) ceiling = n;
    console.log('    ' + String(n).padStart(2) + ' ขา  สูง ' + String(m.h).padStart(4)
      + 'px  ฟอนต์ ' + String(m.fs).padStart(6) + '  ' + (fit ? 'ลง' : 'ล้น ' + (m.h - CAP) + 'px'));
  }
  console.log('    => เพดานที่วัดได้: ' + ceiling + ' ขา\n');
  ok('เพดานอย่างน้อย 8 ขา (พอสำหรับเบิก 4 วันไป-กลับ)', ceiling >= 8, ceiling + ' ขา');

  const countRP = h => (String(h).match(new RegExp(RP, 'g')) || []).length;

  ok('ใบ 2 ขายังมี 2 บรรทัดเส้นทางเท่าเดิม', countRP(two.html) === 2, countRP(two.html) + ' ครั้ง');
  ok('ใบ 4 ขามีครบ 4 บรรทัดเส้นทาง', countRP(four.html) === 4, countRP(four.html) + ' ครั้ง');
  ok('ใบ 4 ขามีวันที่ 10 พ.ย. ด้วย', /10 พ\.ย\./.test(four.html) || /10\/11/.test(four.html));
  ok('ใบ 4 ขาสูงกว่าใบ 2 ขา (แถวเพิ่มจริง)', four.h > two.h, two.h + ' -> ' + four.h);
  ok('ใบ 4 ขาไม่ตกหน้า A4', four.h > 0 && four.h <= 1085, four.h + 'px');

  /* ยอดรวมท้ายใบต้องนับขาที่เพิ่มมาด้วย
     4 ขา x 12 กม. x 5 บาท = 240 บาท
     ของเดิม fuelDist อ่านจาก distOut/distRet เท่านั้น ใบที่มี legs จึงได้ 0
     แล้วใบจะพิมพ์รายขาครบแต่ "รวมทั้งสิ้น" ว่าง + "ศูนย์บาทถ้วน" ซึ่งการเงินรับไม่ได้
     เคยพลาดแบบเดียวกันมาแล้ว (ดูหมายเหตุที่ history.html บรรทัด fuelTotal) */
  ok('ยอดรวมท้ายใบเป็น 240 ไม่ใช่ 0', /240\.00/.test(four.html),
     (String(four.html).match(/ศูนย์บาทถ้วน/) ? 'ได้ ศูนย์บาทถ้วน' : 'หา 240.00 ไม่เจอ'));
  ok('ไม่มีคำว่า "ศูนย์บาทถ้วน"', !/ศูนย์บาทถ้วน/.test(four.html));
  ok('ใบ 8 ขาไม่ตกหน้า A4 (ถ้าตก = เจอเพดานแล้ว)', heavy.h > 0 && heavy.h <= 1085, heavy.h + 'px');
  /* ── หน้าแผนที่: หนึ่งขาหนึ่งหน้า ──
     27 ต.ค. 2569 ผู้ตรวจเอกสารไม่รับแผนที่ที่รวมหลายขาไว้รูปเดียว
     ใบ 4 ขาจึงต้องได้ 4 หน้า เรียง 9 ไป -> 9 กลับ -> 10 ไป -> 10 กลับ */
  const GEO = { home: { lat: 13.66, lng: 100.49, label: 'บ้าน' },
                hosp: { lat: 7.00,  lng: 100.50, label: RP } };
  const FOURPIN = mk({
    startDate: '2026-11-09', endDate: '2026-11-10',
    from: 'บ้าน', to: RP, fromGeo: GEO.home, toGeo: GEO.hosp,
    legs: [
      { dir: 'ขาไป',   date: '2026-11-09', from: 'บ้าน', to: RP, fromGeo: GEO.home, toGeo: GEO.hosp, km: 12 },
      { dir: 'ขากลับ', date: '2026-11-09', from: RP, to: 'บ้าน', fromGeo: GEO.hosp, toGeo: GEO.home, km: 12 },
      { dir: 'ขาไป',   date: '2026-11-10', from: 'บ้าน', to: RP, fromGeo: GEO.home, toGeo: GEO.hosp, km: 12 },
      { dir: 'ขากลับ', date: '2026-11-10', from: RP, to: 'บ้าน', fromGeo: GEO.hosp, toGeo: GEO.home, km: 12 }
    ]
  });
  const mapped = await ev('return mapLegsOf(' + JSON.stringify(FOURPIN.inputMetadata)
    + ').map(function (l) { return l.dir + "@" + (l.date || "-"); });');
  ok('ใบ 4 ขาได้ 4 หน้าแผนที่', mapped.length === 4, JSON.stringify(mapped));
  ok('หน้าแผนที่เรียงตามวันถูก',
     JSON.stringify(mapped) === JSON.stringify(
       ['ขาไป@2026-11-09', 'ขากลับ@2026-11-09', 'ขาไป@2026-11-10', 'ขากลับ@2026-11-10']),
     JSON.stringify(mapped));

  /* ใบเก่ายังต้องได้ 2 หน้าเหมือนเดิม */
  const mappedOld = await ev('return mapLegsOf(' + JSON.stringify(
    mk({ startDate: '2026-11-09', endDate: '2026-11-09', from: 'บ้าน', to: RP,
         fromGeo: GEO.home, toGeo: GEO.hosp, distOut: '12', distRet: '12' }).inputMetadata)
    + ').map(function (l) { return l.dir; });');
  ok('ใบเก่ายังได้ 2 หน้าแผนที่เท่าเดิม',
     JSON.stringify(mappedOld) === JSON.stringify(['ขาไป', 'ขากลับ']), JSON.stringify(mappedOld));

  ok('ไม่มี error ในหน้าเว็บ', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '));
} catch (e) {
  console.error('  ตก    ' + e.message);
  results.push(false);
} finally {
  try { ws && ws.close(); } catch {}
  chrome.kill();
}

const fail = results.filter(r => !r).length;
console.log('\nผ่าน ' + results.filter(Boolean).length + '  ตก ' + fail);
process.exit(fail ? 1 : 0);
