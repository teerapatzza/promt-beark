// ทุกเที่ยว Taxi ต้องมีบรรทัด จาก/ถึง ของตัวเอง และติ๊กต้องตรงกับที่เลือก
//
// 21 ต.ค. 2569 — เจ้าของงานกรอก Taxi ขากลับสองเที่ยว (140 + 160)
// ใบที่พิมพ์ออกมามีบรรทัด จาก/ถึง แค่บรรทัดเดียว แล้วเอาเงินสองก้อนมารวมเป็น 300
//   "ผมติ๊กว่ามีขากลับ 2 ขา แต่ว่าทำไมใน pdf ถึงรวมเป็นขาเดียวละ
//    อันนี้แบบไหนก็ต้องขึ้น จากถึง 2 รอบสิ"
// แล้วสั่งต่อว่า "อย่าลืมรับเคสอื่น ๆ นะ เช่น ขาไป ขาไป ขาไป ไรงี้
//    และตรงที่ปุ่มจุดติ๊กต้องตรงกับที่เลือกนะ"
//
// ต้นเหตุ: ของเดิมหยิบมาแค่เที่ยวแรกของแต่ละทิศ (firstTaxiOut/firstTaxiRet)
// แต่บวกเงินจากทุกเที่ยว เส้นทางในใบจึงไม่ตรงกับยอดมาตลอด
//
//   cd public && python3 -m http.server 8099 --bind 127.0.0.1
//   node scripts/test-taxi-legs-on-receipt.mjs
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9643, PROFILE = 'C:/Users/teerapat/AppData/Local/Temp/pb-taxilegs';
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

const mkRec = (entries, amount) => ({
  id: 9601, requestedBy: 'ธีรภัทร คุ้มวงษ์', amount: amount,
  category: 'TRAVEL002', date: '2026-10-22',
  inputMetadata: {
    _pdfTemplates: ['TRANSPORT_RECEIPT'],
    _activityName: 'กิจกรรมเยี่ยมสำรวจ',
    _extraActivities: ['ประชุมคณะทำงาน'],
    _position: 'นักวิเคราะห์ธุรกิจ', _affiliation: 'อิสระ', _docDate: '2026-10-22',
    _addr: { no: '141/36', soi: 'สุขสวัสดิ์ 55', road: 'สุขสวัสดิ์',
             sub: 'ปากคลองบางปลากด', dist: 'พระสมุทรเจดีย์',
             prov: 'สมุทรปราการ', zip: '10290' },
    _travel: { startDate: '2026-10-22', endDate: '2026-10-22',
               from: 'บ้าน', to: 'สนามบินดอนเมือง' },
    _carType: 'ไม่ระบุ',
    _costs: { fuelRate: '5', airAmount: 0, tollAmount: 0, parkingAmount: 0, otherAmount: 0,
              taxiEntries: entries, hotelEntries: { entries: [] } }
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
    "    JSON.stringify([{id:'TRAVEL002',name:'test',pdfTemplates:['TRANSPORT_RECEIPT'],",
    "      attachmentRules:{},attachmentOrder:[]}]),",
    "    {status:200,headers:{'Content-Type':'application/json'}}));",
    "  if(s.indexOf('/expenses')>=0||s.indexOf('/profiles')>=0)",
    "    return Promise.resolve(new Response('[]',{status:200,headers:{'Content-Type':'application/json'}}));",
    "  return of(u,i);};"
  ].join(NL) });

  await send('Page.navigate', { url: APP + '/history.html' }); await sleep(5000);
  await ev("window.renderRouteMapImage = async () => null; return 1;");

  /* อ่านบล็อก "ค่า Taxi" ออกมาเป็นรายบรรทัด
     นับเฉพาะแถวที่มีข้อความ จาก/ถึง จริง แถวว่างของเทมเพลตไม่นับ */
  const READ = [
    "async function readTaxi(rec) {",
    "  const b = await buildDocumentHtml(rec, function(){});",
    "  const d = document.createElement('div'); d.innerHTML = b.html;",
    // rcFromTo ซ้อนตารางไว้ในช่อง ถ้าไม่กรองออก จะนับแถวซ้อนมาเป็นเที่ยวด้วย
    "  const trs = [...d.querySelectorAll('tr')].filter(tr => !tr.closest('td'));",
    "  const txt = tr => (tr.textContent || '').replace(/\\s+/g,' ').trim();",
    "  const iTaxi = trs.findIndex(t => txt(t).indexOf('ค่า Taxi') >= 0);",
    "  const iFuel = trs.findIndex(t => txt(t).indexOf('ค่าน้ำมันเชื้อเพลิง') >= 0);",
    "  if (iTaxi < 0 || iFuel < 0) throw new Error('หาบล็อกค่า Taxi ไม่เจอ');",
    "  const head = txt(trs[iTaxi]);",
    "  const legs = [];",
    "  for (let i = iTaxi + 1; i < iFuel; i++) {",
    "    const tds = trs[i].children;",
    "    const detail = txt(tds[1] || {});",
    "    const amt = txt(tds[2] || {});",
    "    const body = detail.replace(/^จาก\\s*/,'').replace(/\\s*ถึง\\s*/,' | ').trim();",
    // แถวว่างของเทมเพลตเหลือแค่ตัวคั่น ไม่มีชื่อสถานที่จริง ไม่นับเป็นเที่ยว
    "    const named = body.replace(/[|\s]/g,'');",
    "    if (!named && !amt) continue;",   // แถวว่างของเทมเพลต
    "    legs.push({ date: txt(tds[0] || {}), route: body, amt: amt });",
    "  }",
    "  const all = d.textContent.replace(/\\s+/g,' ');",
    "  const m = all.match(/รวมทั้งสิ้น\\s*([\\d,]+\\.\\d{2})/);",
    "  return { head: head, legs: legs, total: m ? m[1] : null };",
    "}"
  ].join(NL);

  const read = async rec =>
    ev(READ + NL + 'return await readTaxi(' + JSON.stringify(rec) + ');');

  const circleOf = head => {
    // ◉ = วงที่ถูกฝน  ◯ = วงเปล่า  หาว่าคำไหนตามหลังวงที่ถูกฝน
    const m = head.match(/\u25c9\s*(ขาไป|ขากลับ|ไป-กลับ)/);
    return m ? m[1] : 'ไม่มีวงไหนถูกฝน';
  };

  console.log('═══ 1. ขากลับ 2 เที่ยว — เคสที่เจ้าของงานเจอ ═══');
  const a = await read(mkRec([
    { date: '2026-10-22', direction: 'ขากลับ', amount: 140,
      from: 'สนามบินดอนเมือง', to: '141/36 ซอยสุขสวัสดิ์ 55' },
    { date: '2026-10-22', direction: 'ขากลับ', amount: 160,
      from: 'โรงแรมไมด้า ดอนเมือง', to: 'แยกสนามบินสุวรรณภูมิ' }
  ], 300));
  ok('ขึ้น จาก/ถึง 2 บรรทัด ไม่ยุบเป็นบรรทัดเดียว', a.legs.length === 2,
     a.legs.length + ' บรรทัด: ' + a.legs.map(l => l.route).join(' // '));
  ok('ยอดแยกเป็น 140 กับ 160 ไม่รวมเป็น 300',
     a.legs[0].amt === '140.00' && a.legs[1].amt === '160.00',
     a.legs.map(l => l.amt).join(' + '));
  ok('ติ๊กวงกลมตรงกับที่เลือก = ขากลับ', circleOf(a.head) === 'ขากลับ', circleOf(a.head));
  ok('ยอดรวมท้ายใบยังเป็น 300.00', a.total === '300.00', String(a.total));

  console.log('');
  console.log('═══ 2. ขาไป 3 เที่ยว ═══');
  const b = await read(mkRec([
    { date: '2026-10-22', direction: 'ขาไป', amount: 90,  from: 'บ้าน', to: 'บีทีเอส' },
    { date: '2026-10-22', direction: 'ขาไป', amount: 120, from: 'บีทีเอส', to: 'สนามบิน' },
    { date: '2026-10-22', direction: 'ขาไป', amount: 75,  from: 'สนามบิน', to: 'โรงแรม' }
  ], 285));
  ok('ขึ้นครบ 3 บรรทัด', b.legs.length === 3,
     b.legs.length + ' บรรทัด: ' + b.legs.map(l => l.route).join(' // '));
  ok('ยอดแยกครบทุกเที่ยว',
     b.legs.map(l => l.amt).join(',') === '90.00,120.00,75.00',
     b.legs.map(l => l.amt).join(','));
  ok('ติ๊กวงกลม = ขาไป', circleOf(b.head) === 'ขาไป', circleOf(b.head));
  ok('ยอดรวมท้ายใบ 285.00', b.total === '285.00', String(b.total));

  console.log('');
  console.log('═══ 3. ขาไป 2 + ขากลับ 2 — ต้องไม่ยุบ และติ๊กเป็นไป-กลับ ═══');
  const c = await read(mkRec([
    { date: '2026-10-22', direction: 'ขาไป',   amount: 90,  from: 'บ้าน', to: 'บีทีเอส' },
    { date: '2026-10-22', direction: 'ขาไป',   amount: 120, from: 'บีทีเอส', to: 'สนามบิน' },
    { date: '2026-10-23', direction: 'ขากลับ', amount: 110, from: 'สนามบิน', to: 'บีทีเอส' },
    { date: '2026-10-23', direction: 'ขากลับ', amount: 95,  from: 'บีทีเอส', to: 'บ้าน' }
  ], 415));
  ok('ขึ้นครบ 4 บรรทัด มากกว่าช่องเดิมของเทมเพลตก็ต้องเพิ่มให้',
     c.legs.length === 4, c.legs.length + ' บรรทัด');
  ok('ยอดแยกครบทั้งสี่เที่ยว',
     c.legs.map(l => l.amt).join(',') === '90.00,120.00,110.00,95.00',
     c.legs.map(l => l.amt).join(','));
  ok('ติ๊กวงกลม = ไป-กลับ', circleOf(c.head) === 'ไป-กลับ', circleOf(c.head));
  ok('วันที่ของแต่ละเที่ยวตามของตัวเอง',
     c.legs[0].date !== c.legs[3].date,
     c.legs.map(l => l.date).join(' / '));
  ok('ยอดรวมท้ายใบ 415.00', c.total === '415.00', String(c.total));

  console.log('');
  console.log('═══ 4. เที่ยวเดียวแบบ "ไป-กลับ" แยกยอด ═══');
  const d2 = await read(mkRec([
    { date: '2026-10-22', direction: 'ไป-กลับ', amountOut: 150, amountRet: 170,
      amount: 320, from: 'บ้าน', to: 'สนามบิน' }
  ], 320));
  ok('กางเป็น 2 บรรทัด ไป และ กลับ', d2.legs.length === 2,
     d2.legs.map(l => l.route).join(' // '));
  ok('บรรทัดขากลับเป็นเส้นทางกลับหัว',
     /สนามบิน \| บ้าน/.test(d2.legs[1].route), d2.legs[1].route);
  ok('ยอดแยก 150 / 170',
     d2.legs[0].amt === '150.00' && d2.legs[1].amt === '170.00',
     d2.legs.map(l => l.amt).join(' / '));
  ok('ติ๊กวงกลม = ไป-กลับ', circleOf(d2.head) === 'ไป-กลับ', circleOf(d2.head));

  console.log('');
  console.log('═══ 5. "ไป-กลับ" ที่กรอกยอดมาก้อนเดียว ═══');
  const e2 = await read(mkRec([
    { date: '2026-10-22', direction: 'ไป-กลับ', amount: 300, from: 'บ้าน', to: 'สนามบิน' }
  ], 300));
  ok('ยังขึ้นสองบรรทัดให้เห็นว่าไปและกลับ', e2.legs.length === 2,
     e2.legs.map(l => l.route).join(' // '));
  ok('ยอดอยู่ที่บรรทัดขาไป ไม่ซ้ำสองที่',
     e2.legs[0].amt === '300.00' && e2.legs[1].amt === '',
     JSON.stringify(e2.legs.map(l => l.amt)));
  ok('ติ๊กวงกลม = ไป-กลับ', circleOf(e2.head) === 'ไป-กลับ', circleOf(e2.head));

  console.log('');
  console.log('═══ 6. ใบเก่าที่เก็บแค่ยอดรวมรายทิศ ต้องพิมพ์เหมือนเดิม ═══');
  const oldRec = mkRec([], 450);
  oldRec.inputMetadata._costs.taxiOutAmt = 250;
  oldRec.inputMetadata._costs.taxiRetAmt = 200;
  oldRec.inputMetadata._taxiType = 'ไป-กลับ';   // ใบเก่าเก็บไว้ที่ชั้น meta ไม่ใช่ใน _costs
  const f = await read(oldRec);
  ok('ยังขึ้นสองบรรทัดแบบเดิม', f.legs.length === 2,
     f.legs.length + ' บรรทัด: ' + JSON.stringify(f.legs.map(l => l.amt)));
  ok('ยอดเดิมยังอยู่ครบ',
     f.legs.map(l => l.amt).join(',') === '250.00,200.00',
     f.legs.map(l => l.amt).join(','));
  ok('ติ๊กวงกลม = ไป-กลับ', circleOf(f.head) === 'ไป-กลับ', circleOf(f.head));

  console.log('');
  console.log('═══ 7. ยอดที่พิมพ์ทุกบรรทัดบวกกันต้องเท่ายอดรวมท้ายใบ ═══');
  const sum = arr => arr.reduce((s, l) =>
    s + (parseFloat((l.amt || '0').replace(/,/g, '')) || 0), 0);
  [['ขากลับ 2 เที่ยว', a, 300], ['ขาไป 3 เที่ยว', b, 285],
   ['ไป-กลับ 4 เที่ยว', c, 415], ['ไป-กลับ แยกยอด', d2, 320]].forEach(function (x) {
    ok(x[0] + ': ผลบวกรายบรรทัด = ยอดรวมท้ายใบ', sum(x[1].legs) === x[2],
       sum(x[1].legs) + ' / ' + x[2]);
  });

  console.log('');
  console.log('═══ 8. พักคู่ กับใคร ต้องขึ้นในใบ และแผนที่ต้องเคารพติ๊กของผู้ใช้ ═══');
  /* 21 ต.ค. 2569 — เอกสารมีบรรทัด "( ) พักคู่ กับ ______" รออยู่แล้ว
     แต่ฟอร์มไม่เคยเก็บชื่อผู้ร่วมพัก ช่องในใบจึงว่างตลอด
     และตัวสร้างเอกสารก็ไม่เคยอ่านค่าติ๊ก "ใช้แผนที่จากระบบ"
     คนที่ติ๊กออกแล้วแนบภาพเอง จึงได้แผนที่ของพร้อมเบิกแถมไปอีกหน้า */
  const docOf = async (patch) => ev([
    "window.renderRouteMapImage = async () => 'data:image/png;base64,MAPSTUB';",
    "const rec = " + JSON.stringify(patch) + ";",
    "const b = await buildDocumentHtml(rec, function(){});",
    "const d = document.createElement('div'); d.innerHTML = b.html;",
    "return { text: d.textContent.replace(/\s+/g,' '), html: b.html };"
  ].join(NL));

  const hotelRec = mkRec([], 2000);
  hotelRec.inputMetadata._pdfTemplates = ['REPORT'];
  hotelRec.inputMetadata._costs.hotelEntries = {
    name: 'โรงแรมทดสอบ',
    entries: [{ type: 'พักคู่', rate: '1000', nights: '2', withWho: 'นพ.สมชาย ใจดี' }]
  };
  const hotelDoc = await docOf(hotelRec);
  ok('ชื่อผู้ร่วมพักขึ้นในใบ ไม่ใช่เส้นว่าง',
     /นพ\.สมชาย ใจดี/.test(hotelDoc.text),
     (hotelDoc.text.match(/พักคู่ กับ[^0-9]{0,40}/) || [''])[0].trim());

  const mapOn = mkRec([], 300);
  mapOn.inputMetadata._travel.fromGeo = { lat: 13.8, lng: 100.6, precision: 'exact' };
  mapOn.inputMetadata._travel.toGeo   = { lat: 13.85, lng: 100.52, precision: 'exact' };
  const onDoc = await docOf(mapOn);
  ok('ติ๊กไว้ (ใบเก่าไม่มีคีย์นี้) ยังวาดแผนที่ให้เหมือนเดิม',
     onDoc.html.indexOf('MAPSTUB') >= 0, 'มีหน้าแผนที่');

  const mapOff = JSON.parse(JSON.stringify(mapOn));
  mapOff.inputMetadata._travel.useAppMap = false;
  const offDoc = await docOf(mapOff);
  ok('ติ๊กออกแล้วแผนที่ของพร้อมเบิกต้องไม่โผล่ในเอกสาร',
     offDoc.html.indexOf('MAPSTUB') < 0, 'ไม่มีหน้าแผนที่');

  console.log('');
  console.log('═══ 9. แผนที่ในเอกสารต้องมีทุกเที่ยว Taxi ที่ปักหมุด ═══');
  /* 21 ต.ค. 2569 — เจ้าของงานกรอก Taxi 5 เที่ยว เห็นครบ 5 เส้นบนหน้ากรอก
     แต่พอกดพิมพ์ แผนที่ในเอกสารมีเส้นเดียว
     27 ต.ค. 2569 — ผู้ตรวจเอกสารให้แยกเป็นหนึ่งแผนที่ต่อหนึ่งขา (ดู test-leg-maps.mjs)
     ข้อนี้จึงตรวจว่าทุกเที่ยวที่ปักหมุดได้แผนที่ของตัวเอง จาก/ถึง ตรงกับที่กรอก */
  const legFive = n => Array.from({ length: n }, (_, i) => ({
    date: '2026-10-22', direction: i === 0 ? 'ขาไป' : 'ขากลับ', amount: 50 + i,
    from: 'ต้นทาง ' + (i + 1), to: 'ปลายทาง ' + (i + 1),
    fromGeo: { lat: 13.60 + i * 0.05, lng: 100.50 + i * 0.03 },
    toGeo:   { lat: 13.70 + i * 0.05, lng: 100.60 + i * 0.03 }
  }));
  const mapOf = async (entries, withMainPins) => {
    const rec = mkRec(entries, 260);
    rec.inputMetadata._pdfTemplates = ['TRANSPORT_RECEIPT'];
    if (withMainPins) {
      rec.inputMetadata._travel.fromGeo = { lat: 13.60, lng: 100.53, precision: 'exact' };
      rec.inputMetadata._travel.toGeo   = { lat: 13.91, lng: 100.60, precision: 'exact' };
    }
    return ev([
      "const rec = " + JSON.stringify(rec) + ";",
      "const legs = mapLegsOf(rec.inputMetadata);",
      "return { kinds: legs.map(l => l.kind), ends: legs.map(l => l.from.label + '>' + l.to.label) };"
    ].join(NL));
  };

  const five = await mapOf(legFive(5), true);
  ok('เที่ยวที่ปักหมุดครบทั้ง 5 เที่ยว ได้แผนที่ 5 รูป', five.kinds.length === 5 && five.kinds.every(k => k === 'taxi'),
     five.kinds.join(','));
  ok('จาก/ถึง ของแต่ละแผนที่ตรงกับที่กรอกทุกเที่ยว',
     five.ends.join(' ') === [1, 2, 3, 4, 5].map(i => 'ต้นทาง ' + i + '>ปลายทาง ' + i).join(' '),
     five.ends.join(' | '));

  const noMain = await mapOf(legFive(3), false);
  ok('ใบที่เบิกเฉพาะ Taxi (ไม่มีหมุดเส้นทางหลัก) ก็ยังได้แผนที่ทุกเที่ยว',
     noMain.kinds.length === 3, noMain.kinds.length + ' รูป');

  const noPins = await mapOf([{ date: '2026-10-22', direction: 'ขาไป', amount: 90,
                                from: 'ก', to: 'ข' }], true);
  ok('เที่ยวที่ยังไม่ปักหมุดไม่มีแผนที่ของตัวเอง (เหลือแผนที่เส้นทางหลักเหมือนเดิม)',
     noPins.kinds.join(',') === 'route', noPins.kinds.join(','));

  console.log('');
  console.log('═══ 10. เรียกตัววาดแผนที่จริง ═══');
  /* ข้อ 9 ตรวจแค่รายการขา ซึ่งยังไม่พิสูจน์ว่า "เส้นถูกวาดลงภาพ"
     ข้อนี้เรียกตัววาดจริง เส้นทางหลักกับเที่ยว Taxi ต้องได้ภาพทั้งคู่และภาพต่างกัน */
  /* ตอนต้นเทสต์มีการวาง renderRouteMapImage ตัวปลอมไว้ (คืนสตริง MAPSTUB)
     ถ้าไม่โหลดหน้าใหม่ ข้อนี้จะไปเรียกตัวปลอมแล้วได้ภาพเท่ากันทั้งสองครั้ง
     ซึ่งเป็น "เขียวหลอก" กลับด้าน — ตกทั้งที่โค้ดจริงถูก (เจอจริงตอนรันครั้งแรก) */
  await send('Page.navigate', { url: APP + '/history.html' });
  await sleep(5000);

  const drawReal = await ev([
    "const main = { kind:'route', dir:'ขาไป', from:{label:'บ้าน', geo:{lat:13.60,lng:100.53}},",
    "               to:{label:'ดอนเมือง', geo:{lat:13.91,lng:100.60}}, path:null };",
    "const leg = { kind:'taxi', dir:'ขาไป', from:{label:'ก', geo:{lat:13.62,lng:100.45}},",
    "              to:{label:'ข', geo:{lat:13.75,lng:100.70}}, path:null };",
    "const a = await renderRouteMapImage(main);",
    "const b = await renderRouteMapImage(leg);",
    "return { hasA: !!a, hasB: !!b, same: a === b, lenA: a ? a.length : 0, lenB: b ? b.length : 0 };"
  ].join(NL));
  ok('วาดแผนที่ของเส้นทางหลักได้', drawReal.hasA === true);
  ok('วาดแผนที่ของเที่ยว Taxi ได้', drawReal.hasB === true);
  ok('ภาพต่างกันจริง — แต่ละขาได้ภาพของตัวเอง',
     drawReal.same === false, 'ขนาดภาพ ' + drawReal.lenA + ' vs ' + drawReal.lenB);

  console.log('');
  ok('ไม่มี JavaScript error ตลอดการทดสอบ', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '));

  console.log('');
  console.log('══════════════════════════════════════════════════');
  console.log('  ผ่าน ' + results.filter(Boolean).length + ' / ' + results.length);
  console.log('══════════════════════════════════════════════════');
  process.exitCode = results.every(Boolean) ? 0 : 1;
} catch (e) { console.error('ล้มเหลว:', e.message); process.exitCode = 2; }
finally { try { ws.close(); } catch {} chrome.kill(); }
