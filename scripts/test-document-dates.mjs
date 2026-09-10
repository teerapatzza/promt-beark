// ตรวจช่องวันที่สองช่องใหม่ และตรวจว่าเอกสารที่ออกมาใช้ค่านั้นจริง
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import path from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9423, PROFILE = path.join(process.env.TEMP, 'pb-dates');
const APP = 'http://localhost:8080';

const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${PROFILE}`, '--no-first-run', '--disable-gpu', 'about:blank'], { stdio:'ignore' });

let ws, id = 0; const pending = new Map(); const errors = [];
const send = (m,p={}) => { const i=++id; ws.send(JSON.stringify({id:i,method:m,params:p}));
  return new Promise((r,j)=>pending.set(i,{r,j})); };
const ev = async e => {
  const r = await send('Runtime.evaluate', { expression:`(async()=>{${e}})()`, awaitPromise:true, returnByValue:true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result?.value;
};
const results = [];
const check = (n, ok, d='') => { results.push({n,ok}); console.log((ok?'  PASS  ':'  FAIL  ')+n+(d?'  → '+d:'')); };

const today = new Date();
const iso = d => d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
const TODAY = iso(today);

try {
  let u;
  for (let i=0;i<60;i++){ try{ const l=await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
    const p=l.find(t=>t.type==='page'); if(p){u=p.webSocketDebuggerUrl;break;} }catch{} await sleep(250); }
  ws = new WebSocket(u); await new Promise(r=>ws.addEventListener('open',r));
  ws.addEventListener('message', e => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { const {r,j}=pending.get(m.id); pending.delete(m.id);
      m.error?j(new Error(m.error.message)):r(m.result); return; }
    if (m.method==='Runtime.exceptionThrown')
      errors.push(m.params.exceptionDetails.exception?.description||m.params.exceptionDetails.text);
    if (m.method==='Page.javascriptDialogOpening') send('Page.handleJavaScriptDialog',{accept:true});
  });
  await send('Page.enable'); await send('Runtime.enable');

  const cred = { email:'tester@ha.or.th', password:'testpass123' };
  let tok = await fetch(APP+'/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify(cred)}).then(r=>r.json()).then(j=>j.token).catch(()=>null);
  if (!tok) tok = await fetch(APP+'/auth/register',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify(cred)}).then(r=>r.json()).then(j=>j.token);
  if (!tok) throw new Error('ล็อกอินไม่ได้');

  await send('Page.navigate',{url:APP+'/login.html'}); await sleep(1200);
  await ev(`localStorage.setItem('token', ${JSON.stringify(tok)}); return 1`);
  await send('Page.navigate',{url:APP+'/expense.html'}); await sleep(4000);

  console.log('═══ 1. วันที่บนเอกสาร ═══');
  check('เติมวันนี้ให้อัตโนมัติ',
        (await ev(`return document.getElementById('docDate').value`)) === TODAY, TODAY);
  check('เขียนวันที่ไทยกำกับให้',
        /^\d{1,2} .+ 25\d\d$/.test(await ev(`return document.getElementById('docDateThai').textContent`)),
        await ev(`return document.getElementById('docDateThai').textContent`));
  check('ยังไม่แก้ → ไม่มีปุ่มกลับเป็นวันนี้',
        (await ev(`return document.getElementById('docDateReset').classList.contains('hidden')`)) === true);

  await ev(`const e=document.getElementById('docDate'); e.value='2026-08-01';
            e.dispatchEvent(new Event('change',{bubbles:true})); return 1`);
  await sleep(300);
  check('แก้เป็นวันย้อนหลังได้',
        (await ev(`return document.getElementById('docDate').value`)) === '2026-08-01');
  check('วันที่ไทยเปลี่ยนตาม (1 ส.ค. 2026 = 2569)',
        (await ev(`return document.getElementById('docDateThai').textContent`)) === '1 สิงหาคม 2569',
        await ev(`return document.getElementById('docDateThai').textContent`));
  check('แก้แล้วมีปุ่มกลับเป็นวันนี้',
        (await ev(`return document.getElementById('docDateReset').classList.contains('hidden')`)) === false);
  await ev(`resetDocDate(); return 1`); await sleep(250);
  check('กดกลับเป็นวันนี้แล้วกลับจริง',
        (await ev(`return document.getElementById('docDate').value`)) === TODAY);

  console.log('\n═══ 2. ในระหว่างวันที่ ═══');
  await ev(`
    const sel=[...document.querySelectorAll('select')].find(s=>[...s.options].some(o=>o.value==='TRAVEL003'));
    sel.value='TRAVEL003'; sel.dispatchEvent(new Event('change',{bubbles:true})); return 1;`);
  await sleep(900);
  await ev(`
    const set=(id,v)=>{const e=document.getElementById(id); e.value=v; e.dispatchEvent(new Event('change',{bubbles:true}));};
    set('dateStart','2026-08-26'); set('dateEnd','2026-08-28'); return 1;`);
  await sleep(500);
  check('ตามวันเดินทางให้อัตโนมัติ',
        (await ev(`return document.getElementById('periodStart').value+' → '+document.getElementById('periodEnd').value`))
        === '2026-08-26 → 2026-08-28',
        await ev(`return document.getElementById('periodStart').value+' → '+document.getElementById('periodEnd').value`));
  check('ขึ้นป้ายว่ากำลังตามวันเดินทาง',
        (await ev(`return document.getElementById('periodAuto').classList.contains('hidden')`)) === false);

  await ev(`const e=document.getElementById('periodStart'); e.value='2026-09-01';
            e.dispatchEvent(new Event('change',{bubbles:true})); return 1`);
  await sleep(300);
  check('แก้เองแล้วป้าย "ตามวันเดินทาง" หายไป',
        (await ev(`return document.getElementById('periodAuto').classList.contains('hidden')`)) === true);
  check('มีปุ่มให้กลับไปตามวันเดินทาง',
        (await ev(`return document.getElementById('periodReset').classList.contains('hidden')`)) === false);

  await ev(`
    const set=(id,v)=>{const e=document.getElementById(id); e.value=v; e.dispatchEvent(new Event('change',{bubbles:true}));};
    set('dateStart','2026-08-20'); return 1;`);
  await sleep(400);
  check('แก้เองแล้ว เปลี่ยนวันเดินทางไม่ทับค่าที่แก้ไว้',
        (await ev(`return document.getElementById('periodStart').value`)) === '2026-09-01',
        await ev(`return document.getElementById('periodStart').value`));

  await ev(`resetPeriod(); return 1`); await sleep(350);
  check('กดกลับไปตามวันเดินทางแล้วตามจริง',
        (await ev(`return document.getElementById('periodStart').value`)) === '2026-08-20',
        await ev(`return document.getElementById('periodStart').value`));

  console.log('\n═══ 3. เอกสารที่ออกมาใช้ค่าที่กรอกจริงไหม ═══');
  await send('Page.navigate',{url:APP+'/history.html'}); await sleep(3500);
  const doc = await ev(`
    return new Promise(res=>{
      // ดักไม่ให้แปลงเป็นไฟล์จริง แค่ต้องการ HTML ที่ประกอบเสร็จ
      window.html2pdf = () => ({ set:()=>({ from:()=>({ save:()=>Promise.resolve() }) }) });
      const fakeBtn = document.createElement('button');
      fakeBtn.innerHTML = 'ออก PDF';
      document.body.appendChild(fakeBtn);
      window.event = { currentTarget: fakeBtn, target: fakeBtn };
      const rec = {
        id:'TEST1', amount:2800, createdAt:'2026-09-10T04:00:00.000Z',
        requestedBy:'นางวารุณี เอี้ยวฉาย',
        inputMetadata:{
          _pdfTemplates:['REPORT'], _budgetCategoryId:'TRAVEL003',
          _position:'ที่ปรึกษา', _affiliation:'อิสระ',
          _docDate:'2026-08-01',
          _addr:{ no:'66/7', road:'-', soi:'-', sub:'มิตรภาพ', dist:'สีคิ้ว', prov:'นครราชสีมา', zip:'30140' },
          _travel:{ startDate:'2026-08-26', endDate:'2026-08-28',
                    startTime:'14:00', endTime:'20:00',
                    periodStart:'2026-09-01', periodEnd:'2026-09-05',
                    toProv:'นนทบุรี', startFromType:'ที่พัก', distOut:0, distRet:0 },
          _costs:{}
        }
      };
      exportPDF(rec).then(()=>{
        const el=document.getElementById('formal-doc')||document.getElementById('pdf-container');
        res(el ? el.innerText.replace(/\\s+/g,' ') : 'ไม่พบเอกสาร');
      }).catch(e=>res('ล้มเหลว: '+e.message));
    });`);
  await sleep(500);

  const has = s => typeof doc === 'string' && doc.includes(s);
  console.log('   ตัวอย่างข้อความในเอกสาร: ' + String(doc).slice(0, 150));
  check('วันที่บนเอกสารใช้ค่าที่กรอก (01/08/2569) ไม่ใช่วันสร้างใบ (10/09/2569)',
        has('01/08/2569') && !has('10/09/2569'),
        has('01/08/2569') ? 'พบ 01/08/2569' : 'ไม่พบ 01/08/2569');
  check('ในระหว่างวันที่ใช้ค่าที่แก้ (01/09/2569 - 05/09/2569)',
        has('01/09/2569') && has('05/09/2569'));
  check('วันออกเดินทางจริงยังพิมพ์ตามเดิม (26/08/2569)', has('26/08/2569'));

  console.log('\n═══ 4. ใบเก่าที่ไม่มีค่าใหม่ ต้องเหมือนเดิม ═══');
  const old = await ev(`
    return new Promise(res=>{
      window.html2pdf = () => ({ set:()=>({ from:()=>({ save:()=>Promise.resolve() }) }) });
      const fakeBtn = document.createElement('button');
      fakeBtn.innerHTML = 'ออก PDF';
      document.body.appendChild(fakeBtn);
      window.event = { currentTarget: fakeBtn, target: fakeBtn };
      const rec = {
        id:'OLD1', amount:1000, createdAt:'2026-09-10T04:00:00.000Z',
        requestedBy:'ทดสอบ ใบเก่า',
        inputMetadata:{
          _pdfTemplates:['REPORT'], _budgetCategoryId:'TRAVEL003',
          _addr:{}, _costs:{},
          _travel:{ startDate:'2026-08-26', endDate:'2026-08-28', startTime:'09:00', endTime:'17:00',
                    toProv:'นนทบุรี', startFromType:'ที่พัก', distOut:0, distRet:0 }
        }
      };
      exportPDF(rec).then(()=>{
        const el=document.getElementById('formal-doc')||document.getElementById('pdf-container');
        res(el ? el.innerText.replace(/\\s+/g,' ') : 'ไม่พบเอกสาร');
      }).catch(e=>res('ล้มเหลว: '+e.message));
    });`);
  const hasOld = s => typeof old === 'string' && old.includes(s);
  check('ใบเก่าไม่มี _docDate → ใช้วันที่สร้างใบเหมือนเดิม (10/09/2569)', hasOld('10/09/2569'));
  check('ใบเก่าไม่มี periodStart → ใช้วันเดินทางเหมือนเดิม (26/08/2569 - 28/08/2569)',
        hasOld('26/08/2569') && hasOld('28/08/2569'));

  const realErr = errors.filter(e=>!/favicon|fonts\.g|ERR_|html2pdf/i.test(e));
  check('ไม่มี JavaScript error', realErr.length===0, realErr.slice(0,2).join(' | '));

  const pass=results.filter(r=>r.ok).length, fail=results.filter(r=>!r.ok);
  console.log('\n'+'═'.repeat(60));
  console.log('  ผ่าน '+pass+' / '+results.length);
  fail.forEach(f=>console.log('    ✗ '+f.n));
  console.log('═'.repeat(60));
  process.exitCode = fail.length?1:0;
} catch(e){ console.error('ล้มเหลว:', e.message); process.exitCode=2; }
finally { try{ws.close();}catch{} chrome.kill(); }
