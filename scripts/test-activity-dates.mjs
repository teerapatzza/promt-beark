// วันที่จัดกิจกรรม ต้องแยกขาดจากวันเดินทาง
//
// 22 ต.ค. 2569 — เจ้าของงานชี้ว่าเอกสารออกมาผิดความหมาย
//   "ในระหว่างวันที่ ไม่เท่ากับ วันที่กลับถึงที่พัก เพราะในระหว่างเป็นวันที่เกิดกิจกรรม
//    ส่วนวันที่ออกเดินทางคือวันที่ออกเดินทางไปและเดินทางกลับ มันไม่ควรจะเท่ากัน"
//
// ของเดิมช่อง "ในระหว่างวันที่" นั่งอยู่ในกล่องกำหนดการเดินทาง และลอกวันเดินทาง
// มาให้เองพร้อมป้ายเขียว "ตามวันเดินทางด้านบน" เหมือนเป็นเรื่องปกติ
// ผู้ใช้ส่วนใหญ่จึงไม่แตะ แล้ววันที่ผิดความหมายก็ไหลลงใบรายงานที่ส่งการเงิน
//
// หลักฐานจากฐานข้อมูลจริง 22 ต.ค. 2569 — มี 17 ใบที่ผู้ใช้ตั้งช่วงกิจกรรมเอง
// และ 14 ใบใช้กฎเดียวกันเป๊ะ คือ ออกเดินทางล่วงหน้า 1 วัน กิจกรรมเริ่มวันรุ่งขึ้น
// จบวันเดียวกับวันกลับ  ปุ่มลัดในข้อ 4 จึงมาจากพฤติกรรมจริง ไม่ได้คิดเอง
//
// และเจอใบที่ข้อมูลผิดโดยไม่มีด่านไหนจับ 2 ใบ
//   id=108 เดินทาง 15→15 แต่กิจกรรม 16→15  (วันเริ่มอยู่หลังวันจบ)
//   id=123 เดินทาง 24→26 แต่กิจกรรม 25→27  (กิจกรรมจบหลังกลับถึงบ้าน)
//
//   cd public && python3 -m http.server 8099 --bind 127.0.0.1
//   node scripts/test-activity-dates.mjs
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9665, PROFILE = 'C:/Users/teerapat/AppData/Local/Temp/pb-actdates';
const APP = process.env.APP_URL || 'http://127.0.0.1:8099';
const NL = String.fromCharCode(10);

const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=' + PORT,
  '--user-data-dir=' + PROFILE, '--no-first-run', '--disable-gpu',
  '--window-size=1400,1600', 'about:blank'], { stdio: 'ignore' });

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
/* ค่าตั้งของหมวดจริงบนโปรดักชัน — TRAVEL001 มีใบรายงาน TRAVEL004 ไม่มี */
const CATS = [
  { id: 'TRAVEL001', name: 'เบิกค่าเดินทาง+ที่พัก',
    pdfTemplates: ['REPORT', 'TRANSPORT_RECEIPT'], fuelRate: 5, taxiMaxPerTrip: 750, flatRate: FLAT,
    attachmentRules: { LOCATION: { show: true, required: false, label: 'แผนที่' },
                       RECEIPT:  { show: true, required: false, label: 'ใบเสร็จ' } },
    attachmentOrder: ['LOCATION', 'RECEIPT'] },
  { id: 'TRAVEL004', name: 'เบิกค่าพาหนะ',
    pdfTemplates: ['TRANSPORT_RECEIPT'], fuelRate: 5, taxiMaxPerTrip: 750, flatRate: FLAT,
    attachmentRules: { LOCATION: { show: true, required: false, label: 'แผนที่' },
                       RECEIPT:  { show: true, required: false, label: 'ใบเสร็จ' } },
    attachmentOrder: ['LOCATION', 'RECEIPT'] }
];

/* ใบเก่าที่ข้อมูลช่วงกิจกรรมเพี้ยนอยู่แล้ว (ตัวจริงคือ id=108 บนโปรดักชัน)
   เปิดมาแก้ต้องได้ค่าเดิมกลับมาครบ ห้ามพัง ห้ามเงียบ ๆ เปลี่ยนให้เอง */
const OLD = {
  id: 9981, requestedBy: 'ผู้เบิกทดสอบ', position: 'นักวิเคราะห์ธุรกิจ',
  amount: 499, category: 'TRAVEL001', date: '2026-10-15',
  description: 'กิจกรรมเยี่ยมสำรวจ', attachments: { images: [] },
  inputMetadata: {
    _pdfTemplates: ['REPORT', 'TRANSPORT_RECEIPT'], _budgetCategoryId: 'TRAVEL001',
    _activityName: 'กิจกรรมเยี่ยมสำรวจ', _extraActivities: [],
    _position: 'นักวิเคราะห์ธุรกิจ', _affiliation: 'อิสระ', _docDate: '2026-10-15',
    _addr: { no: '99/9', soi: 'ทดสอบ', road: 'ทดสอบ', sub: 'ทดสอบ',
             dist: 'ทดสอบ', prov: 'สมุทรปราการ', zip: '10290' },
    _travel: { startDate: '2026-10-15', endDate: '2026-10-15',
               periodStart: '2026-10-16', periodEnd: '2026-10-15',   // กลับหัวจริงในฐานข้อมูล
               from: 'จุดทดสอบ 1', to: 'จุดทดสอบ 2', distOut: 20, distRet: 20 },
    _carType: 'ไป-กลับ',
    _costs: { fuelRate: '5', airAmount: 0, tollAmount: 0, parkingAmount: 0, otherAmount: 0,
              taxiEntries: [], hotelEntries: { entries: [] } }
  }
};

/* ใบยุคก่อนมีช่องช่วงกิจกรรม — ไม่มี periodStart/periodEnd เลยในฐานข้อมูล
   บนโปรดักชันมีแบบนี้อยู่ 21 ใบ (ตรวจเมื่อ 22 ต.ค. 2569) */
const OLD_NO_PERIOD = JSON.parse(JSON.stringify(OLD));
OLD_NO_PERIOD.id = 9982;
delete OLD_NO_PERIOD.inputMetadata._travel.periodStart;
delete OLD_NO_PERIOD.inputMetadata._travel.periodEnd;

const stub = [
  "localStorage.setItem('token','x');",
  "const CATS=" + JSON.stringify(CATS) + ";",
  "const OLD=" + JSON.stringify(OLD) + ";",
  "const OLD2=" + JSON.stringify(OLD_NO_PERIOD) + ";",
  "window.__saved=null; window.__a=[];",
  "const of=window.fetch;",
  "window.fetch=function(u,i){const s=(typeof u==='string')?u:(u&&u.url)||'';",
  "  if(s.indexOf('/auth/me')>=0) return Promise.resolve(new Response(",
  "    JSON.stringify({id:1,email:'t@example.invalid',name:'test',role:'admin'}),",
  "    {status:200,headers:{'Content-Type':'application/json'}}));",
  "  if(s.indexOf('/settings')>=0&&s.indexOf('list-append')<0) return Promise.resolve(new Response(",
  "    JSON.stringify({fuelRate:5,taxiMaxPerTrip:750,positionList:[],affiliationList:[],activityList:[]}),",
  "    {status:200,headers:{'Content-Type':'application/json'}}));",
  "  if(s.indexOf('/budget-categories')>=0) return Promise.resolve(new Response(",
  "    JSON.stringify(CATS),{status:200,headers:{'Content-Type':'application/json'}}));",
  "  if(i&&(i.method==='POST'||i.method==='PUT')&&s.indexOf('/expenses')>=0){",
  "    window.__saved=i.body; return new Promise(()=>{}); }",
  "  if(s.indexOf('/expenses')>=0) return Promise.resolve(new Response(",
  "    JSON.stringify([OLD,OLD2]),{status:200,headers:{'Content-Type':'application/json'}}));",
  "  if(s.indexOf('/profiles')>=0) return Promise.resolve(new Response('[]',",
  "    {status:200,headers:{'Content-Type':'application/json'}}));",
  "  if(s.indexOf('/map-route')>=0) return Promise.resolve(new Response(",
  "    JSON.stringify({features:[{properties:{distance:20000},",
  "      geometry:{type:'LineString',coordinates:[[100.5,13.6],[100.6,13.7]]}}]}),",
  "    {status:200,headers:{'Content-Type':'application/json'}}));",
  "  return of(u,i);};"
].join(NL);

/** เปิดฟอร์มเปล่าแล้วเลือกหมวด + ใส่วันเดินทาง */
const setup = (catId, ds, de) => [
  "const s=document.getElementById('categorySelect');",
  "s.value='" + catId + "'; s.dispatchEvent(new Event('change',{bubbles:true}));",
  "await new Promise(r=>setTimeout(r,1400));",
  "const a=document.getElementById('dateStart'), b=document.getElementById('dateEnd');",
  "if(a){ a.value='" + ds + "'; a.dispatchEvent(new Event('change',{bubbles:true})); }",
  "if(b){ b.value='" + de + "'; b.dispatchEvent(new Event('change',{bubbles:true})); }",
  "await new Promise(r=>setTimeout(r,700));",
  "return 1;"
].join(NL);

/** กรอกช่องบังคับที่เหลือแล้วกดบันทึก คืนว่าถูกบล็อกด้วยข้อความอะไร */
const trySave = [
  "window.__saved=null; window.__a=[];",
  "window.alert = m => { window.__a.push(String(m)); };",
  "const set=(id,v)=>{const e=document.getElementById(id); if(e){e.value=v;}};",
  "set('requestedBy','ผู้เบิกทดสอบ'); set('activityName','กิจกรรมเยี่ยมสำรวจ');",
  "set('position','นักวิเคราะห์ธุรกิจ'); set('affiliation','อิสระ');",
  /* ต้องใส่เส้นทางหลักด้วย ไม่งั้นโดนด่าน "ยังไม่ระบุจุดเริ่มต้น/ปลายทาง" ก่อน
     แล้วชุดนี้จะผ่านหรือตกด้วยเหตุผลที่ไม่เกี่ยวกับวันที่เลย */
  "set('travelFrom','จุดทดสอบ 1'); set('travelTo','จุดทดสอบ 2');",
  "set('distOutbound','20'); set('distReturn','20');",
  "const ct=document.getElementById('carType');",
  "if(ct){ ct.value='ไป-กลับ'; ct.dispatchEvent(new Event('change',{bubbles:true})); }",
  "const um=document.getElementById('useAppMapImage'); if(um&&um.checked){ um.checked=false;",
  "  um.dispatchEvent(new Event('change',{bubbles:true})); }",
  "await new Promise(r=>setTimeout(r,400));",
  "const mi=document.getElementById('mapManualUpload');",
  "if(mi){ const dt=new DataTransfer();",
  "  dt.items.add(new File([new Uint8Array([137,80,78,71])],'แผนที่.png',{type:'image/png'}));",
  "  mi.files=dt.files; mi.dispatchEvent(new Event('change',{bubbles:true})); }",
  "document.querySelectorAll('.general-file-upload.required-file').forEach(inp=>{",
  "  const dt=new DataTransfer();",
  "  dt.items.add(new File([new Uint8Array([137,80,78,71])],'หลักฐาน.png',{type:'image/png'}));",
  "  inp.files=dt.files; inp.dispatchEvent(new Event('change',{bubbles:true})); });",
  "await new Promise(r=>setTimeout(r,500));",
  "const b=document.getElementById('submitBtn'); if(b){ b.disabled=false; b.click(); }",
  "await new Promise(r=>setTimeout(r,2200));",
  "return { saved: window.__saved, alerts: window.__a.slice(0,3) };"
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
  await send('Page.addScriptToEvaluateOnNewDocument', { source: stub });

  console.log('═══ 1. ช่องต้องอยู่กับกิจกรรม ไม่ใช่กล่องเดินทาง ═══');
  await send('Page.navigate', { url: APP + '/expense.html' });
  await sleep(4500);
  await ev(setup('TRAVEL001', '2026-10-13', '2026-10-15'));

  const place = await ev([
    "const ps=document.getElementById('periodStart');",
    "if(!ps) return { found:false };",
    "const inTravel = !!ps.closest('#travelTimeBox');",
    "const act = document.getElementById('activityDateBox');",
    "const label = (document.querySelector('label[for=\"periodStart\"]')",
    "   || (ps.closest('div')||{}).previousElementSibling || {}).textContent || '';",
    "const box = ps.closest('[id]');",
    "return { found:true, inTravel:inTravel, hasActBox:!!act,",
    "         inActBox: !!(act && act.contains(ps)),",
    "         label: String(label).replace(/\\s+/g,' ').trim(),",
    "         boxId: box ? box.id : '' };"
  ].join(NL));

  ok('ยังมีช่องช่วงกิจกรรมอยู่ (ไม่ได้ลบทิ้ง)', place.found === true);
  ok('ช่องออกจากกล่องกำหนดการเดินทางแล้ว', place.inTravel === false,
     place.inTravel ? 'ยังอยู่ใน travelTimeBox' : 'ออกแล้ว');
  ok('ช่องไปอยู่ในกล่องกิจกรรม', place.inActBox === true,
     'กล่องที่พบ: ' + (place.boxId || '-'));

  const wording = await ev([
    "const t = document.body.innerText || '';",
    "return { hasNew: t.indexOf('วันที่จัดกิจกรรม') >= 0,",
    "         hasOld: t.indexOf('ในระหว่างวันที่') >= 0,",
    "         hasAutoBadge: t.indexOf('ตามวันเดินทางด้านบน') >= 0 };"
  ].join(NL));
  ok('ใช้คำว่า "วันที่จัดกิจกรรม"', wording.hasNew === true);
  ok('ไม่มีป้าย "ตามวันเดินทางด้านบน" อีกแล้ว', wording.hasAutoBadge === false);

  console.log('');
  console.log('═══ 2. ต้องไม่ลอกวันเดินทางมาให้เอง ═══');
  const vals = await ev([
    "const ps=document.getElementById('periodStart'), pe=document.getElementById('periodEnd');",
    "return { ps: ps?ps.value:'(ไม่มีช่อง)', pe: pe?pe.value:'(ไม่มีช่อง)',",
    "         ds: document.getElementById('dateStart').value,",
    "         de: document.getElementById('dateEnd').value };"
  ].join(NL));
  ok('กรอกวันเดินทางแล้ว ช่องกิจกรรมยังว่าง', vals.ps === '' && vals.pe === '',
     'กิจกรรม [' + vals.ps + ' .. ' + vals.pe + '] เดินทาง [' + vals.ds + ' .. ' + vals.de + ']');

  console.log('');
  console.log('═══ 3. หมวดที่มีใบรายงาน ไม่กรอกต้องบันทึกไม่ได้ ═══');
  const blocked = await ev(trySave);
  ok('ถูกบล็อก ไม่ได้ส่งออก', !blocked.saved,
     blocked.saved ? 'หลุดไปแล้ว' : (blocked.alerts[0] || '').slice(0, 70));
  ok('ข้อความบอกว่าต้องกรอกวันที่จัดกิจกรรม',
     (blocked.alerts[0] || '').indexOf('วันที่จัดกิจกรรม') >= 0,
     (blocked.alerts[0] || '').slice(0, 90));

  console.log('');
  console.log('═══ 4. ปุ่มลัด "วันรุ่งขึ้น → วันกลับ" ═══');
  const quick = await ev([
    "const btn=document.getElementById('periodQuick');",
    "if(!btn) return { found:false };",
    "btn.click(); await new Promise(r=>setTimeout(r,250));",
    "return { found:true, ps:document.getElementById('periodStart').value,",
    "         pe:document.getElementById('periodEnd').value };"
  ].join(NL));
  ok('มีปุ่มลัดให้กด', quick.found === true);
  ok('กดแล้วได้ วันออกเดินทาง+1 ถึง วันกลับ (14 ถึง 15)',
     quick.ps === '2026-10-14' && quick.pe === '2026-10-15',
     quick.ps + ' .. ' + quick.pe);

  console.log('');
  console.log('═══ 5. กรอกครบแล้วต้องบันทึกได้ และส่งค่าออกไปถูก ═══');
  const saved = await ev(trySave);
  let body = null; try { body = JSON.parse(saved.saved || 'null'); } catch (e) {}
  ok('บันทึกผ่าน', !!body, body ? 'ส่งออกแล้ว' : (saved.alerts[0] || '').slice(0, 80));
  if (body) {
    const t = ((body.inputMetadata || {})._travel) || {};
    ok('ส่งช่วงกิจกรรมออกไปตามที่กรอก',
       t.periodStart === '2026-10-14' && t.periodEnd === '2026-10-15',
       t.periodStart + ' .. ' + t.periodEnd);
    ok('วันเดินทางยังเป็นของเดิม ไม่ถูกกลืนรวมกัน',
       t.startDate === '2026-10-13' && t.endDate === '2026-10-15',
       t.startDate + ' .. ' + t.endDate);
  }

  console.log('');
  console.log('═══ 6. ด่านกันวันกลับหัว และกิจกรรมจบหลังกลับถึง ═══');
  const rev = await ev([
    "document.getElementById('periodStart').value='2026-10-15';",
    "document.getElementById('periodEnd').value='2026-10-14';",
    "document.getElementById('periodStart').dispatchEvent(new Event('change',{bubbles:true}));",
    "await new Promise(r=>setTimeout(r,250));",
    trySave
  ].join(NL));
  ok('วันเริ่มอยู่หลังวันจบ = บันทึกไม่ได้', !rev.saved,
     rev.saved ? 'หลุดไปแล้ว' : (rev.alerts[0] || '').slice(0, 70));

  const after = await ev([
    "document.getElementById('periodStart').value='2026-10-14';",
    "document.getElementById('periodEnd').value='2026-10-20';",   // หลังวันกลับถึง 15
    "document.getElementById('periodEnd').dispatchEvent(new Event('change',{bubbles:true}));",
    "await new Promise(r=>setTimeout(r,250));",
    "window.confirm = () => false;",      // ผู้ใช้กด "ยกเลิก" ตอนระบบเตือน
    trySave
  ].join(NL));
  ok('กิจกรรมจบหลังวันกลับถึง = เตือนแล้วหยุดถ้าผู้ใช้ไม่ยืนยัน', !after.saved,
     after.saved ? 'ผ่านไปเงียบ ๆ' : 'หยุดให้ตรวจ');

  console.log('');
  console.log('═══ 7. หมวดที่ไม่มีใบรายงาน ต้องไม่โชว์ช่องนี้เลย ═══');
  await send('Page.navigate', { url: APP + '/expense.html' });
  await sleep(4500);
  await ev(setup('TRAVEL004', '2026-10-13', '2026-10-15'));
  const t4 = await ev([
    "const ps=document.getElementById('periodStart');",
    "const vis = !!(ps && ps.offsetParent !== null);",
    "return { vis: vis };"
  ].join(NL));
  ok('หมวดเบิกค่าพาหนะ ช่องวันที่จัดกิจกรรมถูกซ่อน', t4.vis === false,
     t4.vis ? 'ยังโชว์อยู่ ผู้ใช้จะกรอกเปล่า' : 'ซ่อนแล้ว');

  const t4save = await ev(trySave);
  let t4body = null; try { t4body = JSON.parse(t4save.saved || 'null'); } catch (e) {}
  ok('บันทึกได้โดยไม่ต้องกรอกวันที่จัดกิจกรรม', !!t4body,
     t4body ? 'ผ่าน' : (t4save.alerts[0] || '').slice(0, 80));

  console.log('');
  console.log('═══ 8. เปิดใบเก่าที่ข้อมูลเพี้ยนมาแก้ ต้องไม่พังและไม่แก้ให้เงียบ ๆ ═══');
  await send('Page.navigate', { url: APP + '/expense.html?edit=9981' });
  await sleep(6000);
  const old = await ev([
    "const ps=document.getElementById('periodStart'), pe=document.getElementById('periodEnd');",
    "return { ps: ps?ps.value:'', pe: pe?pe.value:'',",
    "         ds: document.getElementById('dateStart').value,",
    "         de: document.getElementById('dateEnd').value,",
    "         saveDisabled: !!document.getElementById('submitBtn').disabled };"
  ].join(NL));
  ok('เปิดใบเก่าได้ ปุ่มบันทึกไม่ถูกปิด', old.saveDisabled === false);
  ok('ค่าช่วงกิจกรรมเดิมกลับมาครบ ไม่ถูกเขียนทับ',
     old.ps === '2026-10-16' && old.pe === '2026-10-15',
     old.ps + ' .. ' + old.pe + ' (ควรเป็น 2026-10-16 .. 2026-10-15)');
  ok('วันเดินทางเดิมกลับมาถูก', old.ds === '2026-10-15' && old.de === '2026-10-15',
     old.ds + ' .. ' + old.de);

  console.log('');
  console.log('═══ 9. ใบเก่าที่ไม่เคยมีช่วงกิจกรรมเลย (ของจริง 21 ใบ) ═══');
  /* ใบยุคก่อนมีช่องนี้ ไม่มี periodStart/periodEnd ในฐานข้อมูลเลย
     เอกสารของใบพวกนี้พิมพ์วันเดินทางแทน เพราะฝั่งเอกสารมี tr.periodStart || tr.startDate
     เปิดมาแก้ต้องได้ช่องว่าง (ไม่ใช่เดาให้) และต้องถูกทักก่อนบันทึกทับ */
  await send('Page.navigate', { url: APP + '/expense.html?edit=9982' });
  await sleep(6000);
  const noPeriod = await ev([
    "const ps=document.getElementById('periodStart'), pe=document.getElementById('periodEnd');",
    "return { ps: ps?ps.value:'(ไม่มีช่อง)', pe: pe?pe.value:'(ไม่มีช่อง)',",
    "         saveDisabled: !!document.getElementById('submitBtn').disabled };"
  ].join(NL));
  ok('เปิดใบเก่าได้ตามปกติ', noPeriod.saveDisabled === false);
  ok('ช่องว่าง ไม่เดาวันให้เอง', noPeriod.ps === '' && noPeriod.pe === '',
     noPeriod.ps + ' .. ' + noPeriod.pe);

  const noPeriodSave = await ev(trySave);
  ok('กดบันทึกทับแล้วถูกทักให้ระบุก่อน', !noPeriodSave.saved,
     noPeriodSave.saved ? 'ผ่านไปโดยไม่ทัก' : (noPeriodSave.alerts[0] || '').slice(0, 60));

  console.log('');
  ok('ไม่มี JavaScript error ตลอดการทดสอบ', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '));

  console.log('');
  console.log('══════════════════════════════════════════════════');
  console.log('  ผ่าน ' + results.filter(Boolean).length + ' / ' + results.length);
  console.log('══════════════════════════════════════════════════');
  process.exitCode = results.every(Boolean) ? 0 : 1;
} catch (e) { console.error('ล้มเหลว:', e.message); process.exitCode = 2; }
finally { try { ws.close(); } catch {} chrome.kill(); }
