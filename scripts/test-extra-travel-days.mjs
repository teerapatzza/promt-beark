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
    "  if (s.indexOf('/map-route')>=0) {",
    "    const q = new URLSearchParams(s.split('?')[1]||'');",
    "    return Promise.resolve(new Response(JSON.stringify({ type:'FeatureCollection',",
    "      features:[{ type:'Feature', properties:{ distance:" + (KM * 1000) + " },",
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
