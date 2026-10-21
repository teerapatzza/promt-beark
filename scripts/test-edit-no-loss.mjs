// เปิดใบมาแก้แล้วกดบันทึกโดยไม่แตะอะไรเลย ข้อมูลต้องเท่าเดิมทุกช่อง
//
// 21 ต.ค. 2569 — เจ้าของงานแจ้งว่า "เหมือนเคยเซฟไว้แล้วมาแก้ไขอีกรอบ
// มันไม่ได้เป็นข้อมูลของครั้งล่าสุดที่แก้ไข แต่เป็นเนื้อหาตั้งแต่ครั้งแรกเลย"
//
// ชุดนี้ไม่ได้เดาว่าช่องไหนพัง แต่เทียบ "ของที่ใส่เข้าไป" กับ "ของที่ส่งออกมา"
// ทีละคีย์ ช่องไหนหายหรือเปลี่ยนค่าเองจะโผล่มาเอง
// เป็นวิธีเดียวที่จับได้ทั้งช่องที่ยังไม่มีใครนึกถึงด้วย
//
//   cd public && python3 -m http.server 8099 --bind 127.0.0.1
//   node scripts/test-edit-no-loss.mjs
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9653, PROFILE = 'C:/Users/teerapat/AppData/Local/Temp/pb-noloss';
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

const FLAT = { enabled: true, maxKm: 200, outsideMetro: 1200, bands: [
  { upTo: 10.99, amount: 150 }, { upTo: 20.99, amount: 250 }, { upTo: null, amount: 750 } ] };

/* ใบที่ใส่ของครบทุกอย่างเท่าที่ฟอร์มรองรับ
   ยิ่งครบยิ่งจับได้มาก เพราะช่องที่ไม่มีใครกรอกคือช่องที่พังแล้วไม่มีใครรู้ */
const SAVED = {
  id: 9901, requestedBy: 'ธีรภัทร คุ้มวงษ์', position: 'นักวิเคราะห์ธุรกิจ',
  amount: 3500, category: 'TRAVEL002', date: '2026-10-21',
  description: 'เบิกค่าเดินทางไปปฏิบัติงาน',
  attachments: { images: ['data:image/png;base64,iVBORw0KGgo='] },
  inputMetadata: {
    _pdfTemplates: ['REPORT', 'TRANSPORT_RECEIPT'],
    _budgetCategoryId: 'TRAVEL002',
    _activityName: 'กิจกรรมเยี่ยมสำรวจ',
    _extraActivities: ['ประชุมคณะทำงานครั้งที่ 3'],
    _position: 'นักวิเคราะห์ธุรกิจ', _affiliation: 'อิสระ',
    _docDate: '2026-10-21',
    _addr: { no: '141/36', soi: 'สุขสวัสดิ์ 55', road: 'สุขสวัสดิ์',
             sub: 'ปากคลองบางปลากด', dist: 'พระสมุทรเจดีย์',
             prov: 'สมุทรปราการ', zip: '10290' },
    _extraAddr: '141/36 ซอยสุขสวัสดิ์ 55 ถนนสุขสวัสดิ์ สมุทรปราการ 10290',
    _travel: {
      startDate: '2026-10-21', endDate: '2026-10-23',
      from: 'บ้าน', to: 'สนามบินดอนเมือง',
      fromGeo: { lat: 13.60, lng: 100.53, precision: 'exact', label: 'บ้าน' },
      toGeo:   { lat: 13.91, lng: 100.60, precision: 'exact', label: 'สนามบินดอนเมือง' },
      distOut: 45.7, distRet: 45.7,
      useAppMap: false
    },
    _carType: 'ไม่ระบุ',
    _fuelMethod: 'flat', _flatVehicle: 'taxi',
    _flatRate: { total: 1500, legs: [
      { dir: 'ขาไป',   km: 45.7, amount: 750, label: 'ระยะทาง 21.00 กม. ขึ้นไป' },
      { dir: 'ขากลับ', km: 45.7, amount: 750, label: 'ระยะทาง 21.00 กม. ขึ้นไป' } ] },
    _costs: {
      fuelRate: '5', airAmount: 0, tollAmount: 0, parkingAmount: 0, otherAmount: 0,
      taxiEntries: [],
      hotelEntries: { name: 'โรงแรมทดสอบ', entries: [
        { type: 'พักคู่', rate: '1000', nights: '2', withWho: 'นพ.สมชาย ใจดี' } ] }
    }
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
    "window.__saved = null;",
    "const FLAT=" + JSON.stringify(FLAT) + ";",
    "const REC=" + JSON.stringify(SAVED) + ";",
    "const of=window.fetch;",
    "window.fetch=function(u,i){const s=(typeof u==='string')?u:(u&&u.url)||'';",
    "  if(s.indexOf('/auth/me')>=0) return Promise.resolve(new Response(",
    "    JSON.stringify({id:1,email:'t@ha.or.th',name:'test',role:'admin'}),",
    "    {status:200,headers:{'Content-Type':'application/json'}}));",
    "  if(s.indexOf('/settings')>=0&&s.indexOf('list-append')<0) return Promise.resolve(new Response(",
    "    JSON.stringify({fuelRate:5,taxiMaxPerTrip:750,hotelRateSingle:1500,hotelRateDouble:1000,",
    "      positionList:['นักวิเคราะห์ธุรกิจ'],affiliationList:['อิสระ'],",
    "      activityList:['กิจกรรมเยี่ยมสำรวจ']}),",
    "    {status:200,headers:{'Content-Type':'application/json'}}));",
    "  if(s.indexOf('/budget-categories')>=0) return Promise.resolve(new Response(",
    "    JSON.stringify([{id:'TRAVEL002',name:'test',fuelRate:5,taxiMaxPerTrip:750,flatRate:FLAT,",
    "      pdfTemplates:['REPORT','TRANSPORT_RECEIPT'],",
    "      attachmentRules:{ LOCATION:{show:true,required:false,label:'แผนที่'},",
    "                        RECEIPT:{show:true,required:false,label:'ใบเสร็จ'} },",
    "      attachmentOrder:['LOCATION','RECEIPT']}]),",
    "    {status:200,headers:{'Content-Type':'application/json'}}));",
    "  if(i && (i.method==='PUT'||i.method==='POST') && s.indexOf('/expenses')>=0){",
    "    window.__saved = i.body; return new Promise(()=>{}); }",
    "  if(/\\/expenses\\/9901(\\?|$)/.test(s)) return Promise.resolve(new Response(",
    "    JSON.stringify(REC), {status:200,headers:{'Content-Type':'application/json'}}));",
    "  if(s.indexOf('/expenses')>=0) return Promise.resolve(new Response(",
    "    JSON.stringify([REC]), {status:200,headers:{'Content-Type':'application/json'}}));",
    "  if(s.indexOf('/profiles')>=0) return Promise.resolve(new Response('[]',",
    "    {status:200,headers:{'Content-Type':'application/json'}}));",
    "  return of(u,i);};",
    "window.routeLeg = async () => ({ km: 45.7, meters: 45700, coords: [] });"
  ].join(NL) });

  await send('Page.navigate', { url: APP + '/expense.html?edit=9901' });
  await sleep(7000);

  console.log('═══ 1. กดบันทึกทันทีโดยไม่แตะอะไรเลย ═══');
  const sent = await ev([
    "window.alert = m => { (window.__a = window.__a || []).push(String(m)); };",
    "window.__a = [];",
    "const b = document.getElementById('submitBtn'); if (b) b.disabled = false;",
    "if (b) b.click();",
    "await new Promise(r => setTimeout(r, 2500));",
    "return { body: window.__saved, alerts: (window.__a||[]).slice(0,3) };"
  ].join(NL));
  let out = null;
  try { out = JSON.parse(sent.body || 'null'); } catch (e) {}
  ok('บันทึกออกไปได้ ไม่ถูกตีกลับ', !!out,
     out ? 'ส่งออกแล้ว' : ((sent.alerts || []).join(' | ').slice(0, 200) || 'ไม่ได้ส่ง'));

  if (!out) {
    console.log('');
    console.log('หยุดตรงนี้ เพราะไม่มีข้อมูลที่ส่งออกให้เทียบ');
  } else {
    const A = SAVED.inputMetadata, B = out.inputMetadata || {};
    const j = x => JSON.stringify(x);
    const cmp = (name, a, b) => ok(name, j(a) === j(b), j(a) + '  ->  ' + j(b));

    console.log('');
    console.log('═══ 2. ข้อมูลหลักต้องเท่าเดิมทุกช่อง ═══');
    cmp('ยอดเงิน', SAVED.amount, out.amount);
    cmp('ชื่อผู้ขอเบิก', SAVED.requestedBy, out.requestedBy);
    cmp('ชื่อกิจกรรม', A._activityName, B._activityName);
    cmp('กิจกรรมแถวล่าง', A._extraActivities, B._extraActivities);
    cmp('บทบาท', A._position, B._position);
    cmp('ส่วนงาน', A._affiliation, B._affiliation);
    cmp('วันที่บนเอกสาร', A._docDate, B._docDate);
    const addrKeys = Object.keys(A._addr);
    const addrDiff = addrKeys.filter(k => String(A._addr[k]) !== String((B._addr||{})[k]));
    ok('ที่อยู่ (เทียบทีละช่อง ไม่สนลำดับคีย์)', addrDiff.length === 0,
       addrDiff.length ? addrDiff.join(', ') : 'ครบ ' + addrKeys.length + ' ช่อง');
    cmp('ที่อยู่แถวท้ายตาราง', A._extraAddr, B._extraAddr);

    console.log('');
    console.log('═══ 3. การเดินทาง ═══');
    const at = A._travel, bt = B._travel || {};
    cmp('วันเดินทาง', [at.startDate, at.endDate], [bt.startDate, bt.endDate]);
    cmp('ต้นทาง-ปลายทาง', [at.from, at.to], [bt.from, bt.to]);
    ok('ระยะทาง (เทียบเป็นตัวเลข)',
       Number(at.distOut) === Number(bt.distOut) && Number(at.distRet) === Number(bt.distRet),
       j([at.distOut, at.distRet]) + '  ->  ' + j([bt.distOut, bt.distRet]));
    cmp('ติ๊กใช้แผนที่จากระบบ', at.useAppMap, bt.useAppMap);
    ok('หมุดต้นทางยังอยู่', !!(bt.fromGeo && bt.fromGeo.lat), j(bt.fromGeo));
    ok('หมุดปลายทางยังอยู่', !!(bt.toGeo && bt.toGeo.lat), j(bt.toGeo));

    console.log('');
    console.log('═══ 4. วิธีคิดเงิน ═══');
    cmp('วิธีคิดค่าพาหนะ', A._fuelMethod, B._fuelMethod);
    cmp('เดินทางด้วยอะไร (เหมาจ่าย)', A._flatVehicle, B._flatVehicle);
    cmp('ยอดเหมาจ่าย', A._flatRate.total, (B._flatRate || {}).total);
    cmp('จำนวนขาที่เบิก', A._flatRate.legs.length, ((B._flatRate || {}).legs || []).length);
    cmp('รูปแบบรถ', A._carType, B._carType);

    console.log('');
    console.log('═══ 5. ค่าใช้จ่าย ═══');
    const ac = A._costs, bc = B._costs || {};
    cmp('อัตราค่าน้ำมัน', ac.fuelRate, bc.fuelRate);
    cmp('ค่าทางด่วน', ac.tollAmount, bc.tollAmount);
    cmp('ค่าที่จอดรถ', ac.parkingAmount, bc.parkingAmount);
    cmp('รายการ Taxi', ac.taxiEntries, bc.taxiEntries);
    cmp('ชื่อโรงแรม', ac.hotelEntries.name, (bc.hotelEntries || {}).name);
    cmp('รายการที่พัก', ac.hotelEntries.entries, (bc.hotelEntries || {}).entries);

    console.log('');
    console.log('═══ 6. ไฟล์แนบเดิมต้องไม่หายเพราะกดแก้เฉย ๆ ═══');
    const imgs = (out.attachments && out.attachments.images) || [];
    ok('ไฟล์แนบเดิมยังอยู่ครบ', imgs.length === 1, imgs.length + ' ไฟล์');
    ok('ติดธงบอกว่ารายการไฟล์ที่ส่งมาครบแล้ว',
       out.attachmentsComplete === true, j(out.attachmentsComplete));

    console.log('');
    console.log('═══ 7. คีย์ที่หายไปทั้งก้อน (จับของที่ยังไม่มีใครนึกถึง) ═══');
    const missing = Object.keys(A).filter(k => !(k in B));
    ok('ไม่มีคีย์ไหนของ inputMetadata หายไป', missing.length === 0,
       missing.length ? missing.join(', ') : 'ครบทุกคีย์ (' + Object.keys(A).length + ' คีย์)');
    const tMissing = Object.keys(at).filter(k => !(k in bt));
    ok('ไม่มีคีย์ไหนของ _travel หายไป', tMissing.length === 0,
       tMissing.length ? tMissing.join(', ') : 'ครบทุกคีย์ (' + Object.keys(at).length + ' คีย์)');
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
