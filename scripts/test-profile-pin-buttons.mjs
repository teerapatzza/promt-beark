/* ปุ่มดึงที่อยู่จากโปรไฟล์ และปุ่มคัดลอกหมุดจากจุดเริ่มต้น
 *
 * 10 พ.ย. 2569 — เจ้าของงานแจ้งว่าตั้งที่อยู่ 141/36 ไว้ในโปรไฟล์พร้อมปักหมุดแล้ว
 * แต่เอามาใส่ช่องค้นหาแผนที่ช่องอื่นไม่ได้เลย ต้องพิมพ์ชื่อแล้วให้ระบบค้นใหม่
 * ซึ่งได้หมุดคนละจุดกับที่ปักไว้
 *
 * ข้อสำคัญที่สุด — ทั้งสองปุ่มต้อง **คัดลอกพิกัดตรง ๆ ห้ามค้นหาใหม่**
 * ถ้าค้นใหม่ หมุดจะคลาดไปเล็กน้อย แล้วระยะขากลับจะไม่เท่าขาไป
 * ทั้งที่เป็นที่เดียวกัน -> เงินที่เบิกเพี้ยน
 *
 * รัน: cd public && python -m http.server 8099 --bind 127.0.0.1 &
 *      node scripts/test-profile-pin-buttons.mjs
 */
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9564, PROFILE = 'C:/Users/teerapat/AppData/Local/Temp/pb-profilepin';
const APP = process.env.APP_URL || 'http://127.0.0.1:8099';

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

/* โปรไฟล์ที่ผู้ใช้ลากหมุดเองแล้ว (source: 'user' = ยืนยันแล้ว แม่นที่สุด) */
const P = {
  id: 77, fullName: 'ทดสอบ หมุดโปรไฟล์', position: 'ที่ปรึกษา', affiliation: 'อิสระ',
  no: '141/36', soi: 'เลี่ยงเมืองปากเกร็ด 3', road: '',
  sub: 'บางพูด', dist: 'ปากเกร็ด', prov: 'นนทบุรี', zip: '11120',
  lat: 13.9123456, lng: 100.4987654,
  geo: { lat: 13.9123456, lng: 100.4987654, precision: 'exact', source: 'user' }
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
    "const of = window.fetch;",
    "window.fetch = function (u,i) { const s=(typeof u==='string')?u:(u&&u.url)||'';",
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

  /* ── 1. ต้องเก็บหมุดของโปรไฟล์ไว้ ไม่ใช่เก็บแค่ที่อยู่ ── */
  await ev('applyProfileDataFromObj(' + JSON.stringify(P) + '); return 1;');
  const pin = await ev('return window.__profilePin || null;');
  ok('เก็บหมุดโปรไฟล์ไว้ใน __profilePin', !!pin, JSON.stringify(pin));
  ok('พิกัดที่เก็บตรงกับโปรไฟล์เป๊ะ',
     pin && pin.lat === P.lat && pin.lng === P.lng, JSON.stringify(pin));
  ok('จำได้ว่าเป็นหมุดที่ผู้ใช้ยืนยันเอง',
     pin && pin.source === 'user' && pin.precision === 'exact', JSON.stringify(pin));

  /* ── 2. ของเดิมต้องไม่เปลี่ยน: จุดเริ่มต้นยังถูกเติมอัตโนมัติ ── */
  const fromGeo = await ev('const g = getGeo("from"); return g ? {lat:g.lat,lng:g.lng,label:g.label} : null;');
  ok('จุดเริ่มต้นยังถูกเติมจากโปรไฟล์อัตโนมัติเหมือนเดิม',
     fromGeo && fromGeo.lat === P.lat && fromGeo.lng === P.lng, JSON.stringify(fromGeo));
  const fromTxt = await ev('return document.getElementById("travelFrom").value;');
  ok('ข้อความจุดเริ่มต้นมีเลขที่และซอย',
     /141\/36/.test(fromTxt) && /ซอยเลี่ยงเมืองปากเกร็ด 3/.test(fromTxt), fromTxt);

  /* ── 3. ปุ่ม "ที่อยู่ในโปรไฟล์" ต้องใช้ได้กับช่องอื่นด้วย ── */
  await ev('return usePlaceFromProfile("ret");');
  const retGeo = await ev('const g = getGeo("ret"); return g ? {lat:g.lat,lng:g.lng,precision:g.precision,source:g.source} : null;');
  ok('ปลายทางขากลับได้หมุดจากโปรไฟล์', !!retGeo, JSON.stringify(retGeo));
  ok('พิกัดขากลับตรงกับโปรไฟล์เป๊ะ ไม่ได้ค้นใหม่',
     retGeo && retGeo.lat === P.lat && retGeo.lng === P.lng, JSON.stringify(retGeo));
  const retTxt = await ev('return document.getElementById("travelReturnTo").value;');
  ok('ข้อความปลายทางขากลับถูกเติมด้วย', /141\/36/.test(retTxt), retTxt);

  /* ── 4. ปุ่ม "เหมือนจุดเริ่มต้น" ต้องคัดลอกพิกัดตรง ๆ ──
     นี่คือข้อที่กันเงินเพี้ยน ถ้าไปค้นใหม่ พิกัดจะไม่เท่ากันเป๊ะ */
  await ev('setPoint("from", 13.1111111, 100.2222222, "จุดอื่นที่ไม่ใช่โปรไฟล์", "exact", "user"); return 1;');
  await ev('return copyPlaceFrom("from", "ret");');
  const copied = await ev('const a=getGeo("from"), b=getGeo("ret");'
    + ' return {a:a?{lat:a.lat,lng:a.lng,label:a.label}:null, b:b?{lat:b.lat,lng:b.lng,label:b.label}:null};');
  ok('คัดลอกพิกัดจากจุดเริ่มต้นได้ตรงทุกหลักทศนิยม',
     copied.a && copied.b && copied.a.lat === copied.b.lat && copied.a.lng === copied.b.lng,
     JSON.stringify(copied));
  ok('คัดลอกชื่อสถานที่มาด้วย',
     copied.b && copied.b.label === copied.a.label, JSON.stringify(copied));

  /* ── 5. โปรไฟล์ที่ยังไม่เคยปักหมุด ต้องไม่พัง ── */
  const noPin = await ev('const Q = ' + JSON.stringify({ ...P, lat: null, lng: null, geo: null }) + ';'
    + ' applyProfileDataFromObj(Q); return window.__profilePin;');
  ok('โปรไฟล์ที่ไม่มีหมุด ไม่เก็บหมุดค้างไว้', !noPin, JSON.stringify(noPin));
  const guard = await ev('try { return usePlaceFromProfile("ret") === false ? "กันไว้" : "ปล่อยผ่าน"; }'
    + ' catch (e) { return "พัง: " + e.message; }');
  ok('ไม่มีหมุดแล้วกดปุ่ม ต้องไม่พังและไม่ปักหมุดมั่ว', guard === 'กันไว้', guard);

  /* ── 6. ปุ่มต้องมีอยู่จริงในหน้า และต่อสายถูกช่อง ──
     ฟังก์ชันทำงานได้แต่ไม่มีปุ่มให้กด = ผู้ใช้ยังใช้ไม่ได้ */
  const chips = await ev('return [...document.querySelectorAll(".place-chip")]'
    + '.map(b => ({ t: b.textContent.trim(), on: b.getAttribute("onclick") }));');
  ok('มีปุ่มครบ 5 ปุ่ม', chips.length === 5, JSON.stringify(chips.map(c => c.t)));
  const has = s => chips.some(c => c.on === s);
  ok('ปุ่มโปรไฟล์ของจุดเริ่มต้นต่อถูก',       has("usePlaceFromProfile('from')"), JSON.stringify(chips));
  ok('ปุ่มโปรไฟล์ของปลายทางขากลับต่อถูก',   has("usePlaceFromProfile('ret')"));
  ok('ปุ่มโปรไฟล์ของจุดเริ่มต้นขากลับต่อถูก', has("usePlaceFromProfile('retfrom')"));
  ok('ปุ่ม "เหมือนจุดเริ่มต้น" ต่อถูก',        has("copyPlaceFrom('from','ret')"));
  ok('ปุ่ม "เหมือนจุดที่รถไปส่ง" ต่อถูก',      has("copyPlaceFrom('to','retfrom')"));

  /* ── 7. ของเดิมต้องอยู่ครบ ไม่ถูกปุ่มเบียดหาย ── */
  const kept = await ev('return ["travelFrom","travelTo","travelReturnFrom","travelReturnTo",'
    + '"fromHint","toHint","returnFromHint","returnToHint","fromSuggest","toSuggest",'
    + '"returnFromSuggest","returnToSuggest"].filter(id => !document.getElementById(id));');
  ok('ช่องกรอกและกล่องผลค้นหาเดิมอยู่ครบ ไม่หายสักตัว', kept.length === 0, JSON.stringify(kept));

  /* ══════════ 8. ของเดิมต้องทำงานเหมือนเดิมทุกประการ ══════════
     10 พ.ย. 2569 เจ้าของงานกำชับว่าปุ่มเป็น "ทางเลือกที่เพิ่มเข้ามา"
     คนที่เคยใช้แบบเว้นว่างไว้ ต้องใช้ได้เหมือนเดิม ห้ามงง ห้ามพัง
     พฤติกรรมเดิมคือ เว้นว่างทั้งสองช่อง = กลับทางเดิม ระยะขากลับเท่าขาไป */
  await ev('applyProfileDataFromObj(' + JSON.stringify(P) + ');'
    + ' const c=document.getElementById("categorySelect");'
    + ' if (c) { c.value="TRAVEL002"; c.dispatchEvent(new Event("change",{bubbles:true})); }'
    + ' return 1;');
  await sleep(1200);
  // ล้างช่องขากลับให้กลับสู่สภาพเริ่มต้น เหมือนผู้ใช้ที่ไม่เคยแตะปุ่มเลย
  await ev('["travelReturnTo","travelReturnFrom"].forEach(function(i){'
    + ' const e=document.getElementById(i); if(e){ e.value=""; e.dispatchEvent(new Event("input",{bubbles:true})); }});'
    + ' if (typeof syncReturnDiff === "function") syncReturnDiff();'
    + ' if (typeof updateReturnPlaceholders === "function") updateReturnPlaceholders();'
    + ' return 1;');

  const base = await ev('return {'
    + ' retVal: document.getElementById("travelReturnTo").value,'
    + ' diff: (typeof returnIsDifferent === "function") ? returnIsDifferent() : null,'
    + ' ph: document.getElementById("travelReturnTo").placeholder,'
    + ' hint: (document.getElementById("returnToHint")||{}).textContent || "",'
    + ' geo: getGeo("ret") ? "มีหมุดค้าง" : "ไม่มีหมุด" };');

  ok('ไม่กดปุ่ม ช่องขากลับยังว่างเหมือนเดิม', base.retVal === '', JSON.stringify(base.retVal));
  ok('ช่องว่าง = ยังถือว่ากลับทางเดิม (ไม่ใช่ไปคนละที่)', base.diff === false, String(base.diff));
  ok('ข้อความ "ว่าง = กลับที่ ..." ยังขึ้นเหมือนเดิม',
     /^ว่าง = กลับที่ /.test(base.ph), base.ph);
  ok('คำอธิบายใต้ช่องยังบอกว่าไปกลับเส้นทางเดิม',
     /ไปกลับเส้นทางเดิม/.test(base.hint), base.hint);
  ok('ช่องว่างแล้วต้องไม่มีหมุดค้างอยู่', base.geo === 'ไม่มีหมุด', base.geo);

  /* กดปุ่มแล้วเปลี่ยนใจ ลบข้อความทิ้ง ต้องกลับไปเป็นพฤติกรรมเดิมได้สนิท
     ไม่ใช่ค้างเป็น "ไปคนละที่" ทั้งที่ช่องว่างแล้ว ซึ่งจะทำให้ระยะขากลับเพี้ยน */
  /* 8ก. อยู่ "เคสปกติ" (การ์ดขากลับซ่อนอยู่) กดปุ่มแล้วต้อง **ไม่** เปลี่ยนโหมด
     กติกาคือ want = backCar && (rf || rt) — ไม่ติ๊กรถขากลับก็ไม่นับ
     ข้อนี้คือเกราะกันไม่ให้ปุ่มใหม่ไปรบกวนคนที่ใช้แบบเดิมอยู่ */
  await ev('return usePlaceFromProfile("ret");');
  const pressNormal = await ev('return { v: document.getElementById("travelReturnTo").value,'
    + ' diff: returnIsDifferent() };');
  ok('เคสปกติ: กดปุ่มแล้วยังถือว่ากลับทางเดิม ไม่ถูกเปลี่ยนโหมดให้',
     pressNormal.diff === false, JSON.stringify(pressNormal));

  /* 8ข. กรณีพิเศษ + ติ๊กรถขากลับ = ช่องนี้ใช้งานจริง ปุ่มต้องมีผล */
  await ev('const e=document.getElementById("travelReturnTo"); e.value="";'
    + ' const sp=document.getElementById("tripModeSpecial");'
    + ' if (sp) { sp.checked=true; sp.dispatchEvent(new Event("change",{bubbles:true})); }'
    + ' const lb=document.getElementById("legBackCar");'
    + ' if (lb) { lb.checked=true; lb.dispatchEvent(new Event("change",{bubbles:true})); }'
    + ' return 1;');
  await sleep(900);
  await ev('return usePlaceFromProfile("ret");');
  const pressSpecial = await ev('return { v: document.getElementById("travelReturnTo").value,'
    + ' diff: returnIsDifferent(), geo: getGeo("ret") ? "มีหมุด" : "ไม่มีหมุด" };');
  ok('กรณีพิเศษ: กดปุ่มแล้วช่องมีค่าและระบบรับรู้ว่าระบุปลายทางเอง',
     pressSpecial.v !== '' && pressSpecial.diff === true, JSON.stringify(pressSpecial));
  ok('กรณีพิเศษ: กดปุ่มแล้วได้หมุดจริง', pressSpecial.geo === 'มีหมุด', pressSpecial.geo);

  // กลับสู่เคสปกติก่อนทดสอบการลบข้อความ ให้ตรงกับที่ผู้ใช้ส่วนใหญ่ใช้
  await ev('const sp=document.getElementById("tripModeSpecial");'
    + ' if (sp) { sp.checked=false; sp.dispatchEvent(new Event("change",{bubbles:true})); } return 1;');
  await sleep(700);

  await ev('const e=document.getElementById("travelReturnTo"); e.value="";'
    + ' e.dispatchEvent(new Event("input",{bubbles:true}));'
    + ' if (typeof syncReturnDiff === "function") syncReturnDiff();'
    + ' if (typeof updateReturnPlaceholders === "function") updateReturnPlaceholders(); return 1;');
  const afterClear = await ev('return { v: document.getElementById("travelReturnTo").value,'
    + ' diff: returnIsDifferent(), geo: getGeo("ret") ? "มีหมุดค้าง" : "ไม่มีหมุด",'
    + ' ph: document.getElementById("travelReturnTo").placeholder };');
  ok('ลบข้อความทิ้งแล้วกลับไปเป็นกลับทางเดิมได้สนิท',
     afterClear.v === '' && afterClear.diff === false, JSON.stringify(afterClear));
  ok('ลบข้อความทิ้งแล้วหมุดต้องหายไปด้วย ไม่ค้างคิดระยะผิด',
     afterClear.geo === 'ไม่มีหมุด', afterClear.geo);
  ok('ข้อความ "ว่าง = กลับที่ ..." กลับมาเหมือนเดิม',
     /^ว่าง = กลับที่ /.test(afterClear.ph), afterClear.ph);

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
