// ช่อง จาก/ถึง ของแถว Taxi ต้องค้นหาสถานที่ได้ และต้องไม่แตะเงิน
//
// 19 ต.ค. 2569 — เจ้าของงานสั่ง:
//   "ช่อง จาก/ถึง ของ Taxi ต้องค้นหาได้ไง เพราะว่าต้องหมุดได้
//    ส่วนถ้าเบิกตามจริงก็ให้ใส่เงินตามมิเตอร์จริง"
//   และยืนยันว่า "แสดงหมุดแสดงระยะทาง แต่เงินก็ตามเขากรอก"
//
// ข้อห้ามที่ต้องระวัง: ตัวค้นหาของเส้นทางหลัก (attachPlaceSearch) ยืมมาใช้ไม่ได้
// เพราะผูกกับหมุด geoFrom/geoTo ซึ่งเป็นฐานคิดค่าน้ำมันและเหมาจ่าย
// ถ้าใช้ซ้ำ หมุดของเที่ยว Taxi จะไปทับเส้นทางหลัก แล้วเงินเพี้ยนทั้งใบ
//
//   cd public && python3 -m http.server 8099 --bind 127.0.0.1
//   node scripts/test-taxi-place-search.mjs
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9613, PROFILE = 'C:/Users/teerapat/AppData/Local/Temp/pb-taxisearch';
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
    "      attachmentRules:{},attachmentOrder:[],taxiMaxPerTrip:750,fuelRate:5}]),",
    "    {status:200,headers:{'Content-Type':'application/json'}}));",
    // ผลค้นหาปลอม จะได้ไม่พึ่งเน็ตและได้ผลเดิมทุกครั้ง
    "  if(s.indexOf('/map-search')>=0) return Promise.resolve(new Response(",
    "    JSON.stringify({data:[",
    "      {name:'โรงพยาบาลตากสิน', address:'คลองสาน กรุงเทพมหานคร', lat:13.7293, lon:100.5021},",
    "      {name:'ท่าอากาศยานสุวรรณภูมิ', address:'บางพลี สมุทรปราการ', lat:13.6900, lon:100.7501}",
    "    ]}), {status:200,headers:{'Content-Type':'application/json'}}));",
    "  if(s.indexOf('/expenses')>=0||s.indexOf('/profiles')>=0)",
    "    return Promise.resolve(new Response('[]',{status:200,headers:{'Content-Type':'application/json'}}));",
    "  return of(u,i);};"
  ].join('\n') });
  await send('Page.navigate', { url: APP + '/expense.html' }); await sleep(5000);

  await ev([
    "const s=document.getElementById('categorySelect');",
    "s.value='TRAVEL002'; s.dispatchEvent(new Event('change',{bubbles:true}));",
    "await new Promise(r=>setTimeout(r,1200));",
    "const ds=document.getElementById('dateStart'), de=document.getElementById('dateEnd');",
    "ds.value='2026-10-19'; ds.dispatchEvent(new Event('change',{bubbles:true}));",
    "de.value='2026-10-20'; de.dispatchEvent(new Event('change',{bubbles:true}));",
    "await new Promise(r=>setTimeout(r,400));",
    "window.routeLeg = async () => ({ km: 12.3, meters: 12300, coords: [] });",
    "geoFrom={lat:13.6591,lng:100.5330,precision:'exact',label:'บ้าน'};",
    "geoTo={lat:13.9126,lng:100.6068,precision:'exact',label:'ดอนเมือง'};",
    "document.getElementById('travelFrom').value='บ้าน';",
    "document.getElementById('travelTo').value='ดอนเมือง';",
    "{const c=document.getElementById('legOutTaxi');c.checked=true;",
    " c.dispatchEvent(new Event('change',{bubbles:true}));await new Promise(r=>setTimeout(r,700));}"
  ].join('\n'));

  console.log('═══ 1. แถว Taxi ต้องมีตัวค้นหาติดมาด้วย ═══');
  const a = await ev([
    "const row=document.querySelector('#taxiEntriesList .taxi-entry');",
    "const f=row.querySelector('.taxi-from'), t=row.querySelector('.taxi-to');",
    "return { hasBoxes: !!row.querySelectorAll('.taxi-sug').length,",
    "         nBoxes: row.querySelectorAll('.taxi-sug').length,",
    "         attached: f.dataset.searchOn === '1' && t.dataset.searchOn === '1',",
    "         ph: t.placeholder, hasNote: !!row.querySelector('.taxi-leg-note') };"
  ].join('\n'));
  ok('มีกล่องผลค้นหาครบทั้งช่อง จาก และ ถึง', a.nBoxes === 2, a.nBoxes + ' กล่อง');
  ok('ตัวค้นหาถูกติดให้ทั้งสองช่อง', a.attached === true);
  ok('ข้อความในช่องบอกให้เลือกจากรายการ', /เลือกจากรายการ/.test(a.ph || ''), a.ph);
  ok('มีที่สำหรับบอกระยะทางของเที่ยวนี้', a.hasNote === true);

  console.log('');
  console.log('═══ 2. พิมพ์แล้วต้องขึ้นรายการให้เลือก ═══');
  const b = await ev([
    "const t=document.querySelector('#taxiEntriesList .taxi-entry .taxi-to');",
    "t.value='ตากสิน'; t.dispatchEvent(new Event('input',{bubbles:true}));",
    "await new Promise(r=>setTimeout(r,900));",
    "const box=t.parentElement.querySelector('.taxi-sug');",
    "return { open: !box.classList.contains('hidden'),",
    "         n: box.querySelectorAll('button[data-i]').length,",
    "         first: (box.querySelector('button[data-i]')||{}).textContent||'' };"
  ].join('\n'));
  ok('กล่องผลค้นหาเปิดขึ้นมา', b.open === true);
  ok('มีรายการให้กดเลือก', b.n === 2, b.n + ' รายการ');
  ok('เห็นชื่อสถานที่จริง', /ตากสิน/.test(b.first), b.first.trim().slice(0, 50));

  console.log('');
  console.log('═══ 3. กดเลือกแล้วได้ทั้งชื่อและหมุด + บอกระยะทาง ═══');
  const c = await ev([
    "const row=document.querySelector('#taxiEntriesList .taxi-entry');",
    "const f=row.querySelector('.taxi-from'), t=row.querySelector('.taxi-to');",
    "t.parentElement.querySelector('.taxi-sug button[data-i=\"0\"]').click();",
    "await new Promise(r=>setTimeout(r,600));",
    "f.value='สุวรรณภูมิ'; f.dispatchEvent(new Event('input',{bubbles:true}));",
    "await new Promise(r=>setTimeout(r,900));",
    "f.parentElement.querySelector('.taxi-sug button[data-i=\"1\"]').click();",
    "await new Promise(r=>setTimeout(r,900));",
    "return { toVal: t.value, toLat: t.dataset.lat, toLng: t.dataset.lng,",
    "         fromVal: f.value, fromLat: f.dataset.lat,",
    "         note: (row.querySelector('.taxi-leg-note')||{}).textContent||'' };"
  ].join('\n'));
  ok('ชื่อถูกเติมลงช่อง', c.toVal === 'โรงพยาบาลตากสิน' && c.fromVal === 'ท่าอากาศยานสุวรรณภูมิ',
     c.fromVal + ' → ' + c.toVal);
  ok('เก็บหมุดไว้ที่ช่องของตัวเอง',
     c.toLat === '13.7293' && c.fromLat === '13.69', c.fromLat + ' / ' + c.toLat);
  ok('บอกระยะทางของเที่ยวนี้', /12\.3 กม/.test(c.note), c.note.trim());
  ok('ย้ำว่าค่าโดยสารยังกรอกตามมิเตอร์', /มิเตอร์/.test(c.note));

  console.log('');
  console.log('═══ 4. ต้องไม่แตะหมุดเส้นทางหลัก (ไม่งั้นเงินเพี้ยนทั้งใบ) ═══');
  const d = await ev([
    "return { from: geoFrom ? geoFrom.label : null, to: geoTo ? geoTo.label : null,",
    "         fromLat: geoFrom ? geoFrom.lat : null, toLat: geoTo ? geoTo.lat : null,",
    "         mainFrom: document.getElementById('travelFrom').value,",
    "         mainTo: document.getElementById('travelTo').value };"
  ].join('\n'));
  ok('หมุดต้นทางหลักไม่ถูกแตะ', d.from === 'บ้าน' && d.fromLat === 13.6591,
     d.from + ' @ ' + d.fromLat);
  ok('หมุดปลายทางหลักไม่ถูกแตะ', d.to === 'ดอนเมือง' && d.toLat === 13.9126,
     d.to + ' @ ' + d.toLat);
  ok('ช่องเส้นทางหลักยังเป็นค่าเดิม',
     d.mainFrom === 'บ้าน' && d.mainTo === 'ดอนเมือง', d.mainFrom + ' → ' + d.mainTo);

  console.log('');
  console.log('═══ 5. เงินยังมาจากค่าโดยสารที่กรอกเท่านั้น ═══');
  const e2 = await ev([
    "const o=document.querySelector('#taxiEntriesList .taxi-amt-out');",
    "o.value='380'; o.dispatchEvent(new Event('input',{bubbles:true}));",
    "o.dispatchEvent(new Event('change',{bubbles:true}));",
    "await new Promise(r=>setTimeout(r,800));",
    "return { total: parseFloat(document.getElementById('totalAmount').dataset.value||0) };"
  ].join('\n'));
  ok('ยอดเป็น 380 ตามมิเตอร์ ไม่ถูกคิดจากระยะทางที่เพิ่งค้นหา',
     e2.total === 380, e2.total + ' บาท');

  console.log('');
  console.log('═══ 6. กด "ใช้เส้นทางหลัก" ต้องล้างหมุดเก่าของแถวด้วย ═══');
  const f = await ev([
    "const row=document.querySelector('#taxiEntriesList .taxi-entry');",
    "row.querySelector('[onclick*=fillTaxiFromRoute]').click();",
    "await new Promise(r=>setTimeout(r,600));",
    "const ff=row.querySelector('.taxi-from'), tt=row.querySelector('.taxi-to');",
    "return { from: ff.value, to: tt.value, lat: ff.dataset.lat || null,",
    "         note: (row.querySelector('.taxi-leg-note')||{}).textContent||'' };"
  ].join('\n'));
  ok('ชื่อกลับไปตามเส้นทางหลัก', f.from === 'บ้าน' && f.to === 'ดอนเมือง',
     f.from + ' → ' + f.to);
  ok('หมุดเก่าของแถวถูกล้าง ไม่ค้างอ้างชื่อที่ไม่ตรงกัน', f.lat === null, String(f.lat));
  ok('ป้ายระยะทางเก่าถูกล้างด้วย', f.note.trim() === '', f.note.trim());

  ok('ไม่มี JavaScript error ตลอดการทดสอบ', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '));

  console.log('');
  console.log('══════════════════════════════════════════════════');
  console.log('  ผ่าน ' + results.filter(Boolean).length + ' / ' + results.length);
  console.log('══════════════════════════════════════════════════');
  process.exitCode = results.every(Boolean) ? 0 : 1;
} catch (e) { console.error('ล้มเหลว:', e.message); process.exitCode = 2; }
finally { try { ws.close(); } catch {} chrome.kill(); }
