/* เพิ่มวันเดินทางในใบเดียว — เส้นทางเดิม คนละวัน
 *
 * 10 พ.ย. 2569 — เคสของเจ้าของงาน
 *   9 พ.ย.  บ้าน -> รพ. -> บ้าน
 *   10 พ.ย. บ้าน -> รพ. -> บ้าน
 * เบิกรวมใบเดียว ค่าน้ำมันตามจริง ออกเฉพาะใบรับรองค่าพาหนะ
 *
 * กติกาที่ต้องถือให้ได้
 *   1. ไม่เพิ่มวันเลย = ใบต้องเหมือนเดิมทุกประการ ไม่มีคีย์ legs โผล่มา
 *      (ใบเก่าทั้งระบบเป็นแบบนี้ ห้ามให้หน้าตาข้อมูลเปลี่ยน)
 *   2. เพิ่มวัน = ได้ขาครบทุกวัน เรียงตามวัน ขาไปก่อนขากลับ
 *   3. ยอดเงินในฟอร์มต้องนับขาที่เพิ่มมาด้วย ไม่งั้นฟอร์มกับเอกสารไม่ตรงกัน
 *   4. distOut/distRet ยังต้องถูกเขียนไว้เหมือนเดิม ไม่งั้นด่านตรวจฝั่งเซิร์ฟเวอร์ตีกลับ
 *      (backend/validation.js ตรวจว่าสองค่านี้ไม่เป็น 0 เมื่อมีการเบิกรถ)
 *
 * รัน: cd public && python -m http.server 8099 --bind 127.0.0.1 &
 *      node scripts/test-extra-travel-days.mjs
 */
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9566, PROFILE = 'C:/Users/teerapat/AppData/Local/Temp/pb-extradays';
const APP = process.env.APP_URL || 'http://127.0.0.1:8099';

const HOME = { lat: 13.90, lng: 100.50, label: 'บ้าน 141/36' };
const HOSP = { lat: 13.70, lng: 100.60, label: 'โรงพยาบาลทดสอบ' };
const KM = 20;          // ตัวคิดเส้นทางถูกตรึงให้ตอบ 20.0 กม. ทุกทิศ
const RATE = 5;         // บาท/กม.

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
    /* ปลายทางของการ์ด (lat ~13.40) ต้องได้คนละเลขกับเส้นทางวันแรก
       ไม่งั้นเทสต์แยกไม่ออกว่าใช้หมุดของการ์ดจริง หรือลอกระยะของวันแรกมา */
    "  if (s.indexOf('/map-route')>=0) {",
    "    const q = new URLSearchParams(s.split('?')[1]||'');",
    "    const near = v => Math.abs(parseFloat(v) - 13.40) < 0.05;",
    "    const m = (near(q.get('tlat')) || near(q.get('flat'))) ? " + (50 * 1000) + " : " + (KM * 1000) + ";",
    "    return Promise.resolve(new Response(JSON.stringify({ type:'FeatureCollection',",
    "      features:[{ type:'Feature', properties:{ distance:m },",
    "        geometry:{ type:'LineString', coordinates:[[q.get('flon')*1,q.get('flat')*1],[q.get('tlon')*1,q.get('tlat')*1]] } }] }),",
    "      {status:200,headers:{'Content-Type':'application/json'}}));",
    "  }",
    "  if (s.indexOf('/auth/me')>=0) return Promise.resolve(new Response(",
    "    JSON.stringify({id:1,email:'t@ha.or.th',name:'ทดสอบ',role:'admin'}),",
    "    {status:200,headers:{'Content-Type':'application/json'}}));",
    /* หมวดนี้ต้องเปิดเหมาจ่ายไว้จริง ไม่งั้น flatMethodOn() เป็นเท็จเสมอ
       แล้วด่านกันจะไม่ถูกทดสอบเลย ทั้งที่ของจริงเลือกเหมาจ่ายได้ */
    "  if (s.indexOf('/budget-categories')>=0) return Promise.resolve(new Response(",
    "    JSON.stringify([{ id:'TRAVEL002', name:'ทดสอบ ใบค่าพาหนะ', fuelRate:" + RATE + ",",
    "      pdfTemplates:['TRANSPORT_RECEIPT'], attachmentRules:{}, attachmentOrder:[],",
    "      flatRate:{ enabled:true, maxKm:200, outsideMetro:1200,",
    "        bands:[{upTo:10.99,amount:150},{upTo:20.99,amount:250},{upTo:30.99,amount:350},",
    "               {upTo:40.99,amount:450},{upTo:50.99,amount:550},{upTo:60.99,amount:650},",
    "               {upTo:null,amount:750}] } }]),",
    "    {status:200,headers:{'Content-Type':'application/json'}}));",
    "  if (s.indexOf('/expenses')>=0||s.indexOf('/profiles')>=0)",
    "    return Promise.resolve(new Response('[]',{status:200,headers:{'Content-Type':'application/json'}}));",
    "  return of(u,i); };"
  ].join('\n') });
  await send('Page.navigate', { url: APP + '/expense.html' }); await sleep(5000);

  // เตรียมใบ: เลือกหมวด ตั้งวันเดินทาง ปักหมุด ติ๊กรถไป-กลับ
  await ev('const c=document.getElementById("categorySelect"); c.value="TRAVEL002";'
    + ' c.dispatchEvent(new Event("change",{bubbles:true})); return 1;');
  await sleep(1200);
  await ev('const ds=document.getElementById("dateStart"), de=document.getElementById("dateEnd");'
    + ' ds.value="2026-11-09"; ds.dispatchEvent(new Event("change",{bubbles:true}));'
    + ' de.value="2026-11-09"; de.dispatchEvent(new Event("change",{bubbles:true}));'
    + ' const fr=document.getElementById("fuelRate"); if (fr) fr.value="' + RATE + '";'
    + ' const lo=document.getElementById("legOutCar");'
    + ' if (lo && !lo.checked) { lo.checked=true; lo.dispatchEvent(new Event("change",{bubbles:true})); }'
    + ' return 1;');
  await sleep(800);
  await ev('document.getElementById("travelFrom").value=' + JSON.stringify(HOME.label) + ';'
    + ' setPoint("from",' + HOME.lat + ',' + HOME.lng + ',' + JSON.stringify(HOME.label) + ',"exact","user");'
    + ' document.getElementById("travelTo").value=' + JSON.stringify(HOSP.label) + ';'
    + ' setPoint("to",' + HOSP.lat + ',' + HOSP.lng + ',' + JSON.stringify(HOSP.label) + ',"exact","user");'
    + ' await recalcRoute(false); return 1;');
  await sleep(1500);

  const base = await ev('return { out: document.getElementById("distOutbound").value,'
    + ' ret: document.getElementById("distReturn").value, car: document.getElementById("carType").value };');
  ok('ตั้งใบตั้งต้นได้ ไป-กลับ อย่างละ ' + KM + ' กม.',
     String(base.out) === String(KM) && String(base.ret) === String(KM), JSON.stringify(base));

  /* ── 1. ยังไม่เพิ่มวัน: ต้องไม่มี legs เลย ใบเหมือนเดิมทุกประการ ── */
  const none = await ev('return buildTravelLegs();');
  ok('ไม่เพิ่มวัน = ไม่สร้าง legs (ใบเหมือนเดิม)', none === null, JSON.stringify(none));

  /* ── 2. ปุ่มเพิ่มวันต้องมีอยู่จริง ── */
  const btn = await ev('return !!document.getElementById("addExtraDayBtn");');
  ok('มีปุ่ม "เพิ่มวันเดินทาง" ในหน้า', btn === true, String(btn));

  /* ── 3. เพิ่มวันที่ 10 แล้วต้องได้ 4 ขา เรียงถูก ── */
  await ev('addExtraDay("2026-11-10"); return 1;');
  await sleep(400);
  const legs = await ev('return buildTravelLegs();');
  ok('เพิ่ม 1 วัน ได้ 4 ขา', Array.isArray(legs) && legs.length === 4,
     JSON.stringify(legs && legs.map(l => l.dir + '@' + l.date)));
  ok('เรียง 9 ไป -> 9 กลับ -> 10 ไป -> 10 กลับ',
     JSON.stringify((legs || []).map(l => l.dir + '@' + l.date)) === JSON.stringify(
       ['ขาไป@2026-11-09', 'ขากลับ@2026-11-09', 'ขาไป@2026-11-10', 'ขากลับ@2026-11-10']),
     JSON.stringify((legs || []).map(l => l.dir + '@' + l.date)));
  ok('ทุกขาได้ระยะ ' + KM + ' กม.',
     (legs || []).every(l => Number(l.km) === KM), JSON.stringify((legs || []).map(l => l.km)));
  ok('ทุกขามีหมุดครบสองจุด',
     (legs || []).every(l => l.fromGeo && l.toGeo), JSON.stringify((legs || []).map(l => !!(l.fromGeo && l.toGeo))));
  ok('ขากลับสลับต้นทางปลายทางถูก',
     (legs || [])[1] && legs[1].from === HOSP.label && legs[1].to === HOME.label,
     JSON.stringify(legs && legs[1]));

  /* ── 4. ยอดเงินในฟอร์มต้องนับขาที่เพิ่มมา ── */
  await ev('calculateTravelTotal(); return 1;');
  await sleep(500);
  const money = await ev('return { fuel: window.__lastFuelTotal,'
    + ' out: document.getElementById("distOutbound").value,'
    + ' ret: document.getElementById("distReturn").value };');
  ok('ยอดค่าน้ำมันเป็น ' + (KM * 4 * RATE) + ' บาท (4 ขา x ' + KM + ' กม. x ' + RATE + ')',
     Number(money.fuel) === KM * 4 * RATE, JSON.stringify(money));

  /* ── 5. distOut/distRet ต้องยังมีค่าเหมือนเดิม เพื่อให้ด่านฝั่งเซิร์ฟเวอร์ผ่าน ── */
  ok('distOut/distRet ยังเป็น ' + KM + ' เหมือนเดิม ไม่ถูกเขียนทับเป็นยอดรวม',
     String(money.out) === String(KM) && String(money.ret) === String(KM), JSON.stringify(money));

  /* ── 6. ลบวันที่เพิ่มออก ต้องกลับไปเหมือนเดิมสนิท ── */
  await ev('document.querySelectorAll("#extraDaysList .extra-day").forEach(function(r){ r.remove(); });'
    + ' if (typeof onExtraDaysChange === "function") onExtraDaysChange(); return 1;');
  await sleep(400);
  const after = await ev('return { legs: buildTravelLegs(), fuel: window.__lastFuelTotal };');
  ok('ลบวันที่เพิ่มออกแล้ว กลับไปไม่มี legs', after.legs === null, JSON.stringify(after.legs));
  ok('ลบแล้วยอดกลับเป็น ' + (KM * 2 * RATE) + ' บาท (2 ขาเหมือนเดิม)',
     Number(after.fuel) === KM * 2 * RATE, JSON.stringify(after));

  /* ══════════ 7. ด่านกัน — ใช้ไม่ได้ต้องกดไม่ได้ ══════════
     เจ้าของงานสั่ง 10 พ.ย. 2569: "ถ้าไม่ได้ก็ไม่ควรให้เขากดได้"
     เหมาจ่าย (บัญชี ๘ ข้อ ๕) คิดจาก distOut/distRet ซึ่งเก็บได้แค่สองขา
     ใบหลายวันจึงยังคิดเหมาจ่ายไม่ถูก ต้องปิดปุ่มและบอกเหตุผล ไม่ใช่ปล่อยให้กดแล้วเงินขาด */
  const flatOn = await ev('const r=[...document.querySelectorAll("input[name=\\"fuelMethod\\"]")]'
    + '.find(function(e){return e.value==="flat";}); if(!r) return "ไม่มีตัวเลือกเหมาจ่าย";'
    + ' r.checked=true; r.dispatchEvent(new Event("change",{bubbles:true})); return "เลือกแล้ว";');
  await sleep(700);
  if (flatOn === 'เลือกแล้ว') {
    const guard = await ev('const b=document.getElementById("addExtraDayBtn");'
      + ' const n=document.getElementById("extraDaysNote");'
      + ' return { disabled: !!(b && b.disabled), note: (n && !n.classList.contains("hidden")) ? n.textContent.trim() : "" };');
    ok('เลือกเหมาจ่ายแล้ว ปุ่มเพิ่มวันต้องกดไม่ได้', guard.disabled === true, JSON.stringify(guard));
    ok('และต้องบอกเหตุผลให้ผู้ใช้อ่านด้วย', /เหมาจ่าย/.test(guard.note), guard.note);

    // กลับไปคิดตามจริง ปุ่มต้องกลับมากดได้
    await ev('const r=[...document.querySelectorAll("input[name=\\"fuelMethod\\"]")]'
      + '.find(function(e){return e.value!=="flat";});'
      + ' if(r){ r.checked=true; r.dispatchEvent(new Event("change",{bubbles:true})); } return 1;');
    await sleep(700);
    const back = await ev('const b=document.getElementById("addExtraDayBtn"); return !!(b && b.disabled);');
    ok('กลับมาคิดตามจริง ปุ่มกดได้เหมือนเดิม', back === false, String(back));
  } else {
    ok('หมวดทดสอบนี้ไม่มีตัวเลือกเหมาจ่าย จึงข้ามด่านนี้', true, flatOn);
  }

  /* ══════════ 8. ด่านกันใบล้นหน้า ══════════
     วัดจากใบจริง 10 พ.ย. 2569 (หน้า A4 = 1085px) ได้ตารางนี้
       ขา  Taxi -> แถว -> สูง
        2   0     18     902   ลง        8   0     30    1019  ลง
        4   0     22    1015   ลง        8   4     31    1040  ลง
        6   0     26    1015   ลง        8   6     33    1083  ลง  <- เพดาน
        6   8     31    1041   ลง        8   8     35    1126  ล้น 41
       10   0     34    1103   ล้น 18   10   8     39    1210  ล้น 125
     สูตรที่ได้  แถว = 18 + (ขา-2)x2 + max(0, Taxi-3)   เพดาน 33 แถว
     ตัวเลขพวกนี้ต้องมาจากการวัด ไม่ใช่เดา ถ้าเลย์เอาต์เปลี่ยนต้องวัดใหม่ */
  const GRID = [
    [2,0,18],[2,2,18],[2,4,19],[2,6,21],[2,8,23],
    [4,0,22],[4,2,22],[4,4,23],[4,6,25],[4,8,27],
    [6,0,26],[6,2,26],[6,4,27],[6,6,29],[6,8,31],
    [8,0,30],[8,2,30],[8,4,31],[8,6,33],[8,8,35],
    [10,0,34],[10,2,34],[10,4,35],[10,6,37],[10,8,39]
  ];
  const wrong = [];
  for (const [L, T, want] of GRID) {
    const got = await ev('return receiptRowEstimate(' + L + ',' + T + ');');
    if (got !== want) wrong.push(L + 'ขา/' + T + 'Taxi: ควร ' + want + ' ได้ ' + got);
  }
  ok('สูตรนับแถวตรงกับที่วัดจากใบจริงครบ 25 ชุด', wrong.length === 0, wrong.join(' | '));
  ok('รู้ว่าเพดานคือ 33 แถว', (await ev('return RECEIPT_MAX_ROWS;')) === 33, '');

  /* เพิ่มวันจนถึงเพดาน แล้ววันถัดไปต้องกดไม่ได้
     0 Taxi: 4 วัน = 8 ขา = 30 แถว ลง · 5 วัน = 10 ขา = 34 แถว ล้น */
  const state = () => ev('const b=document.getElementById("addExtraDayBtn");'
    + ' const n=document.getElementById("extraDaysNote");'
    + ' const L=buildTravelLegs(); return { days: extraDayDates().length,'
    + ' legs: L?L.length:2, rows: receiptRowEstimate(L?L.length:2, 0),'
    + ' disabled: !!(b && b.disabled), save: checkExtraDayLimits(),'
    + ' note: (n && !n.classList.contains("hidden")) ? n.textContent.trim() : "" };');

  // 3 วัน (6 ขา 26 แถว) — เพิ่มอีกวันได้ 30 แถว ยังลง จึงต้องกดได้
  await ev('document.querySelectorAll("#extraDaysList .extra-day").forEach(function(r){r.remove();});'
    + ' addExtraDay("2026-11-10"); addExtraDay("2026-11-11"); onExtraDaysChange(); return 1;');
  await sleep(500);
  const at3 = await state();
  ok('เดินทาง 3 วัน (6 ขา 26 แถว) ยังกดเพิ่มได้',
     at3.legs === 6 && at3.rows === 26 && at3.disabled === false && at3.save === true, JSON.stringify(at3));

  /* 4 วัน (8 ขา 30 แถว) — ใบนี้ยังลงหน้าเดียว บันทึกได้
     แต่กดเพิ่มอีกวันจะเป็น 34 แถว ซึ่งล้น จึงต้องปิดปุ่มไว้ก่อน
     เจ้าของงานสั่งว่า "ถ้าไม่ได้ก็ไม่ควรให้เขากดได้" ไม่ใช่ปล่อยให้กดแล้วค่อยบอกว่าผิด */
  await ev('addExtraDay("2026-11-12"); onExtraDaysChange(); return 1;');
  await sleep(500);
  const at4 = await state();
  ok('เดินทาง 4 วัน (8 ขา 30 แถว) ยังบันทึกได้', at4.save === true, JSON.stringify(at4));
  ok('แต่ปุ่มถูกปิด เพราะเพิ่มอีกวันจะล้น', at4.disabled === true, JSON.stringify(at4));
  ok('และบอกว่าเหลืออีกกี่บรรทัด', /30 จาก 33/.test(at4.note), at4.note);

  // ฝืนเพิ่มวันที่ 5 ด้วยการเรียกฟังก์ชันตรง ๆ (จำลองแถวค้างจากใบที่โหลดมา)
  await ev('addExtraDay("2026-11-13"); onExtraDaysChange(); return 1;');
  await sleep(500);
  const at5 = await ev('const b=document.getElementById("addExtraDayBtn");'
    + ' const n=document.getElementById("extraDaysNote");'
    + ' return { days: extraDayDates().length, rows: receiptRowEstimate(buildTravelLegs().length, 0),'
    + '          disabled: !!(b && b.disabled),'
    + '          note: (n && !n.classList.contains("hidden")) ? n.textContent.trim() : "" };');
  ok('เกินเพดานแล้วปุ่มต้องกดไม่ได้', at5.disabled === true, JSON.stringify(at5));
  ok('และบอกว่าใบจะเกินหนึ่งหน้า', /เกิน|หน้าเดียว|ล้น/.test(at5.note), at5.note);
  ok('บันทึกไม่ได้จนกว่าจะลดวันลง', (await ev('return checkExtraDayLimits();')) === false, '');

  // ลดกลับมาให้พอดี ต้องกลับมาใช้งานได้
  await ev('const rs=document.querySelectorAll("#extraDaysList .extra-day");'
    + ' rs[rs.length-1].remove(); onExtraDaysChange(); return 1;');
  await sleep(500);
  ok('ลดวันลงแล้วกลับมาบันทึกได้',
     (await ev('return checkExtraDayLimits();')) === true, '');

  /* ══════════ 9. วันถัดไปไปคนละที่ ══════════
     10 พ.ย. 2569 — เจ้าของงานสั่งเพิ่มว่า วันที่เพิ่มมาต้องเลือกไปคนละที่ได้ด้วย
     ไม่ใช่บังคับใช้เส้นทางเดิมอย่างเดียว
     หมุดของการ์ดต้องเก็บที่ช่องตัวเอง ห้ามไปแตะ geoFrom/geoTo ของเส้นทางหลัก
     ถ้าทับกันเมื่อไหร่ ค่าน้ำมันของวันแรกจะเพี้ยนตามไปด้วย */
  await ev('document.querySelectorAll("#extraDaysList .extra-day").forEach(function(r){r.remove();});'
    + ' const rs=[...document.querySelectorAll("input[name=\\"fuelMethod\\"]")]'
    + '   .find(function(e){return e.value!=="flat";});'
    + ' if(rs){ rs.checked=true; rs.dispatchEvent(new Event("change",{bubbles:true})); }'
    + ' addExtraDay("2026-11-10"); onExtraDaysChange(); return 1;');
  await sleep(600);

  const hasMode = await ev('return !!document.querySelector("#extraDaysList .extra-day-mode");');
  ok('การ์ดมีตัวเลือก "ใช้เส้นทางเดิม / ไปคนละที่"', hasMode === true, String(hasMode));

  // สลับไปโหมดคนละที่ แล้วช่องกรอกต้องโผล่
  await ev('const r=document.querySelector("#extraDaysList .extra-day");'
    + ' const m=r.querySelector(".extra-day-mode[value=\\"custom\\"]");'
    + ' m.checked=true; m.dispatchEvent(new Event("change",{bubbles:true})); return 1;');
  await sleep(500);
  const fields = await ev('const r=document.querySelector("#extraDaysList .extra-day");'
    + ' const b=r.querySelector(".extra-day-custom");'
    + ' return { shown: !!(b && !b.classList.contains("hidden")),'
    + '          from: !!r.querySelector(".extra-day-from"), to: !!r.querySelector(".extra-day-to") };');
  ok('เลือก "ไปคนละที่" แล้วมีช่องกรอกจาก-ถึง',
     fields.shown && fields.from && fields.to, JSON.stringify(fields));

  /* ปักหมุดของการ์ดเอง แล้วให้คิดระยะ — ตัวคิดเส้นทางถูกตรึงไว้ที่ 20 กม.
     ที่นี่ใช้จุดห่างกว่า เพื่อให้แน่ใจว่ามันคิดจากหมุดของการ์ด ไม่ใช่ลอกของวันแรก */
  await ev('const r=document.querySelector("#extraDaysList .extra-day");'
    + ' const f=r.querySelector(".extra-day-from"), t=r.querySelector(".extra-day-to");'
    + ' f.value="บ้าน 141/36"; f.dataset.lat="13.90"; f.dataset.lng="100.50";'
    + ' t.value="โรงพยาบาลอีกแห่ง"; t.dataset.lat="13.40"; t.dataset.lng="101.00";'
    + ' await recalcExtraDay(r); return 1;');
  await sleep(1500);

  const custom = await ev('const L=buildTravelLegs()||[];'
    + ' return { n:L.length, legs:L.map(function(x){return x.dir+"@"+x.date+":"+x.to+":"+x.km;}) };');
  ok('ยังได้ 4 ขาเหมือนเดิม', custom.n === 4, JSON.stringify(custom.legs));
  ok('ขาของวันที่ 10 ไปที่ใหม่ ไม่ใช่ที่เดิม',
     /โรงพยาบาลอีกแห่ง/.test(custom.legs[2] || ''), JSON.stringify(custom.legs));
  ok('ขาของวันแรกยังเป็นที่เดิม',
     /โรงพยาบาลทดสอบ/.test(custom.legs[0] || ''), JSON.stringify(custom.legs));

  const pins = await ev('const g=getGeo("to");'
    + ' return { mainTo: g? g.lat+","+g.lng : "ไม่มี" };');
  ok('หมุดเส้นทางหลักไม่ถูกการ์ดเขียนทับ',
     pins.mainTo === HOSP.lat + ',' + HOSP.lng, JSON.stringify(pins));

  /* เงิน: วันแรก 2 ขา x 20 กม. + วันที่สอง 2 ขา x ระยะของตัวเอง */
  const km2 = await ev('const r=document.querySelector("#extraDaysList .extra-day");'
    + ' return parseFloat(r.dataset.km)||0;');
  ok('การ์ดเก็บระยะของตัวเองไว้ และต่างจากวันแรก (50 ไม่ใช่ ' + KM + ')',
     km2 === 50, 'ได้ ' + km2);
  await ev('calculateTravelTotal(); return 1;');
  await sleep(400);
  const money2 = await ev('return window.__lastFuelTotal;');
  ok('ยอดเงิน = (2x' + KM + ' + 2x' + km2 + ') x ' + RATE,
     Number(money2) === (2 * KM + 2 * km2) * RATE,
     'ได้ ' + money2 + ' ควรได้ ' + ((2 * KM + 2 * km2) * RATE));

  // กลับไปใช้เส้นทางเดิม ต้องกลับไปคิดแบบเดิมสนิท
  await ev('const r=document.querySelector("#extraDaysList .extra-day");'
    + ' const m=r.querySelector(".extra-day-mode[value=\\"same\\"]");'
    + ' m.checked=true; m.dispatchEvent(new Event("change",{bubbles:true}));'
    + ' await new Promise(function(s){setTimeout(s,300);}); calculateTravelTotal(); return 1;');
  await sleep(900);
  ok('สลับกลับมาใช้เส้นทางเดิม ยอดกลับเป็น ' + (KM * 4 * RATE),
     Number(await ev('return window.__lastFuelTotal;')) === KM * 4 * RATE,
     String(await ev('return window.__lastFuelTotal;')));

  /* ══════════ 10. กรณีพิเศษ + เพิ่มวันเดินทาง ══════════
     16 พ.ย. 2569 — เจ้าของงานกดเล่นบนเซิร์ฟเวอร์ทดลองแล้วเจอว่า
     ใบที่ตั้งขากลับไป "ที่ทำงาน สรพ." (คนละที่กับบ้าน) แล้วเพิ่มวันเดินทางด้วย
     ขาที่บันทึกลง _travel.legs เขียนปลายทางขากลับเป็น "บ้าน" ไม่ใช่ "ที่ทำงาน"
     ระยะทางถูก แต่ชื่อสถานที่ผิด -> ใบรับรองพิมพ์ผิด และแผนที่วาดผิดจุด

     ต้นเหตุคือ buildTravelLegs() สลับ to->from เสมอ โดยไม่ดู returnTo/returnGeo */
  const WORK = { lat: 13.8613, lng: 100.5203, label: 'ที่ทำงาน สรพ.' };
  await ev('document.querySelectorAll("#extraDaysList .extra-day").forEach(function(r){r.remove();});'
    + ' const sp=document.getElementById("tripModeSpecial");'
    + ' if (sp) { sp.checked=true; sp.dispatchEvent(new Event("change",{bubbles:true})); }'
    + ' ["legOutCar","legBackCar"].forEach(function(i){ const e=document.getElementById(i);'
    + '   if (e && !e.checked) { e.checked=true; e.dispatchEvent(new Event("change",{bubbles:true})); } });'
    + ' return 1;');
  await sleep(900);
  await ev('document.getElementById("travelReturnTo").value=' + JSON.stringify(WORK.label) + ';'
    + ' setPoint("ret",' + WORK.lat + ',' + WORK.lng + ',' + JSON.stringify(WORK.label) + ',"exact","user");'
    + ' syncReturnDiff(); await recalcRoute(false); return 1;');
  await sleep(1500);
  await ev('addExtraDay("2026-11-10"); onExtraDaysChange(); return 1;');
  await sleep(600);

  const sp = await ev('const L=buildTravelLegs()||[];'
    + ' return { n:L.length, ret:L[1]||null,'
    + '   all:L.map(function(x){return x.dir+"@"+x.date+":"+x.to;}) };');
  ok('กรณีพิเศษ: ขากลับของวันแรกต้องไปที่ที่ระบุไว้ ไม่ใช่กลับบ้าน',
     sp.ret && sp.ret.to === WORK.label, JSON.stringify(sp.all));
  ok('กรณีพิเศษ: หมุดปลายทางขากลับต้องเป็นของที่ที่ระบุไว้',
     sp.ret && sp.ret.toGeo && Math.abs(sp.ret.toGeo.lat - WORK.lat) < 1e-6,
     JSON.stringify(sp.ret && sp.ret.toGeo));
  ok('วันที่เพิ่มมายังกลับบ้านตามเดิม (ไป-กลับในวันเดียว)',
     sp.all[3] && /141\/36|บ้าน/.test(sp.all[3]), JSON.stringify(sp.all));

  // ล้างกลับสู่เคสปกติ ไม่ให้ค้างไปรบกวนการรันซ้ำ
  await ev('document.getElementById("travelReturnTo").value="";'
    + ' document.querySelectorAll("#extraDaysList .extra-day").forEach(function(r){r.remove();});'
    + ' const sp2=document.getElementById("tripModeSpecial");'
    + ' if (sp2) { sp2.checked=false; sp2.dispatchEvent(new Event("change",{bubbles:true})); }'
    + ' syncReturnDiff(); onExtraDaysChange(); return 1;');
  await sleep(700);

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
