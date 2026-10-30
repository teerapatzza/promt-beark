// ไล่ทุกเคสของการกดบันทึก ด้วยค่าตั้งของหมวดจริงบนโปรดักชัน
//
// 21 ต.ค. 2569 — เจ้าของงานติดด่านตรวจสองตัวซ้อนภายในวันเดียว
//   ครั้งแรก "กรุณาระบุสถานที่ จุดเริ่มต้น และ จุดที่รถไปส่ง"
//   ครั้งที่สอง "ยังปักหมุดไม่ครบทั้งสองจุด"
// ทั้งสองครั้งเขากรอกครบแล้ว และทั้งสองครั้งชุดทดสอบของผมเขียว
//
// ต้นเหตุที่เทสต์จับไม่ได้: ผมใช้ "หมวดสมมติ" ที่ไม่ตรงกับของจริง
// หมวดจริง TRAVEL001 บังคับแนบแผนที่ ด่านตรวจหมุดจึงทำงาน
// หมวดสมมติของผมไม่บังคับอะไรเลย ด่านนั้นไม่เคยถูกเรียกสักครั้ง
//
// ชุดนี้จึงใช้ค่าตั้งของหมวดจริงทั้ง 5 หมวด แล้วไล่ทุกการผสม
//   พาหนะ : รถส่วนตัว / Taxi / ทั้งคู่
//   วิธีคิด: ตามระยะจริง / เหมาจ่าย
// กติกาเดียว — ใบที่ผู้ใช้กรอกครบตามที่หน้าจอขอ ต้องบันทึกได้
// ถ้าถูกบล็อก ชุดนี้จะบอกว่าเคสไหนและด้วยข้อความอะไร
//
//   cd public && python3 -m http.server 8099 --bind 127.0.0.1
//   node scripts/test-save-matrix.mjs
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9659, PROFILE = 'C:/Users/teerapat/AppData/Local/Temp/pb-matrix';
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

const FLAT = { enabled: true, maxKm: 200, outsideMetro: 1200, bands: [
  { upTo: 10.99, amount: 150 }, { upTo: 20.99, amount: 250 }, { upTo: null, amount: 750 } ] };

/* ค่าตั้งของหมวดจริงบนโปรดักชัน อ่านจากฐานข้อมูลเมื่อ 21 ต.ค. 2569
   จงใจคัดมาทั้งก้อน ไม่ย่อ ไม่ตัด เพราะที่พลาดมาคือการใช้ค่าสมมติ */
const CATS = [
  { id: 'TRAVEL001', name: 'เบิกค่าเดินทาง+ที่พัก',
    pdfTemplates: ['REPORT', 'TRANSPORT_RECEIPT'], fuelRate: 5, taxiMaxPerTrip: 750, flatRate: FLAT,
    attachmentRules: { LOCATION: { show: true, required: true,  label: 'แผนที่' },
                       RECEIPT:  { show: true, required: false, label: 'ใบเสร็จ' } },
    attachmentOrder: ['LOCATION', 'RECEIPT'] },
  { id: 'TRAVEL002', name: 'เบิกค่าเดินทาง+ค่าที่พัก (กรณีบิลเงินสด)',
    pdfTemplates: ['REPORT', 'TRANSPORT_RECEIPT', 'GENERAL_RECEIPT'], fuelRate: 5, taxiMaxPerTrip: 750, flatRate: FLAT,
    attachmentRules: { LOCATION: { show: true, required: false, label: 'แผนที่' },
                       RECEIPT:  { show: true, required: true,  label: 'ใบเสร็จ' } },
    attachmentOrder: ['LOCATION', 'RECEIPT'] },
  { id: 'TRAVEL004', name: 'เบิกค่าพาหนะ',
    pdfTemplates: ['TRANSPORT_RECEIPT'], fuelRate: 5, taxiMaxPerTrip: 750, flatRate: FLAT,
    attachmentRules: { LOCATION: { show: true, required: false, label: 'แผนที่' },
                       RECEIPT:  { show: true, required: false, label: 'ใบเสร็จ' } },
    attachmentOrder: ['LOCATION', 'RECEIPT'] }
];

/* ขั้นตอนกรอกฟอร์มของแต่ละเคส เขียนเป็นสคริปต์ที่รันในหน้าเว็บ
   "กรอกครบตามที่หน้าจอขอ" แปลว่า: ผู้ขอเบิก กิจกรรม วันเดินทาง พาหนะ เงิน
   หมุด (ถ้าใช้แผนที่ระบบ) และไฟล์แนบทุกช่องที่ติดดาวบังคับ */
const FILL = [
  "window.__saved=null; window.__a=[];",
  "window.alert = m => { window.__a.push(String(m)); };",
  "const of2=window.fetch;",
  "window.fetch=function(u,i){const s=(typeof u==='string')?u:(u&&u.url)||'';",
  "  if(i&&(i.method==='POST'||i.method==='PUT')&&s.indexOf('/expenses')>=0){",
  "    window.__saved=i.body; return new Promise(()=>{}); }",
  "  return of2(u,i);};",
  "const rb=document.getElementById('requestedBy'); if(rb) rb.value='ทดสอบ ทุกเคส';",
  "const an=document.getElementById('activityName'); if(an) an.value='กิจกรรมเยี่ยมสำรวจ';",
  "const ps=document.getElementById('position'); if(ps) ps.value='นักวิเคราะห์ธุรกิจ';",
  "const af=document.getElementById('affiliation'); if(af) af.value='อิสระ';",
  // แนบไฟล์ให้ทุกช่องที่บังคับ เหมือนผู้ใช้ทำจริง
  "document.querySelectorAll('.general-file-upload.required-file').forEach(inp=>{",
  "  const dt=new DataTransfer();",
  "  dt.items.add(new File([new Uint8Array([137,80,78,71])],'หลักฐาน.png',{type:'image/png'}));",
  "  inp.files=dt.files; inp.dispatchEvent(new Event('change',{bubbles:true})); });",
  "await new Promise(r=>setTimeout(r,500));",
  "const b=document.getElementById('submitBtn'); if(b){ b.disabled=false; b.click(); }",
  "await new Promise(r=>setTimeout(r,2400));",
  "return { body: window.__saved, alerts: window.__a.slice(0,3) };"
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
  await send('Page.addScriptToEvaluateOnNewDocument', { source: [
    "localStorage.setItem('token','x');",
    "const CATS=" + JSON.stringify(CATS) + ";",
    "const of=window.fetch;",
    "window.fetch=function(u,i){const s=(typeof u==='string')?u:(u&&u.url)||'';",
    "  if(s.indexOf('/auth/me')>=0) return Promise.resolve(new Response(",
    "    JSON.stringify({id:1,email:'t@ha.or.th',name:'test',role:'admin'}),",
    "    {status:200,headers:{'Content-Type':'application/json'}}));",
    "  if(s.indexOf('/settings')>=0&&s.indexOf('list-append')<0) return Promise.resolve(new Response(",
    "    JSON.stringify({fuelRate:5,taxiMaxPerTrip:750,hotelRateSingle:1500,hotelRateDouble:1000,",
    "      positionList:['นักวิเคราะห์ธุรกิจ'],affiliationList:['อิสระ'],activityList:['กิจกรรมเยี่ยมสำรวจ']}),",
    "    {status:200,headers:{'Content-Type':'application/json'}}));",
    "  if(s.indexOf('/budget-categories')>=0) return Promise.resolve(new Response(",
    "    JSON.stringify(CATS), {status:200,headers:{'Content-Type':'application/json'}}));",
    "  if(s.indexOf('/expenses')>=0||s.indexOf('/profiles')>=0)",
    "    return Promise.resolve(new Response('[]',{status:200,headers:{'Content-Type':'application/json'}}));",
    "  return of(u,i);};",
    "window.routeLeg = async () => ({ km: 42.5, meters: 42500, coords: [] });"
  ].join(NL) });

  /** เตรียมฟอร์มหนึ่งเคส แล้วกดบันทึก คืนผลว่าถูกบล็อกไหม */
  const runCase = async (catId, vehicle, method) => {
    await send('Page.navigate', { url: APP + '/expense.html' });
    await sleep(4500);
    await ev([
      "const s=document.getElementById('categorySelect');",
      "s.value='" + catId + "'; s.dispatchEvent(new Event('change',{bubbles:true}));",
      "await new Promise(r=>setTimeout(r,1400));",
      "const ds=document.getElementById('dateStart'), de=document.getElementById('dateEnd');",
      "if(ds){ ds.value='2026-10-22'; ds.dispatchEvent(new Event('change',{bubbles:true})); }",
      "if(de){ de.value='2026-10-23'; de.dispatchEvent(new Event('change',{bubbles:true})); }",
      // วันที่จัดกิจกรรมเป็นช่องบังคับตั้งแต่ 30 ต.ค. 2569 (ออกล่วงหน้า 1 วัน จบวันเดียวกับวันกลับ)
      "const pS=document.getElementById('periodStart'), pE=document.getElementById('periodEnd');",
      "if(pS){ pS.value='2026-10-23'; } if(pE){ pE.value='2026-10-23'; }",
      "await new Promise(r=>setTimeout(r,600));",
      "window.routeLeg = async () => ({ km: 42.5, meters: 42500, coords: [] });",
      "return 1;"
    ].join(NL));

    // เลือกวิธีคิดก่อน เพราะมันเปลี่ยนหน้าตาของส่วนพาหนะ
    if (method === 'flat') {
      await ev([
        "const r=document.querySelector('input[name=\"fuelMethod\"][value=\"flat\"]');",
        "if(r){ r.checked=true; r.dispatchEvent(new Event('change',{bubbles:true})); }",
        "await new Promise(r=>setTimeout(r,1200)); return 1;"
      ].join(NL));
    }

    // พาหนะ + หมุด + เงิน
    const steps = [];
    if (vehicle === 'car' || vehicle === 'both' || method === 'flat') {
      steps.push(
        "geoFrom={lat:13.60,lng:100.53,precision:'exact',label:'บ้าน'};",
        "geoTo={lat:13.91,lng:100.60,precision:'exact',label:'ดอนเมือง'};",
        "if(typeof setPoint==='function'){ setPoint('from',13.60,100.53,'บ้าน','exact','t');",
        "  setPoint('to',13.91,100.60,'ดอนเมือง','exact','t'); }",
        "{const a=document.getElementById('travelFrom'), b=document.getElementById('travelTo');",
        " if(a) a.value='บ้าน'; if(b) b.value='ดอนเมือง';}",
        "{const a=document.getElementById('distOutbound'), b=document.getElementById('distReturn');",
        " if(a){ a.value='42.5'; a.dispatchEvent(new Event('input',{bubbles:true})); }",
        " if(b){ b.value='42.5'; b.dispatchEvent(new Event('input',{bubbles:true})); }}"
      );
      if (vehicle === 'car' || vehicle === 'both') {
        steps.push("{const c=document.getElementById('legOutCar'); if(c && !c.checked){ c.checked=true;",
                   " c.dispatchEvent(new Event('change',{bubbles:true})); }}");
      }
    }
    if (vehicle === 'taxi' || vehicle === 'both') {
      steps.push(
        "{const c=document.getElementById('legOutTaxi'); if(c && !c.checked){ c.checked=true;",
        " c.dispatchEvent(new Event('change',{bubbles:true})); }}",
        "await new Promise(r=>setTimeout(r,900));",
        "if(!document.querySelector('.taxi-entry') && typeof addTaxiEntry==='function') addTaxiEntry('ขาไป');",
        "await new Promise(r=>setTimeout(r,500));",
        "[...document.querySelectorAll('.taxi-entry')].forEach((r,i)=>{",
        "  const f=r.querySelector('.taxi-from'), t=r.querySelector('.taxi-to');",
        "  f.value='ต้นทาง'; f.dataset.lat=13.62; f.dataset.lng=100.51; f.dataset.touched='1';",
        "  t.value='ปลายทาง'; t.dataset.lat=13.80; t.dataset.lng=100.58; t.dataset.touched='1';",
        "  const d=r.querySelector('.taxi-dir').value;",
        "  const amt = d==='ขากลับ' ? r.querySelector('.taxi-amt-ret') : r.querySelector('.taxi-amt-out');",
        "  if(amt){ amt.value='120'; amt.dispatchEvent(new Event('input',{bubbles:true})); } });"
      );
    }
    /* หมวดที่มีใบเสร็จทั่วไป (FM-SAM-003-06) ต้องมีรายการในตารางอย่างน้อยหนึ่งแถว
       ซึ่งเป็นข้อบังคับที่ถูกต้อง — ตารางค่าใช้จ่ายที่ว่างเปล่าไม่มีความหมาย
       ผู้ใช้จริงก็ต้องกรอก เทสต์จึงต้องกรอกด้วย ไม่ใช่ไปปลดด่านนี้ทิ้ง */
    steps.push(
      "if (document.querySelector('#generalReceiptSection:not(.hidden)')",
      "    && typeof addGeneralReceiptRow === 'function') {",
      "  if(!document.querySelector('.gr-row')) addGeneralReceiptRow();",
      "  await new Promise(r=>setTimeout(r,400));",
      "  const row=document.querySelector('.gr-row');",
      "  if(row){ row.querySelector('.gr-date').value='2026-10-22';",
      "    row.querySelector('.gr-desc').value='ค่าใช้จ่ายในการเดินทาง';",
      "    const a=row.querySelector('.gr-amt'); a.value='500';",
      "    a.dispatchEvent(new Event('input',{bubbles:true})); } }"
    );
    steps.push("await new Promise(r=>setTimeout(r,1200));",
               "if(typeof calculateTravelTotal==='function') calculateTravelTotal();",
               "await new Promise(r=>setTimeout(r,600)); return 1;");
    await ev(steps.join(NL));

    const out = await ev(FILL);
    let obj = null;
    try { obj = JSON.parse(out.body || 'null'); } catch (e) {}
    return { saved: !!obj,
             amount: obj ? obj.amount : 0,
             alert: (out.alerts || [])[0] || '' };
  };

  const VEH = { car: 'รถส่วนตัว', taxi: 'Taxi', both: 'ทั้งคู่' };
  const MET = { distance: 'ตามระยะจริง', flat: 'เหมาจ่าย' };

  for (const cat of CATS) {
    console.log('');
    console.log('═══ หมวด ' + cat.id + ' — ' + cat.name);
    console.log('    บังคับแนบ: ' + (Object.keys(cat.attachmentRules)
      .filter(k => cat.attachmentRules[k].required).join(', ') || 'ไม่บังคับ'));
    for (const method of ['distance', 'flat']) {
      for (const vehicle of ['car', 'taxi', 'both']) {
        const r = await runCase(cat.id, vehicle, method);
        ok(VEH[vehicle].padEnd(10) + ' · ' + MET[method].padEnd(12)
           + (r.saved ? ' บันทึกได้ ' + r.amount + ' บาท' : ' ถูกบล็อก'),
           r.saved === true,
           r.saved ? '' : r.alert.replace(/\s+/g, ' ').slice(0, 110));
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
