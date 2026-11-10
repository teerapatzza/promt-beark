/* กลับที่จุดเดิม = ระยะทางต้องเท่าขาไปเสมอ
 *
 * 10 พ.ย. 2569 — เจ้าของงานชี้ว่า ถ้าขากลับไปจบที่จุดเดียวกับที่ออกมา
 * ระยะทางก็ต้องเท่ากัน จะมาคิดใหม่แล้วได้เลขคนละตัวไม่ได้
 *
 * ของเดิม recalcRoute ทำแบบนี้
 *     let retKm = km;                       // ค่าตั้งต้น = เท่าขาไป
 *     if (returnIsDifferent()) {
 *         const back = await routeLeg(backStart, geoRet || geoFrom);
 *         retKm = back.km;                  // ไปคิดเส้นทางจริง ทับค่าเดิม
 *     }
 * พอกดปุ่ม "เหมือนจุดเริ่มต้น" ช่องปลายทางขากลับมีค่า -> เข้าเงื่อนไขนี้
 * -> ระยะขากลับถูกคิดใหม่ ซึ่งบนถนนจริงมักไม่เท่าขาไป (เดินรถทางเดียว ฯลฯ)
 * -> เงินที่เบิกของสองขาไม่เท่ากัน ทั้งที่เป็นเส้นทางเดียวกันกลับหัว
 *
 * เทสต์นี้จงใจให้ตัวคิดเส้นทางตอบคนละเลขตามทิศทาง (ไป 20 กม. / กลับ 35 กม.)
 * ถ้าระบบไปเรียกตัวคิดเส้นทางจริง จะได้ 35 แล้วเทสต์ตก
 *
 * รัน: cd public && python -m http.server 8099 --bind 127.0.0.1 &
 *      node scripts/test-return-same-distance.mjs
 */
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9565, PROFILE = 'C:/Users/teerapat/AppData/Local/Temp/pb-retdist';
const APP = process.env.APP_URL || 'http://127.0.0.1:8099';

const HOME = { lat: 13.90, lng: 100.50, label: 'บ้าน 141/36' };
const HOSP = { lat: 13.70, lng: 100.60, label: 'โรงพยาบาลทดสอบ' };
const OUT_M = 20000;   // ขาไป 20.0 กม.
const RET_M = 35000;   // ขากลับ 35.0 กม. — ตั้งให้ต่างชัด ๆ เพื่อให้จับได้แน่

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

const dist = () => ev('return { out: document.getElementById("distOutbound").value,'
  + ' ret: document.getElementById("distReturn").value,'
  + ' calls: window.__routeCalls || [] };');

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
    "window.__routeCalls = [];",
    "const of = window.fetch;",
    "window.fetch = function (u,i) { const s=(typeof u==='string')?u:(u&&u.url)||'';",
    "  if (s.indexOf('/map-route')>=0) {",
    "    const q = new URLSearchParams(s.split('?')[1]||'');",
    "    const flat = parseFloat(q.get('flat')), tlat = parseFloat(q.get('tlat'));",
    "    window.__routeCalls.push(flat.toFixed(2)+'->'+tlat.toFixed(2));",
    /* ออกจากบ้าน (13.90) = ขาไป · ออกจากโรงพยาบาล (13.70) = ขากลับ
       จงใจให้สองทิศได้คนละเลข เพื่อจับว่ามีการคิดเส้นทางขากลับใหม่หรือไม่ */
    "    const m = (flat > 13.8) ? " + OUT_M + " : " + RET_M + ";",
    "    return Promise.resolve(new Response(JSON.stringify({ type:'FeatureCollection',",
    "      features:[{ type:'Feature', properties:{ distance:m },",
    "        geometry:{ type:'LineString', coordinates:[[q.get('flon')*1,flat],[q.get('tlon')*1,tlat]] } }] }),",
    "      {status:200,headers:{'Content-Type':'application/json'}}));",
    "  }",
    "  if (s.indexOf('/auth/me')>=0) return Promise.resolve(new Response(",
    "    JSON.stringify({id:1,email:'t@ha.or.th',name:'ทดสอบ',role:'admin'}),",
    "    {status:200,headers:{'Content-Type':'application/json'}}));",
    "  if (s.indexOf('/budget-categories')>=0) return Promise.resolve(new Response(",
    "    JSON.stringify([{ id:'TRAVEL002', name:'ทดสอบ ใบค่าพาหนะ',",
    "      pdfTemplates:['TRANSPORT_RECEIPT'], attachmentRules:{}, attachmentOrder:[] }]),",
    "    {status:200,headers:{'Content-Type':'application/json'}}));",
    "  if (s.indexOf('/expenses')>=0||s.indexOf('/profiles')>=0)",
    "    return Promise.resolve(new Response('[]',{status:200,headers:{'Content-Type':'application/json'}}));",
    "  return of(u,i); };"
  ].join('\n') });
  await send('Page.navigate', { url: APP + '/expense.html' }); await sleep(5000);

  // เลือกหมวดก่อน ไม่งั้นกล่องค่าพาหนะยังซ่อนอยู่ทั้งหมด
  await ev('const c=document.getElementById("categorySelect"); c.value="TRAVEL002";'
    + ' c.dispatchEvent(new Event("change",{bubbles:true})); return 1;');
  await sleep(1200);

  // กรณีพิเศษ + ติ๊กรถทั้งสองขา เพื่อให้ช่องขากลับใช้งานได้จริง
  await ev('const sp=document.getElementById("tripModeSpecial");'
    + ' if (sp) { sp.checked=true; sp.dispatchEvent(new Event("change",{bubbles:true})); }'
    + ' ["legOutCar","legBackCar"].forEach(function(i){ const e=document.getElementById(i);'
    + '   if (e && !e.checked) { e.checked=true; e.dispatchEvent(new Event("change",{bubbles:true})); } });'
    + ' return 1;');
  await sleep(900);

  await ev('document.getElementById("travelFrom").value = ' + JSON.stringify(HOME.label) + ';'
    + ' setPoint("from", ' + HOME.lat + ', ' + HOME.lng + ', ' + JSON.stringify(HOME.label) + ', "exact", "user");'
    + ' document.getElementById("travelTo").value = ' + JSON.stringify(HOSP.label) + ';'
    + ' setPoint("to", ' + HOSP.lat + ', ' + HOSP.lng + ', ' + JSON.stringify(HOSP.label) + ', "exact", "user");'
    + ' await recalcRoute(false); return 1;');
  await sleep(1500);

  /* ── 1. ยังไม่กดปุ่ม ช่องขากลับว่าง = กลับทางเดิม ระยะต้องเท่ากัน ── */
  const blank = await dist();
  ok('ขาไปได้ระยะจากตัวคิดเส้นทาง 20.0 กม.', String(blank.out) === '20', JSON.stringify(blank));
  ok('ช่องว่าง: ระยะขากลับเท่าขาไป', String(blank.ret) === String(blank.out), JSON.stringify(blank));

  /* ── 2. กดปุ่ม "เหมือนจุดเริ่มต้น" แล้วระยะต้องยังเท่ากัน ──
     ข้อนี้คือหัวใจ ถ้าไปคิดเส้นทางใหม่จะได้ 35 ซึ่งผิด */
  await ev('return copyPlaceFrom("from", "ret");');
  await sleep(500);
  await ev('await recalcRoute(false); return 1;');
  await sleep(1500);
  const copied = await dist();
  ok('กดปุ่มแล้วช่องปลายทางขากลับมีข้อความ',
     (await ev('return document.getElementById("travelReturnTo").value')) !== '', '');
  ok('กดปุ่มแล้วระยะขากลับยังเท่าขาไป (ไม่ใช่ 35)',
     String(copied.ret) === String(copied.out), JSON.stringify(copied));
  ok('ไม่ได้ไปเรียกตัวคิดเส้นทางขากลับเลย',
     !(copied.calls || []).some(c => c.startsWith('13.70')), JSON.stringify(copied.calls));

  /* ── 3. ไปคนละที่จริง ๆ ต้องยังคิดเส้นทางใหม่ตามเดิม ──
     ห้ามแก้แล้วไปทำให้กรณีพิเศษที่ใช้งานอยู่พัง */
  await ev('document.getElementById("travelReturnTo").value = "ที่อื่นจริง ๆ";'
    + ' setPoint("ret", 13.50, 100.80, "ที่อื่นจริง ๆ", "exact", "user");'
    + ' await recalcRoute(false); return 1;');
  await sleep(1500);
  const other = await dist();
  ok('ขากลับไปคนละที่จริง ยังคิดเส้นทางใหม่ได้ 35.0 กม.',
     String(other.ret) === '35', JSON.stringify(other));

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
