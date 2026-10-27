// แผนที่ในเอกสาร: หนึ่งขาที่เบิก = แผนที่หนึ่งรูป = หนึ่งหน้า
//
// 27 ต.ค. 2569 — ผู้ตรวจเอกสารตอบกลับมาว่า "ไม่เอาไป-กลับในแผนที่เดียว"
// ไปหนึ่งเที่ยวได้หนึ่งแผนที่ ไป-กลับต้องแยกเป็นสองแผนที่ หลายเที่ยวก็เที่ยวละแผนที่
// ทั้งค่าน้ำมัน ค่า Taxi และค่าพาหนะเหมาจ่าย
//
// เจ้าของงานย้ำ "อย่าลืมกรณีเหมาจ่าย ห้ามมั่ว" — กฎที่ตรวจจากโค้ดจริงแล้ว
//   - เหมาจ่าย: ขาที่เบิกมาจาก _flatRate.legs เส้นทางมาจากเส้นทางหลัก
//     แถว Taxi ในใบเหมาจ่ายเป็นของค้างที่หน้ากรอกซ่อนไว้และไม่คิดเงิน ห้ามวาด
//     (ของจริงที่เคยวาดผิด: ใบ 202 210 216 224)
//   - คิดตามระยะ: ขาไป/ขากลับตาม _carType  Taxi ทุกแถวที่ปักหมุด แถว ไป-กลับ ได้สองขา
//     ใช้ตัวแตกขาเดียวกับบรรทัด จาก/ถึง ในใบรับรอง ลำดับ จาก ถึง ยอด ต้องตรงกัน
//   - ไม่มีขาไหนวาดได้แต่มีหมุดเส้นทางหลัก ยังได้แผนที่เส้นทางหลักหนึ่งหน้าเหมือนเดิม
//     (ใบ 133: Taxi ไม่ได้ปักหมุด ห้ามเสียแผนที่ที่เคยมี)
//
// ชุดนี้เรียก buildDocumentHtml ตัวจริง จับทุกครั้งที่มันเรียก renderRouteMapImage
// แล้วตรวจหน้าที่ได้ในเอกสาร และวาดภาพจริงบางขามานับสีเส้นกับหมุด
//
//   cd public && python3 -m http.server 8099 --bind 127.0.0.1
//   node scripts/test-leg-maps.mjs
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = JSON.parse(fs.readFileSync(path.join(HERE, 'fixtures-date-regression.json'), 'utf8'));
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const APP = process.env.APP_URL || 'http://127.0.0.1:8099';
const PORT = 9762;
const NL = String.fromCharCode(10);

const results = [];
const ok = (n, pass, d = '') => { results.push(!!pass);
  console.log((pass ? '  ผ่าน  ' : '  ตก    ') + n + (d !== '' ? '  -> ' + d : '')); };

/* พิกัดสมมติ ไม่ใช่บ้านใคร */
const A = { lat: 13.62, lng: 100.70, label: 'จุดทดสอบ บ้าน', precision: 'road' };
const B = { lat: 14.40, lng: 101.84, label: 'จุดทดสอบ ที่พัก', precision: 'search' };
const C = { lat: 14.43, lng: 101.80, label: 'จุดทดสอบ โรงพยาบาล', precision: 'search' };
const D = { lat: 16.43, lng: 102.83, label: 'จุดทดสอบ ปลายทางอื่น', precision: 'search' };
const T1 = { lat: 13.75, lng: 100.50, label: 'จุดทดสอบ ท่ารถ' };
const T2 = { lat: 13.80, lng: 100.56, label: 'จุดทดสอบ สำนักงาน' };
const OUT_PATH = [[13.62, 100.70], [13.95, 100.62], [14.35, 100.95], [14.55, 101.40], [14.40, 101.84]];
const RET_PATH = [[14.43, 101.80], [14.58, 101.38], [14.36, 100.97], [13.96, 100.64], [13.62, 100.70]];

function trip(extra) {
  return Object.assign({
    startDate: '2026-10-06', startTime: '08:00', endDate: '2026-10-08', endTime: '18:00',
    from: '1/1 ถนนทดสอบ', to: 'ที่พักทดสอบ', fromGeo: A, toGeo: B, routePath: OUT_PATH,
    returnDifferent: false, returnTo: '', returnFrom: '', returnFromGeo: null, returnGeo: null,
    returnPath: null, useAppMap: true, distanceSource: 'route',
    route: { km: 268.5 }, distOut: '268.5', distRet: '268.5'
  }, extra || {});
}
const taxi = (date, direction, from, to, fromGeo, toGeo, amt) => {
  const e = { date, direction, from, to, fromGeo, toGeo };
  if (direction === 'ไป-กลับ') { e.amountOut = amt[0]; e.amountRet = amt[1]; e.amount = amt[0] + amt[1]; }
  else e.amount = amt;
  return e;
};
function rec(meta, travel, taxiEntries) {
  return {
    id: 9100, requestedBy: 'ผู้ทดสอบ', description: 'ทดสอบ', status: 'pending', amount: 1000,
    createdAt: '2026-10-08T10:00:00.000Z', attachments: { images: [] },
    inputMetadata: Object.assign({
      _pdfTemplates: ['REPORT', 'TRANSPORT_RECEIPT'], _budgetCategoryId: 'TRAVEL001',
      _position: 'ผู้เยี่ยมสำรวจ', _activityName: 'กิจกรรมทดสอบ', _affiliation: 'หน่วยงานทดสอบ',
      _docDate: '2026-10-08', _addr: {}, _carType: 'ไม่ระบุ', _fuelMethod: 'distance',
      _travel: travel,
      _costs: { hotelEntries: { name: '', entries: [] }, fuelRate: '5', taxiEntries: taxiEntries || [],
                airAmount: 0, tollAmount: 0, parkingAmount: 0, otherAmount: 0 }
    }, meta || {})
  };
}
const flat = (dirs, veh) => ({
  _fuelMethod: 'flat', _flatVehicle: veh,
  _flatRate: { total: dirs.length * 600, legs: dirs.map(d => ({ dir: d, km: d === 'ขาไป' ? 268.5 : 271.5, amount: 600, label: '251-300 กม.' })) }
});

const STUB = [
  "localStorage.setItem('token','x');",
  "const of=window.fetch;",
  "window.fetch=function(u,i){const s=(typeof u==='string')?u:(u&&u.url)||'';",
  "  const J=(o)=>Promise.resolve(new Response(JSON.stringify(o),{status:200,headers:{'Content-Type':'application/json'}}));",
  "  if(s.indexOf('/auth/me')>=0) return J({id:1,email:'t@example.invalid',name:'t',role:'admin'});",
  "  if(s.indexOf('/settings')>=0) return J({fuelRate:5,taxiMaxPerTrip:750});",
  "  if(s.indexOf('/budget-categories')>=0) return J([]);",
  "  if(s.indexOf('/expenses')>=0||s.indexOf('/profiles')>=0||s.indexOf('/feedback')>=0) return J([]);",
  "  return of(u,i);};",
  "window.__countColor=async function(dataUrl, rgb, tol){",
  "  const img=new Image(); img.src=dataUrl; await img.decode();",
  "  const c=document.createElement('canvas'); c.width=img.width; c.height=img.height;",
  "  const x=c.getContext('2d'); x.drawImage(img,0,0);",
  "  const d=x.getImageData(0,0,c.width,c.height).data; let n=0;",
  "  for(let i=0;i<d.length;i+=4){ if(Math.abs(d[i]-rgb[0])<=tol&&Math.abs(d[i+1]-rgb[1])<=tol&&Math.abs(d[i+2]-rgb[2])<=tol) n++; }",
  "  return n; };"
].join(NL);

/* สร้างทั้งใบด้วยตัวจริง โดยแทน renderRouteMapImage ด้วยตัวจดบันทึก
   ตัวจดคืนภาพปลอมที่มีเลขลำดับ จะได้รู้ว่าหน้าไหนได้ภาพจากการเรียกครั้งไหน */
const BUILD = [
  "window.alert=function(){};",
  "if(!window.__realRender) window.__realRender=renderRouteMapImage;",
  "const calls=[]; const said=[];",
  "window.renderRouteMapImage=async function(){ calls.push(JSON.parse(JSON.stringify([...arguments]))); return 'data:image/png;base64,LEG' + calls.length; };",
  "let built; try { built=await buildDocumentHtml(R, function(t){ said.push(String(t)); }); }",
  "finally { window.renderRouteMapImage=window.__realRender; }",
  "const box=document.createElement('div'); box.innerHTML=built.html;",
  "const pages=[...box.querySelectorAll('.pdf-page[data-map-leg]')].map(function(p){",
  "  const img=p.querySelector('img');",
  "  return { kind:p.getAttribute('data-kind'), dir:p.getAttribute('data-dir'), date:p.getAttribute('data-date'),",
  "    img: img ? img.getAttribute('src') : '', imgs: p.querySelectorAll('img').length,",
  "    text: p.innerText.replace(/\\s+/g,' ') }; });",
  "const oldPages=[...box.querySelectorAll('.pdf-page')].filter(function(p){ return !p.hasAttribute('data-map-leg') && /แผนที่และเส้นทาง/.test(p.textContent); }).length;",
  "const fmt=function(iso){ return iso ? formatDateDisplay(new Date(iso+'T00:00:00')) : ''; };",
  "return { calls: calls, said: said, pages: pages, oldPages: oldPages,",
  "  dates: pages.map(function(p){ return fmt(p.date); }) };"
].join(NL);
const build = async R => ev('const R=' + JSON.stringify(R) + ';' + NL + BUILD);

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-legmaps-'));
const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=' + PORT,
  '--user-data-dir=' + profile, '--no-first-run', '--disable-gpu',
  '--window-size=1400,1000', 'about:blank'], { stdio: 'ignore' });
let ws, id = 0; const pending = new Map(); const pageErrors = [];
const send = (m, p = {}) => { const i = ++id; ws.send(JSON.stringify({ id: i, method: m, params: p }));
  return new Promise((r, j) => pending.set(i, { r, j })); };
async function ev(e) {
  const r = await send('Runtime.evaluate',
    { expression: '(async()=>{' + e + '})()', awaitPromise: true, returnByValue: true, timeout: 300000 });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result?.value;
}
const geoOf = l => l && l.geo ? l.geo.lat + ',' + l.geo.lng : '';
/* อ่านขาที่ถูกส่งให้ตัววาด เติมช่องว่างไว้ ขาที่ไม่มีจะได้อ่านเป็นค่าว่าง ไม่ทำให้เทสต์หยุดกลางทาง */
const legsOf = r => { const a = r.calls.map(c => c[0] || {}); while (a.length < 30) a.push({}); return a; };
/* เช็คทุกหน้าต้องมีหน้าอยู่จริงด้วย รายการว่างห้ามนับว่าผ่าน */
const all = (arr, fn) => arr.length > 0 && arr.every(fn);
const same = (g, P) => g && Math.abs(g.lat - P.lat) < 1e-9 && Math.abs(g.lng - P.lng) < 1e-9;

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
  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
  await send('Network.setBlockedURLs', { urls: ['*tile.openstreetmap.org*'] });
  await send('Page.addScriptToEvaluateOnNewDocument', { source: STUB });
  await send('Page.navigate', { url: APP + '/history.html' });
  for (let i = 0; i < 60; i++) {
    await sleep(500);
    const ready = await ev("return document.readyState==='complete' && typeof buildDocumentHtml==='function';").catch(() => false);
    if (ready) break;
  }

  /* ── 1. ค่าน้ำมัน ไป-กลับ ทางเดิม ── */
  console.log('── 1. ค่าน้ำมัน ไป-กลับ กลับทางเดิม ──');
  const r1 = await build(rec({ _carType: 'ไป-กลับ' }, trip()));
  ok('ไม่มีหน้าแผนที่รวมแบบเดิมเหลืออยู่', r1.oldPages === 0, r1.oldPages + ' หน้า');
  ok('ได้แผนที่ 2 หน้า', r1.pages.length === 2, r1.pages.length + ' หน้า');
  ok('เรียกวาดแผนที่ 2 ครั้ง ครั้งละขา', r1.calls.length === 2, r1.calls.length + ' ครั้ง');
  ok('แต่ละหน้ามีภาพแผนที่รูปเดียว และเป็นภาพของขานั้น',
     all(r1.pages, (p, i) => p.imgs === 1 && p.img === 'data:image/png;base64,LEG' + (i + 1)),
     r1.pages.map(p => p.imgs + ':' + p.img.slice(-4)).join(' '));
  const l1 = legsOf(r1);
  ok('หน้าแรก = ขาไป A -> B ตามเส้นทางถนนที่บันทึกไว้',
     r1.pages[0] && r1.pages[0].dir === 'ขาไป' && same(l1[0].from && l1[0].from.geo, A) && same(l1[0].to && l1[0].to.geo, B)
     && Array.isArray(l1[0].path) && l1[0].path.length === OUT_PATH.length,
     (r1.pages[0] || {}).dir + ' ' + geoOf(l1[0].from) + ' -> ' + geoOf(l1[0].to));
  ok('หน้าสอง = ขากลับ B -> A ใช้ถนนเดิมย้อนกลับ',
     r1.pages[1] && r1.pages[1].dir === 'ขากลับ' && same(l1[1].from && l1[1].from.geo, B) && same(l1[1].to && l1[1].to.geo, A)
     && Array.isArray(l1[1].path) && l1[1].path.length === OUT_PATH.length
     && l1[1].path[0][0] === OUT_PATH[OUT_PATH.length - 1][0],
     (r1.pages[1] || {}).dir + ' ' + geoOf(l1[1].from) + ' -> ' + geoOf(l1[1].to));
  ok('หัวหน้าบอก เที่ยวที่ 1 จาก 2 / เที่ยวที่ 2 จาก 2',
     /เที่ยวที่\s*1\s*จาก\s*2/.test((r1.pages[0] || {}).text) && /เที่ยวที่\s*2\s*จาก\s*2/.test((r1.pages[1] || {}).text));
  ok('บอกว่าเป็นค่าน้ำมันเชื้อเพลิง', all(r1.pages, p => p.kind === 'fuel' && p.text.includes('ค่าน้ำมันเชื้อเพลิง')));
  ok('วันที่: ขาไป = วันออกเดินทาง ขากลับ = วันกลับถึง ตรงกับใบรับรอง',
     (r1.pages[0] || {}).date === '2026-10-06' && (r1.pages[1] || {}).date === '2026-10-08'
     && all(r1.pages, (p, i) => r1.dates[i] && p.text.includes(r1.dates[i])), r1.dates.join(' / '));
  ok('ระยะทางของแต่ละขา 268.5 กม.', all(r1.pages, p => /268\.5\s*กม/.test(p.text)));
  ok('ไม่มีคำอธิบายเส้นเยื้องของแบบรวม', all(r1.pages, p => !p.text.includes('วาดเยื้อง')));
  ok('ปุ่มบอกความคืบหน้า กำลังวาดแผนที่ 2/2', r1.said.some(t => /แผนที่\s*2\s*\/\s*2/.test(t)), r1.said.filter(t => /แผนที่/.test(t)).join(' | '));

  /* ── 2. เบิกขาเดียว ── */
  console.log('');
  console.log('── 2. เบิกขาไปอย่างเดียว / ขากลับอย่างเดียว ──');
  const r2 = await build(rec({ _carType: 'ขาไป' }, trip()));
  ok('ขาไปอย่างเดียว: 1 หน้า เป็นขาไป', r2.pages.length === 1 && r2.pages[0].dir === 'ขาไป', r2.pages.map(p => p.dir).join(','));
  const r2b = await build(rec({ _carType: 'ขากลับ' }, trip()));
  ok('ขากลับอย่างเดียว: 1 หน้า เป็นขากลับ', r2b.pages.length === 1 && r2b.pages[0].dir === 'ขากลับ', r2b.pages.map(p => p.dir).join(','));
  const r2c = await build(rec({ _carType: 'ขาไป' }, trip({ returnDifferent: true, returnFrom: 'รพ.', returnFromGeo: C, returnPath: RET_PATH, distRet: '271.5' })));
  ok('ขากลับคนละที่แต่ไม่ได้เบิกขากลับ: ไม่มีหน้าขากลับ', r2c.pages.length === 1 && r2c.pages[0].dir === 'ขาไป', r2c.pages.map(p => p.dir).join(','));
  /* ใบเก่าที่ไม่มีวันเดินทาง (ของจริง 69 70 74 83 85 86 109) */
  const r2d = await build(rec({ _carType: 'ไป-กลับ' }, trip({ startDate: '', endDate: '' }),
    [taxi('2026-10-07', 'ขาไป', 'ท่ารถ', 'สำนักงาน', T1, T2, 90)]));
  ok('ใบไม่มีวันเดินทาง: ขาไปหน้าแรก ขากลับหน้าสุดท้าย Taxi อยู่กลาง',
     r2d.pages.map(p => p.kind + ':' + p.dir).join(' ') === 'fuel:ขาไป taxi:ขาไป fuel:ขากลับ',
     r2d.pages.map(p => p.kind + ':' + p.dir).join(' '));
  ok('ใบไม่มีวันเดินทาง: ไม่พิมพ์วันที่มั่ว', r2d.pages.length === 3 && !r2d.pages[0].date && !r2d.pages[2].date
     && r2d.pages.every(p => !/Invalid|NaN|undefined/.test(p.text)));

  /* ── 3. ขากลับออกจากที่อื่น (ใบที่ถูกตีกลับ: ของจริง 110 132 161) ── */
  console.log('');
  console.log('── 3. ขากลับออกจากโรงพยาบาล กลับบ้าน (ปลายทางขากลับว่าง) ──');
  const r3 = await build(rec({ _carType: 'ไป-กลับ' }, trip({
    returnDifferent: true, returnFrom: 'โรงพยาบาลทดสอบ', returnFromGeo: C, returnPath: RET_PATH, distRet: '271.5' })));
  const l3 = legsOf(r3);
  ok('ได้ 2 หน้า', r3.pages.length === 2, r3.pages.length);
  ok('ขากลับเริ่มที่โรงพยาบาล จบที่บ้าน ตามเส้นทางที่บันทึก',
     same(l3[1] && l3[1].from && l3[1].from.geo, C) && same(l3[1] && l3[1].to && l3[1].to.geo, A)
     && Array.isArray(l3[1] && l3[1].path) && l3[1].path[0][0] === RET_PATH[0][0],
     l3[1] ? geoOf(l3[1].from) + ' -> ' + geoOf(l3[1].to) : 'ไม่มี');
  ok('หน้าขากลับเขียนชื่อโรงพยาบาลและระยะ 271.5', r3.pages[1] && r3.pages[1].text.includes('จุดทดสอบ โรงพยาบาล') && /271\.5\s*กม/.test(r3.pages[1].text));
  ok('หน้าขาไปยังเป็น 268.5', r3.pages[0] && /268\.5\s*กม/.test(r3.pages[0].text));

  console.log('');
  console.log('── 3b. ขากลับออกจากที่อื่น และไปจบที่อื่น ──');
  const r3b = await build(rec({ _carType: 'ไป-กลับ' }, trip({
    returnDifferent: true, returnFrom: 'โรงพยาบาลทดสอบ', returnFromGeo: C, returnTo: 'ปลายทางอื่น', returnGeo: D,
    returnPath: [[14.43, 101.80], [15.70, 102.40], [16.43, 102.83]], distRet: '280.2' })));
  const l3b = legsOf(r3b);
  ok('ขากลับ C -> D', same(l3b[1] && l3b[1].from && l3b[1].from.geo, C) && same(l3b[1] && l3b[1].to && l3b[1].to.geo, D));
  ok('หน้าขากลับเขียนทั้งสองที่ และ 280.2', r3b.pages[1] && r3b.pages[1].text.includes('จุดทดสอบ โรงพยาบาล')
     && r3b.pages[1].text.includes('จุดทดสอบ ปลายทางอื่น') && /280\.2\s*กม/.test(r3b.pages[1].text));

  /* ── 4. เหมาจ่าย ── */
  console.log('');
  console.log('── 4. ค่าพาหนะเหมาจ่าย ──');
  const r4 = await build(rec(Object.assign({ _carType: 'ไป-กลับ' }, flat(['ขาไป', 'ขากลับ'], 'car')), trip({ distRet: '271.5' })));
  ok('เหมาจ่ายรถส่วนตัว ไป-กลับ: 2 หน้า ขาไป แล้ว ขากลับ',
     r4.pages.length === 2 && r4.pages[0].dir === 'ขาไป' && r4.pages[1].dir === 'ขากลับ', r4.pages.map(p => p.dir).join(','));
  ok('บอกว่าเป็นค่าพาหนะเหมาจ่าย', all(r4.pages, p => p.kind === 'flat' && p.text.includes('เหมาจ่าย')));
  ok('ระยะของแต่ละขาตรงกับใบรับรอง 268.5 / 271.5',
     r4.pages[0] && /268\.5\s*กม/.test(r4.pages[0].text) && r4.pages[1] && /271\.5\s*กม/.test(r4.pages[1].text));

  const STALE = [taxi('2026-10-06', 'ขาไป', 'ท่ารถ', 'สำนักงาน', T1, T2, 0), taxi('2026-10-08', 'ขากลับ', 'สำนักงาน', 'ท่ารถ', T2, T1, 0)];
  const r4b = await build(rec(Object.assign({ _carType: 'ไม่ระบุ' }, flat(['ขาไป', 'ขากลับ'], 'taxi')), trip(), STALE));
  ok('เหมาจ่ายนั่ง Taxi ที่มีแถว Taxi ค้าง (แบบใบ 202 210 216 224): 2 หน้าจากเส้นทางหลัก',
     r4b.pages.length === 2, r4b.pages.length + ' หน้า');
  ok('ไม่วาดแถว Taxi ที่ค้างอยู่เลย',
     r4b.calls.every(c => !(c[0] && c[0].kind === 'taxi')) && all(r4b.pages, p => p.kind === 'flat'),
     r4b.pages.map(p => p.kind).join(','));
  const r4c = await build(rec(Object.assign({ _carType: 'ไม่ระบุ' }, flat(['ขาไป'], 'car')), trip()));
  ok('เหมาจ่ายขาไปขาเดียว (แบบใบ 160 207): 1 หน้า', r4c.pages.length === 1 && r4c.pages[0].dir === 'ขาไป', r4c.pages.map(p => p.dir).join(','));
  const r4d = await build(rec(Object.assign({ _carType: 'ไป-กลับ' }, flat(['ขาไป', 'ขากลับ'], 'car')), trip({
    returnDifferent: true, returnFrom: 'โรงพยาบาลทดสอบ', returnFromGeo: C, returnTo: 'ปลายทางอื่น', returnGeo: D,
    returnPath: [[14.43, 101.80], [15.70, 102.40], [16.43, 102.83]], distRet: '280.2' })));
  const l4d = legsOf(r4d);
  ok('เหมาจ่ายที่ขากลับคนละที่: ขากลับ C -> D', same(l4d[1] && l4d[1].from && l4d[1].from.geo, C) && same(l4d[1] && l4d[1].to && l4d[1].to.geo, D));

  /* ── 5. Taxi ── */
  console.log('');
  console.log('── 5. ค่า Taxi หลายเที่ยว ──');
  const TX = [
    taxi('2026-10-07', 'ขากลับ', 'สำนักงาน', 'ท่ารถ', T2, T1, 160),
    taxi('2026-10-06', 'ขาไป', 'ท่ารถ', 'สำนักงาน', T1, T2, 140),
    taxi('2026-10-06', 'ไป-กลับ', 'ท่ารถ', 'ที่พัก', T1, B, [150, 170]),
    taxi('2026-10-07', 'ขาไป', 'ไม่ได้ปักหมุด', 'ไม่ได้ปักหมุด', null, null, 99)
  ];
  const r5 = await build(rec({ _carType: 'ไม่ระบุ' }, trip(), TX));
  ok('Taxi 3 แถวที่ปักหมุด (หนึ่งแถว ไป-กลับ) = 4 หน้า ไม่นับแถวที่ไม่ได้ปักหมุด', r5.pages.length === 4, r5.pages.length + ' หน้า');
  ok('ไม่เบิกน้ำมัน จึงไม่มีหน้าเส้นทางหลัก', all(r5.pages, p => p.kind === 'taxi'), r5.pages.map(p => p.kind).join(','));
  ok('เรียงตามวันที่ วันเดียวกันตามลำดับที่กรอก แถว ไป-กลับ ได้ ไป แล้ว กลับ',
     r5.pages.map(p => p.date + ':' + p.dir).join(' ') === '2026-10-06:ขาไป 2026-10-06:ขาไป 2026-10-06:ขากลับ 2026-10-07:ขากลับ',
     r5.pages.map(p => p.date + ':' + p.dir).join(' '));
  const l5 = legsOf(r5);
  ok('ขากลับของแถว ไป-กลับ คือเส้นเดิมกลับหัว (ที่พัก -> ท่ารถ)',
     same(l5[2] && l5[2].from && l5[2].from.geo, B) && same(l5[2] && l5[2].to && l5[2].to.geo, T1));
  ok('ยอดของแต่ละขา 140 / 150 / 170 / 160 ตรงกับบรรทัดในใบรับรอง',
     ['140', '150', '170', '160'].every((a, i) => r5.pages[i] && new RegExp(a + '(\\.00)?\\s*บาท').test(r5.pages[i].text)),
     r5.pages.map(p => (p.text.match(/[\d,.]+\s*บาท/) || ['-'])[0]).join(' / '));
  ok('Taxi ไม่มีเส้นทางถนน ส่งเส้นทางว่างให้ตัววาด (วาดเส้นประตรง)', all(r5.calls, c => (c[0] || {}).kind === 'taxi' && !c[0].path));
  ok('หัวหน้าบอกค่า Taxi และเที่ยวที่ 4 จาก 4', all(r5.pages, p => p.text.includes('Taxi')) && /เที่ยวที่\s*4\s*จาก\s*4/.test((r5.pages[3] || {}).text));

  console.log('');
  console.log('── 5b. น้ำมันกับ Taxi ในใบเดียว ──');
  const r5b = await build(rec({ _carType: 'ไป-กลับ' }, trip(), [taxi('2026-10-07', 'ขาไป', 'ที่พัก', 'สำนักงาน', B, T2, 200)]));
  ok('น้ำมันขาไป -> Taxi -> น้ำมันขากลับ ตามวันที่',
     r5b.pages.map(p => p.kind + ':' + p.dir).join(' ') === 'fuel:ขาไป taxi:ขาไป fuel:ขากลับ',
     r5b.pages.map(p => p.kind + ':' + p.dir).join(' '));

  /* ── 6. ไม่มีขาให้วาด ── */
  console.log('');
  console.log('── 6. ใบที่ไม่มีขาให้วาด ──');
  const r6 = await build(rec({ _carType: 'ไม่ระบุ' }, trip(), [taxi('2026-10-06', 'ขาไป', 'ก', 'ข', null, null, 100)]));
  ok('Taxi ไม่ได้ปักหมุด แต่มีหมุดเส้นทางหลัก (แบบใบ 133): ยังได้แผนที่เส้นทางหลัก 1 หน้า',
     r6.pages.length === 1 && r6.pages[0].kind === 'route', r6.pages.map(p => p.kind).join(','));
  ok('หน้านี้ไม่เขียนว่าเป็นเที่ยวที่ไหน', r6.pages[0] && !/เที่ยวที่/.test(r6.pages[0].text));
  const r6b = await build(rec({ _carType: 'ไป-กลับ' }, trip({ useAppMap: false })));
  ok('ติ๊กไม่ใช้แผนที่ระบบ: ไม่มีหน้าแผนที่ และไม่เรียกวาดเลย', r6b.pages.length === 0 && r6b.calls.length === 0 && r6b.oldPages === 0);
  const r6c = await build(rec({ _carType: 'ไป-กลับ' }, trip({ fromGeo: null, toGeo: null, routePath: null })));
  ok('ไม่มีหมุดเลย: ไม่มีหน้าแผนที่', r6c.pages.length === 0 && r6c.oldPages === 0);

  /* ── 7. ใบตัวอย่างจริง 13 ใบ ── */
  console.log('');
  console.log('── 7. ใบตัวอย่างจริงทั้ง 13 ใบ: จำนวนหน้าตรงกฎ ──');
  const g = x => !!(x && isFinite(x.lat) && isFinite(x.lng));
  for (const f of FIXTURES) {
    const R = JSON.parse(JSON.stringify(f.rec)); R.id = f.id; R.createdAt = R.createdAt || f.createdAt;
    const m = R.inputMetadata || {}; const tr = m._travel || null;
    const fl = m._fuelMethod === 'flat' && m._flatRate ? m._flatRate : null;
    const car = m._carType || 'ไม่ระบุ';
    const main = !!(tr && g(tr.fromGeo) && g(tr.toGeo));
    const pinned = (((m._costs || {}).taxiEntries) || []).filter(e => e && g(e.fromGeo) && g(e.toGeo));
    let want = 0;
    if (!tr || tr.useAppMap !== false) {
      if (fl) { const ds = (fl.legs || []).map(l => l.dir); if (main) want += (ds.includes('ขาไป') ? 1 : 0) + (ds.includes('ขากลับ') ? 1 : 0); }
      else {
        if (main && (car === 'ขาไป' || car === 'ไป-กลับ')) want++;
        if (main && (car === 'ขากลับ' || car === 'ไป-กลับ')) want++;
        pinned.forEach(e => { want += e.direction === 'ไป-กลับ' ? 2 : 1; });
      }
      if (!want && main) want = 1;
    }
    const r = await build(R);
    ok('ใบ ' + f.id + ': ' + want + ' หน้า', r.pages.length === want && r.oldPages === 0
       && (!fl || r.pages.every(p => p.kind === 'flat' || p.kind === 'route')),
       r.pages.length + ' หน้า ' + r.pages.map(p => p.kind + ':' + p.dir).join(','));
  }

  /* ── 8. เคสหนักสุดที่ใบรับรองรับได้: น้ำมัน 2 ขา + Taxi 11 แถว ไป-กลับ = 24 หน้า ── */
  console.log('');
  console.log('── 8. 24 ขาในใบเดียว ──');
  const MANY = [];
  for (let i = 0; i < 11; i++) MANY.push(taxi('2026-10-07', 'ไป-กลับ', 'จุด ' + i, 'ปลาย ' + i,
    { lat: 13.7 + i * 0.01, lng: 100.5 }, { lat: 13.8 + i * 0.01, lng: 100.6 }, [100 + i, 200 + i]));
  const r8 = await build(rec({ _carType: 'ไป-กลับ' }, trip(), MANY));
  ok('ได้ครบ 24 หน้า', r8.pages.length === 24, r8.pages.length + ' หน้า');
  ok('หน้าสุดท้ายเขียน เที่ยวที่ 24 จาก 24', /เที่ยวที่\s*24\s*จาก\s*24/.test((r8.pages[23] || {}).text));
  ok('บอกความคืบหน้าถึง 24/24', r8.said.some(t => /แผนที่\s*24\s*\/\s*24/.test(t)));

  /* ── 9. วาดลงไม่สำเร็จบางขา ต้องไม่เงียบ ── */
  console.log('');
  console.log('── 9. วาดไม่สำเร็จบางขา ──');
  const r9 = await ev([
    "const R=" + JSON.stringify(rec({ _carType: 'ไป-กลับ' }, trip())) + ";",
    "if(!window.__realRender) window.__realRender=renderRouteMapImage;",
    "const alerts=[]; window.alert=function(t){ alerts.push(String(t)); };",
    "let n=0; window.renderRouteMapImage=async function(){ n++; return n===2 ? null : 'data:image/png;base64,LEG'+n; };",
    "let built; try { built=await buildDocumentHtml(R, function(){}); } finally { window.renderRouteMapImage=window.__realRender; }",
    "const box=document.createElement('div'); box.innerHTML=built.html;",
    "return { pages: box.querySelectorAll('.pdf-page[data-map-leg]').length, alerts: alerts };"
  ].join(NL));
  ok('ขาที่วาดได้ยังออกครบ (1 หน้า)', r9.pages === 1, r9.pages + ' หน้า');
  ok('แจ้งเตือนบอกว่าขาไหนขาด (ขากลับ)', r9.alerts.length === 1 && r9.alerts[0].includes('ขากลับ'), r9.alerts.join(' | ').slice(0, 120));

  /* ── 10. ภาพจริง: หนึ่งเส้น สองหมุด ── */
  console.log('');
  console.log('── 10. วาดภาพจริงทีละขา นับสีเส้นและหมุด ──');
  const BLUE = [37, 99, 235], PURPLE = [124, 58, 237], GREEN = [5, 150, 105], RED = [225, 29, 72];
  const real = async R => ev([
    "const R=" + JSON.stringify(R) + ";",
    "window.alert=function(){};",
    "if(window.__realRender) window.renderRouteMapImage=window.__realRender;",
    "const built=await buildDocumentHtml(R, function(){});",
    "const box=document.createElement('div'); box.innerHTML=built.html;",
    "const out=[];",
    "for (const p of box.querySelectorAll('.pdf-page[data-map-leg]')) { const s=p.querySelector('img').getAttribute('src');",
    "  out.push({ dir:p.getAttribute('data-dir'), kind:p.getAttribute('data-kind'),",
    "    blue: await __countColor(s," + JSON.stringify(BLUE) + ",28), purple: await __countColor(s," + JSON.stringify(PURPLE) + ",28),",
    "    green: await __countColor(s," + JSON.stringify(GREEN) + ",20), red: await __countColor(s," + JSON.stringify(RED) + ",20) }); }",
    "return out;"
  ].join(NL));
  const i10 = await real(rec({ _carType: 'ไป-กลับ' }, trip({
    returnDifferent: true, returnFrom: 'โรงพยาบาลทดสอบ', returnFromGeo: C, returnPath: RET_PATH, distRet: '271.5' })));
  ok('วาดจริงได้ 2 ภาพ', i10.length === 2, i10.length);
  ok('ภาพขาไป: เส้นน้ำเงินเส้นเดียว ไม่มีเส้นม่วง', i10[0] && i10[0].blue >= 3000 && i10[0].purple < 100,
     i10[0] ? 'น้ำเงิน ' + i10[0].blue + ' ม่วง ' + i10[0].purple : '');
  ok('ภาพขากลับ: เส้นม่วงเส้นเดียว ไม่มีเส้นน้ำเงิน', i10[1] && i10[1].purple >= 3000 && i10[1].blue < 100,
     i10[1] ? 'ม่วง ' + i10[1].purple + ' น้ำเงิน ' + i10[1].blue : '');
  ok('ทุกภาพมีหมุด A (เขียว) และ B (แดง) อย่างละหนึ่ง', all(i10, x => x.green >= 600 && x.green < 2600 && x.red >= 600 && x.red < 2600),
     i10.map(x => 'เขียว ' + x.green + ' แดง ' + x.red).join(' / '));
  const i10b = await real(rec({ _carType: 'ไม่ระบุ' }, trip(), [taxi('2026-10-06', 'ไป-กลับ', 'ท่ารถ', 'สำนักงาน', T1, T2, [120, 130])]));
  ok('Taxi ไป-กลับ วาดจริงได้ 2 ภาพ ขาไปน้ำเงิน ขากลับม่วง',
     i10b.length === 2 && i10b[0].blue >= 1500 && i10b[0].purple < 100 && i10b[1].purple >= 1500 && i10b[1].blue < 100,
     i10b.map(x => x.dir + ' น้ำเงิน ' + x.blue + ' ม่วง ' + x.purple).join(' / '));

  /* ── 11. ตัวล็อกหน้าจอ: ใบยาวต้องไม่ถูกปลดกลางทาง แต่ค้างจริงต้องปลดเอง ── */
  console.log('');
  console.log('── 11. ตัวล็อกหน้าจอระหว่างสร้าง PDF ──');
  const r11 = await ev([
    "const veil=function(){ return !!document.querySelector('[data-say]'); };",
    "const lock=lockScreenForPdf(400);",
    "for (let i=0;i<6;i++){ await new Promise(r=>setTimeout(r,250)); lock.say('กำลังวาดแผนที่ '+(i+1)+'/6'); }",
    "const stillLocked=veil();",
    "await new Promise(r=>setTimeout(r,900));",
    "const released=!veil();",
    "lock.release();",
    "return { stillLocked: stillLocked, released: released };"
  ].join(NL));
  ok('มีความคืบหน้าเรื่อย ๆ นานเกินเวลารอ ยังล็อกอยู่', r11.stillLocked);
  ok('ไม่มีความคืบหน้าเกินเวลารอ ปลดเอง', r11.released);

  console.log('');
  ok('ไม่มี JavaScript error ตลอดการทดสอบ', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '));

  console.log('');
  console.log('══════════════════════════════════════════════════');
  console.log('  ผ่าน ' + results.filter(Boolean).length + ' / ' + results.length);
  console.log('══════════════════════════════════════════════════');
  process.exitCode = results.every(Boolean) ? 0 : 1;
} catch (e) { console.error('ล้มเหลว:', e.message); process.exitCode = 2; }
finally {
  try { ws.close(); } catch {} chrome.kill();
  await sleep(500);
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
}
