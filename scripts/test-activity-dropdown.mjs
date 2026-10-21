// ช่อง "ระบุกิจกรรม" ต้องเป็นรายการให้เลือก และเพิ่มเองได้
//
// 21 ต.ค. 2569 — เจ้าของงานสั่งว่า
//   "ตรงกิจกรรมจุดนี้ เราจะปรับปรุงโดยให้ทำเป็น drop down
//    โดยมีให้เลือกเป็น กิจกรรมเยี่ยมสำรวจ กิจกรรมอบรม ไรงี้
//    โดยให้เมเนจเพิ่มลบได้ทั้งหน้าบ้านและหลังบ้าน
//    คือถ้ามันเป็นอันที่ไม่มีใน drop down ให้เขาสามารถพิมและเพิ่มเข้าไปได้
//    และชื่อรายละเอียดกิจกรรมเขาจะไปพิมข้างล่างแทน
//    และก็ตอนนี้ไม่ต้องซ่อนชื่อกิจกรรมด้านล่างแล้ว ที่ต้องกด + ขึ้นมาก่อน ให้แสดงไปเลย"
//
//   cd public && python3 -m http.server 8099 --bind 127.0.0.1
//   node scripts/test-activity-dropdown.mjs
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9639, PROFILE = 'C:/Users/teerapat/AppData/Local/Temp/pb-actdd';
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

const ACTIVITIES = ['กิจกรรมเยี่ยมสำรวจ', 'กิจกรรมอบรม', 'กิจกรรมประชุม'];

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
    "window.__appended = [];",
    "const of=window.fetch;",
    "window.fetch=function(u,i){const s=(typeof u==='string')?u:(u&&u.url)||'';",
    "  if(s.indexOf('/auth/me')>=0) return Promise.resolve(new Response(",
    "    JSON.stringify({id:1,email:'t@ha.or.th',name:'test',role:'admin'}),",
    "    {status:200,headers:{'Content-Type':'application/json'}}));",
    "  if(s.indexOf('/settings/list-append')>=0){",
    "    window.__appended.push(i && i.body ? JSON.parse(i.body) : null);",
    "    return Promise.resolve(new Response(JSON.stringify({ok:true,added:true}),",
    "      {status:200,headers:{'Content-Type':'application/json'}})); }",
    "  if(s.indexOf('/settings')>=0) return Promise.resolve(new Response(",
    "    JSON.stringify({fuelRate:5,taxiMaxPerTrip:750,",
    "      positionList:['นพ.'],affiliationList:['อิสระ'],",
    "      activityList:" + JSON.stringify(ACTIVITIES) + "}),",
    "    {status:200,headers:{'Content-Type':'application/json'}}));",
    "  if(s.indexOf('/budget-categories')>=0) return Promise.resolve(new Response(",
    "    JSON.stringify([{id:'TRAVEL002',name:'test',pdfTemplates:['REPORT','TRANSPORT_RECEIPT'],",
    "      attachmentRules:{},attachmentOrder:[],fuelRate:5}]),",
    "    {status:200,headers:{'Content-Type':'application/json'}}));",
    "  if(s.indexOf('/expenses')>=0||s.indexOf('/profiles')>=0)",
    "    return Promise.resolve(new Response('[]',{status:200,headers:{'Content-Type':'application/json'}}));",
    "  return of(u,i);};"
  ].join(NL) });

  await send('Page.navigate', { url: APP + '/expense.html' }); await sleep(6000);
  await ev([
    "const s=document.getElementById('categorySelect');",
    "s.value='TRAVEL002'; s.dispatchEvent(new Event('change',{bubbles:true}));",
    "await new Promise(r=>setTimeout(r,1500)); return 1;"
  ].join(NL));

  console.log('═══ 1. ช่องกิจกรรมต้องกลายเป็นรายการให้เลือก ═══');
  const a = await ev([
    "const inp=document.getElementById('activityName');",
    "return { wrapped: !!inp.closest('.cb-wrap'),",
    "         hasCb: !!inp.__cb,",
    "         placeholder: inp.placeholder };"
  ].join(NL));
  ok('ช่องถูกแปลงเป็น combobox แล้ว', a.wrapped === true && a.hasCb === true,
     'wrap=' + a.wrapped + ' cb=' + a.hasCb);
  ok('ข้อความในช่องบอกว่าเลือกหรือพิมพ์เพิ่มได้',
     /เลือก/.test(a.placeholder) && /พิมพ์/.test(a.placeholder), a.placeholder);

  console.log('');
  console.log('═══ 2. กดแล้วต้องเห็นรายการจากหลังบ้าน ═══');
  const b = await ev([
    "const inp=document.getElementById('activityName');",
    "inp.focus(); inp.dispatchEvent(new Event('focus',{bubbles:true}));",
    "inp.dispatchEvent(new MouseEvent('mousedown',{bubbles:true}));",
    "await new Promise(r=>setTimeout(r,500));",
    "const list=inp.closest('.cb-wrap').querySelector('.cb-list');",
    "const opts=[...list.querySelectorAll('.cb-opt')].map(o=>o.textContent.trim());",
    "return { open: list.classList.contains('open'), opts: opts };"
  ].join(NL));
  ok('รายการเปิดขึ้นมา', b.open === true);
  ok('เห็นประเภทที่หลังบ้านตั้งไว้ครบ',
     ACTIVITIES.every(x => b.opts.some(o => o.indexOf(x) >= 0)),
     b.opts.join(' · ').slice(0, 80));

  console.log('');
  console.log('═══ 3. เลือกจากรายการแล้วค่าต้องลงช่อง ═══');
  const c = await ev([
    "const inp=document.getElementById('activityName');",
    "const list=inp.closest('.cb-wrap').querySelector('.cb-list');",
    "const hit=[...list.querySelectorAll('.cb-opt')]",
    "  .find(o=>o.textContent.indexOf('กิจกรรมอบรม')>=0);",
    "hit.dispatchEvent(new MouseEvent('mousedown',{bubbles:true}));",
    "await new Promise(r=>setTimeout(r,500));",
    "return { value: inp.value };"
  ].join(NL));
  ok('ค่าที่เลือกลงช่องแล้ว', c.value === 'กิจกรรมอบรม', c.value);

  console.log('');
  console.log('═══ 4. พิมพ์ประเภทที่ยังไม่มี ต้องเพิ่มเข้ารายการกลางได้ ═══');
  const d = await ev([
    "const inp=document.getElementById('activityName');",
    "inp.value='กิจกรรมตรวจเยี่ยมเชิงลึก';",
    "inp.dispatchEvent(new Event('input',{bubbles:true}));",
    "await new Promise(r=>setTimeout(r,500));",
    "const list=inp.closest('.cb-wrap').querySelector('.cb-list');",
    "const add=list.querySelector('.cb-new');",
    "if(add) add.dispatchEvent(new MouseEvent('mousedown',{bubbles:true}));",
    "await new Promise(r=>setTimeout(r,700));",
    "return { hadAddButton: !!add, sent: window.__appended, value: inp.value };"
  ].join(NL));
  ok('มีปุ่มให้เพิ่มค่าใหม่', d.hadAddButton === true);
  ok('ส่งขึ้นรายการกลางด้วย key = activityList',
     Array.isArray(d.sent) && d.sent.some(x => x && x.key === 'activityList'
       && x.value === 'กิจกรรมตรวจเยี่ยมเชิงลึก'),
     JSON.stringify(d.sent));

  console.log('');
  console.log('═══ 5. แถวรายละเอียดด้านล่างต้องแสดงเลย ไม่ต้องกด + ═══');
  const e2 = await ev([
    "const list=document.getElementById('extraActivitiesList');",
    "const rows=list.querySelectorAll('.extra-activity');",
    "const inp=list.querySelector('.extra-act-text');",
    "return { rows: rows.length,",
    "         empty: inp ? inp.value : null,",
    "         placeholder: inp ? inp.placeholder : '',",
    "         hasPrompt: !!list.querySelector('p.italic') };"
  ].join(NL));
  ok('มีแถวให้พิมพ์อย่างน้อยหนึ่งแถว', e2.rows >= 1, e2.rows + ' แถว');
  ok('ไม่มีข้อความ "กดปุ่มเพิ่มแถว" ค้างอยู่', e2.hasPrompt === false);
  ok('แถวล่างว่าง ไม่ถูกเติมประเภทจากช่องบนมาทับ', e2.empty === '', JSON.stringify(e2.empty));
  ok('ข้อความในช่องบอกว่าเป็นรายละเอียด',
     /รายละเอียด/.test(e2.placeholder), e2.placeholder);

  console.log('');
  console.log('═══ 6. พิมพ์รายละเอียดยาว ต้องบอกว่าใบจะย่อตัวอักษรแค่ไหน ═══');
  const f = await ev([
    "const inp=document.querySelector('.extra-act-text');",
    "inp.value='ก'.repeat(150);",
    "inp.dispatchEvent(new Event('input',{bubbles:true}));",
    "await new Promise(r=>setTimeout(r,400));",
    "const box=document.getElementById('extraActFit');",
    "const mid = { hidden: box.classList.contains('hidden'), text: box.textContent };",
    "inp.value='ก'.repeat(260);",
    "inp.dispatchEvent(new Event('input',{bubbles:true}));",
    "await new Promise(r=>setTimeout(r,400));",
    "const long = { hidden: box.classList.contains('hidden'), text: box.textContent };",
    "inp.value='สั้น';",
    "inp.dispatchEvent(new Event('input',{bubbles:true}));",
    "await new Promise(r=>setTimeout(r,400));",
    "const shortOne = { hidden: box.classList.contains('hidden') };",
    "return { mid: mid, long: long, shortOne: shortOne };"
  ].join(NL));
  ok('ยาวปานกลาง: บอกว่าจะย่อเป็น 12.5px',
     f.mid.hidden === false && /12\.5px/.test(f.mid.text), f.mid.text.slice(0, 80));
  ok('ยาวมาก: บอกว่าย่อจนเล็กที่สุด 10.5px',
     f.long.hidden === false && /10\.5px/.test(f.long.text), f.long.text.slice(0, 80));
  ok('ยืนยันว่าเอกสารยังอยู่ในหน้าเดียว',
     /หน้าเดียว/.test(f.long.text), f.long.text.slice(-40));
  ok('พิมพ์สั้นแล้วคำเตือนหายไป', f.shortOne.hidden === true);

  console.log('');
  ok('ไม่มี JavaScript error ตลอดการทดสอบ', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '));

  console.log('');
  console.log('══════════════════════════════════════════════════');
  console.log('  ผ่าน ' + results.filter(Boolean).length + ' / ' + results.length);
  console.log('══════════════════════════════════════════════════');
  process.exitCode = results.every(Boolean) ? 0 : 1;
} catch (e) { console.error('ล้มเหลว:', e.message); process.exitCode = 2; }
finally { try { ws.close(); } catch {} chrome.kill(); }
