// หน้าแผนที่ในเอกสารต้องเล่าขากลับให้ครบ ตรงกับใบรับรองค่าพาหนะ
//
// 27 ต.ค. 2569 — ผู้ตรวจเอกสารตีกลับใบหนึ่ง: ขาไปบ้าน -> ที่พัก 268.5 กม.
// ขากลับออกจากโรงพยาบาล -> บ้าน 271.5 กม. ใบรับรองพิมพ์ครบทั้งสองขา
// แต่หน้าแผนที่มีเส้นเดียว มีหมุด C โผล่มาโดยไม่มีบรรทัดอธิบาย
// และเขียนว่า "268.5 กิโลเมตรต่อเที่ยว" ไม่ตรงกับใบรับรอง
//
// ต้นเหตุ: หน้ากรอกบันทึกเส้นทางขากลับไว้ครบแล้ว (returnPath)
// แต่ตัววาดแผนที่เขียนไว้ก่อนมีช่อง "จุดเริ่มต้นขากลับ"
// จึงวาดขากลับเฉพาะเมื่อ "ปลายทางขากลับ" เป็นที่อื่น (returnGeo)
// ใครออกจากที่อื่นแล้วกลับบ้าน ปลายทางว่าง เส้นขากลับจึงหายทุกใบ
//
// ชุดนี้เรียกฟังก์ชันจริงในหน้า history.html ไม่ได้คัดลอกตรรกะมาเขียนใหม่
// แล้วนับพิกเซลสีของเส้นบนภาพแผนที่ที่ได้จริง
//
//   cd public && python3 -m http.server 8099 --bind 127.0.0.1
//   node scripts/test-return-map.mjs
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const APP = process.env.APP_URL || 'http://127.0.0.1:8099';
const PORT = 9761;
const NL = String.fromCharCode(10);

const results = [];
const ok = (n, pass, d = '') => { results.push(pass);
  console.log((pass ? '  ผ่าน  ' : '  ตก    ') + n + (d ? '  -> ' + d : '')); };

/* พิกัดสมมติ ไม่ใช่บ้านใคร: กรุงเทพฯ ฝั่งตะวันออก -> อุทยานฯ เขาใหญ่ฝั่งตะวันออก
   เส้นทางเป็นเส้นหักมุมไม่กี่จุด พอให้มีความยาวและทิศทางเหมือนของจริง */
const A = { lat: 13.62, lng: 100.70, label: 'จุดทดสอบ บ้าน', precision: 'road', source: 'profile' };
const B = { lat: 14.40, lng: 101.84, label: 'จุดทดสอบ ที่พัก', precision: 'search', source: 'longdo' };
const C = { lat: 14.43, lng: 101.80, label: 'จุดทดสอบ โรงพยาบาล', precision: 'search', source: 'longdo' };
const D = { lat: 16.43, lng: 102.83, label: 'จุดทดสอบ ปลายทางอื่น', precision: 'search', source: 'longdo' };
const OUT_PATH = [[13.62, 100.70], [13.95, 100.62], [14.35, 100.95], [14.55, 101.40], [14.40, 101.84]];
const RET_PATH = [[14.43, 101.80], [14.58, 101.38], [14.36, 100.97], [13.96, 100.64], [13.62, 100.70]];

function trip(extra) {
  return Object.assign({
    startDate: '2026-10-06', startTime: '11:00', endDate: '2026-10-08', endTime: '21:30',
    from: '1/1 ถนนทดสอบ', to: 'ที่พักทดสอบ', toProv: 'นครราชสีมา', toProvCode: '30',
    fromGeo: A, toGeo: B, routePath: OUT_PATH,
    returnDifferent: false, returnTo: '', returnFrom: '', returnFromGeo: null, returnGeo: null,
    returnPath: null, useAppMap: true, distanceSource: 'route',
    route: { km: 268.5, provider: 'longdo' }, distOut: '268.5', distRet: '268.5'
  }, extra || {});
}

/* เคสที่ผู้ตรวจตีกลับ: ออกจากโรงพยาบาล กลับบ้าน (ปลายทางขากลับเว้นว่าง) */
const TR_REPORTED = trip({
  returnDifferent: true, returnFrom: 'โรงพยาบาลทดสอบ', returnFromGeo: C,
  returnTo: '', returnGeo: null, returnPath: RET_PATH, distRet: '271.5'
});
/* ทั้งจุดเริ่มต้นและปลายทางขากลับเป็นที่อื่น — หมุด C กับ D */
const TR_BOTH = trip({
  returnDifferent: true, returnFrom: 'โรงพยาบาลทดสอบ', returnFromGeo: C,
  returnTo: 'ปลายทางอื่น', returnGeo: D,
  returnPath: [[14.43, 101.80], [14.98, 102.10], [15.70, 102.40], [16.43, 102.83]], distRet: '280.2'
});
/* ปลายทางขากลับเป็นที่อื่นอย่างเดียว — ของเดิมที่ใช้ได้อยู่แล้ว ต้องไม่พัง */
const TR_DEST_ONLY = trip({
  returnDifferent: true, returnTo: 'ปลายทางอื่น', returnGeo: D,
  returnPath: [[14.40, 101.84], [14.98, 102.10], [15.70, 102.40], [16.43, 102.83]], distRet: '275.0'
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
  /* นับพิกเซลที่ใกล้สีเป้าหมาย บนภาพที่ renderRouteMapImage คืนมาจริง */
  "window.__countColor=async function(dataUrl, rgb, tol){",
  "  const img=new Image(); img.src=dataUrl; await img.decode();",
  "  const c=document.createElement('canvas'); c.width=img.width; c.height=img.height;",
  "  const x=c.getContext('2d'); x.drawImage(img,0,0);",
  "  const d=x.getImageData(0,0,c.width,c.height).data; let n=0;",
  "  for(let i=0;i<d.length;i+=4){ if(Math.abs(d[i]-rgb[0])<=tol&&Math.abs(d[i+1]-rgb[1])<=tol&&Math.abs(d[i+2]-rgb[2])<=tol) n++; }",
  "  return n; };"
].join(NL);

const BLUE = [37, 99, 235];      // #2563eb เส้นขาไป
const PURPLE = [124, 58, 237];   // #7c3aed เส้นขากลับ
const TOL = 28;
/* เส้นหนา 8 พิกเซล ยาวหลายร้อยพิกเซล ได้หลายพันจุด
   แต่หมุด D (และหมุด C เมื่อเป็นปลายทางขากลับ) ใช้สีม่วงเดียวกับเส้น
   หมุดหนึ่งตัวมีสีม่วงราว 1,250 จุด จึงต้องหักออกก่อนนับว่ามีเส้นจริง
   เส้นที่หายไปจริง (เคสที่ตีกลับ) ได้ไม่ถึง 10 จุด ห่างจากเกณฑ์มาก */
const LINE_MIN = 900;
const PIN_PX = 1250;
const lineOf = (count, samePins) => count - samePins * PIN_PX;

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-retmap-'));
const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=' + PORT,
  '--user-data-dir=' + profile, '--no-first-run', '--disable-gpu',
  '--window-size=1400,1000', 'about:blank'], { stdio: 'ignore' });
let ws, id = 0; const pending = new Map(); const pageErrors = [];
const send = (m, p = {}) => { const i = ++id; ws.send(JSON.stringify({ id: i, method: m, params: p }));
  return new Promise((r, j) => pending.set(i, { r, j })); };
const ev = async e => {
  const r = await send('Runtime.evaluate',
    { expression: '(async()=>{' + e + '})()', awaitPromise: true, returnByValue: true, timeout: 120000 });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result?.value;
};

/** วาดแผนที่และหน้าแผนที่ด้วยฟังก์ชันจริง แล้วนับสีของเส้น */
async function render(tr, opts) {
  return ev([
    "const tr=" + JSON.stringify(tr) + ";",
    "const opts=" + JSON.stringify(opts || {}) + ";",
    "const img=await renderRouteMapImage(tr, [], opts);",
    "if(!img) return { img:false };",
    "const html=buildMapPageHtml(img, tr, tr.distOut, [], opts);",
    "const text=(function(){ const d=document.createElement('div'); d.innerHTML=html; return d.innerText.replace(/\\s+/g,' '); })();",
    "return { img:true, blue: await __countColor(img," + JSON.stringify(BLUE) + "," + TOL + "),",
    "  purple: await __countColor(img," + JSON.stringify(PURPLE) + "," + TOL + "), text: text };"
  ].join(NL));
}

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
  await send('Page.enable'); await send('Runtime.enable');
  await send('Network.enable');
  // ปิดภาพพื้นแผนที่ ให้พื้นเป็นสีขาว นับสีเส้นได้แม่นและผลไม่ขึ้นกับเน็ต
  await send('Network.setBlockedURLs', { urls: ['*tile.openstreetmap.org*'] });
  await send('Page.addScriptToEvaluateOnNewDocument', { source: STUB });
  await send('Page.navigate', { url: APP + '/history.html' });
  await sleep(5000);

  console.log('── เคสที่ผู้ตรวจตีกลับ: ขากลับออกจากโรงพยาบาล กลับบ้าน ──');
  const r1 = await render(TR_REPORTED);
  ok('วาดแผนที่ได้', r1.img);
  ok('มีเส้นขาไป (สีน้ำเงิน)', r1.blue >= 3000, r1.blue + ' จุด');
  ok('มีเส้นขากลับ (สีม่วง) ตามเส้นทางที่บันทึกไว้', lineOf(r1.purple, 0) >= LINE_MIN, r1.purple + ' จุด (ไม่มีหมุดสีเดียวกัน)');
  ok('ตารางมีบรรทัดอธิบายหมุด C ว่าเป็นจุดเริ่มต้นขากลับ',
     /C\s*จุดเริ่มต้นขากลับ/.test(r1.text) && r1.text.includes('จุดทดสอบ โรงพยาบาล'));
  ok('ระยะทางเขียนแยกขาไป 268.5 และขากลับ 271.5 ตรงกับใบรับรอง',
     /ขาไป\s*268\.5/.test(r1.text) && /ขากลับ\s*271\.5/.test(r1.text));
  ok('ไม่เขียน "กิโลเมตรต่อเที่ยว" ซึ่งไม่จริงเมื่อสองขาไม่เท่ากัน',
     !r1.text.includes('กิโลเมตรต่อเที่ยว'));
  ok('ไม่มีบรรทัด "ปลายทางขากลับ" เพราะกลับที่จุดเริ่มต้น', !r1.text.includes('ปลายทางขากลับ'));

  console.log('');
  console.log('── ขากลับออกจากที่อื่น และไปจบที่อื่นด้วย (หมุด C และ D) ──');
  const r2 = await render(TR_BOTH);
  ok('มีเส้นขากลับ', lineOf(r2.purple, 1) >= LINE_MIN, r2.purple + ' จุด (หักหมุด D)');
  ok('ตาราง: C = จุดเริ่มต้นขากลับ', /C\s*จุดเริ่มต้นขากลับ/.test(r2.text));
  ok('ตาราง: D = ปลายทางขากลับ ตรงกับตัวอักษรบนหมุด', /D\s*ปลายทางขากลับ/.test(r2.text),
     (r2.text.match(/[A-D]\s*ปลายทางขากลับ/) || ['ไม่พบ'])[0]);
  ok('ระยะทางแยกขาไป/ขากลับ', /ขาไป\s*268\.5/.test(r2.text) && /ขากลับ\s*280\.2/.test(r2.text));

  console.log('');
  console.log('── ปลายทางขากลับเป็นที่อื่นอย่างเดียว (ของเดิมที่ใช้ได้อยู่แล้ว) ──');
  const r3 = await render(TR_DEST_ONLY);
  ok('มีเส้นขากลับเหมือนเดิม', lineOf(r3.purple, 1) >= LINE_MIN, r3.purple + ' จุด (หักหมุด C)');
  ok('ตาราง: C = ปลายทางขากลับ เหมือนเดิม', /C\s*ปลายทางขากลับ/.test(r3.text));
  ok('ไม่มีบรรทัดจุดเริ่มต้นขากลับ', !r3.text.includes('จุดเริ่มต้นขากลับ'));
  ok('ระยะทางแยกขาไป/ขากลับเหมือนเดิม', /ขาไป\s*268\.5/.test(r3.text) && /ขากลับ\s*275/.test(r3.text));

  /* กลับทางเดิม (ใบส่วนใหญ่) — เส้นขากลับวิ่งถนนเดียวกับขาไปทุกเมตร
     ผู้ตรวจต้องการเห็นสองเส้น จึงวาดขากลับเยื้องข้างและมีลูกศรบอกทิศ
     แต่ต้องวาดเฉพาะใบที่เบิกขากลับจริง ใบที่เบิกขาไปอย่างเดียวห้ามมีเส้นขากลับโผล่ */
  console.log('');
  console.log('── กลับทางเดิม และเบิกขากลับ ──');
  const TR_SAME = trip();
  const r4 = await render(TR_SAME, { returnClaimed: true });
  ok('มีเส้นขาไป (สีน้ำเงิน) ไม่ถูกเส้นขากลับทับ', r4.blue >= 3000, r4.blue + ' จุด');
  ok('มีเส้นขากลับ (สีม่วง) แยกให้เห็น', lineOf(r4.purple, 0) >= LINE_MIN, r4.purple + ' จุด');
  ok('มีคำอธิบายสีเส้นและหมายเหตุว่าเส้นขากลับวาดเยื้อง',
     r4.text.includes('ลูกศรบอกทิศทาง') && r4.text.includes('วาดเยื้อง'));
  ok('ระยะทางยังเขียนแบบเดิม (สองขาเท่ากัน)', r4.text.includes('268.5') && r4.text.includes('กิโลเมตรต่อเที่ยว'));

  console.log('');
  console.log('── กลับทางเดิม แต่เบิกขาไปอย่างเดียว ──');
  const r5 = await render(TR_SAME, { returnClaimed: false });
  ok('ไม่มีเส้นขากลับ', r5.purple < 100, r5.purple + ' จุด');
  ok('ไม่มีคำอธิบายเส้นขากลับ', !r5.text.includes('ลูกศรบอกทิศทาง'));
  ok('เส้นขาไปเหมือนเดิม', r5.blue >= 3000, r5.blue + ' จุด');

  /* ทั้งใบผ่าน buildDocumentHtml — พิสูจน์ว่าค่า "เบิกขากลับไหม" ไหลจากใบรับรองมาถึงแผนที่จริง
     ไม่ได้ส่งค่าให้เองแบบสองเคสข้างบน */
  console.log('');
  console.log('── ทั้งใบผ่านตัวสร้างเอกสารจริง (_carType ไป-กลับ / ขาไป) ──');
  const docMap = async carType => ev([
    "const rec={ id: 9001, requestedBy: 'ผู้ทดสอบ', description: 'ทดสอบ', status: 'pending', amount: 2685,",
    "  createdAt: '2026-10-08T10:00:00.000Z', attachments: { images: [] },",
    "  inputMetadata: { _pdfTemplates: ['REPORT','TRANSPORT_RECEIPT'], _budgetCategoryId: 'TRAVEL001',",
    "    _position: 'ผู้เยี่ยมสำรวจ', _activityName: 'กิจกรรมทดสอบ', _affiliation: 'หน่วยงานทดสอบ',",
    "    _docDate: '2026-10-08', _addr: {}, _carType: " + JSON.stringify(carType) + ",",
    "    _travel: " + JSON.stringify(TR_SAME) + ",",
    "    _costs: { hotelEntries: { name: '', entries: [] }, fuelRate: '5', taxiEntries: [], airAmount: 0, tollAmount: 0, parkingAmount: 0, otherAmount: 0 } } };",
    "const built=await buildDocumentHtml(rec, function(){});",
    "const box=document.createElement('div'); box.innerHTML=built.html;",
    "const page=[...box.querySelectorAll('.pdf-page')].find(p=>p.textContent.indexOf('แผนที่และเส้นทาง')>=0);",
    "if(!page) return { map:false };",
    "const img=page.querySelector('img');",
    "return { map:true, blue: await __countColor(img.src," + JSON.stringify(BLUE) + "," + TOL + "),",
    "  purple: await __countColor(img.src," + JSON.stringify(PURPLE) + "," + TOL + "),",
    "  legend: page.textContent.indexOf('ลูกศรบอกทิศทาง')>=0 };"
  ].join(NL));
  const d1 = await docMap('ไป-กลับ');
  ok('ใบ ไป-กลับ: มีหน้าแผนที่', d1.map);
  ok('ใบ ไป-กลับ: มีทั้งเส้นขาไปและขากลับ', d1.blue >= 3000 && lineOf(d1.purple, 0) >= LINE_MIN,
     'น้ำเงิน ' + d1.blue + ' · ม่วง ' + d1.purple);
  ok('ใบ ไป-กลับ: มีคำอธิบายสีเส้น', d1.legend);
  const d2 = await docMap('ขาไป');
  ok('ใบ ขาไป: ไม่มีเส้นขากลับ และไม่มีคำอธิบาย', d2.map && d2.purple < 100 && !d2.legend,
     'ม่วง ' + d2.purple);

  console.log('');
  ok('ไม่มี JavaScript error', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '));

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
