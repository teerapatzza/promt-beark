// เส้นทางของเที่ยว Taxi ต้องขึ้นบนแผนที่ แม้เส้นทางหลักยังไม่มีหมุดครบ
//
// 21 ต.ค. 2569 — เจ้าของงานเบิกเฉพาะ Taxi ขากลับ 2 เที่ยว ปักหมุดครบทั้ง 4 จุด
// แต่แผนที่ว่างเปล่า แล้วทักว่า
//   "ทำไมแผนที่ไม่ลากหมุด ผมเลือก taxi แล้ว ... ไหนบอกลองแล้วเทสแล้ว หมุดหายไปไหน"
//
// ต้นเหตุเป็นความผิดของผมเอง: วางบรรทัดวาดเส้นไว้ "ใต้" ด่านตรวจหมุดของเส้นทางหลัก
//   if (!geoFrom || !geoTo) { ...; return; }     <- ออกตรงนี้
//   await drawTaxiLegLines();                    <- ไม่เคยถึง
// เคสที่เบิกเฉพาะ Taxi เส้นทางหลักไม่มีหมุดปลายทาง จึง return ก่อนเสมอ
//
// และผมประกาศว่า "เสร็จ" ทั้งที่ไม่เคยเขียนชุดทดสอบคุมมันเลย ชุดนี้คือตัวที่ขาดไป
//
//   cd public && python3 -m http.server 8099 --bind 127.0.0.1
//   node scripts/test-taxi-map-lines.mjs
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9655, PROFILE = 'C:/Users/teerapat/AppData/Local/Temp/pb-taximap';
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
    "    JSON.stringify([{id:'TRAVEL002',name:'test',fuelRate:5,taxiMaxPerTrip:1200,",
    "      pdfTemplates:['REPORT','TRANSPORT_RECEIPT'],attachmentRules:{},attachmentOrder:[]}]),",
    "    {status:200,headers:{'Content-Type':'application/json'}}));",
    "  if(s.indexOf('/expenses')>=0||s.indexOf('/profiles')>=0)",
    "    return Promise.resolve(new Response('[]',{status:200,headers:{'Content-Type':'application/json'}}));",
    "  return of(u,i);};"
  ].join(NL) });

  await send('Page.navigate', { url: APP + '/expense.html' }); await sleep(6000);
  await ev([
    "const s=document.getElementById('categorySelect');",
    "s.value='TRAVEL002'; s.dispatchEvent(new Event('change',{bubbles:true}));",
    "await new Promise(r=>setTimeout(r,1500));",
    "const ds=document.getElementById('dateStart'), de=document.getElementById('dateEnd');",
    "ds.value='2026-10-21'; ds.dispatchEvent(new Event('change',{bubbles:true}));",
    "de.value='2026-10-22'; de.dispatchEvent(new Event('change',{bubbles:true}));",
    "await new Promise(r=>setTimeout(r,500));",
    "window.routeLeg = async (a,b) => ({ km: 43.2, meters: 43200,",
    "  coords: [[a.lat,a.lng],[(a.lat+b.lat)/2,(a.lng+b.lng)/2],[b.lat,b.lng]] });",
    "return 1;"
  ].join(NL));

  console.log('═══ 1. เคสของเจ้าของงาน: เบิกเฉพาะ Taxi เส้นทางหลักไม่มีหมุดปลายทาง ═══');
  const setup = await ev([
    // จงใจไม่ปักหมุดปลายทางของเส้นทางหลัก ให้เหมือนหน้าจอที่ผู้ใช้ส่งรูปมา
    "geoFrom = { lat: 13.60, lng: 100.53, precision:'exact', label:'บ้าน' };",
    "geoTo = null;",
    "document.getElementById('travelFrom').value='บ้าน';",
    "{const c=document.getElementById('legOutTaxi'); c.checked=true;",
    " c.dispatchEvent(new Event('change',{bubbles:true}));",
    " await new Promise(r=>setTimeout(r,900));}",
    "if (document.querySelectorAll('.taxi-entry').length < 2) addTaxiEntry('ขากลับ');",
    "await new Promise(r=>setTimeout(r,500));",
    "const rows=[...document.querySelectorAll('.taxi-entry')];",
    "const pin=(row,cls,lat,lng,name)=>{",
    "  const el=row.querySelector(cls); el.value=name;",
    "  el.dataset.lat=lat; el.dataset.lng=lng; el.dataset.touched='1'; };",
    "pin(rows[0],'.taxi-from',13.9126,100.6068,'สนามบินดอนเมือง');",
    "pin(rows[0],'.taxi-to',  13.6591,100.5330,'141/36 ซอยสุขสวัสดิ์ 55');",
    "if(rows[1]){ pin(rows[1],'.taxi-from',13.6650,100.4300,'เซ็นทรัลพลาซา พระราม 2');",
    "             pin(rows[1],'.taxi-to',  13.6900,100.7501,'แยกสนามบินสุวรรณภูมิ'); }",
    "return { rows: rows.length, mainTo: geoTo };"
  ].join(NL));
  ok('มีแถว Taxi ให้ทดสอบอย่างน้อย 2 เที่ยว', setup.rows >= 2, setup.rows + ' แถว');
  ok('เส้นทางหลักยังไม่มีหมุดปลายทาง (เหมือนหน้าจอที่ผู้ใช้เจอ)',
     setup.mainTo === null, String(setup.mainTo));

  console.log('');
  console.log('═══ 2. สั่งคำนวณเส้นทาง เส้นของเที่ยว Taxi ต้องขึ้นบนแผนที่ ═══');
  const drawn = await ev([
    "await recalcRoute(true);",
    "await new Promise(r=>setTimeout(r,900));",
    "const lines = (typeof taxiLegLines !== 'undefined') ? taxiLegLines : [];",
    "return { n: lines.length,",
    "         colors: lines.map(l => l.options.color),",
    "         dashed: lines.every(l => !!l.options.dashArray),",
    "         onMap: lines.every(l => !!(routeMap && routeMap.hasLayer(l))) };"
  ].join(NL));
  ok('วาดเส้นครบทุกเที่ยว ไม่ใช่ศูนย์เส้น', drawn.n === setup.rows,
     drawn.n + ' เส้น จาก ' + setup.rows + ' เที่ยว');
  ok('เส้นอยู่บนแผนที่จริง', drawn.onMap === true);
  ok('ใช้สีต่างจากเส้นทางหลัก (ไม่ใช่สีน้ำเงิน/ม่วงของเส้นทางหลัก)',
     drawn.colors.every(c => c !== '#2563eb' && c !== '#7c3aed'),
     drawn.colors.join(', '));
  /* 21 ต.ค. 2569 — เจ้าของงานทักว่า "สีมันเหมือนกันเกิน"
     สองเที่ยวในย่านเดียวกัน (ขากลับ ขากลับ) เส้นทับกันจนแยกไม่ออก */
  ok('แต่ละเที่ยวใช้คนละสี ไม่ใช่สีเดียวกันหมด',
     new Set(drawn.colors).size === drawn.colors.length,
     drawn.colors.join(' / '));
  ok('เป็นเส้นประ แยกจากเส้นทางหลักด้วยสายตา', drawn.dashed === true);

  console.log('');
  console.log('═══ 2ข. หมุดของทุกเที่ยวต้องขึ้นบนแผนที่ และลากได้ ═══');
  /* 21 ต.ค. 2569 — เจ้าของงานปักหมุดครบสี่จุดแต่เห็นหมุดเดียว แล้วถามว่า
     "หมุดหายไปไหน" ของเดิมแผนที่มีหมุดแค่ของเส้นทางหลัก
     หมุดของเที่ยว Taxi เก็บไว้ที่ช่องกรอก ไม่เคยถูกวางลงแผนที่ */
  const marks = await ev([
    "const mk = (typeof taxiLegMarkers !== 'undefined') ? taxiLegMarkers : [];",
    "return { n: mk.length,",
    "         draggable: mk.every(m => !!(m.options && m.options.draggable)),",
    "         onMap: mk.every(m => !!(routeMap && routeMap.hasLayer(m))) };"
  ].join(NL));
  ok('หมุดขึ้นครบทุกจุดของทุกเที่ยว (2 เที่ยว = 4 หมุด)',
     marks.n === setup.rows * 2, marks.n + ' หมุด');
  ok('หมุดอยู่บนแผนที่จริง', marks.onMap === true);
  ok('หมุดลากได้ทุกตัว (แผนที่ไม่มีทุกซอย ต้องลากปรับเองได้)',
     marks.draggable === true);

  console.log('');
  console.log('═══ 2ค. ลากหมุดแล้วพิกัดในช่องต้องเปลี่ยนตาม ═══');
  const dragged = await ev([
    "const row = document.querySelectorAll('.taxi-entry')[0];",
    "const el = row.querySelector('.taxi-from');",
    "const before = { lat: el.dataset.lat, lng: el.dataset.lng };",
    "const mk = taxiLegMarkers[0];",
    "mk.setLatLng([14.1234, 100.4321]);",
    "mk.fire('dragend');",
    "await new Promise(r=>setTimeout(r,900));",
    "return { before: before,",
    "         after: { lat: el.dataset.lat, lng: el.dataset.lng },",
    "         touched: el.dataset.touched || null };"
  ].join(NL));
  ok('ลากแล้วพิกัดในช่องเปลี่ยนตามหมุด',
     Math.abs(parseFloat(dragged.after.lat) - 14.1234) < 1e-6,
     dragged.before.lat + '  ->  ' + dragged.after.lat);
  ok('ตีตราว่าผู้ใช้ยืนยันเอง เส้นทางหลักจะไม่มาเขียนทับ',
     dragged.touched === '1', String(dragged.touched));

  console.log('');
  console.log('═══ 3. ปักหมุดเพิ่มทีหลัง เส้นต้องขึ้นเองโดยไม่ต้องกดคำนวณใหม่ ═══');
  const live = await ev([
    "const row = document.querySelectorAll('.taxi-entry')[0];",
    "const el = row.querySelector('.taxi-to');",
    "// จำลองการเลือกสถานที่จากรายการ ซึ่งไหลไปที่ setPoint",
    "const key = taxiSinkKey(el);",
    "setPoint(key, 13.7000, 100.5000, 'จุดใหม่', 'search', 'test');",
    "await new Promise(r=>setTimeout(r,1200));",
    "const lines = taxiLegLines || [];",
    "return { n: lines.length };"
  ].join(NL));
  ok('ปักหมุดแล้วเส้นยังอยู่ครบ ไม่หายไป', live.n === setup.rows,
     live.n + ' เส้น');

  console.log('');
  console.log('═══ 4. ลบแถว Taxi แล้วเส้นของแถวนั้นต้องหายตาม ═══');
  const removed = await ev([
    "const rows=[...document.querySelectorAll('.taxi-entry')];",
    "const btn = rows[rows.length-1].querySelector('[onclick*=removeTaxiEntry]');",
    "if (btn) btn.click();",
    "await new Promise(r=>setTimeout(r,1200));",
    "return { rows: document.querySelectorAll('.taxi-entry').length,",
    "         lines: (taxiLegLines||[]).length,",
    "         marks: (taxiLegMarkers||[]).length };"
  ].join(NL));
  ok('จำนวนเส้นเท่ากับจำนวนเที่ยวที่เหลือ', removed.lines === removed.rows,
     removed.rows + ' เที่ยว · ' + removed.lines + ' เส้น');
  ok('หมุดของแถวที่ลบไปหายตามด้วย ไม่ค้างบนแผนที่',
     removed.marks === removed.rows * 2, removed.marks + ' หมุด');

  console.log('');
  console.log('═══ 5. ทุกเที่ยวเป็น "ขากลับ" เหมือนกันก็ต้องรองรับ ═══');
  /* 21 ต.ค. 2569 — เจ้าของงานสั่งว่า "บางครั้งเขาอาจจะเขียนเป็น ขากลับ ขากลับ
     ถ้าเขายืนยันเราก็ต้องรองรับเคสเขา" */
  const sameDir = await ev([
    // ข้อ 4 ลบแถวไปหนึ่ง เติมกลับให้ครบสามเที่ยว จะได้ทดสอบ "ขากลับ ขากลับ ขากลับ" จริง
    "while (document.querySelectorAll('.taxi-entry').length < 3) addTaxiEntry('ขากลับ');",
    "await new Promise(r=>setTimeout(r,600));",
    "{const pts=[[13.72,100.52,13.65,100.49],[13.80,100.60,13.70,100.55]];",
    " [...document.querySelectorAll('.taxi-entry')].forEach((r,i)=>{",
    "   const f=r.querySelector('.taxi-from'), t=r.querySelector('.taxi-to');",
    "   if(!f.dataset.lat){ const p=pts[i%pts.length];",
    "     f.value='ต้นทาง '+(i+1); f.dataset.lat=p[0]; f.dataset.lng=p[1]; f.dataset.touched='1';",
    "     t.value='ปลายทาง '+(i+1); t.dataset.lat=p[2]; t.dataset.lng=p[3]; t.dataset.touched='1'; } });}",
    "document.querySelectorAll('.taxi-entry').forEach(r=>{",
    "  const s=r.querySelector('.taxi-dir'); s.value='ขากลับ';",
    "  s.dispatchEvent(new Event('change',{bubbles:true})); });",
    "await new Promise(r=>setTimeout(r,400));",
    "await drawTaxiLegLines();",
    "await new Promise(r=>setTimeout(r,600));",
    "const rows=[...document.querySelectorAll('.taxi-entry')];",
    "return { dirs: rows.map(r=>r.querySelector('.taxi-dir').value),",
    "         lines: (taxiLegLines||[]).length,",
    "         marks: (taxiLegMarkers||[]).length,",
    "         colors: (taxiLegLines||[]).map(l=>l.options.color) };"
  ].join(NL));
  ok('มีหลายเที่ยวให้ทดสอบจริง ไม่ใช่เที่ยวเดียว', sameDir.dirs.length >= 3,
     sameDir.dirs.length + ' เที่ยว');
  ok('ทุกแถวเป็นขากลับได้ ระบบไม่บังคับให้ต่างทิศ',
     sameDir.dirs.every(d => d === 'ขากลับ'), sameDir.dirs.join(', '));
  ok('ยังวาดเส้นครบทุกเที่ยวแม้ทิศทางซ้ำกัน',
     sameDir.lines === sameDir.dirs.length, sameDir.lines + ' เส้น');
  ok('ยังแยกสีได้แม้ทิศทางซ้ำกัน',
     new Set(sameDir.colors).size === sameDir.colors.length,
     sameDir.colors.join(' / '));

  console.log('');
  console.log('═══ 6. เบิกเฉพาะ Taxi (ไม่มีเส้นทางหลัก) ต้องบันทึกได้ ═══');
  /* 21 ต.ค. 2569 — ตัวตรวจบังคับให้กรอกเส้นทางหลักเสมอ
     ใบที่เบิกเฉพาะ Taxi จึงบันทึกไม่ได้ ทั้งที่กรอกแถว Taxi ครบแล้ว
     ("ทั้ง ๆ ที่ผมใส่ครบถ้วนแล้วนะ") */
  const saveTry = await ev([
    "window.__saved=null; window.__a=[];",
    "window.alert = m => { window.__a.push(String(m)); };",
    "const of2=window.fetch;",
    "window.fetch=function(u,i){const s=(typeof u==='string')?u:(u&&u.url)||'';",
    "  if(i&&(i.method==='POST'||i.method==='PUT')&&s.indexOf('/expenses')>=0){",
    "    window.__saved=i.body; return new Promise(()=>{}); }",
    "  return of2(u,i);};",
    "const rb=document.getElementById('requestedBy'); if(rb) rb.value='ทดสอบ แท็กซี่ล้วน';",
    "const an=document.getElementById('activityName'); if(an) an.value='ประชุม';",
    "document.querySelectorAll('.taxi-entry').forEach((r,i)=>{",
    "  const amt=r.querySelector('.taxi-amt-ret'); if(amt){ amt.value=String(150+i*10);",
    "    amt.dispatchEvent(new Event('input',{bubbles:true})); } });",
    "await new Promise(r=>setTimeout(r,700));",
    "const b=document.getElementById('submitBtn'); if(b){ b.disabled=false; b.click(); }",
    "await new Promise(r=>setTimeout(r,2200));",
    "return { body: window.__saved, alerts: window.__a.slice(0,2) };"
  ].join(NL));
  const blocked = (saveTry.alerts || []).some(a => /จุดที่รถไปส่ง/.test(a));
  ok('ไม่ถูกบล็อกด้วยข้อความ "ระบุจุดเริ่มต้นและจุดที่รถไปส่ง"',
     !blocked, (saveTry.alerts || []).join(' | ').slice(0, 120) || 'ไม่มีข้อความเตือน');
  let sentObj = null;
  try { sentObj = JSON.parse(saveTry.body || 'null'); } catch (e) {}
  ok('ส่งข้อมูลออกไปได้จริง', !!sentObj,
     sentObj ? 'ส่งออกแล้ว' : ((saveTry.alerts || []).join(' | ').slice(0, 150) || 'ไม่ได้ส่ง'));
  if (sentObj) {
    const ents = ((sentObj.inputMetadata || {})._costs || {}).taxiEntries || [];
    ok('แนบหมุดของแต่ละเที่ยวไปด้วย (ใช้ตัดสินวงเงินตามพื้นที่)',
       ents.length > 0 && ents.every(e => e.fromGeo && e.toGeo),
       JSON.stringify(ents.map(e => !!(e.fromGeo && e.toGeo))));
  }

  console.log('');
  console.log('═══ 7. เที่ยวที่ใช้เส้นทางหลัก ต้องไม่วางหมุดซ้อนกองเดียว ═══');
  /* 21 ต.ค. 2569 — เจ้าของงานทักว่า "ทำไมหมุดมันไปกองกันที่เดียว"
     เที่ยว Taxi ที่ยังไม่ได้แก้เส้นทางเอง จะดึงหมุดจากเส้นทางหลักมาใช้
     หมุดของเที่ยวจึงทับหมุด A/B พอดีเป๊ะ */
  const stacked = await ev([
    "document.querySelectorAll('.taxi-entry').forEach(r=>r.querySelector('[onclick*=removeTaxiEntry]')?.click());",
    "await new Promise(r=>setTimeout(r,400));",
    "geoFrom = { lat: 13.60, lng: 100.53, precision:'exact', label:'บ้าน' };",
    "geoTo   = { lat: 13.91, lng: 100.60, precision:'exact', label:'ดอนเมือง' };",
    "setPoint('from', 13.60, 100.53, 'บ้าน', 'exact', 'test');",
    "setPoint('to',   13.91, 100.60, 'ดอนเมือง', 'exact', 'test');",
    "await new Promise(r=>setTimeout(r,500));",
    "addTaxiEntry('ขาไป'); addTaxiEntry('ขากลับ');",
    "await new Promise(r=>setTimeout(r,500));",
    // ทั้งสองเที่ยวใช้หมุดเดียวกับเส้นทางหลัก (สถานการณ์ที่ทำให้หมุดกอง)
    "[...document.querySelectorAll('.taxi-entry')].forEach(r=>{",
    "  const f=r.querySelector('.taxi-from'), t=r.querySelector('.taxi-to');",
    "  f.value='บ้าน'; f.dataset.lat=13.60; f.dataset.lng=100.53;",
    "  t.value='ดอนเมือง'; t.dataset.lat=13.91; t.dataset.lng=100.60; });",
    "await drawTaxiLegLines();",
    "await new Promise(r=>setTimeout(r,600));",
    "const all = [mFrom, mTo].filter(Boolean).concat(taxiLegMarkers||[]);",
    "const key = m => { const p=m.getLatLng(); return p.lat.toFixed(4)+','+p.lng.toFixed(4); };",
    "return { markers: (taxiLegMarkers||[]).length,",
    "         lines: (taxiLegLines||[]).length,",
    "         spots: new Set(all.map(key)).size,",
    "         total: all.length };"
  ].join(NL));
  ok('ไม่วางหมุดของเที่ยวซ้อนบนหมุดเส้นทางหลัก',
     stacked.markers === 0, stacked.markers + ' หมุดของเที่ยว');
  ok('จำนวนหมุดบนแผนที่เท่ากับจำนวนตำแหน่งจริง ไม่มีกองซ้อน',
     stacked.total === stacked.spots,
     stacked.total + ' หมุด · ' + stacked.spots + ' ตำแหน่ง');
  ok('ไม่ลากเส้นซ้ำทับเส้นทางหลัก',
     stacked.lines === 0, stacked.lines + ' เส้น');

  console.log('');
  ok('ไม่มี JavaScript error ตลอดการทดสอบ', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '));

  console.log('');
  console.log('══════════════════════════════════════════════════');
  console.log('  ผ่าน ' + results.filter(Boolean).length + ' / ' + results.length);
  console.log('══════════════════════════════════════════════════');
  process.exitCode = results.every(Boolean) ? 0 : 1;
} catch (e) { console.error('ล้มเหลว:', e.message); process.exitCode = 2; }
finally { try { ws.close(); } catch {} chrome.kill(); }
