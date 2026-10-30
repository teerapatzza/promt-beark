// โหมดเหมาจ่ายต้องถามว่าเดินทางด้วยอะไร และคำตอบต้องไม่แตะยอดเงิน
//
// 21 ต.ค. 2569 — ใบรับรองค่าพาหนะ (FM-SAM-095-00) มีให้กาแค่ 2 ช่อง
// "ค่า Taxi" กับ "ค่าน้ำมันเชื้อเพลิง" ไม่มีช่องกลางสำหรับเหมาจ่าย
//
// ก่อนหน้านี้โหมดเหมาจ่ายซ่อนติ๊กพาหนะทั้งสองอัน คนที่กดเหมาจ่ายตั้งแต่แรก
// จึงได้ _carType = "ไม่ระบุ" + taxiEntries = [] ใบเลยกาช่อง Taxi เสมอ
// คนที่ขับรถไปเองบอกระบบไม่ได้เลย
//
// ข้อที่ต้องระวังที่สุด: ห้ามเอาคำตอบนี้ไปผูกกับ carType
// เพราะในโหมดเหมาจ่าย carType แปลว่า "เบิกขาไหนบ้าง" ไม่ใช่ "นั่งรถอะไร"
// ผูกเมื่อไหร่จำนวนขาจะเพี้ยน แล้วเงินเปลี่ยนเองเงียบ ๆ
//
//   cd public && python3 -m http.server 8099 --bind 127.0.0.1
//   node scripts/test-flat-vehicle-pick.mjs
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9635, PROFILE = 'C:/Users/teerapat/AppData/Local/Temp/pb-flatveh2';
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

const FLAT_CFG = { enabled: true, maxKm: 200, outsideMetro: 1200, bands: [
  { upTo: 10.99, amount: 150 }, { upTo: 20.99, amount: 250 }, { upTo: 30.99, amount: 350 },
  { upTo: null, amount: 750 } ] };

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
    "const FLAT=" + JSON.stringify(FLAT_CFG) + ";",
    "const of=window.fetch;",
    "window.fetch=function(u,i){const s=(typeof u==='string')?u:(u&&u.url)||'';",
    "  if(s.indexOf('/auth/me')>=0) return Promise.resolve(new Response(",
    "    JSON.stringify({id:1,email:'t@ha.or.th',name:'test',role:'admin'}),",
    "    {status:200,headers:{'Content-Type':'application/json'}}));",
    "  if(s.indexOf('/budget-categories')>=0) return Promise.resolve(new Response(",
    "    JSON.stringify([{id:'TRAVEL002',name:'test',pdfTemplates:['REPORT','TRANSPORT_RECEIPT'],",
    "      attachmentRules:{},attachmentOrder:[],taxiMaxPerTrip:750,fuelRate:5,flatRate:FLAT}]),",
    "    {status:200,headers:{'Content-Type':'application/json'}}));",
    "  if(s.indexOf('/map-search')>=0) return Promise.resolve(new Response(",
    "    JSON.stringify({data:[{name:'สรพ.',address:'กรุงเทพมหานคร',lat:13.85,lon:100.52}]}),",
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
    "ds.value='2026-10-19'; ds.dispatchEvent(new Event('change',{bubbles:true}));",
    "de.value='2026-10-19'; de.dispatchEvent(new Event('change',{bubbles:true}));",
    // วันที่จัดกิจกรรมเป็นช่องบังคับตั้งแต่ 30 ต.ค. 2569 (ทริปวันเดียว จึงเท่ากับวันเดินทาง)
    "const pS=document.getElementById('periodStart'), pE=document.getElementById('periodEnd');",
    "if(pS){ pS.value='2026-10-19'; } if(pE){ pE.value='2026-10-19'; }",
    "await new Promise(r=>setTimeout(r,400));",
    "window.routeLeg = async () => ({ km: 15.5, meters: 15500, coords: [] });",
    "geoFrom={lat:13.80,lng:100.60,precision:'exact',label:'บ้าน'};",
    "geoTo={lat:13.85,lng:100.52,precision:'exact',label:'สรพ.'};",
    "document.getElementById('travelFrom').value='บ้าน';",
    "document.getElementById('travelTo').value='สรพ.';",
    // เหมาจ่ายคิดจากระยะทางต่อเที่ยว ถ้าไม่มีระยะ ยอดจะเป็น 0 และไม่ได้ทดสอบอะไรเลย
    "{const a=document.getElementById('distOutbound'), b=document.getElementById('distReturn');",
    " a.value='15.5'; a.dispatchEvent(new Event('input',{bubbles:true}));",
    " b.value='15.5'; b.dispatchEvent(new Event('input',{bubbles:true}));}",
    "await new Promise(r=>setTimeout(r,500));"
  ].join(NL));

  console.log('═══ 1. โหมดคิดตามระยะจริง ต้องไม่มีคำถามนี้โผล่มากวน ═══');
  const before = await ev([
    "const b=document.getElementById('flatVehicleBox');",
    "return { exists: !!b, hidden: b ? b.classList.contains('hidden') : null };"
  ].join(NL));
  ok('มีกล่องคำถามอยู่ในหน้า', before.exists === true);
  ok('ซ่อนไว้ตอนคิดตามระยะจริง', before.hidden === true);

  console.log('');
  console.log('═══ 2. เลือกเหมาจ่าย คำถามต้องโผล่ พร้อมคำตอบตั้งต้น ═══');
  const flat = await ev([
    "const r=document.querySelector('input[name=\"fuelMethod\"][value=\"flat\"]');",
    "r.checked=true; r.dispatchEvent(new Event('change',{bubbles:true}));",
    "await new Promise(r=>setTimeout(r,1400));",
    "const b=document.getElementById('flatVehicleBox');",
    "const picked=document.querySelector('input[name=\"flatVehicle\"]:checked');",
    "return { hidden: b.classList.contains('hidden'),",
    "         nOptions: document.querySelectorAll('input[name=\"flatVehicle\"]').length,",
    "         picked: picked ? picked.value : null,",
    "         total: parseFloat(document.getElementById('totalAmount').dataset.value||0),",
    "         carType: document.getElementById('carType').value };"
  ].join(NL));
  ok('คำถามโผล่ขึ้นมา', flat.hidden === false);
  ok('มีให้เลือก 2 ทาง', flat.nOptions === 2, flat.nOptions + ' ตัวเลือก');
  ok('ตั้งต้นเป็นรถส่วนตัว เพราะยังไม่มีเที่ยว Taxi', flat.picked === 'car', String(flat.picked));
  ok('ยอดเหมาจ่ายคิดได้แล้ว', flat.total > 0, flat.total + ' บาท');

  console.log('');
  console.log('═══ 3. สลับคำตอบเป็น Taxi — ยอดเงินห้ามขยับแม้แต่บาทเดียว ═══');
  const swapped = await ev([
    "const t=document.querySelector('input[name=\"flatVehicle\"][value=\"taxi\"]');",
    "t.checked=true; t.dispatchEvent(new Event('change',{bubbles:true}));",
    "await new Promise(r=>setTimeout(r,900));",
    "return { picked: document.querySelector('input[name=\"flatVehicle\"]:checked').value,",
    "         total: parseFloat(document.getElementById('totalAmount').dataset.value||0),",
    "         carType: document.getElementById('carType').value,",
    "         taxiRows: document.querySelectorAll('.taxi-entry').length,",
    "         legs: (typeof flatResult==='function' && flatResult().ok)",
    "               ? flatResult().legs.length : null };"
  ].join(NL));
  ok('คำตอบเปลี่ยนเป็น Taxi', swapped.picked === 'taxi', swapped.picked);
  ok('ยอดเงินเท่าเดิมเป๊ะ', swapped.total === flat.total,
     flat.total + ' -> ' + swapped.total + ' บาท');
  ok('จำนวนขาที่เบิกเท่าเดิม', swapped.legs === 2, swapped.legs + ' ขา');
  ok('ไม่ไปแตะ carType (ซึ่งแปลว่าเบิกขาไหน ไม่ใช่นั่งรถอะไร)',
     swapped.carType === flat.carType, flat.carType + ' -> ' + swapped.carType);
  ok('ไม่ไปสร้างแถว Taxi ให้เอง', swapped.taxiRows === 0, swapped.taxiRows + ' แถว');

  console.log('');
  console.log('═══ 4. คำตอบต้องถูกส่งไปกับใบตอนบันทึก ═══');
  const sent = await ev([
    "window.__saved=null;",
    "const of2=window.fetch;",
    "window.fetch=function(u,i){const s=(typeof u==='string')?u:(u&&u.url)||'';",
    "  if(i&&(i.method==='POST'||i.method==='PUT')&&s.indexOf('/expenses')>=0){",
    "    window.__saved=i.body; return new Promise(()=>{}); }",
    "  return of2(u,i);};",
    "window.alert=m=>{(window.__a=window.__a||[]).push(String(m));};",
    "window.__a=[];",
    "const rb=document.getElementById('requestedBy'); if(rb) rb.value='ทดสอบ พาหนะ';",
    "const an=document.getElementById('activityName'); if(an) an.value='ประชุม';",
    "const b=document.getElementById('submitBtn'); if(b){b.disabled=false;b.click();}",
    "await new Promise(r=>setTimeout(r,2000));",
    "return { body: window.__saved, alerts:(window.__a||[]).slice(0,3) };"
  ].join(NL));
  let obj = null;
  try { obj = JSON.parse(sent.body || 'null'); } catch (e) {}
  ok('บันทึกผ่านการตรวจ', !!obj,
     obj ? 'ส่งออกไปแล้ว' : ((sent.alerts || []).join(' | ').slice(0, 150) || 'ไม่ได้ส่ง'));
  if (obj) {
    const m = obj.inputMetadata || {};
    ok('ส่ง _flatVehicle = taxi ไปด้วย', m._flatVehicle === 'taxi', String(m._flatVehicle));
    ok('ยังเป็นใบเหมาจ่ายเหมือนเดิม', m._fuelMethod === 'flat', String(m._fuelMethod));
    ok('ยอดที่ส่งออกไปเท่ากับยอดบนจอ',
       Number(obj.amount) === swapped.total, obj.amount + ' / ' + swapped.total);
    ok('_flatRate ยังครบ 2 ขา',
       !!(m._flatRate && Array.isArray(m._flatRate.legs) && m._flatRate.legs.length === 2),
       JSON.stringify((m._flatRate || {}).total));
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
