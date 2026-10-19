// ขาที่ไม่มีใครเบิก ต้องไม่มีระยะทาง และต้องถามก่อนบันทึก
//
// 16 ต.ค. 2569 — เจ้าของงานเจอเองว่า อยู่กรณีพิเศษ ติ๊ก Taxi เฉพาะขาไป
// ไม่แตะการ์ดขากลับเลย แต่แผนที่ยังกรอกระยะทางขากลับให้ 47.6 กม.
// พร้อมขึ้นป้ายว่า "ขากลับใช้เส้นทางเดิม 47.6 กม."
//
// สองผลที่ตามมา
//   ก. ผู้ใช้อ่านแล้วนึกว่าระบบคิดขากลับให้แล้ว คนที่ลืมติ๊กไม่มีทางรู้ว่าลืม
//   ข. ตัวเลขที่ค้างไว้ไปโผล่เป็นค่าน้ำมันบนหน้าสถิติ (ดู test-stats-breakdown.mjs)
//
// เจ้าของงานชี้ว่าระบบแยกไม่ออกว่า "ไม่ได้กลับจริง" กับ "ลืมกรอก"
// จึงไม่ควรเดาแทน ต้องถามให้คนตอบเอง
//
//   cd public && python3 -m http.server 8099 --bind 127.0.0.1
//   node scripts/test-return-leg-guard.mjs
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9597, PROFILE = 'C:/Users/teerapat/AppData/Local/Temp/pb-retguard';
const APP = process.env.APP_URL || 'http://127.0.0.1:8099';

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

const PREP = [
  "const s=document.getElementById('categorySelect');",
  "s.value='TRAVEL002'; s.dispatchEvent(new Event('change',{bubbles:true}));",
  "await new Promise(r=>setTimeout(r,1000));",
  "const ds=document.getElementById('dateStart'), de=document.getElementById('dateEnd');",
  "ds.value='2026-10-16'; ds.dispatchEvent(new Event('change',{bubbles:true}));",
  "de.value='2026-10-17'; de.dispatchEvent(new Event('change',{bubbles:true}));",
  "await new Promise(r=>setTimeout(r,300));",
  // แกล้งให้แผนที่คืนระยะทางคงที่ จะได้วัดได้แน่นอน
  "window.routeLeg = async () => ({ km: 47.6, meters: 47600, coords: [] });",
  "geoFrom = { lat: 13.6591, lng: 100.5330, precision:'exact', label:'บ้าน' };",
  "geoTo   = { lat: 13.9126, lng: 100.6068, precision:'exact', label:'สนามบินดอนเมือง' };",
  "document.getElementById('travelFrom').value = 'บ้าน';",
  "document.getElementById('travelTo').value   = 'สนามบินดอนเมือง';",
  /* ช่องบังคับที่ถูกตรวจก่อนถึงจุดที่เทสต์นี้สนใจ ถ้าไม่กรอก validation จะเด้ง
     ออกตั้งแต่ "กรุณาระบุชื่อผู้ขอเบิก" แล้วเทสต์จะวัดไม่ถึงของจริง */
  "document.getElementById('requestedBy').value = 'ผู้ทดสอบ';",
  "const act = document.getElementById('activityName'); if (act) act.value = 'ทดสอบเคสขาเดียว';"
].join('\n');

const tick = (n, on) => "{const c=document.getElementById('" + n + "');c.checked=" + on +
  ";c.dispatchEvent(new Event('change',{bubbles:true}));await new Promise(r=>setTimeout(r,400));}";
const toSpecial = [
  "const sp=document.getElementById('tripModeSpecial');",
  "sp.checked=true; sp.dispatchEvent(new Event('change',{bubbles:true}));",
  "await new Promise(r=>setTimeout(r,600));"
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
    "const of=window.fetch;",
    "window.fetch=function(u,i){const s=(typeof u==='string')?u:(u&&u.url)||'';",
    "  if(s.indexOf('/auth/me')>=0) return Promise.resolve(new Response(",
    "    JSON.stringify({id:1,email:'t@ha.or.th',name:'test',role:'admin'}),",
    "    {status:200,headers:{'Content-Type':'application/json'}}));",
    "  if(s.indexOf('/budget-categories')>=0) return Promise.resolve(new Response(",
    "    JSON.stringify([{id:'TRAVEL002',name:'test',pdfTemplates:['REPORT','TRANSPORT_RECEIPT'],",
    // เปิดเหมาจ่ายไว้ด้วย เพื่อให้ข้อ 6 ทดสอบเคสที่เจ้าของงานเจอได้จริง
    "      attachmentRules:{},attachmentOrder:[],taxiMaxPerTrip:750,fuelRate:5,",
    "      flatRate:{enabled:true,maxKm:200,outsideMetro:1200,bands:[",
    "        {upTo:10.99,amount:150},{upTo:20.99,amount:250},{upTo:30.99,amount:350},",
    "        {upTo:40.99,amount:450},{upTo:50.99,amount:550},{upTo:60.99,amount:650},",
    "        {upTo:null,amount:750}]}}]),",
    "    {status:200,headers:{'Content-Type':'application/json'}}));",
    "  if(s.indexOf('/expenses')>=0||s.indexOf('/profiles')>=0)",
    "    return Promise.resolve(new Response('[]',{status:200,headers:{'Content-Type':'application/json'}}));",
    "  return of(u,i);};"
  ].join('\n') });
  await send('Page.navigate', { url: APP + '/expense.html' }); await sleep(4500);

  console.log('═══ 1. กรณีพิเศษ ติ๊ก Taxi ขาไปอย่างเดียว ═══');
  const a = await ev([
    PREP, toSpecial, tick('legOutTaxi', true),
    "await recalcRoute(true); await new Promise(r=>setTimeout(r,800));",
    "return { distOut: document.getElementById('distOutbound').value,",
    "         distRet: document.getElementById('distReturn').value,",
    "         status: (document.getElementById('routeStatus')||{}).textContent||'' };"
  ].join('\n'));
  ok('ระยะทางขาไปยังคำนวณให้ตามปกติ', parseFloat(a.distOut) === 47.6, a.distOut + ' กม.');
  ok('ระยะทางขากลับต้องเป็น 0 เพราะไม่มีใครเบิกขากลับ',
     parseFloat(a.distRet) === 0, a.distRet + ' กม.');
  ok('ป้ายบอกตรง ๆ ว่าไม่ได้เบิกขากลับ',
     /ไม่ได้เบิกขากลับ/.test(a.status), a.status.replace(/\s+/g, ' ').trim().slice(0, 130));
  ok('ไม่ขึ้นป้าย "ขากลับใช้เส้นทางเดิม" ให้เข้าใจผิด',
     !/ขากลับใช้เส้นทางเดิม/.test(a.status));

  console.log('');
  console.log('═══ 2. พอติ๊กรถขากลับ ระยะทางต้องกลับมา ═══');
  const b = await ev([
    tick('legBackCar', true),
    "await recalcRoute(true); await new Promise(r=>setTimeout(r,800));",
    "return { distRet: document.getElementById('distReturn').value,",
    "         status: (document.getElementById('routeStatus')||{}).textContent||'',",
    "         car: document.getElementById('carType').value };"
  ].join('\n'));
  ok('ติ๊กรถขากลับแล้ว ระยะทางขากลับกลับมาเป็น 47.6',
     parseFloat(b.distRet) === 47.6, b.distRet + ' กม.');
  ok('ป้ายกลับไปบอกว่าใช้เส้นทางเดิม', /ขากลับใช้เส้นทางเดิม/.test(b.status));
  ok('carType เป็น ขากลับ (เบิกรถเฉพาะขากลับ)', b.car === 'ขากลับ', b.car);

  console.log('');
  console.log('═══ 3. เคสปกติต้องไม่เปลี่ยนพฤติกรรมเดิม ═══');
  const c = await ev([
    "const nm=document.getElementById('tripModeNormal');",
    "nm.checked=true; nm.dispatchEvent(new Event('change',{bubbles:true}));",
    "await new Promise(r=>setTimeout(r,600));",
    tick('legOutCar', true),
    "await recalcRoute(true); await new Promise(r=>setTimeout(r,800));",
    "return { distOut: document.getElementById('distOutbound').value,",
    "         distRet: document.getElementById('distReturn').value,",
    "         car: document.getElementById('carType').value,",
    "         backCar: document.getElementById('legBackCar').checked };"
  ].join('\n'));
  ok('เคสปกติติ๊กรถส่วนตัว มีผลทั้งสองขาเหมือนเดิม', c.backCar === true && c.car === 'ไป-กลับ', c.car);
  ok('ระยะทางครบทั้งสองขา 47.6 / 47.6',
     parseFloat(c.distOut) === 47.6 && parseFloat(c.distRet) === 47.6,
     c.distOut + ' / ' + c.distRet);

  console.log('');
  console.log('═══ 4. กดบันทึกตอนกรณีพิเศษแล้วขากลับว่าง ต้องถามก่อน ═══');
  const d = await ev([
    toSpecial,
    tick('legOutCar', true),
    tick('legBackCar', false),
    tick('legBackTaxi', false),
    // ดักกล่องยืนยันไว้เอง จะได้รู้ว่ามันถูกเรียกจริงและข้อความว่าอะไร
    "window.__confirms = [];",
    "window.confirm = function (m) { window.__confirms.push(m); return false; };",
    "window.__alerts = []; const oa = window.alert;",
    "window.alert = function (m) { window.__alerts.push(String(m)); };",
    "await recalcRoute(true); await new Promise(r=>setTimeout(r,600));",
    "const btn = document.getElementById('submitBtn') ||",
    "            document.querySelector('[onclick*=submitExpense]') ||",
    "            document.querySelector('button[type=submit]');",
    "if (btn) btn.click(); await new Promise(r=>setTimeout(r,1200));",
    "return { confirms: window.__confirms, alerts: window.__alerts.slice(0,3),",
    "         foundBtn: !!btn };"
  ].join('\n'));
  ok('หาปุ่มบันทึกเจอ', d.foundBtn === true);
  ok('ระบบถามยืนยันว่าเบิกเฉพาะขาไปจริงไหม',
     (d.confirms || []).some(m => /เบิกเฉพาะขาไป/.test(m)),
     (d.confirms || []).join(' | ').slice(0, 150) || '(ไม่ถามเลย)');
  ok('ข้อความบอกทางออกทั้งสองทาง ตกลง=บันทึก ยกเลิก=กลับไปติ๊ก',
     (d.confirms || []).some(m => /ตกลง/.test(m) && /ยกเลิก/.test(m)));

  console.log('');
  console.log('═══ 5. กด "ยกเลิก" ต้องไม่บันทึก ═══');
  const e2 = await ev([
    "return { savedAlerts: (window.__alerts||[]).filter(a=>/บันทึก(สำเร็จ|เรียบร้อย)/.test(a)).length };"
  ].join('\n'));
  ok('กดยกเลิกแล้วไม่มีการบันทึกเกิดขึ้น', e2.savedAlerts === 0, e2.savedAlerts + ' ข้อความสำเร็จ');

  console.log('');
  console.log('═══ 6. เคสปกติ ติ๊กแต่ Taxi แล้วเลือกเหมาจ่าย ต้องได้เงิน ไม่ใช่ 0 ═══');

  /* 19 ต.ค. 2569 — เจ้าของงานเจอว่ายอดขึ้น 0.00
     ต้นเหตุคือข้อ 6 ของรอบก่อน (เวอร์ชัน 2.16.0) ที่ผมเขียนเงื่อนไขว่า
     "เติมระยะทางขากลับเมื่อติ๊กรถส่วนตัวขากลับ" โดยให้เหตุผลว่าระยะทาง
     มีความหมายกับรถส่วนตัวเท่านั้น ซึ่งผิด

     เหมาจ่าย (บัญชี ๘ ข้อ ๕) คิดจากช่วงระยะทางโดยไม่ผูกชนิดพาหนะ
     ขา Taxi จึงต้องมีระยะทางด้วย พอขากลับไม่มีระยะ ขานั้นตก ok=false
     ทั้งใบเลยตก แล้วถอยไปคิดตามระยะจริงซึ่งเป็นศูนย์เพราะไม่ได้ติ๊กรถ

     เงื่อนไขที่ถูกคือ "ขากลับถูกเบิกไหม" ไม่ว่าด้วยพาหนะอะไร */
  const flatTaxi = await ev([
    "const nm=document.getElementById('tripModeNormal');",
    "nm.checked=true; nm.dispatchEvent(new Event('change',{bubbles:true}));",
    "await new Promise(r=>setTimeout(r,600));",
    tick('legOutCar', false),
    /* ปิดแล้วเปิดใหม่ เพื่อให้ระบบสร้างแถวชุดใหม่ครบสองแถวตามเคสปกติ
       ถ้าไม่ปิดก่อน แถวที่ค้างจากข้อก่อนหน้าจะเหลือขาไปแถวเดียว
       แล้วข้อนี้จะกลายเป็นวัดเคสขาเดียวซึ่งเป็นของข้อ 7 ไม่ใช่ข้อนี้ */
    tick('legOutTaxi', false),
    tick('legOutTaxi', true),
    "const f=document.querySelector('input[name=\"fuelMethod\"][value=\"flat\"]');",
    "const hasFlat = !!f;",
    "if(f){f.checked=true; f.dispatchEvent(new Event('change',{bubbles:true}));}",
    "await recalcRoute(true); await new Promise(r=>setTimeout(r,1000));",
    "return { hasFlat: hasFlat,",
    "         distRet: document.getElementById('distReturn').value,",
    "         car: currentTrip().carType,",
    "         flat: (typeof flatResult==='function') ? flatResult() : null };"
  ].join('\n'));

  if (!flatTaxi.hasFlat) {
    ok('ข้ามข้อนี้ — หมวดทดสอบไม่ได้เปิดเหมาจ่าย', true, 'ดู test-case-note.mjs ที่เปิดไว้');
  } else {
    ok('ติ๊กแต่ Taxi ในเคสปกติ = เบิกทั้งสองขา ระยะทางขากลับต้องมี',
       parseFloat(flatTaxi.distRet) === 47.6, flatTaxi.distRet + ' กม.');
    ok('เหมาจ่ายคิดได้ทั้งสองขา ไม่ตกเป็น ok=false',
       !!(flatTaxi.flat && flatTaxi.flat.ok), 'ok=' + (flatTaxi.flat || {}).ok
         + ' why=' + ((flatTaxi.flat || {}).why || '-'));
    ok('ได้เงินจริง ไม่ใช่ 0',
       !!(flatTaxi.flat && flatTaxi.flat.total > 0), (flatTaxi.flat || {}).total + ' บาท');
  }

  console.log('');
  console.log('═══ 7. ลบแถว Taxi ขากลับทิ้ง เหมาจ่ายต้องคิดขาเดียว ═══');

  /* 19 ต.ค. 2569 — เจ้าของงานเจอว่าเหลือแถว Taxi ขาไปแถวเดียว
     แต่เหมาจ่ายยังคิดสองขา ได้ 1,100 แทนที่จะเป็น 550

     ต้นเหตุ: currentTrip() ดูแค่ "ติ๊ก Taxi ไว้ไหม" ไม่เคยดูว่ามีแถวกี่แถว
     ขณะที่วิธีคิดตามระยะจริงรวมเงินจากแถว จึงได้ขาเดียวถูกต้อง
     สองวิธีคิดนับจำนวนขาไม่ตรงกันทั้งที่เป็นใบเดียวกัน

     สำหรับ Taxi "แถว" คือหลักฐานว่าเดินทางขาไหนจริง ติ๊กเป็นแค่สวิตช์เปิดส่วน */
  const oneWay = await ev([
    "const rs=[...document.querySelectorAll('#taxiEntriesList .taxi-entry')];",
    "const back=rs.find(r=>r.querySelector('.taxi-dir').value==='" + 'ขากลับ' + "');",
    "if(back) back.querySelector('[onclick*=removeTaxiEntry]').click();",
    "await new Promise(r=>setTimeout(r,900));",
    "return { rows: [...document.querySelectorAll('#taxiEntriesList .taxi-entry')]",
    "           .map(r=>r.querySelector('.taxi-dir').value),",
    "         car: currentTrip().carType,",
    "         flat: (typeof flatResult==='function') ? flatResult() : null };"
  ].join('\n'));
  ok('เหลือแถว Taxi ขาไปแถวเดียว', oneWay.rows.length === 1 && oneWay.rows[0] === 'ขาไป',
     JSON.stringify(oneWay.rows));
  ok('currentTrip นับเป็นขาไปอย่างเดียว ไม่ใช่ไป-กลับ',
     oneWay.car === 'ขาไป', oneWay.car);
  ok('เหมาจ่ายคิดขาเดียว 550 ไม่ใช่ 1,100',
     !!(oneWay.flat && oneWay.flat.total === 550 && oneWay.flat.legs.length === 1),
     (oneWay.flat || {}).total + ' บาท · ' + ((oneWay.flat || {}).legs || []).length + ' ขา');

  ok('ไม่มี JavaScript error ตลอดการทดสอบ', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '));

  console.log('');
  console.log('══════════════════════════════════════════════════');
  console.log('  ผ่าน ' + results.filter(Boolean).length + ' / ' + results.length);
  console.log('══════════════════════════════════════════════════');
  process.exitCode = results.every(Boolean) ? 0 : 1;
} catch (e) { console.error('ล้มเหลว:', e.message); process.exitCode = 2; }
finally { try { ws.close(); } catch {} chrome.kill(); }
