// วันที่จัดกิจกรรม ต้องทำงานถูกกับ "ทุกหมวดที่มีอยู่จริงบนโปรดักชัน"
//
// 30 ต.ค. 2569 — เจ้าของงานเตือนว่า "ดูดีๆ เรื่องหมวดหมู่ด้วย ต้องสอดคล้อง"
// ตรวจแล้วพบว่าเทสต์เดิมครอบเส้นทาง "กดบันทึก" แค่ชุดเอกสารที่มีใบรับรองค่าพาหนะ
// ส่วน TRAVEL003 (NORMAL+REPORT) กับ TRAVEL005 (REPORT+GENERAL_RECEIPT)
// ซึ่งมีอยู่จริงบนโปรดักชัน ไม่เคยถูกกดบันทึกในเทสต์ไหนเลย
// (test-general-receipt กดปุ่ม "วันที่แยกรายเอกสาร" ไม่ใช่ปุ่มบันทึก)
//
// ชุดเอกสารด้านล่างคัดลอกมาจากฐานข้อมูลโปรดักชันจริง อ่านเมื่อ 30 ต.ค. 2569
//
//   cd public && python -m http.server 8099 --bind 127.0.0.1
//   node scripts/test-category-matrix-period.mjs
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9668, PROFILE = 'C:/Users/teerapat/AppData/Local/Temp/pb-catmatrix';
const APP = process.env.APP_URL || 'http://127.0.0.1:8099';
const NL = String.fromCharCode(10);

/* หมวดจริงบนโปรดักชัน 30 ต.ค. 2569 — id/ชื่อ/ชุดเอกสาร ตรงตามฐานข้อมูล */
const PROD_CATS = [
  { id: 'TRAVEL001', name: 'เบิกค่าเดินทาง+ที่พัก',                 pdfTemplates: ['REPORT', 'TRANSPORT_RECEIPT'] },
  { id: 'TRAVEL002', name: 'เบิกค่าเดินทาง+ค่าที่พัก (กรณีบิลเงินสด)', pdfTemplates: ['REPORT', 'TRANSPORT_RECEIPT', 'GENERAL_RECEIPT'] },
  { id: 'TRAVEL003', name: 'เบิกค่าที่พัก',                          pdfTemplates: ['NORMAL', 'REPORT'] },
  { id: 'TRAVEL004', name: 'เบิกค่าพาหนะ',                           pdfTemplates: ['TRANSPORT_RECEIPT'] },
  { id: 'TRAVEL005', name: 'เบิกค่าที่พัก (กรณีบิลเงินสด)',           pdfTemplates: ['REPORT', 'GENERAL_RECEIPT'] }
];
const CATS = PROD_CATS.map(c => Object.assign({}, c, {
  fuelRate: 5, taxiMaxPerTrip: 750,
  attachmentRules: { LOCATION: { show: true, required: false, label: 'แผนที่' },
                     RECEIPT:  { show: true, required: false, label: 'ใบเสร็จ' } },
  attachmentOrder: ['LOCATION', 'RECEIPT']
}));

const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=' + PORT,
  '--user-data-dir=' + PROFILE, '--no-first-run', '--disable-gpu',
  '--window-size=1400,1600', 'about:blank'], { stdio: 'ignore' });

let ws, id = 0; const pending = new Map(); const pageErrors = [];
const send = (m, p = {}) => { const i = ++id; ws.send(JSON.stringify({ id: i, method: m, params: p }));
  return new Promise((r, j) => pending.set(i, { r, j })); };
const ev = async e => {
  const r = await send('Runtime.evaluate',
    { expression: '(async()=>{' + e + '})()', awaitPromise: true, returnByValue: true, timeout: 60000 });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result?.value;
};
const results = [];
const ok = (n, pass, d = '') => { results.push(pass);
  console.log((pass ? '  ผ่าน  ' : '  ตก    ') + n + (d ? '  -> ' + d : '')); };

const stub = [
  "localStorage.setItem('token','x');",
  "const CATS=" + JSON.stringify(CATS) + ";",
  "window.__saved=null; window.__a=[];",
  "const of=window.fetch;",
  "window.fetch=function(u,i){const s=(typeof u==='string')?u:(u&&u.url)||'';",
  "  if(s.indexOf('/auth/me')>=0) return Promise.resolve(new Response(",
  "    JSON.stringify({id:1,email:'t@example.invalid',name:'test',role:'admin'}),",
  "    {status:200,headers:{'Content-Type':'application/json'}}));",
  "  if(s.indexOf('/settings')>=0&&s.indexOf('list-append')<0) return Promise.resolve(new Response(",
  "    JSON.stringify({fuelRate:5,taxiMaxPerTrip:750,positionList:[],affiliationList:[],activityList:[]}),",
  "    {status:200,headers:{'Content-Type':'application/json'}}));",
  "  if(s.indexOf('/budget-categories')>=0) return Promise.resolve(new Response(",
  "    JSON.stringify(CATS),{status:200,headers:{'Content-Type':'application/json'}}));",
  "  if(i&&(i.method==='POST'||i.method==='PUT')&&s.indexOf('/expenses')>=0){",
  "    window.__saved=i.body; return new Promise(()=>{}); }",
  "  if(s.indexOf('/expenses')>=0) return Promise.resolve(new Response('[]',",
  "    {status:200,headers:{'Content-Type':'application/json'}}));",
  "  if(s.indexOf('/profiles')>=0) return Promise.resolve(new Response('[]',",
  "    {status:200,headers:{'Content-Type':'application/json'}}));",
  "  if(s.indexOf('/map-route')>=0) return Promise.resolve(new Response(",
  "    JSON.stringify({features:[{properties:{distance:20000},",
  "      geometry:{type:'LineString',coordinates:[[100.5,13.6],[100.6,13.7]]}}]}),",
  "    {status:200,headers:{'Content-Type':'application/json'}}));",
  "  return of(u,i);};"
].join(NL);

/** เลือกหมวด + ใส่วันเดินทาง 22→23 ต.ค. */
const setup = catId => [
  "const s=document.getElementById('categorySelect');",
  "s.value='" + catId + "'; s.dispatchEvent(new Event('change',{bubbles:true}));",
  "await new Promise(r=>setTimeout(r,1500));",
  "const a=document.getElementById('dateStart'), b=document.getElementById('dateEnd');",
  "if(a){ a.value='2026-10-22'; a.dispatchEvent(new Event('change',{bubbles:true})); }",
  "if(b){ b.value='2026-10-23'; b.dispatchEvent(new Event('change',{bubbles:true})); }",
  "await new Promise(r=>setTimeout(r,700));",
  "return { visible: !!(document.getElementById('periodStart')||{}).offsetParent };"
].join(NL);

/** กรอกช่องบังคับที่เหลือแล้วกดบันทึก — fillPeriod=true คือกรอกวันที่จัดกิจกรรมด้วย */
const trySave = fillPeriod => [
  "window.__saved=null; window.__a=[];",
  "window.alert = m => { window.__a.push(String(m)); };",
  "window.confirm = () => true;",
  "const set=(id,v)=>{const e=document.getElementById(id); if(e){e.value=v;}};",
  "set('requestedBy','ผู้เบิกทดสอบ'); set('activityName','กิจกรรมเยี่ยมสำรวจ');",
  "set('position','นักวิเคราะห์ธุรกิจ'); set('affiliation','อิสระ');",
  "set('addrNo','1'); set('addrSub','บางรัก'); set('addrDist','บางรัก');",
  "set('addrProv','กรุงเทพมหานคร'); set('addrZip','10500');",
  "set('travelFrom','จุดทดสอบ 1'); set('travelTo','จุดทดสอบ 2');",
  "set('distOutbound','20'); set('distReturn','20');",
  /* หมวดที่ไม่มีใบรับรองค่าพาหนะจะไม่มีค่าน้ำมันให้คิด ยอดจึงเป็น 0 แล้วโดนด่าน
     "ยอดเบิกต้องมากกว่า 0" ตีกลับก่อนถึงเรื่องวันที่ จึงต้องใส่ค่าใช้จ่ายอื่นให้มียอด */
  "['otherCost','parkingCost'].forEach(id=>{const e=document.getElementById(id);",
  "  if(e && e.offsetParent!==null && !e.value){ e.value='500';",
  "    e.dispatchEvent(new Event('input',{bubbles:true})); }});",
  /* ใบรับรองแทนใบเสร็จบังคับให้มีอย่างน้อย 1 แถวในตาราง FM-SAM-003-06 */
  "const grBody=document.getElementById('generalReceiptBody');",
  "if(grBody && typeof addGeneralReceiptRow==='function' && !grBody.querySelector('.gr-row')){",
  "  addGeneralReceiptRow();",
  "  const row=grBody.querySelector('.gr-row');",
  "  if(row){ row.querySelector('.gr-date').value='2026-10-23';",
  "    row.querySelector('.gr-desc').value='ค่าที่พักทดสอบ';",
  "    const amt=row.querySelector('.gr-amt'); amt.value='1500';",
  "    amt.dispatchEvent(new Event('input',{bubbles:true})); } }",
  "await new Promise(r=>setTimeout(r,300));",
  fillPeriod ? "set('periodStart','2026-10-23'); set('periodEnd','2026-10-23');" : "",
  "const ct=document.getElementById('carType');",
  "if(ct){ ct.value='ไป-กลับ'; ct.dispatchEvent(new Event('change',{bubbles:true})); }",
  "const um=document.getElementById('useAppMapImage'); if(um&&um.checked){ um.checked=false;",
  "  um.dispatchEvent(new Event('change',{bubbles:true})); }",
  "await new Promise(r=>setTimeout(r,400));",
  "const mi=document.getElementById('mapManualUpload');",
  "if(mi){ const dt=new DataTransfer();",
  "  dt.items.add(new File([new Uint8Array([137,80,78,71])],'แผนที่.png',{type:'image/png'}));",
  "  mi.files=dt.files; mi.dispatchEvent(new Event('change',{bubbles:true})); }",
  "document.querySelectorAll('.general-file-upload.required-file').forEach(inp=>{",
  "  const dt=new DataTransfer();",
  "  dt.items.add(new File([new Uint8Array([137,80,78,71])],'หลักฐาน.png',{type:'image/png'}));",
  "  inp.files=dt.files; inp.dispatchEvent(new Event('change',{bubbles:true})); });",
  "await new Promise(r=>setTimeout(r,500));",
  "const b=document.getElementById('submitBtn'); if(b){ b.disabled=false; b.click(); }",
  "await new Promise(r=>setTimeout(r,2200));",
  "return { saved: window.__saved, alerts: window.__a.slice(0,3) };"
].filter(Boolean).join(NL);

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
  await send('Page.addScriptToEvaluateOnNewDocument', { source: stub });

  for (const cat of PROD_CATS) {
    const needReport = cat.pdfTemplates.includes('REPORT');
    console.log('');
    console.log('═══ ' + cat.id + ' ' + cat.name + '  ' + JSON.stringify(cat.pdfTemplates) + ' ═══');

    await send('Page.navigate', { url: APP + '/expense.html' });
    await sleep(4500);
    const st = await ev(setup(cat.id));

    ok('ช่องวันที่จัดกิจกรรม ' + (needReport ? 'ต้องเห็น' : 'ต้องถูกซ่อน'),
       st.visible === needReport, st.visible ? 'เห็นอยู่' : 'ซ่อนอยู่');

    if (needReport) {
      // ไม่กรอก = ต้องถูกบล็อก พร้อมบอกเหตุผลให้ตรงจุด
      const blocked = await ev(trySave(false));
      ok('ไม่กรอกแล้วบันทึก = ถูกบล็อก', !blocked.saved,
         blocked.saved ? 'หลุดไปแล้ว' : (blocked.alerts[0] || '').slice(0, 60));
      ok('ข้อความบอกว่าต้องกรอกวันที่จัดกิจกรรม',
         (blocked.alerts[0] || '').indexOf('วันที่จัดกิจกรรม') >= 0,
         (blocked.alerts[0] || '').slice(0, 60));
    }

    // กรอกครบ (หรือหมวดที่ไม่ต้องกรอก) = ต้องบันทึกได้
    const saved = await ev(trySave(needReport));
    let body = null; try { body = JSON.parse(saved.saved || 'null'); } catch (e) {}
    ok('กรอกครบแล้วบันทึกได้', !!body, body ? 'ส่งออกแล้ว' : (saved.alerts[0] || '').slice(0, 70));

    if (body) {
      const tr = ((body.inputMetadata || {})._travel) || {};
      ok('วันเดินทางที่ส่งออกถูกต้อง (22→23)',
         tr.startDate === '2026-10-22' && tr.endDate === '2026-10-23',
         tr.startDate + ' .. ' + tr.endDate);
      if (needReport) {
        ok('ช่วงกิจกรรมที่ส่งออกเป็นค่าที่กรอก ไม่ใช่วันเดินทาง',
           tr.periodStart === '2026-10-23' && tr.periodEnd === '2026-10-23',
           tr.periodStart + ' .. ' + tr.periodEnd);
      } else {
        /* หมวดที่ไม่มีใบรายงานไม่มีช่องนี้ให้กรอก จึงต้องไม่มีค่าหลุดออกไป
           ถ้ามีค่าแปลว่าไปลอกมาจากที่ไหนสักแห่งโดยที่ผู้ใช้ไม่ได้ตั้งใจ */
        ok('หมวดที่ไม่มีใบรายงาน ไม่ส่งช่วงกิจกรรมออกไป',
           !tr.periodStart && !tr.periodEnd,
           '[' + (tr.periodStart || '') + ' .. ' + (tr.periodEnd || '') + ']');
      }
    }
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
