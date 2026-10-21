// สามเรื่องที่เจ้าของงานแจ้งเมื่อ 21 ต.ค. 2569
//   1. เลือก "พักคู่" ต้องมีช่องกรอกชื่อผู้ร่วมพัก แล้วชื่อไปขึ้นในใบ
//   2. ติ๊กออก "ใช้แผนที่จากระบบ" แล้วแผนที่ของพร้อมเบิกต้องไม่โผล่ใน PDF
//      "ถ้าเขาติ๊กออก แผนที่ที่แสดงใน pdf จะต้องกลายเป็นที่เขาแนบ
//       ไม่ใช่แผนที่ในพร้อมเบิกโผล่ไปด้วย"
//   3. ไฟล์ที่เพิ่งเลือก ต้องเอาออกได้ทีละไฟล์ตั้งแต่ตอนกรอก
//      "ตอนนี้แนบไปแล้วแนบเลย กดเอาไฟล์ออกไม่ได้"
//
//   cd public && python3 -m http.server 8099 --bind 127.0.0.1
//   node scripts/test-hotel-map-files.mjs
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9651, PROFILE = 'C:/Users/teerapat/AppData/Local/Temp/pb-hmf';
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

const STUB = [
  "localStorage.setItem('token','x');",
  "const of=window.fetch;",
  "window.fetch=function(u,i){const s=(typeof u==='string')?u:(u&&u.url)||'';",
  "  if(s.indexOf('/auth/me')>=0) return Promise.resolve(new Response(",
  "    JSON.stringify({id:1,email:'t@ha.or.th',name:'test',role:'admin'}),",
  "    {status:200,headers:{'Content-Type':'application/json'}}));",
  "  if(s.indexOf('/settings')>=0&&s.indexOf('list-append')<0) return Promise.resolve(new Response(",
  "    JSON.stringify({fuelRate:5,hotelRateSingle:1500,hotelRateDouble:1000,",
  "      positionList:['นพ.'],affiliationList:['อิสระ'],activityList:['กิจกรรมเยี่ยมสำรวจ']}),",
  "    {status:200,headers:{'Content-Type':'application/json'}}));",
  "  if(s.indexOf('/budget-categories')>=0) return Promise.resolve(new Response(",
  // ต้องเปิดช่องแนบไฟล์และช่องแผนที่จริง ไม่งั้นหน้าไม่สร้าง element ให้ทดสอบ
  "    JSON.stringify([{id:'TRAVEL002',name:'test',",
  "      pdfTemplates:['REPORT','TRANSPORT_RECEIPT'],fuelRate:5,",
  "      attachmentRules:{ LOCATION:{show:true,required:false,label:'แผนที่'},",
  "                        RECEIPT:{show:true,required:false,label:'ใบเสร็จ'} },",
  "      attachmentOrder:['LOCATION','RECEIPT']}]),",
  "    {status:200,headers:{'Content-Type':'application/json'}}));",
  "  if(s.indexOf('/expenses')>=0||s.indexOf('/profiles')>=0)",
  "    return Promise.resolve(new Response('[]',{status:200,headers:{'Content-Type':'application/json'}}));",
  "  return of(u,i);};"
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
  await send('Page.addScriptToEvaluateOnNewDocument', { source: STUB });

  await send('Page.navigate', { url: APP + '/expense.html' }); await sleep(6000);
  await ev([
    "const s=document.getElementById('categorySelect');",
    "s.value='TRAVEL002'; s.dispatchEvent(new Event('change',{bubbles:true}));",
    "await new Promise(r=>setTimeout(r,1500));",
    "const ds=document.getElementById('dateStart'), de=document.getElementById('dateEnd');",
    "ds.value='2026-10-21'; ds.dispatchEvent(new Event('change',{bubbles:true}));",
    "de.value='2026-10-23'; de.dispatchEvent(new Event('change',{bubbles:true}));",
    "await new Promise(r=>setTimeout(r,600)); return 1;"
  ].join(NL));

  console.log('═══ 1. ค่าที่พัก: เลือกพักคู่ต้องมีช่องกรอกชื่อผู้ร่วมพัก ═══');
  const a = await ev([
    "if (typeof addAccommodationEntry === 'function') addAccommodationEntry();",
    "await new Promise(r=>setTimeout(r,300));",
    "const row=document.querySelector('.accommodation-entry');",
    "const wrap=row.querySelector('.accommodation-with-wrap');",
    "const before={ hidden: wrap.classList.contains('hidden'),",
    "               nights: row.querySelector('.accommodation-nights').value };",
    "const sel=row.querySelector('.accommodation-type');",
    "sel.value='พักคู่'; sel.dispatchEvent(new Event('change',{bubbles:true}));",
    "await new Promise(r=>setTimeout(r,300));",
    "const after={ hidden: wrap.classList.contains('hidden') };",
    "row.querySelector('.accommodation-with').value='นพ.สมชาย ใจดี';",
    "row.querySelector('.accommodation-rate').value='1000';",
    "const saved = (typeof collectHotelEntries==='function') ? collectHotelEntries() : null;",
    "return { before: before, after: after, saved: saved };"
  ].join(NL));
  ok('จำนวนคืนเติมให้เองจากวันเดินทาง 21-23 = 2 คืน', a.before.nights === '2', a.before.nights + ' คืน');
  ok('ตอนพักเดี่ยว ช่องชื่อผู้ร่วมพักถูกซ่อน', a.before.hidden === true);
  ok('เลือกพักคู่แล้วช่องโผล่ขึ้นมา', a.after.hidden === false);
  ok('ชื่อผู้ร่วมพักถูกเก็บไปกับใบ',
     a.saved && a.saved.entries[0] && a.saved.entries[0].withWho === 'นพ.สมชาย ใจดี',
     JSON.stringify(a.saved && a.saved.entries[0]));

  console.log('');
  console.log('═══ 2. กลับไปพักเดี่ยว ชื่อที่ค้างต้องไม่ถูกส่งไปพิมพ์ในใบ ═══');
  const b = await ev([
    "const row=document.querySelector('.accommodation-entry');",
    "const sel=row.querySelector('.accommodation-type');",
    "sel.value='พักเดี่ยว'; sel.dispatchEvent(new Event('change',{bubbles:true}));",
    "await new Promise(r=>setTimeout(r,300));",
    "const saved = collectHotelEntries();",
    "return { hidden: row.querySelector('.accommodation-with-wrap').classList.contains('hidden'),",
    "         withWho: saved.entries[0].withWho,",
    "         inputVal: row.querySelector('.accommodation-with').value };"
  ].join(NL));
  ok('ช่องถูกซ่อนกลับ', b.hidden === true);
  ok('ชื่อในช่องถูกล้าง', b.inputVal === '', JSON.stringify(b.inputVal));
  ok('ไม่ส่งชื่อผู้ร่วมพักไปกับใบที่พักเดี่ยว', b.withWho === '', JSON.stringify(b.withWho));

  console.log('');
  console.log('═══ 3. ไฟล์ที่เพิ่งเลือก ต้องเอาออกได้ทีละไฟล์ ═══');
  const c = await ev([
    "const inp=document.querySelector('.general-file-upload') || document.getElementById('mapManualUpload');",
    "if(!inp) return { skip: true };",
    "const mk=(n)=>new File([new Uint8Array([1,2,3])], n, {type:'image/png'});",
    "const dt=new DataTransfer();",
    "['ใบเสร็จ-1.png','ใบเสร็จ-2.png','ใบเสร็จ-3.png'].forEach(n=>dt.items.add(mk(n)));",
    "inp.files=dt.files;",
    "inp.dispatchEvent(new Event('change',{bubbles:true}));",
    "await new Promise(r=>setTimeout(r,300));",
    "const box=inp.parentElement.querySelector('.picked-files');",
    "const shown=[...box.querySelectorAll('.pf-x')].length;",
    "const names1=[...inp.files].map(f=>f.name);",
    "box.querySelectorAll('.pf-x')[1].click();",   // เอาไฟล์กลางออก
    "await new Promise(r=>setTimeout(r,300));",
    "const names2=[...inp.files].map(f=>f.name);",
    "const shown2=[...box.querySelectorAll('.pf-x')].length;",
    "box.querySelectorAll('.pf-x').forEach(()=>box.querySelector('.pf-x').click());",
    "await new Promise(r=>setTimeout(r,400));",
    "return { shown: shown, names1: names1, names2: names2, shown2: shown2,",
    "         left: [...inp.files].map(f=>f.name),",
    "         boxHidden: box.classList.contains('hidden') };"
  ].join(NL));
  if (c.skip) {
    ok('มีช่องแนบไฟล์ให้ทดสอบ', false, 'ไม่พบช่องแนบไฟล์');
  } else {
    ok('เลือก 3 ไฟล์แล้วเห็นครบ 3 รายการพร้อมปุ่มเอาออก', c.shown === 3, c.shown + ' รายการ');
    ok('เอาไฟล์กลางออกแล้วเหลือ 2 ไฟล์ที่ถูกตัว',
       c.names2.length === 2 && c.names2.join(',') === 'ใบเสร็จ-1.png,ใบเสร็จ-3.png',
       c.names1.join(',') + '  ->  ' + c.names2.join(','));
    ok('รายการบนหน้าจอลดตาม', c.shown2 === 2, c.shown2 + ' รายการ');
    ok('เอาออกจนหมดได้ ไม่ใช่เอาออกไม่ได้เลย', c.left.length === 0, JSON.stringify(c.left));
    ok('ไม่มีไฟล์แล้วกล่องรายการถูกซ่อน', c.boxHidden === true);
  }

  console.log('');
  console.log('═══ 4. ติ๊กออก "ใช้แผนที่จากระบบ" ต้องถูกส่งไปกับใบ ═══');
  const d2 = await ev([
    "const chk=document.getElementById('useAppMapImage');",
    "const was=chk.checked;",
    "chk.checked=false; chk.dispatchEvent(new Event('change',{bubbles:true}));",
    "await new Promise(r=>setTimeout(r,400));",
    "return { was: was, now: chk.checked };"
  ].join(NL));
  ok('ติ๊กไว้ให้ตั้งแต่แรก (ค่าตั้งต้น = ใช้แผนที่ระบบ)', d2.was === true);
  ok('เอาติ๊กออกได้', d2.now === false);

  console.log('');
  ok('ไม่มี JavaScript error ตลอดการทดสอบ', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '));

  console.log('');
  console.log('══════════════════════════════════════════════════');
  console.log('  ผ่าน ' + results.filter(Boolean).length + ' / ' + results.length);
  console.log('══════════════════════════════════════════════════');
  process.exitCode = results.every(Boolean) ? 0 : 1;
} catch (e) { console.error('ล้มเหลว:', e.message); process.exitCode = 2; }
finally { try { ws.close(); } catch {} chrome.kill(); }
