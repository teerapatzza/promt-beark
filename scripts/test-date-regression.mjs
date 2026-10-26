// ล็อกวันที่และยอดเงินของใบเก่า — ต้องไม่เปลี่ยนแม้แต่วันเดียวบาทเดียว
//
// 22 ต.ค. 2569 — ก่อนเริ่มงานใหญ่เรื่องวันที่ (แยกวันกิจกรรมออกจากวันเดินทาง,
// ค่าน้ำมันหลายเที่ยว, กฎวันตั้งต้นใหม่) ต้องมีตาข่ายรองก่อน
//
// หลักการ: ใบที่บันทึกไปแล้วเก็บค่าทุกอย่างไว้ครบในตัวมันเอง
// การแก้ "ค่าตั้งต้นตอนกรอก" จึงต้องไม่กระทบเอกสารของใบเก่าเลยแม้แต่น้อย
// ถ้าชุดนี้แดงหลังแก้โค้ด แปลว่าเผลอไปแตะทางเดินของใบเก่าเข้าแล้ว
//
// ตัวตั้งต้น 13 ใบคัดจากฐานข้อมูลจริงบนโปรดักชัน ลบชื่อ ที่อยู่ และพิกัดบ้านออกแล้ว
// (ตรวจซ้ำในชุดนี้ด้วย ข้อ 0 — repo เป็น public ห้ามมีข้อมูลคนจริงหลุด)
//
// วิธีทำงาน: เรียก buildDocumentHtml ตัวจริงในหน้าประวัติ แล้วดึง "วันที่ทุกตัว"
// กับยอดเงินออกมาเทียบกับแฟ้มอ้างอิง  ครั้งแรกที่รันจะสร้างแฟ้มให้เอง
//
//   cd public && python3 -m http.server 8099 --bind 127.0.0.1
//   node scripts/test-date-regression.mjs            ตรวจเทียบแฟ้มอ้างอิง
//   node scripts/test-date-regression.mjs --bless    เขียนแฟ้มอ้างอิงใหม่ (ใช้เมื่อตั้งใจเปลี่ยน)
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = JSON.parse(fs.readFileSync(path.join(HERE, 'fixtures-date-regression.json'), 'utf8'));
const GOLDEN = path.join(HERE, 'golden-date-regression.json');
const BLESS = process.argv.includes('--bless');

const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9663, PROFILE = 'C:/Users/teerapat/AppData/Local/Temp/pb-datereg';
const APP = process.env.APP_URL || 'http://127.0.0.1:8099';
const NL = String.fromCharCode(10);

const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=' + PORT,
  '--user-data-dir=' + PROFILE, '--no-first-run', '--disable-gpu',
  '--window-size=1400,1400', 'about:blank'], { stdio: 'ignore' });

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
const ok = (n, pass, d = '') => { results.push(pass);
  console.log((pass ? '  ผ่าน  ' : '  ตก    ') + n + (d ? '  -> ' + d : '')); };

/* ค่าตั้งของหมวดจริงบนโปรดักชัน อ่านจากฐานข้อมูลเมื่อ 22 ต.ค. 2569
   ต้องใช้ของจริง ไม่ใช่ค่าสมมติ ไม่งั้นเอกสารจะออกมาคนละชุดกับที่ผู้ใช้เห็น */
const FLAT = { enabled: true, maxKm: 200, outsideMetro: 1200, bands: [
  { upTo: 10.99, amount: 150 }, { upTo: 20.99, amount: 250 }, { upTo: null, amount: 750 } ] };
const CATS = [
  { id: 'TRAVEL001', name: 'เบิกค่าเดินทาง+ที่พัก',
    pdfTemplates: ['REPORT', 'TRANSPORT_RECEIPT'], fuelRate: 5, taxiMaxPerTrip: 750, flatRate: FLAT },
  { id: 'TRAVEL002', name: 'เบิกค่าเดินทาง+ค่าที่พัก (กรณีบิลเงินสด)',
    pdfTemplates: ['REPORT', 'TRANSPORT_RECEIPT', 'GENERAL_RECEIPT'], fuelRate: 5, taxiMaxPerTrip: 750, flatRate: FLAT },
  { id: 'TRAVEL003', name: 'เบิกค่าที่พัก',
    pdfTemplates: ['NORMAL', 'REPORT'], fuelRate: 5, taxiMaxPerTrip: 750, flatRate: FLAT },
  { id: 'TRAVEL004', name: 'เบิกค่าพาหนะ',
    pdfTemplates: ['TRANSPORT_RECEIPT'], fuelRate: 5, taxiMaxPerTrip: 750, flatRate: FLAT },
  { id: 'TRAVEL005', name: 'เบิกค่าที่พัก (กรณีบิลเงินสด)',
    pdfTemplates: ['REPORT', 'GENERAL_RECEIPT'], fuelRate: 5, taxiMaxPerTrip: 750, flatRate: FLAT }
];

/* ดึง "วันที่" ทุกตัวที่ปรากฏบนเอกสาร โดยไม่สนใจว่าอยู่ตรงไหนของหน้า
   รูปแบบวันที่ไทยของเอกสารคือ เช่น "19 ต.ค. 2569" หรือ "19 ตุลาคม 2569"
   เก็บเรียงตามลำดับที่ปรากฏ ลำดับเปลี่ยนก็ถือว่าเปลี่ยน */
const EXTRACT = [
  /* ถอดแท็กด้วยการแทนที่ด้วยช่องว่าง ไม่พึ่ง innerText
     innerText ใช้กับกล่องที่ยังไม่ถูกแสดงไม่ได้ ส่วน textContent ทำให้ข้อความ
     ของสองเซลล์ติดกันจนตัวเลขเชื่อมกันเป็นค่าใหม่ เช่น ปี 2569 ต่อกับยอด 2,541.00 */
  "const text = String(window.__html)",
  "  .replace(/<[^>]+>/g, ' ')",
  "  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')",
  "  .replace(/\\s+/g, ' ');",
  /* เอกสารพิมพ์วันที่ด้วย toLocaleDateString('th-TH') ซึ่งได้รูปแบบ 21/10/2569
     ไม่ใช่ชื่อเดือนไทย  เก็บรูปแบบชื่อเดือนไว้ด้วยเผื่อมีที่ไหนใช้อยู่ */
  "const TH = /\\d{1,2}\\/\\d{1,2}\\/25\\d{2}|\\d{1,2}\\s*(?:ม\\.ค\\.|ก\\.พ\\.|มี\\.ค\\.|เม\\.ย\\.|พ\\.ค\\.|มิ\\.ย\\.|ก\\.ค\\.|ส\\.ค\\.|ก\\.ย\\.|ต\\.ค\\.|พ\\.ย\\.|ธ\\.ค\\.|มกราคม|กุมภาพันธ์|มีนาคม|เมษายน|พฤษภาคม|มิถุนายน|กรกฎาคม|สิงหาคม|กันยายน|ตุลาคม|พฤศจิกายน|ธันวาคม)\\s*\\d{4}/g;",
  "const dates = text.match(TH) || [];",
  "const money = (text.match(/\\d{1,3}(?:,\\d{3})*\\.\\d{2}/g) || []);",
  "return { dates: dates.map(s=>s.replace(/\\s+/g,' ').trim()), money: money, chars: text.length };"
].join(NL);

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
    "const CATS=" + JSON.stringify(CATS) + ";",
    "const of=window.fetch;",
    "window.fetch=function(u,i){const s=(typeof u==='string')?u:(u&&u.url)||'';",
    "  if(s.indexOf('/auth/me')>=0) return Promise.resolve(new Response(",
    "    JSON.stringify({id:1,email:'t@example.invalid',name:'test',role:'admin'}),",
    "    {status:200,headers:{'Content-Type':'application/json'}}));",
    "  if(s.indexOf('/settings')>=0) return Promise.resolve(new Response(",
    "    JSON.stringify({fuelRate:5,taxiMaxPerTrip:750,positionList:[],affiliationList:[],activityList:[]}),",
    "    {status:200,headers:{'Content-Type':'application/json'}}));",
    "  if(s.indexOf('/budget-categories')>=0) return Promise.resolve(new Response(",
    "    JSON.stringify(CATS),{status:200,headers:{'Content-Type':'application/json'}}));",
    "  if(s.indexOf('/expenses')>=0) return Promise.resolve(new Response('[]',",
    "    {status:200,headers:{'Content-Type':'application/json'}}));",
    "  if(s.indexOf('/profiles')>=0) return Promise.resolve(new Response('[]',",
    "    {status:200,headers:{'Content-Type':'application/json'}}));",
    "  return of(u,i);};"
  ].join(NL) });

  console.log('═══ 0. ตัวตั้งต้นต้องไม่มีข้อมูลคนจริง (repo เป็น public) ═══');
  const raw = fs.readFileSync(path.join(HERE, 'fixtures-date-regression.json'), 'utf8');
  /* ตัวตรวจจับข้อมูลคนจริงรั่ว — เก็บเป็นรหัสยูนิโคดไม่ใช่ตัวอักษรตรง ๆ
     ไม่งั้นตัวตรวจเองจะกลายเป็นที่เปิดเผยชื่อคนจริงใน repo สาธารณะ
     ถอดรหัสแล้วคือนามสกุลและบ้านเลขที่ของผู้ใช้จริงที่เคยปนเข้ามาตอนคัดตัวตั้งต้น */
  const LEAK_WORDS = ['\u0e01\u0e23\u0e23\u0e13\u0e34\u0e01\u0e32\u0e23\u0e4c', '\u0e18\u0e35\u0e23\u0e20\u0e31\u0e17\u0e23', '\u0e04\u0e38\u0e49\u0e21\u0e27\u0e07\u0e29\u0e4c', '\u0e28\u0e38\u0e20\u0e01\u0e34\u0e08', '\u0e2a\u0e38\u0e02\u0e2a\u0e27\u0e31\u0e2a\u0e14\u0e34\u0e4c',
    '141/36', '@ha.or.th'];
  const LEAK = new RegExp(LEAK_WORDS.map(w => w.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')).join('|'));
  ok('ไม่มีชื่อ ที่อยู่ หรืออีเมลจริงในแฟ้มตัวตั้งต้น', !LEAK.test(raw),
     LEAK.test(raw) ? 'พบข้อมูลจริง' : 'สะอาด');
  ok('มีใบครบ 13 ใบ', FIXTURES.length === 13, FIXTURES.length + ' ใบ');

  await send('Page.navigate', { url: APP + '/history.html' });
  await sleep(5000);

  console.log('');
  console.log('═══ 1. สร้างเอกสารจากใบเก่าทุกใบ แล้วดึงวันที่กับยอดเงินออกมา ═══');

  const got = {};
  for (const fx of FIXTURES) {
    const snap = await ev([
      "const REC=" + JSON.stringify(fx.rec) + ";",
      "REC.createdAt = REC.createdAt || " + JSON.stringify(fx.createdAt || '') + ";",
      "if (typeof buildDocumentHtml !== 'function') throw new Error('ไม่พบ buildDocumentHtml');",
      /* คืนมาเป็น { html, dateObj } ไม่ใช่สตริง — เผลอใช้ทั้งก้อนจะได้ '[object Object]' */
      "const built = await buildDocumentHtml(REC, function(){});",
      "window.__html = (built && built.html) ? built.html : String(built);",
      EXTRACT
    ].join(NL));
    got['id' + fx.id] = snap;
    console.log('    ใบ ' + String(fx.id).padEnd(4) + ' วันที่ ' +
                String(snap.dates.length).padStart(2) + ' ตัว · ยอดเงิน ' +
                String(snap.money.length).padStart(2) + ' ตัว · ตัวอักษร ' + snap.chars);
  }

  ok('สร้างเอกสารได้ครบทุกใบ', Object.keys(got).length === FIXTURES.length,
     Object.keys(got).length + '/' + FIXTURES.length);
  ok('ทุกใบมีวันที่อย่างน้อยหนึ่งตัว',
     Object.values(got).every(s => s.dates.length > 0),
     Object.entries(got).filter(([, s]) => !s.dates.length).map(([k]) => k).join(' ') || 'ครบ');

  console.log('');
  if (BLESS || !fs.existsSync(GOLDEN)) {
    fs.writeFileSync(GOLDEN, JSON.stringify(got, null, 1));
    console.log('═══ เขียนแฟ้มอ้างอิงใหม่แล้ว: ' + path.basename(GOLDEN) + ' ═══');
    console.log('    ครั้งต่อไปที่รัน จะเทียบกับแฟ้มนี้');
    ok('บันทึกแฟ้มอ้างอิงสำเร็จ', fs.existsSync(GOLDEN));
  } else {
    console.log('═══ 2. เทียบกับแฟ้มอ้างอิง — ห้ามต่างแม้แต่ตัวเดียว ═══');
    const want = JSON.parse(fs.readFileSync(GOLDEN, 'utf8'));
    for (const fx of FIXTURES) {
      const k = 'id' + fx.id;
      const a = want[k], b = got[k];
      if (!a) { ok('ใบ ' + fx.id + ' มีในแฟ้มอ้างอิง', false, 'ไม่มี — รัน --bless ถ้าเพิ่งเพิ่มใบนี้'); continue; }
      const sameDates = JSON.stringify(a.dates) === JSON.stringify(b.dates);
      const sameMoney = JSON.stringify(a.money) === JSON.stringify(b.money);
      ok('ใบ ' + String(fx.id).padEnd(4) + ' วันที่เท่าเดิมทุกตัว', sameDates,
         sameDates ? '' : 'เดิม [' + a.dates.join(' | ') + ']  ได้ [' + b.dates.join(' | ') + ']');
      ok('ใบ ' + String(fx.id).padEnd(4) + ' ยอดเงินเท่าเดิมทุกตัว', sameMoney,
         sameMoney ? '' : 'เดิม [' + a.money.join(' | ') + ']  ได้ [' + b.money.join(' | ') + ']');
    }
  }

  console.log('');
  ok('ไม่มี JavaScript error ตลอดการทดสอบ', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '));

  console.log('');
  console.log('══════════════════════════════════════════════════');
  console.log('  ผ่าน ' + results.filter(Boolean).length + ' / ' + results.length);
  console.log('══════════════════════════════════════════════════');
  process.exitCode = results.every(Boolean) ? 0 : 1;
} catch (e) {
  console.error('ล้มเหลว:', e.message);
  process.exitCode = 2;
} finally { try { ws.close(); } catch {} chrome.kill(); }
