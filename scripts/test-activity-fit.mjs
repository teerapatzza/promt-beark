// รายละเอียดกิจกรรมยาวแค่ไหน ใบก็ต้องไม่ตกไปหน้าถัดไป
//
// 21 ต.ค. 2569 — เจ้าของงานส่งใบจริงมาให้ดู ชื่อกิจกรรมยาวสามบรรทัด
// ช่องในใบรับรองค่าพาหนะสูงขึ้นจนท้ายใบตกไปอีกหน้า แล้วสั่งว่า
//   "มันไปขยายช่อง pdf ซึ่งไม่ใช่ อาจจะต้องทำ 2 ทาง ไม่ลดขนาดตัวอักษร
//    หรือไม่ก็ขึ้นบรรทัดใหม่ ... และก็ต้องดูด้วยว่ามันจะล้นไหม
//    เห็นจากรูปสุดท้ายไหมมันยาวจนตกไปหน้าอื่นซึ่งห้ามเด็ดขาด"
//
// ชุดนี้วัดความสูงของหน้ากระดาษจริงที่สร้างจาก buildDocumentHtml
// ไม่ได้นับตัวอักษรแล้วเดา — นับตัวอักษรบอกไม่ได้ว่าจะล้นหรือไม่
//
//   cd public && python3 -m http.server 8099 --bind 127.0.0.1
//   node scripts/test-activity-fit.mjs
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9637, PROFILE = 'C:/Users/teerapat/AppData/Local/Temp/pb-actfit';
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

/* ข้อความทดสอบ ต่อจากชื่อกิจกรรมจริงที่เจ้าของงานส่งมา แล้วไล่ยาวขึ้น */
const REAL = 'กิจกรรมสัมมนาสร้างการเรียนรู้เพื่อทบทวนและวิเคราะห์สาเหตุที่แท้จริง '
           + 'กรณีเกิดเหตุการณ์ไม่พึงประสงค์ในกระบวนการดูแลรักษา โรงพยาบาลชาน '
           + 'คามิลโล จังหวัดราชบุรี วันที่ 22 ตุลาคม 2569';
const pad = (base, n) => {
  let s = base;
  while (s.length < n) s += ' ' + base;
  return s.slice(0, n);
};

const mkRec = (act, extra) => ({
  id: 9301, requestedBy: 'กฤษดา แสวงดี', amount: 500,
  category: 'TRAVEL002', date: '2026-10-22',
  inputMetadata: {
    _pdfTemplates: ['REPORT', 'TRANSPORT_RECEIPT'],
    _activityName: act,
    _extraActivities: extra ? [extra] : [],
    _position: 'ผู้เชี่ยวชาญ', _affiliation: 'อิสระ', _docDate: '2026-10-22',
    _addr: { no: '99/61', sub: 'คลองพระอุดม', dist: 'ปากเกร็ด',
             prov: 'นนทบุรี', zip: '11120' },
    _extraAddr: '99/61 ตำบลคลองพระอุดม อำเภอปากเกร็ด จังหวัดนนทบุรี 11120',
    _travel: { startDate: '2026-10-22', endDate: '2026-10-22',
               from: '99/61', to: 'สถาบันรับรองคุณภาพสถานพยาบาล',
               distOut: 12.1, distRet: 12.1 },
    _carType: 'ไป-กลับ',
    _fuelMethod: 'flat', _flatVehicle: 'car',
    _flatRate: { total: 500, legs: [
      { dir: 'ขาไป',   km: 12.1, amount: 250, label: 'ระยะทาง 11.00 - 20.99 กม.' },
      { dir: 'ขากลับ', km: 12.1, amount: 250, label: 'ระยะทาง 11.00 - 20.99 กม.' } ] },
    _costs: { fuelRate: '5', taxiEntries: [], airAmount: 0,
              tollAmount: 0, parkingAmount: 0, otherAmount: 0,
              hotelEntries: { entries: [] } }
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
    if (m.id && pending.has(m.id)) { const { r, j } = pending.get(m.id); pending.delete(m.id);
      m.error ? j(new Error(m.error.message)) : r(m.result); return; }
    if (m.method === 'Runtime.exceptionThrown')
      pageErrors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
    if (m.method === 'Page.javascriptDialogOpening') send('Page.handleJavaScriptDialog', { accept: true }); });
  await send('Page.enable'); await send('Runtime.enable');
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Page.addScriptToEvaluateOnNewDocument', { source: [
    "localStorage.setItem('token','x');",
    "const of=window.fetch;",
    "window.fetch=function(u,i){const s=(typeof u==='string')?u:(u&&u.url)||'';",
    "  if(s.indexOf('/auth/me')>=0) return Promise.resolve(new Response(",
    "    JSON.stringify({id:1,email:'t@ha.or.th',name:'test',role:'admin'}),",
    "    {status:200,headers:{'Content-Type':'application/json'}}));",
    "  if(s.indexOf('/budget-categories')>=0) return Promise.resolve(new Response(",
    "    JSON.stringify([{id:'TRAVEL002',name:'test',pdfTemplates:['REPORT','TRANSPORT_RECEIPT'],",
    "      attachmentRules:{},attachmentOrder:[]}]),",
    "    {status:200,headers:{'Content-Type':'application/json'}}));",
    "  if(s.indexOf('/expenses')>=0||s.indexOf('/profiles')>=0)",
    "    return Promise.resolve(new Response('[]',{status:200,headers:{'Content-Type':'application/json'}}));",
    "  return of(u,i);};"
  ].join(NL) });

  await send('Page.navigate', { url: APP + '/history.html' }); await sleep(5000);
  await ev("window.renderRouteMapImage = async () => null; return 1;");

  // หน้ากระดาษ A4 ที่ใช้ได้จริง: กว้าง 190mm สูง 297mm หักขอบบนล่างอย่างละ 5mm
  const width = await ev([
    "document.getElementById('pdf-container').innerHTML='<div class=\"pdf-page\" id=\"_m\">x</div>';",
    "const w=document.getElementById('_m').getBoundingClientRect().width;",
    "document.getElementById('pdf-container').innerHTML='';",
    "return w;"
  ].join(NL));
  const pxPerMm = width / 190;
  const limit = Math.round(287 * pxPerMm);
  console.log('  หนึ่งหน้า A4 ใส่ได้สูงสุด ' + limit + 'px (287mm)');
  console.log('');

  const measure = async rec => {
    const m = await ev([
      "const built = await buildDocumentHtml(" + JSON.stringify(rec) + ", function(){});",
      "document.getElementById('pdf-container').innerHTML =",
      "  '<div id=\"_doc\" style=\"background:white;color:black;margin:0;padding:0;\">' + built.html + '</div>';",
      // เรียกตัววัดแล้วย่อให้พอดีหน้า เหมือนที่เส้นทางสร้าง PDF จริงเรียก
      "const fit = fitCertificatePages(document.getElementById('_doc'));",
      "const pages=[...document.querySelectorAll('#_doc .pdf-page')];",
      "const hs = pages.map(p=>Math.round(p.getBoundingClientRect().height));",
      "const fs = [...document.querySelectorAll('#_doc .free-text')]",
      "  .map(e=>Math.round(parseFloat(getComputedStyle(e).fontSize)*10)/10);",
      "document.getElementById('pdf-container').innerHTML='';",
      "return { heights: hs, fontSizes: fs, warned: fit.overflow.length > 0 };"
    ].join(NL));
    return m;
  };

  console.log('═══ 1. ใบจริงที่เจ้าของงานส่งมา (' + REAL.length + ' ตัวอักษร) ═══');
  const real = await measure(mkRec(REAL, REAL));
  const realMax = Math.max(...real.heights);
  console.log('    ความสูงแต่ละหน้า: ' + real.heights.join(', ') + 'px');
  console.log('    ขนาดตัวอักษรที่ใช้: ' + [...new Set(real.fontSizes)].join(', ') + 'px');
  ok('ใบจริงอยู่ในหน้าเดียว ไม่ตกไปหน้าถัดไป', realMax <= limit,
     realMax + 'px / ' + limit + 'px (เหลือ ' + (limit - realMax) + 'px)');
  ok('ตัวอักษรถูกย่อลงจากขนาดปกติ 13.5px',
     real.fontSizes.some(f => f < 13.5), real.fontSizes.join(', ') + 'px');

  console.log('');
  /* ช่องทั้งสองมี maxlength=200 เท่ากัน กรณีแย่ที่สุดที่เป็นไปได้จริง
     จึงคือยาว 200 ทั้งคู่ ไม่ใช่ตัวเลขสมมติที่ยาวกว่านั้น */
  console.log('═══ 2. ไล่ความยาวขึ้นเรื่อย ๆ จนถึงเพดานที่ช่องรับได้ (200 ตัวอักษร) ═══');
  console.log('    ก. ประเภทสั้น + รายละเอียดยาว (รูปแบบที่ใช้งานจริง)');
  for (const n of [60, 110, 111, 170, 171, 200]) {
    const txt = pad(REAL, n);
    const m = await measure(mkRec('กิจกรรมเยี่ยมสำรวจ', txt));
    const h = Math.max(...m.heights);
    const fs = [...new Set(m.fontSizes)].join('/');
    ok('รายละเอียด ' + String(n).padStart(3) + ' ตัวอักษร  สูง ' + h + 'px  ฟอนต์ ' + fs + 'px',
       h <= limit, 'เหลือ ' + (limit - h) + 'px');
  }
  console.log('    ข. ยาวสุดทั้งสองช่อง — กรณีแย่ที่สุดที่ฟอร์มยอมให้เกิดได้');
  for (const n of [150, 175, 200]) {
    const txt = pad(REAL, n);
    const m = await measure(mkRec(txt, txt));
    const h = Math.max(...m.heights);
    const fs = [...new Set(m.fontSizes)].join('/');
    ok('ทั้งสองช่อง ' + String(n).padStart(3) + ' ตัวอักษร  สูง ' + h + 'px  ฟอนต์ ' + fs + 'px',
       h <= limit, 'เหลือ ' + (limit - h) + 'px');
  }

  console.log('');
  console.log('═══ 3. ใบสั้นปกติต้องหน้าตาเหมือนเดิม ไม่ถูกย่อ ═══');
  const shortRec = await measure(mkRec('กิจกรรมเยี่ยมสำรวจ', 'ประชุมคณะกรรมการ'));
  ok('ใบสั้นยังใช้ตัวอักษรขนาดปกติ',
     shortRec.fontSizes.every(f => f >= 13.4), shortRec.fontSizes.join(', ') + 'px');
  ok('ใบสั้นอยู่ในหน้าเดียว',
     Math.max(...shortRec.heights) <= limit,
     Math.max(...shortRec.heights) + 'px / ' + limit + 'px');

  console.log('');
  console.log('=== 4. หลายอย่างยาวพร้อมกัน — ของจริงความสูงมาจากหลายทางรวมกัน ===');
  /* 21 ต.ค. 2569 — เจ้าของงานถามว่า "แน่ใจใช่ไหมว่าชื่อยาว ๆ จะไม่ตกหน้า"
     ไปวัดแล้วตอบว่าแน่ใจไม่ได้ ของเดิมเดาขนาดจากจำนวนเที่ยวอย่างเดียว
     ตอนนี้วัดความสูงจริงแล้วย่อจนพอดี จึงต้องมีข้อคุมเคสที่ผสมกัน */
  const legOf = i => ({ date: '2026-10-22', direction: 'ขากลับ', amount: 150,
    from: 'ท่าอากาศยานนานาชาติดอนเมือง อาคารผู้โดยสาร 1 เที่ยวที่ ' + i,
    to: '141/36 ซอยสุขสวัสดิ์ 55 ถนนสุขสวัสดิ์ ตำบลปากคลองบางปลากด' });
  const mixRec = (actLen, extraLen, nLegs) => {
    const r = mkRec(pad(REAL, actLen), pad(REAL, extraLen));
    /* ใบตั้งต้นของชุดนี้เป็นแบบเหมาจ่าย ซึ่งใบรับรองจะไม่กางเที่ยว Taxi เลย
       ถ้าไม่ถอดออก จำนวนเที่ยวที่ใส่เข้าไปจะไม่มีผล แล้วข้อทดสอบจะเขียวหลอก
       (เจอจริง: 10/12/16/20 เที่ยว ได้ความสูง 880px เท่ากันเป๊ะทุกอัน) */
    delete r.inputMetadata._fuelMethod;
    delete r.inputMetadata._flatRate;
    delete r.inputMetadata._flatVehicle;
    r.inputMetadata._costs.taxiEntries =
      Array.from({ length: nLegs }, (_, i) => legOf(i + 1));
    return r;
  };
  for (const [a, b, n] of [[18, 40, 2], [60, 200, 4], [200, 200, 4], [200, 200, 6], [200, 200, 8]]) {
    const m = await measure(mixRec(a, b, n));
    const h = Math.max(...m.heights);
    ok('ชื่อ ' + String(a).padStart(3) + ' · รายละเอียด ' + String(b).padStart(3)
       + ' · ' + n + ' เที่ยว  สูง ' + h + 'px', h <= limit,
       'เหลือ ' + (limit - h) + 'px');
  }

  console.log('');
  /* กติกาที่แท้จริงไม่ใช่ "เคสนี้ต้องเตือน" เพราะจุดแตกขึ้นกับเนื้อหาที่ผสมกัน
     แต่คือ "ทุกเคสต้องอยู่ในหน้าเดียว ไม่ก็ต้องรู้ตัวแล้วเตือน" ห้ามล้นเงียบ ๆ */
  console.log('=== 5. ทุกเคสต้อง "พอดีหน้า" หรือ "เตือนผู้ใช้" อย่างใดอย่างหนึ่ง ===');
  for (const [a, b, n] of [[200, 200, 10], [200, 200, 12], [200, 200, 16], [200, 200, 20]]) {
    const m = await measure(mixRec(a, b, n));
    const h = Math.max(...m.heights);
    const fits = h <= limit;
    ok(n + ' เที่ยว  สูง ' + h + 'px  ' + (fits ? 'พอดีหน้า' : 'เกินหน้า'),
       fits || m.warned === true,
       fits ? 'เหลือ ' + (limit - h) + 'px' : (m.warned ? 'เตือนผู้ใช้แล้ว' : 'ล้นเงียบ ๆ'));
  }

  console.log('');
  ok('ไม่มี JavaScript error ตลอดการทดสอบ', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '));

  console.log('');
  console.log('══════════════════════════════════════════════════');
  console.log('  ผ่าน ' + results.filter(Boolean).length + ' / ' + results.length);
  console.log('══════════════════════════════════════════════════');
  process.exitCode = results.every(Boolean) ? 0 : 1;
} catch (e) { console.error('ล้มเหลว:', e.message); process.exitCode = 2; }
finally { try { ws.close(); } catch {} chrome.kill(); }
